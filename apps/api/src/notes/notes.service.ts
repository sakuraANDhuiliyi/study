import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { noteInput, noteQuery, noteDelete } from './notes.schemas';
@Injectable()
export class NotesService {
  constructor(private readonly db: PrismaService) {}
  private async scoped<T>(
    a: Actor,
    run: (tx: Prisma.TransactionClient, auth: AuthService, actor: Actor) => Promise<T>,
  ) {
    return this.db.$transaction(async (tx) => {
      // Both clients use the same lock; authenticate again after waiting for another editor.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${'lesson-notes:' + a.organizationId + ':' + a.id}))`;
      const auth = new AuthService(tx as PrismaService);
      const current = a.sessionId
        ? await (a.clientType === 'MOBILE'
            ? auth.resolveMobileSessionId(a.sessionId)
            : auth.resolveSessionId(a.sessionId))
        : null;
      if (
        !current ||
        current.id !== a.id ||
        current.organizationId !== a.organizationId ||
        current.role !== a.role ||
        current.clientType !== a.clientType
      )
        throw new UnauthorizedException('会话或身份已变化，请重新登录');
      if (a.clientType === 'MOBILE') {
        if (current.role !== 'STUDENT') throw new ForbiddenException('请使用学生手机会话');
        auth.require(current, 'learning.use');
      }
      return run(tx, auth, current);
    });
  }
  private async source(db: Prisma.TransactionClient, auth: AuthService, actor: Actor, lessonId: string) {
    const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('课时不存在');
    const course = await auth.course(actor, lesson.courseId);
    if (actor.role === 'STUDENT' && lesson.opensAt && lesson.opensAt > new Date())
      throw new ForbiddenException('课时尚未开放');
    return {
      lesson: { id: lesson.id, title: lesson.title, courseId: lesson.courseId },
      course: { id: course.id, title: course.title, status: course.status },
    };
  }

  async list(actor: Actor, input: unknown, mobile = false) {
    const q = (mobile ? noteQuery.strict() : noteQuery).parse(input);
    return this.scoped(actor, async (tx, auth, actor) => {
      const courseIds = await auth.courseIds(actor);
      if (q.courseId) await auth.course(actor, q.courseId);
      if (!courseIds.length) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
      const where = Prisma.sql`
      n."userId" = ${actor.id} AND n."organizationId" = ${actor.organizationId}
      AND n."courseId" IN (${Prisma.join(q.courseId ? [q.courseId] : courseIds)})
      AND c."organizationId" = ${actor.organizationId} AND l."courseId" = n."courseId"
      ${actor.role === 'STUDENT' ? Prisma.sql`AND (l."opensAt" IS NULL OR l."opensAt" <= ${new Date()})` : Prisma.empty}
      ${q.pinned !== undefined ? Prisma.sql`AND n."pinned" = ${q.pinned === 'true'}` : Prisma.empty}
      ${q.search ? Prisma.sql`AND (strpos(lower(n."body"), lower(${q.search})) > 0 OR strpos(lower(l."title"), lower(${q.search})) > 0 OR strpos(lower(c."title"), lower(${q.search})) > 0)` : Prisma.empty}
    `;
      const join = Prisma.sql`FROM "LessonNote" n JOIN "Lesson" l ON l."id" = n."lessonId" JOIN "Course" c ON c."id" = n."courseId" WHERE ${where}`;
      const [items, count] = await Promise.all([
        tx.$queryRaw(Prisma.sql`
        SELECT n."id", n."lessonId", n."courseId", n."pinned", n."revision", n."updatedAt",
          left(n."body", 300) AS "preview", l."title" AS "lessonTitle", c."title" AS "courseTitle"
        ${join} ORDER BY n."pinned" DESC, n."updatedAt" DESC, n."id" ASC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
      `),
        tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${join}`),
      ]);
      return { items, total: Number(count[0].total), page: q.page, pageSize: q.pageSize };
    });
  }
  async read(actor: Actor, lessonId: string) {
    return this.scoped(actor, async (tx, auth, actor) => {
      const source = await this.source(tx, auth, actor, lessonId);
      const note = await tx.lessonNote.findFirst({
        where: { userId: actor.id, organizationId: actor.organizationId, lessonId },
      });
      return { ...source, note };
    });
  }
  async save(actor: Actor, lessonId: string, body: unknown) {
    const d = noteInput.parse(body);
    return this.scoped(actor, async (tx, auth, actor) => {
      const source = await this.source(tx, auth, actor, lessonId);
      const where = { userId: actor.id, organizationId: actor.organizationId, lessonId };
      if (d.revision === 0) {
        const existing = await tx.lessonNote.findFirst({ where });
        if (existing) throw new ConflictException('笔记已存在，请载入最新版本；当前输入尚未覆盖');
        const note = await tx.lessonNote.create({
          data: { ...where, courseId: source.course.id, body: d.body, pinned: d.pinned },
        });
        return { ...source, note };
      }
      const result = await tx.lessonNote.updateMany({
        where: { ...where, id: d.noteId, revision: d.revision },
        data: { body: d.body, pinned: d.pinned, revision: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new ConflictException('笔记已在其他页面更新，请先载入最新版本；当前输入尚未覆盖');
      return { ...source, note: await tx.lessonNote.findFirstOrThrow({ where }) };
    });
  }
  async remove(actor: Actor, lessonId: string, body: unknown) {
    const d = noteDelete.parse(body);
    return this.scoped(actor, async (tx, auth, actor) => {
      await this.source(tx, auth, actor, lessonId);
      const result = await tx.lessonNote.deleteMany({
        where: {
          id: d.noteId,
          userId: actor.id,
          organizationId: actor.organizationId,
          lessonId,
          revision: d.revision,
        },
      });
      if (result.count !== 1) throw new ConflictException('笔记已变更，请载入最新版本后再删除');
      return { deleted: true };
    });
  }
}
