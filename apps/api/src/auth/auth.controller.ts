import { changePassword } from './change-password';
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
import { AuthService } from './auth.service';
import { AuthGuard, CurrentActor, Actor } from './auth.guard';
import { authProfile } from './profile';
import { LoginService } from './login.service';
import { username } from '../common/utils';
import { AccountsService } from '../accounts/accounts.service';
import { AccountRecoveryService } from './account-recovery.service';
@ApiTags('认证与个人资料')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly accounts: AccountsService,
    private readonly loginService: LoginService,
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
  private view(actor: Actor) {
    return authProfile(this.db, actor);
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
    const { token, hours, actor } = await this.loginService.login(data, req.ip || 'unknown');
    res.cookie('lms_session', token, { ...this.cookieOptions(), maxAge: hours * 3600000 });
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
    await changePassword(this.db, actor, body, req.ip || 'unknown');
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
    const result = await new AccountRecoveryService(this.db).issue(actor, body, req.ip || 'unknown');
    res.setHeader('Cache-Control', 'no-store');
    return result;
  }

  @Post('recover') async recover(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.checkOrigin(req);
    const result = await new AccountRecoveryService(this.db).recover(body, req.ip || 'unknown');
    res.clearCookie('lms_session', this.cookieOptions());
    return result;
  }
}
