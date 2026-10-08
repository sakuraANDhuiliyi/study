import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Actor } from './auth.guard';

type SecurityUser = {
  id: string;
  organizationId: string;
  active: boolean;
  authVersion: number;
  passwordHash: string;
};

/** Bind sensitive self-service writes to the still-valid session, under the user lock. */
export async function lockSecurityUser(
  tx: Prisma.TransactionClient,
  actor: Actor,
  verified: Pick<SecurityUser, 'authVersion' | 'passwordHash'>,
) {
  const [current] = await tx.$queryRaw<SecurityUser[]>`
    SELECT "id", "organizationId", "active", "authVersion", "passwordHash"
    FROM "User" WHERE "id" = ${actor.id} FOR UPDATE
  `;
  if (
    !current?.active ||
    current.organizationId !== actor.organizationId ||
    current.authVersion !== verified.authVersion ||
    current.passwordHash !== verified.passwordHash
  )
    throw new ForbiddenException('账号安全状态已变化，请重新验证');
  const session =
    actor.sessionId &&
    (await tx.session.findFirst({
      where: {
        id: actor.sessionId,
        userId: actor.id,
        authVersion: current.authVersion,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    }));
  if (!session) throw new UnauthorizedException('登录已失效，请重新登录');
  const organization = await tx.organization.findUnique({
    where: { id: actor.organizationId },
    select: { active: true },
  });
  if (!organization?.active) throw new ForbiddenException('机构已停用');
  return current;
}
