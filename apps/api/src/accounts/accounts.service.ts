import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { AuthService, tokenHash } from '../auth/auth.service';
import type { Actor } from '../auth/auth.guard';
import { hashPasswordAsync } from '../auth/password';
import { reserveAuthAttempt } from '../auth/attempt-limit';
import { lockSecurityUser } from '../auth/security-transaction';
import {
  registrationSchema,
  joinRequestSchema,
  joinReviewSchema,
  joinListSchema,
  profileSchema,
} from './accounts.schemas';

type Db = Prisma.TransactionClient;
export const majorSummarySelect = {
  id: true,
  name: true,
  subjectId: true,
  description: true,
  moduleIds: true,
} as const;
export async function validateAccountMajor(
  db: Db,
  majorId: string | null | undefined,
  organizationId: string | null,
) {
  if (!majorId) return null;
  await db.$queryRaw`SELECT "id" FROM "AcademicsMajor" WHERE "id" = ${majorId} FOR SHARE`;
  const major = await db.academicsMajor.findFirst({
    where: {
      id: majorId,
      active: true,
      OR: [{ organizationId: null }, ...(organizationId ? [{ organizationId }] : [])],
    },
    select: { ...majorSummarySelect, organizationId: true },
  });
  if (!major) throw new BadRequestException('所选专业不可用或不属于当前机构');
  await db.$queryRaw`SELECT "id" FROM "AcademicsSubject" WHERE "id" = ${major.subjectId} FOR SHARE`;
  const subject = await db.academicsSubject.findFirst({
    where: {
      id: major.subjectId,
      active: true,
      OR: [
        { organizationId: null },
        ...(major.organizationId ? [{ organizationId: major.organizationId }] : []),
      ],
    },
    select: { id: true },
  });
  if (!subject) throw new BadRequestException('专业所属学科不可用或归属不匹配');
  const { organizationId: _organizationId, ...summary } = major;
  return summary;
}
export function canUsePersonalRecovery(
  user: { accountMode: string; organizationId: string; personalOrganizationId: string | null },
  organization: { kind: string },
) {
  return (
    user.accountMode === 'PERSONAL' &&
    organization.kind === 'PERSONAL' &&
    user.organizationId === user.personalOrganizationId
  );
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async register(body: unknown, ip: string) {
    const input = registrationSchema.parse(body);
    // Successful registration still spends the IP budget: fresh usernames must not bypass it.
    await reserveAuthAttempt(this.db, ip, input.username, 'register');
    const passwordHash = await hashPasswordAsync(input.password);
    const token = randomBytes(32).toString('base64url');
    const hours = Math.min(72, Math.max(1, Number(process.env.SESSION_HOURS) || 12));
    try {
      await this.db.$transaction(async (tx) => {
        await validateAccountMajor(tx, input.majorId, null);
        const org = await tx.organization.create({ data: { name: '个人学习空间', kind: 'PERSONAL' } });
        const user = await tx.user.create({
          data: {
            username: input.username.toLowerCase(),
            name: input.name,
            passwordHash,
            organizationId: org.id,
            personalOrganizationId: org.id,
            accountMode: 'PERSONAL',
            majorId: input.majorId,
            personalMajorId: input.majorId,
            roles: { create: { roleId: 'STUDENT' } },
          },
        });
        await tx.session.create({
          data: {
            userId: user.id,
            role: 'STUDENT',
            tokenHash: tokenHash(token),
            csrfToken: randomBytes(24).toString('hex'),
            authVersion: user.authVersion,
            expiresAt: new Date(Date.now() + hours * 3600000),
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: org.id,
            userId: user.id,
            action: 'account.register',
            resourceType: 'User',
            resourceId: user.id,
            details: {},
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('该账号已被使用');
      throw error;
    }
    return { token, hours };
  }

  private requireStudent(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('此操作仅供学生账号使用');
    this.auth.require(actor, 'learning.use');
  }
  private requireAdmin(actor: Actor) {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role) || actor.accountMode === 'PERSONAL')
      throw new ForbiddenException('此操作仅供机构管理员使用');
    this.auth.require(actor, 'users.manage');
    this.auth.require(actor, 'org.manage');
  }
  private async current(tx: Db, actor: Actor) {
    const verified = await tx.user.findUnique({ where: { id: actor.id } });
    if (!verified) throw new UnauthorizedException('登录已失效，请重新登录');
    await lockSecurityUser(tx, actor, verified);
    const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true } });
    if (!current.roles.some((role) => role.roleId === actor.role))
      throw new UnauthorizedException('账号身份已变化，请重新登录');
    return current;
  }
  private personal(user: User & { roles: { roleId: string }[] }) {
    if (
      user.accountMode !== 'PERSONAL' ||
      !user.personalOrganizationId ||
      user.organizationId !== user.personalOrganizationId ||
      user.roles.length !== 1 ||
      user.roles[0].roleId !== 'STUDENT'
    )
      throw new ForbiddenException('此操作需要个人学生账号');
  }
  private async institution(tx: Db, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${id} FOR UPDATE`;
    const org = await tx.organization.findFirst({ where: { id, kind: 'INSTITUTION', active: true } });
    if (!org) throw new NotFoundException('机构不存在或已停用');
    return org;
  }
  async updateProfile(actor: Actor, body: unknown) {
    const input = profileSchema.parse(body);
    await this.db.$transaction(async (tx) => {
      const user = await this.current(tx, actor);
      if (input.majorId !== undefined) {
        this.personal(user);
        await validateAccountMajor(tx, input.majorId, null);
        if (input.majorId !== user.majorId)
          await tx.academicsPreference.upsert({
            where: {
              organizationId_userId: { organizationId: user.organizationId, userId: user.id },
            },
            create: {
              organizationId: user.organizationId,
              userId: user.id,
              selectedModuleIds: [],
              revision: 1,
            },
            update: { revision: { increment: 1 } },
          });
      }
      await tx.user.update({
        where: { id: actor.id },
        data: {
          name: input.name,
          majorId: input.majorId,
          ...(input.majorId !== undefined ? { personalMajorId: input.majorId } : {}),
        },
      });
    });
  }
  async organization(actor: Actor) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true } });
    const organization =
      user.accountMode === 'ORGANIZATION'
        ? await this.db.organization.findFirst({
            where: { id: actor.organizationId, kind: 'INSTITUTION' },
            select: { id: true, name: true },
          })
        : null;
    return {
      accountMode: user.accountMode,
      organization,
      canReturnToPersonal:
        user.accountMode === 'ORGANIZATION' &&
        !!user.personalOrganizationId &&
        user.roles.length === 1 &&
        user.roles[0].roleId === 'STUDENT',
    };
  }
  private async requestView(
    tx: Db,
    request: {
      id: string;
      userId: string;
      organizationId: string;
      status: string;
      majorId: string | null;
      note: string;
      createdAt: Date;
      updatedAt: Date;
    },
    admin = false,
  ) {
    const { userId, organizationId, ...data } = request;
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    return {
      ...data,
      organization,
      ...(admin
        ? {
            user: await tx.user.findUniqueOrThrow({
              where: { id: userId },
              select: { id: true, name: true, username: true },
            }),
          }
        : {}),
    };
  }
  async requests(actor: Actor) {
    this.requireStudent(actor);
    const rows = await this.db.organizationJoinRequest.findMany({
      where: { userId: actor.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
    return { items: await Promise.all(rows.map((row) => this.requestView(this.db, row))) };
  }
  async apply(actor: Actor, body: unknown, ip: string) {
    this.requireStudent(actor);
    const input = joinRequestSchema.parse(body);
    await reserveAuthAttempt(this.db, ip, actor.id, 'join');
    return this.db.$transaction(async (tx) => {
      const user = await this.current(tx, actor);
      this.personal(user);
      const target = await tx.organization.findFirst({
        where: { inviteCode: input.inviteCode, joinEnabled: true, kind: 'INSTITUTION', active: true },
      });
      if (!target) throw new BadRequestException('邀请码无效或机构暂未开放申请');
      const org = await this.institution(tx, target.id);
      if (!org.joinEnabled || org.inviteCode !== input.inviteCode)
        throw new BadRequestException('邀请码无效或机构暂未开放申请');
      await validateAccountMajor(tx, input.majorId, org.id);
      if (await tx.organizationJoinRequest.findFirst({ where: { userId: actor.id, status: 'PENDING' } }))
        throw new ConflictException('已有待审核的申请，请等待审核或先取消');
      const row = await tx.organizationJoinRequest.create({
        data: { userId: actor.id, organizationId: org.id, majorId: input.majorId, note: input.note },
      });
      return this.requestView(tx, row);
    });
  }
  async cancel(actor: Actor, id: string) {
    this.requireStudent(actor);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const row = await tx.organizationJoinRequest.findFirst({ where: { id, userId: actor.id } });
      if (!row) throw new NotFoundException('申请不存在');
      if (row.status !== 'PENDING') throw new ConflictException('申请已处理');
      return this.requestView(
        tx,
        await tx.organizationJoinRequest.update({ where: { id }, data: { status: 'CANCELLED' } }),
      );
    });
  }
  async joinSettings(actor: Actor) {
    this.requireAdmin(actor);
    const org = await this.db.organization.findFirst({
      where: { id: actor.organizationId, kind: 'INSTITUTION' },
      select: { joinEnabled: true, inviteCode: true },
    });
    if (!org) throw new NotFoundException('机构不存在');
    return org;
  }
  async updateJoinSettings(actor: Actor, enabled?: boolean, rotate = false) {
    this.requireAdmin(actor);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const org = await this.institution(tx, actor.organizationId);
      const inviteCode =
        rotate || (enabled && !org.inviteCode) ? randomBytes(24).toString('base64url') : org.inviteCode;
      const result = await tx.organization.update({
        where: { id: org.id },
        data: { joinEnabled: enabled, inviteCode },
        select: { joinEnabled: true, inviteCode: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          userId: actor.id,
          action: rotate ? 'organization.invite.rotate' : 'organization.join-settings',
          resourceType: 'Organization',
          resourceId: org.id,
          details: { joinEnabled: result.joinEnabled },
          requestId: actor.requestId,
        },
      });
      return result;
    });
  }
  async adminRequests(actor: Actor, query: unknown) {
    this.requireAdmin(actor);
    const q = joinListSchema.parse(query);
    const where = { organizationId: actor.organizationId, ...(q.status ? { status: q.status } : {}) };
    const [rows, total] = await Promise.all([
      this.db.organizationJoinRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.organizationJoinRequest.count({ where }),
    ]);
    return {
      items: await Promise.all(rows.map((row) => this.requestView(this.db, row, true))),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async review(actor: Actor, id: string, body: unknown) {
    this.requireAdmin(actor);
    const input = joinReviewSchema.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const initial = await tx.organizationJoinRequest.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!initial) throw new NotFoundException('申请不存在');
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${initial.userId} FOR UPDATE`;
      const row = await tx.organizationJoinRequest.findUniqueOrThrow({ where: { id } });
      if (row.status !== 'PENDING') throw new ConflictException('申请已处理');
      const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId }, include: { roles: true } });
      if (!user.active) throw new ConflictException('申请账号已停用');
      this.personal(user);
      const org = await this.institution(tx, actor.organizationId);
      const majorId = input.majorId === undefined ? row.majorId : input.majorId;
      if (input.status === 'APPROVED') {
        await validateAccountMajor(tx, majorId, org.id);
        await tx.user.update({
          where: { id: user.id },
          data: {
            organizationId: org.id,
            accountMode: 'ORGANIZATION',
            majorId,
            personalMajorId: user.majorId,
            studentNo: null,
            authVersion: { increment: 1 },
          },
        });
        await this.revoke(tx, user.id);
      }
      const updated = await tx.organizationJoinRequest.update({
        where: { id },
        data: {
          status: input.status,
          reviewedBy: actor.id,
          ...(input.status === 'APPROVED' ? { majorId } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          userId: actor.id,
          action: 'organization.join-review',
          resourceType: 'OrganizationJoinRequest',
          resourceId: id,
          details: {
            status: input.status,
            userId: user.id,
            ...(input.status === 'APPROVED' ? { majorId } : {}),
          },
          requestId: actor.requestId,
        },
      });
      await tx.notification.create({
        data: {
          organizationId: input.status === 'APPROVED' ? org.id : user.organizationId,
          userId: user.id,
          type: 'ACCOUNT',
          title: input.status === 'APPROVED' ? '加入机构申请已通过' : '加入机构申请未通过',
          body:
            input.status === 'APPROVED'
              ? `你已加入${org.name}，请重新登录。个人空间的学习记录会保留。`
              : `你申请加入${org.name}的请求未通过，可联系机构了解详情。`,
          link: '/profile',
          eventKey: `join-request:${id}:${input.status}`,
        },
      });
      return this.requestView(tx, updated, true);
    });
  }
  private async revoke(tx: Db, userId: string) {
    await tx.session.deleteMany({ where: { userId } });
    await tx.sensitiveGrant.deleteMany({ where: { userId } });
    await tx.passwordRecovery.updateMany({
      where: { userId },
      data: { pendingUntil: null, requestedAuthVersion: null, requestedBy: null },
    });
  }
  async leave(actor: Actor) {
    this.requireStudent(actor);
    return this.db.$transaction(async (tx) => {
      const user = await this.current(tx, actor);
      if (
        user.accountMode !== 'ORGANIZATION' ||
        !user.personalOrganizationId ||
        user.roles.length !== 1 ||
        user.roles[0].roleId !== 'STUDENT'
      )
        throw new ForbiddenException('此账号不能返回个人空间');
      const personal = await tx.organization.findFirst({
        where: { id: user.personalOrganizationId, kind: 'PERSONAL', active: true },
      });
      if (!personal) throw new ForbiddenException('个人空间不可用');
      let major: Awaited<ReturnType<typeof validateAccountMajor>> = null;
      try {
        major = await validateAccountMajor(tx, user.personalMajorId, null);
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
      }
      const [classes, courses] = await Promise.all([
        tx.class.findMany({ where: { organizationId: user.organizationId }, select: { id: true } }),
        tx.course.findMany({ where: { organizationId: user.organizationId }, select: { id: true } }),
      ]);
      await tx.classMember.updateMany({
        where: { userId: user.id, classId: { in: classes.map((item) => item.id) }, active: true },
        data: { active: false },
      });
      await tx.enrollment.updateMany({
        where: { userId: user.id, courseId: { in: courses.map((item) => item.id) }, active: true },
        data: { active: false },
      });
      await tx.teachingAssignment.updateMany({
        where: { userId: user.id, courseId: { in: courses.map((item) => item.id) }, active: true },
        data: { active: false },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          organizationId: personal.id,
          accountMode: 'PERSONAL',
          majorId: major?.id || null,
          personalMajorId: major?.id || null,
          studentNo: null,
          authVersion: { increment: 1 },
        },
      });
      await this.revoke(tx, user.id);
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'organization.leave',
          resourceType: 'User',
          resourceId: actor.id,
          details: {},
          requestId: actor.requestId,
        },
      });
      return { ok: true, loginRequired: true };
    });
  }
}
