import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../common/prisma.service';
export const progressInput = z.object({
  completed: z.boolean(),
  positionSeconds: z.number().int().min(0).max(86400).default(0),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
});
/** Serialize web/native writes before checking the latest session, scope and progress. */
export async function saveLessonProgress(db: PrismaService, a: Actor, id: string, body: unknown) {
  const d = progressInput.parse(body);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'lesson-progress:' + a.id + ':' + id}, 0))`;
    // Reuse the transaction connection; nested pool acquisition can deadlock under load.
    const auth = new AuthService(tx as PrismaService);
    const fresh = a.sessionId ? await auth.resolveSessionId(a.sessionId) : null;
    if (!fresh || fresh.id !== a.id || fresh.role !== a.role || fresh.organizationId !== a.organizationId)
      throw new UnauthorizedException('会话或身份已变化，请重新登录');
    auth.require(fresh, 'learning.use');
    const lesson = await tx.lesson.findUnique({ where: { id } });
    if (!lesson) throw new NotFoundException('课时不存在');
    await auth.course(fresh, lesson.courseId);
    if (lesson.opensAt && lesson.opensAt > new Date()) throw new ForbiddenException('课时尚未开放');
    const where = { userId_lessonId: { userId: a.id, lessonId: id } };
    const before = await tx.learningProgress.findUnique({ where });
    if (
      d.expectedUpdatedAt !== undefined &&
      d.expectedUpdatedAt !== (before?.updatedAt.toISOString() ?? null)
    )
      throw new ConflictException('学习进度已在其他设备更新，请重新加载后继续。');
    const data = {
      completed: d.completed,
      positionSeconds: d.positionSeconds,
      updatedAt: new Date(Math.max(Date.now(), (before?.updatedAt.getTime() || 0) + 1)),
    };
    return tx.learningProgress.upsert({
      where,
      create: { userId: a.id, lessonId: id, courseId: lesson.courseId, ...data },
      update: data,
    });
  });
}
