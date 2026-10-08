import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from '../auth/auth.service';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuditService } from '../common/audit.service';
import { hashPassword } from '../auth/password';
import { roleDefinitions } from '../auth/permissions';
import { paging, username, password, dateString, safeUser, csvCell } from '../common/utils';
const role = z.enum(['STUDENT', 'TEACHER', 'ADMIN', 'SUPER_ADMIN']);
export const newUser = z.object({
  username,
  name: z.string().trim().min(1).max(80),
  password,
  studentNo: z.string().max(64).nullable().optional(),
  roles: z.array(role).min(1).max(4),
});
@ApiTags('机构与后台管理')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private audit: AuditService,
  ) {}
  private roleCeiling(a: Actor, roles: string[]) {
    this.auth.require(a, 'users.manage');
    if (
      roles.includes('SUPER_ADMIN') ||
      (a.role !== 'SUPER_ADMIN' && roles.some((r) => !['STUDENT', 'TEACHER'].includes(r)))
    )
      throw new ForbiddenException('超出可授予的角色范围');
  }
  private async target(a: Actor, id: string) {
    const u = await this.db.user.findFirst({
      where: { id, organizationId: a.organizationId },
      include: { roles: true },
    });
    if (!u) throw new NotFoundException('用户不存在');
    if (
      u.roles.some((r) => r.roleId === 'SUPER_ADMIN') ||
      (a.role !== 'SUPER_ADMIN' && u.roles.some((r) => r.roleId === 'ADMIN'))
    )
      throw new ForbiddenException('不能管理同级或更高权限的账号');
    return u;
  }
  @Get('users') async users(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    this.auth.require(a, 'users.manage');
    const p = paging(q);
    const where = {
      organizationId: a.organizationId,
      ...(q.role ? { roles: { some: { roleId: q.role } } } : {}),
      ...(q.active ? { active: q.active === 'true' } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { username: { contains: q.search, mode: 'insensitive' as const } },
              { studentNo: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: safeUser,
        skip: p.skip,
        take: p.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.user.count({ where }),
    ]);
    return {
      items: items.map((u) => ({ ...u, roles: u.roles.map((r) => r.roleId) })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  @Get('people') async people(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    if (!a.permissions.some((p) => ['users.manage', 'course.manage', 'course.admin'].includes(p)))
      throw new ForbiddenException();
    const p = paging({ ...q, pageSize: q.pageSize || '100' });
    let permittedIds: string[] | undefined;
    if (a.role === 'TEACHER') {
      const courses = await this.auth.courseIds(a);
      const [students, teachers] = await Promise.all([
        this.db.enrollment.findMany({
          where: { courseId: { in: courses }, active: true },
          select: { userId: true },
        }),
        this.db.teachingAssignment.findMany({
          where: { courseId: { in: courses }, active: true },
          select: { userId: true },
        }),
      ]);
      permittedIds = [...new Set([...students, ...teachers].map((m) => m.userId))];
    }
    const where = {
      organizationId: a.organizationId,
      active: true,
      ...(permittedIds ? { id: { in: permittedIds } } : {}),
      ...(q.role ? { roles: { some: { roleId: q.role } } } : {}),
      ...(q.search ? { name: { contains: q.search } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: { id: true, name: true, username: true, roles: { select: { roleId: true } } },
        skip: p.skip,
        take: p.pageSize,
        orderBy: { id: 'asc' },
      }),
      this.db.user.count({ where }),
    ]);
    return {
      items: items.map((u) => ({ ...u, roles: u.roles.map((r) => r.roleId) })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  @Post('users') async create(@CurrentActor() a: Actor, @Body() body: unknown) {
    const d = newUser.parse(body);
    this.roleCeiling(a, d.roles);
    const passwordHash = hashPassword(d.password);
    const user = await this.db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          organizationId: a.organizationId,
          username: d.username.toLowerCase(),
          name: d.name,
          passwordHash,
          studentNo: d.studentNo,
          roles: { create: [...new Set(d.roles)].map((roleId) => ({ roleId })) },
        },
        select: safeUser,
      });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          userId: a.id,
          action: 'user.create',
          resourceType: 'User',
          resourceId: u.id,
          details: { roles: d.roles },
          requestId: a.requestId,
        },
      });
      return u;
    });
    return { ...user, roles: user.roles.map((r) => r.roleId) };
  }
  @Patch('users/:id') async update(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    this.auth.require(a, 'users.manage');
    if (a.id === id) throw new ForbiddenException('请使用个人设置；不能修改自己的权限');
    const before = await this.target(a, id);
    const d = z
      .object({
        name: z.string().min(1).max(80).optional(),
        active: z.boolean().optional(),
        roles: z.array(role).min(1).max(4).optional(),
        password: password.optional(),
        studentNo: z.string().max(64).nullable().optional(),
      })
      .parse(body);
    if (d.roles) this.roleCeiling(a, d.roles);
    const result = await this.db.$transaction(async (tx) => {
      if (d.roles) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({
          data: [...new Set(d.roles)].map((roleId) => ({ userId: id, roleId })),
        });
      }
      const u = await tx.user.update({
        where: { id },
        data: {
          name: d.name,
          active: d.active,
          studentNo: d.studentNo,
          ...(d.password ? { passwordHash: hashPassword(d.password) } : {}),
          ...(d.roles || d.password || d.active !== undefined ? { authVersion: { increment: 1 } } : {}),
        },
        select: safeUser,
      });
      if (d.roles || d.password || d.active !== undefined)
        await tx.session.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          userId: a.id,
          action: 'user.update',
          resourceType: 'User',
          resourceId: id,
          details: {
            before: { roles: before.roles.map((r) => r.roleId), active: before.active },
            after: { roles: u.roles.map((r) => r.roleId), active: u.active },
            passwordReset: !!d.password,
          },
          requestId: a.requestId,
        },
      });
      return u;
    });
    if (d.roles || d.active !== undefined || d.password)
      await this.audit.notify(
        [id],
        a.organizationId,
        'MEMBERSHIP',
        '账号授权或安全设置已更新',
        d.roles ? '你的角色授权已调整，请重新登录查看当前权限。' : '管理员已更新你的账号状态或安全设置。',
        '/profile',
        `user-access:${result.id}:${result.createdAt.getTime()}:${Date.now()}`,
      );
    return { ...result, roles: result.roles.map((r) => r.roleId) };
  }
  @Get('users/template') template(@CurrentActor() a: Actor, @Res() res: Response) {
    this.auth.require(a, 'users.manage');
    res
      .type('text/csv; charset=utf-8')
      .attachment('user-import-template.csv')
      .send(
        '\ufeffusername,name,password,studentNo,roles\nsample_student,学生姓名,请设置12位以上密码,20260001,STUDENT\n',
      );
  }
  @Post('users/import') async importUsers(@CurrentActor() a: Actor, @Body() body: unknown) {
    this.auth.require(a, 'users.manage');
    const input = z
      .object({ rows: z.array(z.unknown()).min(1).max(500), commit: z.boolean().default(false) })
      .parse(body);
    const errors: { row: number; message: string }[] = [];
    const rows: z.infer<typeof newUser>[] = [];
    const usernames = new Set<string>(),
      numbers = new Set<string>();
    for (const [index, rowData] of input.rows.entries()) {
      const result = newUser.safeParse(rowData);
      if (!result.success) {
        errors.push({
          row: index + 2,
          message: result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('；'),
        });
        continue;
      }
      const r = result.data;
      r.username = r.username.toLowerCase();
      try {
        this.roleCeiling(a, r.roles);
      } catch {
        errors.push({ row: index + 2, message: '角色超出授权范围' });
      }
      if (usernames.has(r.username)) errors.push({ row: index + 2, message: '文件内账号重复' });
      if (r.studentNo && numbers.has(r.studentNo)) errors.push({ row: index + 2, message: '文件内学号重复' });
      usernames.add(r.username);
      if (r.studentNo) numbers.add(r.studentNo);
      rows.push(r);
    }
    const existing = await this.db.user.findMany({
      where: {
        OR: [
          { username: { in: [...usernames] } },
          { organizationId: a.organizationId, studentNo: { in: [...numbers] } },
        ],
      },
      select: { username: true, studentNo: true },
    });
    for (const [i, r] of input.rows.entries()) {
      const parsed = newUser.safeParse(r);
      if (!parsed.success) continue;
      const x = parsed.data;
      if (
        existing.some(
          (e) => e.username === x.username.toLowerCase() || (x.studentNo && e.studentNo === x.studentNo),
        )
      )
        errors.push({ row: i + 2, message: '账号或学号已存在' });
    }
    if (errors.length || !input.commit)
      return {
        valid: errors.length === 0,
        committed: false,
        total: input.rows.length,
        errors,
        preview: rows.map(({ password: _password, ...r }) => r),
      };
    const hashes = rows.map((r) => hashPassword(r.password));
    await this.db.$transaction(
      async (tx) => {
        for (const [i, r] of rows.entries())
          await tx.user.create({
            data: {
              organizationId: a.organizationId,
              username: r.username,
              name: r.name,
              studentNo: r.studentNo,
              passwordHash: hashes[i],
              roles: { create: [...new Set(r.roles)].map((roleId) => ({ roleId })) },
            },
          });
        await tx.auditLog.create({
          data: {
            organizationId: a.organizationId,
            userId: a.id,
            action: 'user.import',
            resourceType: 'User',
            resourceId: 'batch',
            details: { count: rows.length },
          },
        });
      },
      { timeout: 30000 },
    );
    return { valid: true, committed: true, total: rows.length, errors: [] };
  }
  @Post('users/batch') async batch(@CurrentActor() a: Actor, @Body() body: unknown) {
    const d = z.object({ ids: z.array(z.string()).min(1).max(100), active: z.boolean() }).parse(body);
    this.auth.require(a, 'users.manage');
    const results = [];
    for (const id of [...new Set(d.ids)]) {
      try {
        await this.update(a, id, { active: d.active });
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : '操作失败' });
      }
    }
    return { results };
  }
  @Get('users/export') async exportUsers(@CurrentActor() a: Actor, @Res() res: Response) {
    this.auth.require(a, 'users.manage');
    this.auth.require(a, 'data.export');
    const users = await this.db.user.findMany({
      where: { organizationId: a.organizationId },
      select: safeUser,
      orderBy: { id: 'asc' },
      take: 10000,
    });
    await this.audit.record(a, 'data.export', 'User', 'export', { count: users.length });
    res
      .type('text/csv; charset=utf-8')
      .attachment('users.csv')
      .send(
        '\ufeff' +
          [
            ['账号', '姓名', '学号', '角色', '启用'],
            ...users.map((u) => [
              u.username,
              u.name,
              u.studentNo,
              u.roles.map((r) => r.roleId).join('|'),
              u.active,
            ]),
          ]
            .map((row) => row.map(csvCell).join(','))
            .join('\r\n'),
      );
  }
  @Get('terms') async terms(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    this.auth.require(a, 'org.manage');
    const p = paging(q);
    const where = { organizationId: a.organizationId, ...(q.search ? { name: { contains: q.search } } : {}) };
    const [items, total] = await Promise.all([
      this.db.academicTerm.findMany({
        where,
        skip: p.skip,
        take: p.pageSize,
        orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.academicTerm.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  @Post('terms') async termCreate(@CurrentActor() a: Actor, @Body() body: unknown) {
    this.auth.require(a, 'org.manage');
    const d = z
      .object({ name: z.string().min(1).max(100), startsAt: dateString, endsAt: dateString })
      .refine((d) => new Date(d.endsAt) > new Date(d.startsAt), '结束时间必须晚于开始时间')
      .parse(body);
    return this.db.academicTerm.create({ data: { ...d, organizationId: a.organizationId } });
  }
  @Get('classes') async classes(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    this.auth.require(a, 'org.manage');
    const p = paging(q);
    const where = { organizationId: a.organizationId, ...(q.search ? { name: { contains: q.search } } : {}) };
    const [items, total] = await Promise.all([
      this.db.class.findMany({
        where,
        skip: p.skip,
        take: p.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.class.count({ where }),
    ]);
    const counts = await this.db.classMember.groupBy({
      by: ['classId'],
      where: { classId: { in: items.map((x) => x.id) }, active: true },
      _count: true,
    });
    const terms = await this.db.academicTerm.findMany({
      where: {
        id: { in: items.flatMap((x) => (x.termId ? [x.termId] : [])) },
        organizationId: a.organizationId,
      },
      select: { id: true, name: true },
    });
    return {
      items: items.map((x) => ({
        ...x,
        term: terms.find((t) => t.id === x.termId) || null,
        memberCount: counts.find((c) => c.classId === x.id)?._count || 0,
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  @Post('classes') async classCreate(@CurrentActor() a: Actor, @Body() body: unknown) {
    this.auth.require(a, 'org.manage');
    const d = z
      .object({
        name: z.string().min(1).max(100),
        grade: z.string().min(1).max(100),
        termId: z.string().nullable().optional(),
      })
      .parse(body);
    if (
      d.termId &&
      !(await this.db.academicTerm.findFirst({ where: { id: d.termId, organizationId: a.organizationId } }))
    )
      throw new BadRequestException('学期无效');
    return this.db.class.create({ data: { ...d, organizationId: a.organizationId } });
  }
  @Patch('classes/:id') async classEdit(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.require(a, 'org.manage');
    const cl = await this.db.class.findFirst({ where: { id, organizationId: a.organizationId } });
    if (!cl) throw new NotFoundException();
    const d = z
      .object({ name: z.string().min(1).max(100).optional(), grade: z.string().min(1).max(100).optional() })
      .parse(body);
    return this.db.class.update({ where: { id }, data: d });
  }
  @Get('classes/:id/members') async classMembers(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: Record<string, string>,
  ) {
    this.auth.require(a, 'org.manage');
    if (!(await this.db.class.findFirst({ where: { id, organizationId: a.organizationId } })))
      throw new NotFoundException();
    const p = paging(q);
    const memberships = await this.db.classMember.findMany({
      where: { classId: id, active: true },
      orderBy: { id: 'asc' },
      skip: p.skip,
      take: p.pageSize,
    });
    const users = await this.db.user.findMany({
      where: { id: { in: memberships.map((m) => m.userId) } },
      select: safeUser,
    });
    return {
      items: users.map((u) => ({ ...u, roles: u.roles.map((r) => r.roleId) })),
      total: await this.db.classMember.count({ where: { classId: id, active: true } }),
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  @Post('classes/:id/members') async classMember(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.require(a, 'org.manage');
    const d = z
      .object({ userId: z.string(), active: z.boolean().default(true), transferFrom: z.string().optional() })
      .parse(body);
    if (
      !(await this.db.class.findFirst({ where: { id, organizationId: a.organizationId } })) ||
      !(await this.db.user.findFirst({
        where: { id: d.userId, organizationId: a.organizationId, roles: { some: { roleId: 'STUDENT' } } },
      }))
    )
      throw new BadRequestException('班级或学生无效');
    if (
      d.transferFrom &&
      !(await this.db.class.findFirst({ where: { id: d.transferFrom, organizationId: a.organizationId } }))
    )
      throw new BadRequestException('原班级无效');
    const result = await this.db.$transaction(async (tx) => {
      if (d.transferFrom)
        await tx.classMember.updateMany({
          where: { classId: d.transferFrom, userId: d.userId },
          data: { active: false },
        });
      return tx.classMember.upsert({
        where: { classId_userId: { classId: id, userId: d.userId } },
        create: { classId: id, userId: d.userId, active: d.active },
        update: { active: d.active },
      });
    });
    await this.audit.record(a, 'class.membership', 'Class', id, {
      userId: d.userId,
      active: d.active,
      transferFrom: d.transferFrom,
    });
    await this.audit.notify(
      [d.userId],
      a.organizationId,
      'MEMBERSHIP',
      '班级成员资格更新',
      d.transferFrom
        ? '你的行政班级已调整，课程授权请以当前课程列表为准。'
        : d.active
          ? '你已加入行政班级。'
          : '你的行政班级成员资格已移除。',
      '/courses',
      `class-member:${result.id}:${Date.now()}`,
    );
    return result;
  }
  @Post('classes/:id/courses') async classCourse(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.require(a, 'org.manage');
    this.auth.require(a, 'course.admin');
    const d = z.object({ courseId: z.string(), name: z.string().min(1).max(100).optional() }).parse(body);
    const cl = await this.db.class.findFirst({ where: { id, organizationId: a.organizationId } });
    if (!cl) throw new NotFoundException();
    await this.auth.course(a, d.courseId, true);
    const members = await this.db.classMember.findMany({ where: { classId: id, active: true } });
    const result = await this.db.$transaction(async (tx) => {
      const cc = await tx.courseClass.upsert({
        where: { courseId_classId: { courseId: d.courseId, classId: id } },
        create: { courseId: d.courseId, classId: id, name: d.name || cl.name + '教学班' },
        update: {},
      });
      for (const m of members)
        await tx.enrollment.upsert({
          where: { courseId_userId: { courseId: d.courseId, userId: m.userId } },
          create: { courseId: d.courseId, userId: m.userId },
          update: { active: true },
        });
      return cc;
    });
    await this.audit.record(a, 'class.course.assign', 'Course', d.courseId, {
      classId: id,
      count: members.length,
    });
    return result;
  }
  @Get('organizations') async organizations(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    this.auth.require(a, 'org.platform');
    const p = paging(q);
    const [items, total] = await Promise.all([
      this.db.organization.findMany({
        skip: p.skip,
        take: p.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.organization.count(),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  @Post('organizations') async organization(@CurrentActor() a: Actor, @Body() body: unknown) {
    this.auth.require(a, 'org.platform');
    const d = z.object({ name: z.string().min(2).max(100) }).parse(body);
    const o = await this.db.organization.create({ data: d });
    await this.audit.record(a, 'organization.create', 'Organization', o.id);
    return o;
  }
  @Patch('organizations/:id') async organizationEdit(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.require(a, 'org.platform');
    const d = z
      .object({
        name: z.string().min(2).max(100).optional(),
        active: z.boolean().optional(),
        reason: z.string().min(5).max(500),
      })
      .parse(body);
    if (id === a.organizationId && d.active === false) throw new ForbiddenException('不能停用当前管理机构');
    const before = await this.db.organization.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const org = await this.db.organization.update({
      where: { id },
      data: { name: d.name, active: d.active },
    });
    await this.audit.record(a, 'organization.update', 'Organization', id, {
      before: { name: before.name, active: before.active },
      after: { name: org.name, active: org.active },
      reason: d.reason,
    });
    return org;
  }
  @Post('organizations/:id/admins') async organizationAdmin(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.require(a, 'org.platform');
    this.auth.require(a, 'users.manage');
    const d = z
      .object({ username, name: z.string().min(1).max(80), password, reason: z.string().min(5).max(500) })
      .parse(body);
    if (!(await this.db.organization.findFirst({ where: { id, active: true } })))
      throw new NotFoundException();
    const user = await this.db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          organizationId: id,
          username: d.username.toLowerCase(),
          name: d.name,
          passwordHash: hashPassword(d.password),
          roles: { create: { roleId: 'ADMIN' } },
        },
        select: safeUser,
      });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          userId: a.id,
          action: 'organization.admin.create',
          resourceType: 'User',
          resourceId: u.id,
          details: { targetOrganizationId: id, reason: d.reason },
        },
      });
      return u;
    });
    return { ...user, roles: user.roles.map((r) => r.roleId) };
  }
  @Get('roles') async roles(@CurrentActor() a: Actor) {
    this.auth.require(a, 'users.manage');
    const items = await this.db.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { id: 'asc' },
    });
    return {
      items,
      permissions: await this.db.permission.findMany({ orderBy: { id: 'asc' } }),
      total: items.length,
      page: 1,
      pageSize: 100,
    };
  }
  @Patch('roles/:id') async roleEdit(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.require(a, 'roles.manage');
    const d = z
      .object({ permissions: z.array(z.string()).max(100), reason: z.string().min(5).max(500) })
      .parse(body);
    const ownRoles = await this.db.userRole.findMany({ where: { userId: a.id } });
    if (ownRoles.some((r) => r.roleId === id)) throw new ForbiddenException('不能修改自己持有的角色模板');
    if (!(await this.db.role.findUnique({ where: { id } }))) throw new NotFoundException();
    const all = await this.db.permission.findMany();
    const before = await this.db.rolePermission.findMany({ where: { roleId: id } });
    if (
      d.permissions.some(
        (id) =>
          !all.some((p) => p.id === id) ||
          (all.some((p) => p.id === id && p.sensitive) &&
            !a.permissions.includes(id) &&
            !before.some((p) => p.permissionId === id)),
      )
    )
      throw new ForbiddenException('敏感权限必须先取得独立授权，且只能使用已定义的权限');
    if (d.permissions.some((p) => !roleDefinitions[id]?.permissions.includes(p)))
      throw new ForbiddenException('基础角色不能超越授权上限');
    await this.db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({
        data: [...new Set(d.permissions)].map((permissionId) => ({ roleId: id, permissionId })),
      });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          userId: a.id,
          action: 'role.permissions.change',
          resourceType: 'Role',
          resourceId: id,
          details: { before: before.map((p) => p.permissionId), after: d.permissions, reason: d.reason },
          requestId: a.requestId,
        },
      });
    });
    return { ok: true };
  }
  @Post('grants') async grant(@CurrentActor() a: Actor, @Body() body: unknown) {
    this.auth.require(a, 'grants.manage');
    const d = z
      .object({
        userId: z.string(),
        permissionId: z.string(),
        reason: z.string().min(5).max(500),
        expiresAt: dateString,
      })
      .parse(body);
    if (d.userId === a.id) throw new ForbiddenException('敏感权限不可自行授予');
    if (!(await this.db.user.findFirst({ where: { id: d.userId, organizationId: a.organizationId } })))
      throw new NotFoundException();
    const permission = await this.db.permission.findUnique({ where: { id: d.permissionId } });
    if (!permission?.sensitive) throw new BadRequestException('只支持独立敏感权限授权');
    const targetRoles = await this.db.userRole.findMany({
      where: { userId: d.userId },
      select: { roleId: true },
    });
    if (
      !(await this.db.rolePermission.findFirst({
        where: { roleId: { in: targetRoles.map((r) => r.roleId) }, permissionId: d.permissionId },
      }))
    )
      throw new BadRequestException('目标用户的角色模板不允许此敏感能力');
    if (new Date(d.expiresAt) <= new Date() || new Date(d.expiresAt).getTime() > Date.now() + 30 * 86400000)
      throw new BadRequestException('授权有效期必须为未来 30 天以内');
    const grant = await this.db.$transaction(async (tx) => {
      const g = await tx.sensitiveGrant.upsert({
        where: { userId_permissionId: { userId: d.userId, permissionId: d.permissionId } },
        create: { ...d, organizationId: a.organizationId, grantedBy: a.id },
        update: { expiresAt: d.expiresAt, reason: d.reason, grantedBy: a.id },
      });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          userId: a.id,
          action: 'sensitive.grant',
          requestId: a.requestId,
          resourceType: 'User',
          resourceId: d.userId,
          details: { permissionId: d.permissionId, reason: d.reason, expiresAt: d.expiresAt },
        },
      });
      return g;
    });
    return grant;
  }
  @Get('grants') async grants(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    this.auth.require(a, 'grants.manage');
    const p = paging(q);
    const where = { organizationId: a.organizationId };
    const [items, total] = await Promise.all([
      this.db.sensitiveGrant.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: p.pageSize,
        skip: p.skip,
      }),
      this.db.sensitiveGrant.count({ where }),
    ]);
    const users = await this.db.user.findMany({
      where: { id: { in: items.map((i) => i.userId) } },
      select: { id: true, name: true },
    });
    return {
      items: items.map((i) => ({ ...i, userName: users.find((u) => u.id === i.userId)?.name })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  @Delete('grants/:id') async revoke(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.require(a, 'grants.manage');
    const { reason } = z.object({ reason: z.string().min(5).max(500) }).parse(body);
    const grant = await this.db.sensitiveGrant.findFirst({ where: { id, organizationId: a.organizationId } });
    if (!grant) throw new NotFoundException();
    await this.db.$transaction(async (tx) => {
      await tx.sensitiveGrant.update({ where: { id }, data: { expiresAt: new Date() } });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          userId: a.id,
          action: 'sensitive.revoke',
          requestId: a.requestId,
          resourceType: 'User',
          resourceId: grant.userId,
          details: { permissionId: grant.permissionId, reason },
        },
      });
    });
    return { ok: true };
  }
  @Get('settings') async settings(@CurrentActor() a: Actor) {
    this.auth.require(a, 'settings.org');
    return {
      items: await this.db.systemSetting.findMany({
        where: { organizationId: a.organizationId },
        orderBy: { key: 'asc' },
      }),
    };
  }
  @Patch('settings') async settingsUpdate(@CurrentActor() a: Actor, @Body() body: unknown) {
    this.auth.require(a, 'settings.org');
    const d = z
      .object({
        key: z.enum([
          'platformName',
          'dataDictionary',
          'logoUrl',
          'notificationEnabled',
          'maxUploadMB',
          'allowedFileTypes',
          'features',
          'loginPolicy',
        ]),
        value: z.unknown(),
        reason: z.string().min(5).max(500),
      })
      .parse(body);
    if (['loginPolicy', 'features', 'allowedFileTypes', 'maxUploadMB'].includes(d.key))
      this.auth.require(a, 'settings.platform');
    if (d.key === 'platformName') z.string().min(1).max(80).parse(d.value);
    if (d.key === 'dataDictionary')
      z.object({
        courseCategories: z.array(z.string().trim().min(1).max(60)).max(100),
        grades: z.array(z.string().trim().min(1).max(100)).max(100),
      })
        .strict()
        .parse(d.value);
    if (d.key === 'logoUrl')
      z.string()
        .url()
        .refine((v) => /^https?:\/\//.test(v))
        .parse(d.value);
    if (d.key === 'notificationEnabled') z.boolean().parse(d.value);
    if (d.key === 'maxUploadMB') z.number().int().min(1).max(50).parse(d.value);
    if (d.key === 'allowedFileTypes')
      z.array(
        z.enum([
          'image/png',
          'image/jpeg',
          'image/gif',
          'image/webp',
          'application/pdf',
          'text/plain',
          'text/csv',
          'video/mp4',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ]),
      ).parse(d.value);
    if (d.key === 'features')
      z.object({ practice: z.boolean(), communication: z.boolean() }).strict().parse(d.value);
    if (d.key === 'loginPolicy')
      z.object({ sessionHours: z.number().int().min(1).max(72) })
        .strict()
        .parse(d.value);
    const before = await this.db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: a.organizationId, key: d.key } },
    });
    const v = JSON.parse(JSON.stringify(d.value));
    const result = await this.db.$transaction(async (tx) => {
      const r = await tx.systemSetting.upsert({
        where: { organizationId_key: { organizationId: a.organizationId, key: d.key } },
        create: { organizationId: a.organizationId, key: d.key, value: v },
        update: { value: v },
      });
      await tx.auditLog.create({
        data: {
          organizationId: a.organizationId,
          userId: a.id,
          action: 'settings.change',
          requestId: a.requestId,
          resourceType: 'SystemSetting',
          resourceId: r.id,
          details: { key: d.key, before: before?.value ?? null, after: v, reason: d.reason },
        },
      });
      return r;
    });
    return result;
  }
  @Get('audit') async auditList(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    this.auth.require(a, 'audit.read');
    const p = paging(q);
    const where = {
      organizationId: a.organizationId,
      ...(q.action ? { action: { contains: q.action } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        skip: p.skip,
        take: p.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.auditLog.count({ where }),
    ]);
    const users = await this.db.user.findMany({
      where: { id: { in: items.flatMap((i) => (i.userId ? [i.userId] : [])) } },
      select: { id: true, name: true },
    });
    return {
      items: items.map((i) => ({ ...i, actorName: users.find((u) => u.id === i.userId)?.name || '系统' })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  @Get('jobs') async jobs(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    this.auth.require(a, 'audit.read');
    const p = paging(q);
    const where = a.permissions.includes('org.platform') ? {} : { organizationId: a.organizationId };
    const [items, total] = await Promise.all([
      this.db.backgroundJob.findMany({
        where,
        select: {
          id: true,
          kind: true,
          status: true,
          attempts: true,
          runAt: true,
          lastError: true,
          createdAt: true,
        },
        skip: p.skip,
        take: p.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.backgroundJob.count({ where }),
    ]);
    return {
      items,
      total,
      page: p.page,
      pageSize: p.pageSize,
      examDeadlineRuns: a.permissions.includes('org.platform')
        ? await this.db.assessmentJobRun.findMany({
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            take: 20,
          })
        : [],
    };
  }
}
