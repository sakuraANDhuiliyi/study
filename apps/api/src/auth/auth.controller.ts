import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import type { Response, Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthService, tokenHash } from './auth.service';
import { AuthGuard, CurrentActor, Actor } from './auth.guard';
import { hashPasswordAsync, verifyPasswordAsync } from './password';
import { releaseAuthAttempt, reserveAuthAttempt } from './attempt-limit';
import { lockSecurityUser } from './security-transaction';
import { username, password } from '../common/utils';
import { AccountsService, canUsePersonalRecovery, majorSummarySelect } from '../accounts/accounts.service';
@ApiTags('认证与个人资料')
@Controller('auth')
export class AuthController {
  private readonly dummyHash = hashPasswordAsync(randomBytes(24).toString('hex'));
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly accounts: AccountsService,
  ) {}
  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
    };
  }
  private checkOrigin(req: Request) {
    if (req.headers.origin && req.headers.origin !== process.env.APP_ORIGIN)
      throw new ForbiddenException('请求来源不被允许');
  }
  private async view(actor: Actor) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        id: true,
        name: true,
        username: true,
        organizationId: true,
        accountMode: true,
        majorId: true,
        personalOrganizationId: true,
        roles: { select: { roleId: true } },
      },
    });
    const major = user.majorId
      ? await this.db.academicsMajor.findFirst({
          where: {
            id: user.majorId,
            OR: [{ organizationId: null }, { organizationId: user.organizationId }],
          },
          select: majorSummarySelect,
        })
      : null;
    if (user.organizationId !== actor.organizationId)
      throw new UnauthorizedException('账号归属已变化，请重新登录');
    const { personalOrganizationId, ...publicUser } = user;
    return {
      user: {
        ...publicUser,
        major,
        canReturnToPersonal:
          user.accountMode === 'ORGANIZATION' &&
          !!personalOrganizationId &&
          user.roles.length === 1 &&
          user.roles[0].roleId === 'STUDENT',
        roles: user.roles
          .filter((x) => user.accountMode !== 'PERSONAL' || x.roleId === 'STUDENT')
          .map((x) => x.roleId),
        role: actor.role,
        permissions: actor.permissions,
      },
      csrfToken: actor.csrfToken,
    };
  }
  @Post('register')
  @ApiOperation({ summary: '注册个人学习账号，仅创建学生身份及独立个人数据空间' })
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.checkOrigin(req);
    const { token, hours } = await this.accounts.register(body, req.ip || 'unknown');
    const actor = await this.auth.resolveSession(token);
    if (!actor) throw new UnauthorizedException('账号安全状态已变化，请重新登录');
    res.cookie('lms_session', token, { ...this.cookieOptions(), maxAge: hours * 3600000 });
    res.setHeader('Cache-Control', 'no-store');
    return this.view(actor);
  }
  @Post('login')
  @ApiOperation({ summary: '登录；同源 Cookie 会话，共享请求限流' })
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const data = z.object({ username, password: z.string().min(1).max(128) }).parse(body);
    this.checkOrigin(req);
    const reservation = await reserveAuthAttempt(this.db, req.ip || 'unknown', data.username);
    const user = await this.db.user.findUnique({
      where: { username: data.username.toLowerCase() },
      include: { roles: true },
    });
    const org = user && (await this.db.organization.findUnique({ where: { id: user.organizationId } }));
    const passwordValid = await verifyPasswordAsync(
      data.password,
      user?.passwordHash || (await this.dummyHash),
    );
    const recovery = user && (await this.db.passwordRecovery.findUnique({ where: { userId: user.id } }));
    if (
      !user?.active ||
      !org?.active ||
      !user.roles.length ||
      !passwordValid ||
      (recovery?.pendingUntil && recovery.pendingUntil > new Date())
    ) {
      if (user)
        await this.db.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: 'login.failure',
            resourceType: 'User',
            resourceId: user.id,
            details: {},
          },
        });
      throw new UnauthorizedException('账号或密码错误，或账号已停用');
    }
    const policy = await this.db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: user.organizationId, key: 'loginPolicy' } },
    });
    const token = randomBytes(32).toString('base64url');
    const hours = Math.min(
      72,
      Math.max(
        1,
        Number((policy?.value as { sessionHours?: number })?.sessionHours) ||
          Number(process.env.SESSION_HOURS) ||
          12,
      ),
    );
    const session = await this.db.session.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        role: user.accountMode === 'PERSONAL' ? 'STUDENT' : user.roles[0].roleId,
        csrfToken: randomBytes(24).toString('hex'),
        authVersion: user.authVersion,
        expiresAt: new Date(Date.now() + hours * 3600000),
      },
    });
    res.cookie('lms_session', token, { ...this.cookieOptions(), maxAge: hours * 3600000 });
    const actor = await this.auth.resolveSession(token);
    if (!actor) throw new UnauthorizedException('账号安全状态已变化，请重新登录');
    await this.audit.record(actor, 'login.success', 'Session', session.id);
    await releaseAuthAttempt(this.db, reservation);
    return this.view(actor);
  }
  @Get('me') @UseGuards(AuthGuard) @ApiCookieAuth() async me(@CurrentActor() actor: Actor) {
    return this.view(actor);
  }
  @Post('logout') @UseGuards(AuthGuard) async logout(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.session.deleteMany({ where: { id: actor.sessionId } });
    res.clearCookie('lms_session', this.cookieOptions());
    return { ok: true };
  }
  @Post('role') @UseGuards(AuthGuard) async role(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const { role } = z.object({ role: z.enum(['STUDENT', 'TEACHER', 'ADMIN', 'SUPER_ADMIN']) }).parse(body);
    if (actor.accountMode === 'PERSONAL' && role !== 'STUDENT')
      throw new ForbiddenException('个人账号仅支持学生身份');
    if (
      !(await this.db.userRole.findUnique({ where: { userId_roleId: { userId: actor.id, roleId: role } } }))
    )
      throw new ForbiddenException('未被授予该身份');
    const csrfToken = randomBytes(24).toString('hex');
    await this.db.session.update({ where: { id: actor.sessionId }, data: { role, csrfToken } });
    const permissions = await this.db.rolePermission.findMany({
      where: { roleId: role },
      include: { permission: true },
    });
    const grants = await this.db.sensitiveGrant.findMany({
      where: { userId: actor.id, expiresAt: { gt: new Date() } },
    });
    return this.view({
      ...actor,
      role,
      csrfToken,
      permissions: permissions
        .filter((p) => !p.permission.sensitive || grants.some((g) => g.permissionId === p.permissionId))
        .map((p) => p.permissionId),
    });
  }
  @Patch('profile') @UseGuards(AuthGuard) async profile(@CurrentActor() actor: Actor, @Body() body: unknown) {
    await this.accounts.updateProfile(actor, body);
    return this.view(actor);
  }
  @Post('password') @UseGuards(AuthGuard) async password(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = z.object({ oldPassword: z.string().max(128), newPassword: password }).parse(body);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    const reservation = await reserveAuthAttempt(this.db, req.ip || 'unknown', actor.id, 'password');
    if (!(await verifyPasswordAsync(data.oldPassword, user.passwordHash)))
      throw new ForbiddenException('原密码不正确');
    const passwordHash = await hashPasswordAsync(data.newPassword);
    await this.db.$transaction(async (tx) => {
      await lockSecurityUser(tx, actor, user);
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await tx.session.deleteMany({ where: { userId: actor.id } });
      await tx.passwordRecovery.deleteMany({ where: { userId: actor.id } });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'password.change',
          resourceType: 'User',
          resourceId: actor.id,
          details: {},
          requestId: actor.requestId,
        },
      });
    });
    await releaseAuthAttempt(this.db, reservation);
    res.clearCookie('lms_session', this.cookieOptions());
    return { ok: true, loginRequired: true };
  }

  @Get('recovery') @UseGuards(AuthGuard) async recoveryStatus(@CurrentActor() actor: Actor) {
    return { configured: !!(await this.db.passwordRecovery.findUnique({ where: { userId: actor.id } })) };
  }

  @Post('recovery-code') @UseGuards(AuthGuard) async recoveryCode(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = z.object({ oldPassword: z.string().min(1).max(128) }).parse(body);
    const reservation = await reserveAuthAttempt(this.db, req.ip || 'unknown', actor.id, 'password');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await verifyPasswordAsync(data.oldPassword, user.passwordHash)))
      throw new ForbiddenException('原密码不正确');
    const code = `lmsr_${randomBytes(32).toString('base64url')}`;
    await this.db.$transaction(async (tx) => {
      await lockSecurityUser(tx, actor, user);
      await tx.passwordRecovery.upsert({
        where: { userId: actor.id },
        create: { userId: actor.id, codeHash: tokenHash(code) },
        update: {
          codeHash: tokenHash(code),
          pendingUntil: null,
          requestedAuthVersion: null,
          requestedBy: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'password.recovery-code',
          resourceType: 'User',
          resourceId: actor.id,
          details: {},
          requestId: actor.requestId,
        },
      });
    });
    await releaseAuthAttempt(this.db, reservation);
    res.setHeader('Cache-Control', 'no-store');
    return { code };
  }

  @Post('recover') async recover(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = z.object({ username, code: z.string().min(40).max(100), newPassword: password }).parse(body);
    this.checkOrigin(req);
    const reservation = await reserveAuthAttempt(this.db, req.ip || 'unknown', data.username, 'recovery');
    const user = await this.db.user.findUnique({
      where: { username: data.username.toLowerCase() },
      include: { roles: true },
    });
    const recovery = user && (await this.db.passwordRecovery.findUnique({ where: { userId: user.id } }));
    const org = user && (await this.db.organization.findUnique({ where: { id: user.organizationId } }));
    const personal = !!(user && org && canUsePersonalRecovery(user, org));
    const invalid = () => new UnauthorizedException('恢复码或恢复许可无效');
    if (
      !user?.active ||
      !org?.active ||
      !user.roles.length ||
      !recovery ||
      recovery.codeHash !== tokenHash(data.code) ||
      (!personal &&
        (!recovery.pendingUntil ||
          recovery.pendingUntil <= new Date() ||
          recovery.requestedAuthVersion !== user.authVersion))
    )
      throw invalid();
    const passwordHash = await hashPasswordAsync(data.newPassword);
    await this.db.$transaction(async (tx) => {
      // Lock the user first, consistently with initiation and recovery-code rotation.
      const [current] = await tx.$queryRaw<
        {
          authVersion: number;
          active: boolean;
          organizationId: string;
          accountMode: string;
          personalOrganizationId: string | null;
        }[]
      >`
        SELECT "authVersion", "active", "organizationId", "accountMode", "personalOrganizationId" FROM "User" WHERE "id" = ${user.id} FOR UPDATE
      `;
      if (
        !current?.active ||
        current.authVersion !== user.authVersion ||
        current.organizationId !== user.organizationId
      )
        throw invalid();
      const currentOrg = await tx.organization.findUnique({ where: { id: current.organizationId } });
      if (!currentOrg?.active || canUsePersonalRecovery(current, currentOrg) !== personal) throw invalid();
      const consumed = await tx.passwordRecovery.deleteMany({
        where: {
          userId: user.id,
          codeHash: tokenHash(data.code),
          ...(!personal
            ? { pendingUntil: { gt: new Date() }, requestedAuthVersion: current.authVersion }
            : {}),
        },
      });
      if (consumed.count !== 1) throw invalid();
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, authVersion: { increment: 1 } } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.sensitiveGrant.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'password.recovery-complete',
          resourceType: 'User',
          resourceId: user.id,
          details: { requestedBy: recovery.requestedBy },
        },
      });
    });
    await releaseAuthAttempt(this.db, reservation);
    res.clearCookie('lms_session', this.cookieOptions());
    return { ok: true, loginRequired: true };
  }
}
