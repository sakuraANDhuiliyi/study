import { ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { password } from '../common/utils';
import type { Actor } from './auth.guard';
import { hashPasswordAsync, verifyPasswordAsync } from './password';
import { lockSecurityUser } from './security-transaction';
import { releaseAuthAttempt, reserveAuthAttempt } from './attempt-limit';
export async function changePassword(db: PrismaService, actor: Actor, body: unknown, ip: string) {
  const data = z.object({ oldPassword: z.string().max(128), newPassword: password }).parse(body);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  const reservation = await reserveAuthAttempt(db, ip, actor.id, 'password');
  if (!(await verifyPasswordAsync(data.oldPassword, user.passwordHash)))
    throw new ForbiddenException('原密码不正确');
  const passwordHash = await hashPasswordAsync(data.newPassword);
  await db.$transaction(async (tx) => {
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
  await releaseAuthAttempt(db, reservation);
}
