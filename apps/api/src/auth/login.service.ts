import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { username } from '../common/utils';
import { AuthService, tokenHash } from './auth.service';
import { hashPasswordAsync, verifyPasswordAsync } from './password';
import { reserveAuthAttempt, releaseAuthAttempt } from './attempt-limit';

export const loginInput = z.object({ username, password: z.string().min(1).max(128) }).strict();
@Injectable()
export class LoginService {
  private readonly dummyHash = hashPasswordAsync(randomBytes(24).toString('hex'));
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private audit: AuditService,
  ) {}
  async login(input: unknown, ip: string, clientType: 'WEB' | 'MOBILE' = 'WEB') {
    const data = loginInput.parse(input);
    const reservation = await reserveAuthAttempt(this.db, ip, data.username);
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
        clientType,
        expiresAt: new Date(Date.now() + hours * 3600000),
      },
    });
    const actor = await this.auth.resolveSessionId(session.id);
    if (!actor) throw new UnauthorizedException('账号安全状态已变化，请重新登录');
    await this.audit.record(actor, 'login.success', 'Session', session.id);
    await releaseAuthAttempt(this.db, reservation);
    return { token, hours, actor, session };
  }
}
