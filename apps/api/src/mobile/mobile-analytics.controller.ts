import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AnalyticsController } from '../analytics/analytics.controller';
import { StudentOverviewService } from '../analytics/student-overview.service';
import { GradingQueueService } from '../assessment/grading-queue.service';
import { CoursesController } from '../courses/courses.controller';
import {
  mobileAnalyticsQuery,
  mobileAnalyticsExportQuery,
  mobileAnnouncementInput,
  mobileAnnouncementQuery,
} from './mobile-teaching-tools.schemas';
@Controller('mobile')
@UseGuards(AuthGuard)
export class MobileAnalyticsController {
  private analytics: AnalyticsController;
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    audit: AuditService,
    overview: StudentOverviewService,
    grading: GradingQueueService,
  ) {
    this.analytics = new AnalyticsController(db, auth, audit, overview, grading);
  }
  private async current(a: Actor, db: PrismaService | Prisma.TransactionClient = this.db) {
    if (a.clientType !== 'MOBILE' || !['STUDENT', 'TEACHER', 'ADMIN', 'SUPER_ADMIN'].includes(a.role))
      throw new ForbiddenException('当前身份不能查看学习统计');
    const auth = db === this.db ? this.auth : new AuthService(db as PrismaService);
    const current = a.sessionId ? await auth.resolveMobileSessionId(a.sessionId) : null;
    if (
      !current ||
      current.id !== a.id ||
      current.organizationId !== a.organizationId ||
      current.role !== a.role
    )
      throw new UnauthorizedException('会话已变化，请重新登录');
    if ([...current.permissions].sort().join('|') !== [...a.permissions].sort().join('|'))
      throw new ForbiddenException('授权已变化，请重新加载');
    if (current.role === 'STUDENT') {
      auth.require(current, 'learning.use');
      auth.require(current, 'course.read');
    } else auth.require(current, 'analysis.read');
    await auth.checkFeature(current, '/api/analytics');
    return current;
  }
  private async scope<T>(a: Actor, action: (actor: Actor, ids: string[]) => Promise<T>) {
    const current = await this.current(a),
      ids = await this.auth.courseIds(current);
    const result = await action(current, ids);
    const fresh = await this.current(a),
      after = await this.auth.courseIds(fresh);
    if ([...ids].sort().join('|') !== [...after].sort().join('|'))
      throw new ForbiddenException('课程授权已变化，请刷新后重试');
    return result;
  }
  @Get('analytics') read(@CurrentActor() a: Actor, @Query() query: unknown) {
    const q = mobileAnalyticsQuery.parse(query);
    return this.scope(a, (actor) => this.analytics.analytics(actor, q));
  }
  @Get('analytics/filters') filters(@CurrentActor() a: Actor) {
    return this.scope(a, async (actor, ids) => {
      const courses = await this.db.course.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, termId: true },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
      });
      const links = await this.db.courseClass.findMany({
        where: { courseId: { in: ids } },
        select: { classId: true },
      });
      const memberships =
        actor.role === 'STUDENT'
          ? await this.db.classMember.findMany({
              where: { userId: actor.id, active: true },
              select: { classId: true },
            })
          : null;
      const classes = await this.db.class.findMany({
        where: {
          organizationId: actor.organizationId,
          id: {
            in: links
              .map((l) => l.classId)
              .filter((id) => !memberships || memberships.some((m) => m.classId === id)),
          },
        },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      const terms = await this.db.academicTerm.findMany({
        where: {
          organizationId: actor.organizationId,
          id: { in: courses.flatMap((c) => (c.termId ? [c.termId] : [])) },
        },
        select: { id: true, name: true },
        orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      });
      const canExport =
        actor.role === 'STUDENT' ||
        (actor.permissions.includes('data.export') &&
          (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role) ||
            actor.permissions.includes('analysis.sensitive')));
      return { courses: courses.map((c) => ({ id: c.id, title: c.title })), classes, terms, canExport };
    });
  }
  @Get('analytics/export') async export(
    @CurrentActor() a: Actor,
    @Query() query: unknown,
    @Res() response: Response,
  ) {
    const q = mobileAnalyticsExportQuery.parse(query);
    const output = await this.scope(a, async (actor) => {
      let text = '',
        filename = '',
        contentType = '';
      const capture = {
        set: () => capture,
        type: (value: string) => {
          contentType = value;
          return capture;
        },
        attachment: (value: string) => {
          filename = value;
          return capture;
        },
        send: (value: string) => {
          text = value;
          return capture;
        },
      };
      await this.analytics.export(actor, q, capture as unknown as Response);
      return { text, filename, contentType };
    });
    response
      .set('Cache-Control', 'private, no-store')
      .type(output.contentType)
      .attachment(output.filename)
      .send(output.text);
  }
  @Get('teaching-announcements') async announcements(@CurrentActor() a: Actor, @Query() query: unknown) {
    if (a.clientType !== 'MOBILE' || a.role !== 'TEACHER') throw new ForbiddenException('请使用教师手机会话');
    const input = mobileAnnouncementQuery.parse(query);
    const current = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (
      !current ||
      current.id !== a.id ||
      current.organizationId !== a.organizationId ||
      current.role !== a.role
    )
      throw new UnauthorizedException('教师会话已变化');
    await this.auth.checkFeature(current, '/api/courses');
    await this.auth.course(current, input.courseId);
    const output = await new CoursesController(this.db, this.auth, new AuditService(this.db)).announcements(
      current,
      { courseId: input.courseId, page: String(input.page), pageSize: String(input.pageSize) },
    );
    const fresh = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (!fresh || fresh.id !== a.id || fresh.organizationId !== a.organizationId || fresh.role !== a.role)
      throw new UnauthorizedException('教师会话已变化');
    await this.auth.checkFeature(fresh, '/api/courses');
    await this.auth.course(fresh, input.courseId);
    return {
      ...output,
      items: output.items.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        createdAt: row.createdAt,
      })),
    };
  }
  @Post('teaching-announcements') async announcement(@CurrentActor() a: Actor, @Body() body: unknown) {
    if (a.clientType !== 'MOBILE' || a.role !== 'TEACHER')
      throw new ForbiddenException('请使用教师手机会话发布课程公告');
    const input = mobileAnnouncementInput.parse(body);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${a.id} FOR UPDATE`;
      const auth = new AuthService(tx as PrismaService),
        current = a.sessionId ? await auth.resolveMobileSessionId(a.sessionId) : null;
      if (
        !current ||
        current.id !== a.id ||
        current.organizationId !== a.organizationId ||
        current.role !== a.role
      )
        throw new UnauthorizedException('教师会话已失效');
      await auth.checkFeature(current, '/api/courses');
      await auth.course(current, input.courseId, true);
      const related = await tx.$queryRaw<
        { id: string }[]
      >`SELECT c.id FROM "Course" c JOIN "TeachingAssignment" t ON t."courseId" = c.id WHERE c.id = ${input.courseId} AND c."organizationId" = ${current.organizationId} AND c.status <> 'ARCHIVED' AND t."userId" = ${current.id} AND t.active = true FOR SHARE OF c, t`;
      if (!related.length) throw new ForbiddenException('课程不允许当前教师发布公告');
      return new CoursesController(
        tx as PrismaService,
        auth,
        new AuditService(tx as PrismaService),
      ).announcement(current, input);
    });
  }
}
