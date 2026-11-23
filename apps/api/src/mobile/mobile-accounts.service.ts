import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { AccountRecoveryService } from '../auth/account-recovery.service';
import { AuthService, tokenHash } from '../auth/auth.service';
import type { Actor } from '../auth/auth.guard';
import { authProfile } from '../auth/profile';
import {
  mobileRecoveryCodeInput,
  mobileRecoveryInput,
  mobileRegistrationInput,
  mobileRoleInput,
  mobileSessionId,
} from './mobile-account.schemas';

const tokens = () => ({
  accessToken: 'ma1_' + randomBytes(32).toString('base64url'),
  refreshToken: 'mr1_' + randomBytes(48).toString('base64url'),
});
const accessExpiry = (expiresAt: Date) => new Date(Math.min(Date.now() + 15 * 60000, expiresAt.getTime()));
@Injectable()
export class MobileAccountsService {
  constructor(
    private readonly db: PrismaService,
    private readonly accounts: AccountsService,
  ) {}
  private native(actor: Actor) {
    if (actor.clientType !== 'MOBILE') throw new ForbiddenException('请使用独立手机会话');
  }
  private async current(tx: Prisma.TransactionClient, actor: Actor) {
    this.native(actor);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id} FOR UPDATE`;
    const fresh = await new AuthService(tx as PrismaService).resolveMobileSessionId(actor.sessionId!);
    if (
      !fresh ||
      fresh.id !== actor.id ||
      fresh.organizationId !== actor.organizationId ||
      fresh.role !== actor.role
    )
      throw new UnauthorizedException('账号身份已变化，请重新登录');
    return fresh;
  }
  async register(body: unknown, ip: string) {
    const { deviceName, ...input } = mobileRegistrationInput.parse(body);
    // The browser credential remains server-local and is never exposed to the device.
    const registered = await this.accounts.register(input, ip);
    const token = tokens();
    try {
      return await this.db.$transaction(async (tx) => {
        const web = await tx.session.findUnique({ where: { tokenHash: tokenHash(registered.token) } });
        if (!web || web.clientType !== 'WEB') throw new UnauthorizedException('注册状态已变化，请登录');
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${web.userId} FOR UPDATE`;
        const actor = await new AuthService(tx as PrismaService).resolveSession(registered.token);
        if (!actor || actor.accountMode !== 'PERSONAL' || actor.role !== 'STUDENT')
          throw new UnauthorizedException('注册状态已变化，请登录');
        await tx.session.update({
          where: { id: web.id },
          data: { clientType: 'MOBILE', tokenHash: tokenHash(randomBytes(32).toString('base64url')) },
        });
        const accessExpiresAt = accessExpiry(web.expiresAt);
        await tx.mobileCredential.create({
          data: {
            sessionId: web.id,
            deviceName,
            accessHash: tokenHash(token.accessToken),
            refreshHash: tokenHash(token.refreshToken),
            accessExpiresAt,
          },
        });
        const user = (await authProfile(tx as PrismaService, { ...actor, clientType: 'MOBILE' })).user;
        return { ...token, accessExpiresAt, sessionExpiresAt: web.expiresAt, user };
      });
    } catch (error) {
      await this.db.session.deleteMany({ where: { tokenHash: tokenHash(registered.token) } });
      throw error;
    }
  }
  recover(body: unknown, ip: string) {
    return new AccountRecoveryService(this.db).recover(mobileRecoveryInput.parse(body), ip);
  }
  async recovery(actor: Actor) {
    this.native(actor);
    return {
      configured: !!(await this.db.passwordRecovery.findUnique({ where: { userId: actor.id } })),
      requiresOrganizationApproval: actor.accountMode !== 'PERSONAL',
    };
  }
  recoveryCode(actor: Actor, body: unknown, ip: string) {
    this.native(actor);
    return new AccountRecoveryService(this.db).issue(actor, mobileRecoveryCodeInput.parse(body), ip);
  }
  async sessions(actor: Actor) {
    this.native(actor);
    const now = new Date();
    const [items, total] = await this.db.$transaction(
      [
        this.db.session.findMany({
          where: { userId: actor.id, expiresAt: { gt: now } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          select: {
            id: true,
            role: true,
            clientType: true,
            createdAt: true,
            expiresAt: true,
            mobileCredential: { select: { deviceName: true } },
          },
        }),
        this.db.session.count({ where: { userId: actor.id, expiresAt: { gt: now } } }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      total,
      items: items.map(({ mobileCredential, ...s }) => ({
        ...s,
        current: s.id === actor.sessionId,
        deviceName: mobileCredential?.deviceName || '网页会话',
      })),
    };
  }
  async revoke(actor: Actor, id: string) {
    mobileSessionId.parse(id);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const deleted = await tx.session.deleteMany({ where: { id, userId: actor.id } });
      if (deleted.count !== 1) throw new NotFoundException('会话不存在或已退出');
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'mobile.session.revoke',
          resourceType: 'Session',
          resourceId: id,
          details: { current: id === actor.sessionId },
          requestId: actor.requestId,
        },
      });
      return { ok: true, loginRequired: id === actor.sessionId };
    });
  }
  async role(actor: Actor, body: unknown) {
    const { role } = mobileRoleInput.parse(body);
    return this.db.$transaction(async (tx) => {
      const fresh = await this.current(tx, actor);
      if (fresh.accountMode === 'PERSONAL' && role !== 'STUDENT')
        throw new ForbiddenException('个人账号仅支持学生身份');
      const granted = await tx.userRole.findUnique({
        where: { userId_roleId: { userId: actor.id, roleId: role } },
      });
      if (!granted) throw new ForbiddenException('未被授予该身份');
      await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id"=${actor.sessionId!} FOR UPDATE`;
      const session = await tx.session.findUnique({ where: { id: actor.sessionId! } });
      const credential = await tx.mobileCredential.findUnique({ where: { sessionId: actor.sessionId! } });
      if (!session || !credential || session.role !== actor.role)
        throw new UnauthorizedException('手机会话已变化，请重新登录');
      if ((await tx.mobileRefreshUse.count({ where: { sessionId: session.id } })) >= 512)
        throw new ForbiddenException('设备会话轮换次数过多，请退出后重新登录');
      const issued = tokens(),
        accessExpiresAt = accessExpiry(session.expiresAt);
      await tx.mobileRefreshUse.create({
        data: { hash: credential.refreshHash, sessionId: session.id, expiresAt: session.expiresAt },
      });
      await tx.session.update({
        where: { id: session.id },
        data: { role, csrfToken: randomBytes(24).toString('hex') },
      });
      await tx.mobileCredential.update({
        where: { sessionId: session.id },
        data: {
          accessHash: tokenHash(issued.accessToken),
          refreshHash: tokenHash(issued.refreshToken),
          accessExpiresAt,
        },
      });
      const next = await new AuthService(tx as PrismaService).resolveMobileSessionId(session.id);
      if (!next) throw new UnauthorizedException('账号身份已变化，请重新登录');
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'mobile.role.switch',
          resourceType: 'Session',
          resourceId: session.id,
          details: { role },
          requestId: actor.requestId,
        },
      });
      return {
        ...issued,
        accessExpiresAt,
        sessionExpiresAt: session.expiresAt,
        user: (await authProfile(tx as PrismaService, next)).user,
      };
    });
  }
}
