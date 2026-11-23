import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { PrismaService } from '../common/prisma.service';
import type { Actor } from './auth.guard';
import { tokenHash } from './auth.service';
import { hashPasswordAsync, verifyPasswordAsync } from './password';
import { reserveAuthAttempt, releaseAuthAttempt } from './attempt-limit';
import { lockSecurityUser } from './security-transaction';
import { username, password } from '../common/utils';
import { canUsePersonalRecovery } from '../accounts/accounts.service';

/** Shared browser/native recovery policy; secrets are returned only once, never audited. */
export class AccountRecoveryService {
  constructor(private readonly db: PrismaService) {}
  async issue(actor: Actor, body: unknown, ip: string) {
    const data = z.object({ oldPassword: z.string().min(1).max(128) }).parse(body);
    const reservation = await reserveAuthAttempt(this.db, ip, actor.id, 'password');
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
    return { code };
  }
  async recover(body: unknown, ip: string) {
    const data = z.object({ username, code: z.string().min(40).max(100), newPassword: password }).parse(body);
    const reservation = await reserveAuthAttempt(this.db, ip, data.username, 'recovery');
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
    return { ok: true, loginRequired: true };
  }
}
