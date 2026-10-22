import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { clean } from '../common/utils';
export async function announcementScope<T>(
  db: PrismaService,
  actor: Actor,
  run: (tx: Prisma.TransactionClient, auth: AuthService, current: Actor) => Promise<T>,
) {
  if (actor.role !== 'STUDENT' || actor.clientType !== 'MOBILE')
    throw new ForbiddenException('请使用学生手机会话');
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${'mobile-announcements:' + actor.id}))`;
    const auth = new AuthService(tx as PrismaService);
    const current = actor.sessionId ? await auth.resolveMobileSessionId(actor.sessionId) : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.organizationId !== actor.organizationId ||
      current.role !== actor.role
    )
      throw new UnauthorizedException('会话或身份已变化，请重新登录');
    auth.require(current, 'learning.use');
    auth.require(current, 'course.read');
    return run(tx, auth, current);
  });
}
export async function readAnnouncement(
  tx: Prisma.TransactionClient,
  auth: AuthService,
  actor: Actor,
  id: string,
) {
  const row = await tx.announcement.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) throw new NotFoundException('公告不存在或已撤回');
  auth.require(actor, 'course.read');
  const course = row.courseId ? await auth.course(actor, row.courseId) : null;
  return {
    id: row.id,
    title: row.title,
    content: clean(row.content),
    createdAt: row.createdAt,
    courseId: row.courseId,
    courseTitle: course?.title ?? null,
  };
}
