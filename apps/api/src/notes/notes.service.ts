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
import { canUseStandalone, lessonNotesFrom, listCombinedNotes } from './note-list';
import {
  combinedNoteQuery,
  standaloneCreate,
  standaloneDelete,
  standaloneId,
  standalonePatch,
} from './standalone.schemas';
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
      // Space changes and role switches must wait for an in-flight scoped operation.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${a.id} FOR SHARE`;
      if (a.sessionId) await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${a.sessionId} FOR SHARE`;
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
        if (current.role === 'STUDENT') auth.require(current, 'learning.use');
        else if (current.role === 'TEACHER' && current.accountMode === 'ORGANIZATION')
          auth.require(current, 'course.read');
        else throw new ForbiddenException('当前手机身份不能使用私人笔记');
      }
      return run(tx, auth, { ...current, requestId: a.requestId });
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
      const join = await lessonNotesFrom(tx, auth, actor, q);
      if (!join) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
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
  listCombined(actor: Actor, input: unknown) {
    const q = combinedNoteQuery.parse(input);
    return this.scoped(actor, (tx, auth, current) => listCombinedNotes(tx, auth, current, q));
  }

  private standalone<T>(
    actor: Actor,
    run: (tx: Prisma.TransactionClient, scope: { organizationId: string; userId: string }) => Promise<T>,
  ) {
    return this.scoped(actor, async (tx, _auth, current) => {
      if (!canUseStandalone(current)) throw new ForbiddenException('当前身份不能使用独立笔记');
      return run(tx, { organizationId: current.organizationId, userId: current.id });
    });
  }

  private readonly standaloneFields = {
    id: true,
    title: true,
    category: true,
    body: true,
    pinned: true,
    revision: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  private recordChange(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: string,
    id: string,
    revision: number,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        action: 'note.standalone.' + action,
        resourceType: 'StandaloneNote',
        resourceId: id,
        requestId: actor.requestId,
        details: { revision },
      },
    });
  }
  readStandalone(actor: Actor, noteId: string) {
    const id = standaloneId.parse(noteId);
    return this.standalone(actor, async (tx, scope) => {
      const note = await tx.standaloneNote.findFirst({
        where: { ...scope, id },
        select: this.standaloneFields,
      });
      if (!note) throw new NotFoundException('笔记不存在');
      return note;
    });
  }
  createStandalone(actor: Actor, input: unknown) {
    const data = standaloneCreate.parse(input);
    return this.standalone(actor, async (tx, scope) => {
      const note = await tx.standaloneNote.create({
        data: { ...scope, ...data },
        select: this.standaloneFields,
      });
      await this.recordChange(tx, actor, 'create', note.id, note.revision);
      return note;
    });
  }
  updateStandalone(actor: Actor, noteId: string, input: unknown) {
    const id = standaloneId.parse(noteId);
    const { revision, ...data } = standalonePatch.parse(input);
    return this.standalone(actor, async (tx, scope) => {
      const where = { ...scope, id };
      const changed = await tx.standaloneNote.updateMany({
        where: { ...where, revision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (!changed.count) await this.standaloneConflict(tx, where);
      const note = await tx.standaloneNote.findFirstOrThrow({ where, select: this.standaloneFields });
      await this.recordChange(tx, actor, 'update', id, note.revision);
      return note;
    });
  }
  removeStandalone(actor: Actor, noteId: string, input: unknown) {
    const id = standaloneId.parse(noteId);
    const { revision } = standaloneDelete.parse(input);
    return this.standalone(actor, async (tx, scope) => {
      const where = { ...scope, id };
      const deleted = await tx.standaloneNote.deleteMany({ where: { ...where, revision } });
      if (!deleted.count) await this.standaloneConflict(tx, where);
      await this.recordChange(tx, actor, 'delete', id, revision);
      return { deleted: true };
    });
  }
  private async standaloneConflict(
    tx: Prisma.TransactionClient,
    where: { id: string; organizationId: string; userId: string },
  ): Promise<never> {
    if (!(await tx.standaloneNote.findFirst({ where, select: { id: true } })))
      throw new NotFoundException('笔记不存在');
    throw new ConflictException('笔记已在其他页面更新，请载入最新版本');
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
