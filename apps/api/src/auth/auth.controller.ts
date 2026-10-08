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
  HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import type { Response, Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthService, tokenHash } from './auth.service';
import { AuthGuard, CurrentActor, Actor } from './auth.guard';
import { hashPassword, verifyPassword } from './password';
import { username, password } from '../common/utils';
@ApiTags('认证与个人资料')
@Controller('auth')
export class AuthController {
  private failures = new Map<string, { count: number; expires: number }>();
  private readonly dummyHash = hashPassword(randomBytes(24).toString('hex'));
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}
  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
    };
  }
  private async view(actor: Actor) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        id: true,
        name: true,
        username: true,
        organizationId: true,
        roles: { select: { roleId: true } },
      },
    });
    return {
      user: {
        ...user,
        roles: user.roles.map((x) => x.roleId),
        role: actor.role,
        permissions: actor.permissions,
      },
      csrfToken: actor.csrfToken,
    };
  }
  @Post('login')
  @ApiOperation({ summary: '登录；同源 Cookie 会话，失败限流' })
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const data = z.object({ username, password: z.string().min(1).max(128) }).parse(body);
    if (req.headers.origin && req.headers.origin !== process.env.APP_ORIGIN)
      throw new ForbiddenException('请求来源不被允许');
    const key = `${req.ip}:${data.username.toLowerCase()}`;
    const fail = this.failures.get(key);
    const ipKey = `ip:${req.ip}`;
    const ipFail = this.failures.get(ipKey);
    if (
      (fail && fail.expires > Date.now() && fail.count >= 8) ||
      (ipFail && ipFail.expires > Date.now() && ipFail.count >= 50)
    )
      throw new HttpException('登录失败次数过多，请 15 分钟后再试', 429);
    const user = await this.db.user.findUnique({
      where: { username: data.username.toLowerCase() },
      include: { roles: true },
    });
    const org = user && (await this.db.organization.findUnique({ where: { id: user.organizationId } }));
    const passwordValid = verifyPassword(data.password, user?.passwordHash || this.dummyHash);
    if (!user?.active || !org?.active || !user.roles.length || !passwordValid) {
      this.failures.set(key, {
        count: fail && fail.expires > Date.now() ? fail.count + 1 : 1,
        expires: Date.now() + 900000,
      });
      this.failures.set(ipKey, {
        count: ipFail && ipFail.expires > Date.now() ? ipFail.count + 1 : 1,
        expires: Date.now() + 900000,
      });
      if (this.failures.size > 10000)
        for (const [k, v] of this.failures) if (v.expires < Date.now()) this.failures.delete(k);
      if (this.failures.size > 20000) this.failures.delete(this.failures.keys().next().value!);
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
    this.failures.delete(key);
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
        role: user.roles[0].roleId,
        csrfToken: randomBytes(24).toString('hex'),
        authVersion: user.authVersion,
        expiresAt: new Date(Date.now() + hours * 3600000),
      },
    });
    res.cookie('lms_session', token, { ...this.cookieOptions(), maxAge: hours * 3600000 });
    const actor = (await this.auth.resolveSession(token))!;
    await this.audit.record(actor, 'login.success', 'Session', session.id);
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
    const data = z.object({ name: z.string().trim().min(1).max(80) }).parse(body);
    await this.db.user.update({ where: { id: actor.id }, data });
    return this.view({ ...actor, name: data.name });
  }
  @Post('password') @UseGuards(AuthGuard) async password(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = z.object({ oldPassword: z.string().max(128), newPassword: password }).parse(body);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!verifyPassword(data.oldPassword, user.passwordHash)) throw new ForbiddenException('原密码不正确');
    await this.db.$transaction([
      this.db.user.update({
        where: { id: actor.id },
        data: { passwordHash: hashPassword(data.newPassword), authVersion: { increment: 1 } },
      }),
      this.db.session.deleteMany({ where: { userId: actor.id } }),
      this.db.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'password.change',
          resourceType: 'User',
          resourceId: actor.id,
          details: {},
          requestId: actor.requestId,
        },
      }),
    ]);
    res.clearCookie('lms_session', this.cookieOptions());
    return { ok: true, loginRequired: true };
  }
}
