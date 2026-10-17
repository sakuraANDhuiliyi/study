import { mobileLoginInput, mobileRefreshInput } from './mobile.schemas';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { AuthService, tokenHash } from '../auth/auth.service';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { LoginService } from '../auth/login.service';
import { authProfile } from '../auth/profile';
import { reserveAuthAttempt, releaseAuthAttempt } from '../auth/attempt-limit';

const credentials = () => ({
  accessToken: 'ma1_' + randomBytes(32).toString('base64url'),
  refreshToken: 'mr1_' + randomBytes(48).toString('base64url'),
});
const accessExpiry = (expiresAt: Date) => new Date(Math.min(Date.now() + 15 * 60_000, expiresAt.getTime()));
@Controller('mobile/auth')
export class MobileAuthController {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private loginService: LoginService,
  ) {}
  private nativeRequest(req: Request) {
    if (req.headers.origin || req.cookies?.lms_session)
      throw new ForbiddenException('请使用独立手机会话，不能混用网页凭据');
  }
  @Post('login')
  async login(@Body() body: unknown, @Req() req: Request) {
    this.nativeRequest(req);
    const { deviceName, ...input } = mobileLoginInput.parse(body);
    const { session, actor } = await this.loginService.login(input, req.ip || 'unknown', 'MOBILE');
    const tokens = credentials();
    const accessExpiresAt = accessExpiry(session.expiresAt);
    try {
      await this.db.mobileCredential.create({
        data: {
          sessionId: session.id,
          accessHash: tokenHash(tokens.accessToken),
          refreshHash: tokenHash(tokens.refreshToken),
          accessExpiresAt,
          deviceName,
        },
      });
      return {
        ...tokens,
        accessExpiresAt,
        sessionExpiresAt: session.expiresAt,
        user: (await authProfile(this.db, actor)).user,
      };
    } catch (error) {
      await this.db.session.deleteMany({ where: { id: session.id } });
      throw error;
    }
  }
  @Post('refresh')
  async refresh(@Body() body: unknown, @Req() req: Request) {
    this.nativeRequest(req);
    const { refreshToken } = mobileRefreshInput.parse(body);
    const hash = tokenHash(refreshToken);
    const reservation = await reserveAuthAttempt(this.db, req.ip || 'unknown', hash, 'mobile-refresh');
    const tokens = credentials();
    const result = await this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', '5000', true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mobile-refresh:${hash}`}, 0))`;
        const row = await tx.mobileCredential.findUnique({ where: { refreshHash: hash } });
        if (!row) {
          const used = await tx.mobileRefreshUse.findUnique({ where: { hash } });
          // A recognized consumed credential revokes its whole device session.
          // Return from the transaction so revocation is committed before the 401.
          if (used) await tx.session.deleteMany({ where: { id: used.sessionId, clientType: 'MOBILE' } });
          return null;
        }
        await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id"=${row.sessionId} FOR UPDATE`;
        const auth = new AuthService(tx as PrismaService);
        const actor = await auth.resolveMobileSessionId(row.sessionId);
        const session = await tx.session.findUnique({ where: { id: row.sessionId } });
        if (!actor || !session) {
          await tx.session.deleteMany({ where: { id: row.sessionId } });
          return null;
        }
        // A 72-hour session needs at most 288 normal rotations. Bound malicious
        // repeated rotations instead of retaining an unbounded replay ledger.
        if ((await tx.mobileRefreshUse.count({ where: { sessionId: session.id } })) >= 512) {
          await tx.session.delete({ where: { id: session.id } });
          return null;
        }
        const accessExpiresAt = accessExpiry(session.expiresAt);
        await tx.mobileRefreshUse.create({
          data: { hash, sessionId: session.id, expiresAt: session.expiresAt },
        });
        await tx.mobileCredential.update({
          where: { sessionId: session.id },
          data: {
            accessHash: tokenHash(tokens.accessToken),
            refreshHash: tokenHash(tokens.refreshToken),
            accessExpiresAt,
          },
        });
        return { actor, session, accessExpiresAt };
      },
      { maxWait: 10000, timeout: 20000 },
    );
    if (!result) throw new UnauthorizedException('手机登录已失效，请重新登录');
    await releaseAuthAttempt(this.db, reservation);
    return {
      ...tokens,
      accessExpiresAt: result.accessExpiresAt,
      sessionExpiresAt: result.session.expiresAt,
      user: (await authProfile(this.db, result.actor)).user,
    };
  }
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentActor() actor: Actor) {
    if (actor.clientType !== 'MOBILE') throw new ForbiddenException();
    return { user: (await authProfile(this.db, actor)).user };
  }
  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@CurrentActor() actor: Actor) {
    if (actor.clientType !== 'MOBILE') throw new ForbiddenException();
    await this.db.session.deleteMany({
      where: { id: actor.sessionId, userId: actor.id, clientType: 'MOBILE' },
    });
    return { ok: true };
  }
}
