import { UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../common/prisma.service';
/** Revalidate the native credential on the same connection after the shared user lock. */
export async function assertMobileAcademicActor(tx: Prisma.TransactionClient, actor: Actor) {
  if (actor.clientType !== 'MOBILE') return;
  const auth = new AuthService(tx as PrismaService);
  const current = actor.sessionId ? await auth.resolveMobileSessionId(actor.sessionId) : null;
  if (
    !current ||
    current.id !== actor.id ||
    current.organizationId !== actor.organizationId ||
    current.role !== actor.role ||
    current.accountMode !== actor.accountMode
  )
    throw new UnauthorizedException('手机会话或身份已变化，请重新登录');
  auth.require(current, 'learning.use');
  await auth.checkFeature(current, '/api/practice');
}
