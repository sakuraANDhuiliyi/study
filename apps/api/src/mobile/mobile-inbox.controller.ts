import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { inboxKind, inboxLabels, inboxTarget } from './mobile-inbox.policy';
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(10),
    unread: z.enum(['true', 'false']).optional(),
    kind: z.enum(['assignment', 'exam', 'grade', 'course', 'other']).optional(),
  })
  .strict();
@Controller('mobile/notifications')
@UseGuards(AuthGuard)
export class MobileInboxController {
  constructor(private db: PrismaService) {}
  private async scoped<T>(
    a: Actor,
    run: (tx: Prisma.TransactionClient, auth: AuthService, current: Actor) => Promise<T>,
  ) {
    if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT') throw new ForbiddenException('请使用学生手机会话');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${'mobile-inbox:' + a.organizationId + ':' + a.id}))`;
      const auth = new AuthService(tx as PrismaService);
      const current = a.sessionId ? await auth.resolveMobileSessionId(a.sessionId) : null;
      if (
        !current ||
        current.id !== a.id ||
        current.organizationId !== a.organizationId ||
        current.role !== a.role
      )
        throw new UnauthorizedException('会话或身份已变化，请重新登录');
      auth.require(current, 'learning.use');
      return run(tx, auth, current);
    });
  }
  @Get()
  async list(@CurrentActor() a: Actor, @Query() input: unknown) {
    const q = querySchema.parse(input);
    return this.scoped(a, async (tx, _auth, actor) => {
      const own = { userId: actor.id, organizationId: actor.organizationId };
      const known = ['assignment', 'exam', 'grade', 'MEMBERSHIP', 'ANNOUNCEMENT'];
      const where: Prisma.NotificationWhereInput = {
        ...own,
        ...(q.unread === 'true' ? { readAt: null } : {}),
        ...(q.kind
          ? {
              type:
                q.kind === 'other'
                  ? { notIn: known }
                  : q.kind === 'course'
                    ? { in: ['MEMBERSHIP', 'ANNOUNCEMENT'] }
                    : q.kind,
            }
          : {}),
      };
      const items = await tx.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      });
      return {
        items: items.map((n) => ({
          id: n.id,
          kind: inboxKind(n.type),
          title: inboxLabels[inboxKind(n.type)],
          createdAt: n.createdAt,
          readAt: n.readAt,
          canOpen: Boolean(inboxTarget(n.type, n.link)),
        })),
        total: await tx.notification.count({ where }),
        unreadCount: await tx.notification.count({ where: { ...own, readAt: null } }),
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }
  @Post('read')
  async read(@CurrentActor() a: Actor, @Body() body: unknown) {
    const ids = [
      ...new Set(
        z
          .object({ ids: z.array(idSchema).min(1).max(20) })
          .strict()
          .parse(body).ids,
      ),
    ];
    return this.scoped(a, async (tx, _auth, actor) => {
      const where = { userId: actor.id, organizationId: actor.organizationId, id: { in: ids } };
      if ((await tx.notification.count({ where })) !== ids.length)
        throw new NotFoundException('通知不存在或不属于本人');
      const result = await tx.notification.updateMany({
        where: { ...where, readAt: null },
        data: { readAt: new Date() },
      });
      return { success: true, updated: result.count };
    });
  }
  @Get(':id/target')
  async target(@CurrentActor() a: Actor, @Param('id') id: string) {
    idSchema.parse(id);
    return this.scoped(a, async (tx, auth, actor) => {
      const n = await tx.notification.findFirst({
        where: { id, organizationId: actor.organizationId, userId: actor.id },
      });
      if (!n) throw new NotFoundException('通知不存在或不属于本人');
      const target = inboxTarget(n.type, n.link);
      if (!target) throw new NotFoundException('此类通知详情尚未迁移，请在网站查看');
      let courseId: string;
      if (target.name === 'course') courseId = target.id;
      else if (target.name === 'assignment') {
        const row = await tx.assignment.findFirst({
          where: {
            id: target.id,
            organizationId: actor.organizationId,
            status: 'published',
            opensAt: { lte: new Date() },
            audience: { some: { userId: actor.id } },
          },
        });
        if (!row) throw new NotFoundException('作业不存在或当前不可访问');
        courseId = row.courseId;
      } else {
        const attempt =
          target.name === 'review'
            ? await tx.examAttempt.findFirst({
                where: { id: target.id, userId: actor.id, exam: { organizationId: actor.organizationId } },
              })
            : null;
        if (target.name === 'review' && !attempt) throw new NotFoundException('答卷不存在或不属于本人');
        const exam = await tx.exam.findFirst({
          where: {
            id: attempt?.examId || target.id,
            organizationId: actor.organizationId,
            status: { not: 'draft' },
            audience: { some: { userId: actor.id, eligible: true } },
          },
        });
        if (!exam) throw new NotFoundException('考试不存在或没有访问资格');
        courseId = exam.courseId;
      }
      await auth.course(actor, courseId);
      return target;
    });
  }
}
