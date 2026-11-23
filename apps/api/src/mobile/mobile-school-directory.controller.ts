import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { AdminController } from '../admin/admin.controller';
import { CoursesController } from '../courses/courses.controller';
import * as p from './mobile-school-directory.policy';
const q = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
@Controller('mobile/school-directory')
@UseGuards(AuthGuard)
export class MobileSchoolDirectoryController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: PrismaService,
    private readonly admin: AdminController,
    private readonly courses: CoursesController,
  ) {}
  private async current(a: Actor, permissions: string[]) {
    if (
      a.clientType !== 'MOBILE' ||
      a.accountMode !== 'ORGANIZATION' ||
      !['ADMIN', 'SUPER_ADMIN'].includes(a.role)
    )
      throw new ForbiddenException('请使用机构管理员手机身份');
    const f = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (
      !f ||
      f.id !== a.id ||
      f.organizationId !== a.organizationId ||
      f.role !== a.role ||
      f.accountMode !== 'ORGANIZATION'
    )
      throw new UnauthorizedException('管理身份已变化，请重新登录');
    for (const permission of permissions) this.auth.require(f, permission);
    return f;
  }
  private async read<T>(a: Actor, permissions: string[], run: (f: Actor) => Promise<T>) {
    const result = await run(await this.current(a, permissions));
    await this.current(a, permissions);
    return result;
  }
  @Get('users') users(@CurrentActor() a: Actor, @Query() query: unknown) {
    return this.read(a, ['users.manage'], (f) => this.admin.users(f, q(p.schoolDirectoryQuery.parse(query))));
  }
  @Patch('users/:id/roles') async roles(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.admin.update(
      await this.current(a, ['users.manage']),
      p.schoolDirectoryId.parse(id),
      p.schoolDirectoryRoles.parse(b),
    );
  }
  @Post('users/import') async importUsers(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.admin.importUsers(await this.current(a, ['users.manage']), p.schoolDirectoryImport.parse(b));
  }
  private async csv(a: Actor, exporting: boolean, res: Response) {
    const permissions = exporting ? ['users.manage', 'data.export'] : ['users.manage'],
      fresh = await this.current(a, permissions);
    let payload: string | undefined;
    const capture = {
      type: () => capture,
      attachment: () => capture,
      send: (text: string) => {
        payload = text;
        return capture;
      },
    };
    if (exporting) await this.admin.exportUsers(fresh, capture as unknown as Response);
    else this.admin.template(fresh, capture as unknown as Response);
    if (payload === undefined) throw new NotFoundException('导出文件尚未生成');
    if (Buffer.byteLength(payload, 'utf8') > 8 * 1024 * 1024)
      throw new PayloadTooLargeException('文件超过手机端8MiB导出上限');
    await this.current(a, permissions);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res
      .type('text/csv; charset=utf-8')
      .attachment(exporting ? 'users.csv' : 'user-import-template.csv')
      .send(payload);
  }
  @Get('users/template') template(@CurrentActor() a: Actor, @Res() res: Response) {
    return this.csv(a, false, res);
  }
  @Get('users/export') export(@CurrentActor() a: Actor, @Res() res: Response) {
    return this.csv(a, true, res);
  }
  @Get('classes') classes(@CurrentActor() a: Actor, @Query() query: unknown) {
    return this.read(a, ['org.manage', 'course.admin'], (f) =>
      this.admin.classes(f, q(p.schoolDirectoryQuery.parse(query))),
    );
  }
  @Get('courses') courseList(@CurrentActor() a: Actor, @Query() query: unknown) {
    return this.read(a, ['org.manage', 'course.admin'], (f) =>
      this.courses.list(f, q(p.schoolDirectoryQuery.parse(query))),
    );
  }
  @Get('classes/:id/courses') bindings(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.read(a, ['org.manage', 'course.admin'], async (f) => {
      p.schoolDirectoryId.parse(id);
      const page = p.schoolDirectoryQuery.omit({ search: true }).parse(query);
      if (!(await this.db.class.findFirst({ where: { id, organizationId: f.organizationId } })))
        throw new NotFoundException('班级不存在');
      const courseIds = await this.auth.courseIds(f);
      const where = { classId: id, courseId: { in: courseIds } };
      const [rows, total] = await this.db.$transaction([
        this.db.courseClass.findMany({
          where,
          orderBy: { id: 'asc' },
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
        }),
        this.db.courseClass.count({ where }),
      ]);
      const courses = await this.db.course.findMany({
        where: { id: { in: rows.map((r) => r.courseId) }, organizationId: f.organizationId },
        select: { id: true, title: true, status: true },
      });
      return {
        ...page,
        total,
        items: rows
          .filter((r) => courses.some((c) => c.id === r.courseId))
          .map((r) => ({ ...r, course: courses.find((c) => c.id === r.courseId) })),
      };
    });
  }
  @Post('classes/:id/courses') async bind(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.admin.classCourse(
      await this.current(a, ['org.manage', 'course.admin']),
      p.schoolDirectoryId.parse(id),
      p.schoolDirectoryBinding.parse(b),
    );
  }
}
