import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';

export const noteInput = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, '请填写笔记内容')
      .max(10000, '笔记最多 10000 个字符')
      .refine((value) => !value.includes('\u0000'), '笔记不能包含空字符'),
    pinned: z.boolean().default(false),
    revision: z.number().int().min(0).max(2147483646),
    noteId: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => (value.revision === 0 ? value.noteId === undefined : !!value.noteId), {
    path: ['noteId'],
    message: '更新笔记必须提供读取时的笔记标识，新建时不得指定标识',
  });
const noteQuery = z.object({
  search: z.string().trim().max(120).optional(),
  courseId: z.string().min(1).max(100).optional(),
  pinned: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

@ApiTags('私人学习笔记')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller()
export class NotesController {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private async source(actor: Actor, lessonId: string) {
    const lesson = await this.db.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('课时不存在');
    const course = await this.auth.course(actor, lesson.courseId);
    if (actor.role === 'STUDENT' && lesson.opensAt && lesson.opensAt > new Date())
      throw new ForbiddenException('课时尚未开放');
    return {
      lesson: { id: lesson.id, title: lesson.title, courseId: lesson.courseId },
      course: { id: course.id, title: course.title, status: course.status },
    };
  }

  @Get('notes')
  async list(@CurrentActor() actor: Actor, @Query() query: Record<string, string>) {
    const q = noteQuery.parse(query);
    const courseIds = await this.auth.courseIds(actor);
    if (q.courseId) await this.auth.course(actor, q.courseId);
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
      this.db.$queryRaw(Prisma.sql`
        SELECT n."id", n."lessonId", n."courseId", n."pinned", n."revision", n."updatedAt",
          left(n."body", 300) AS "preview", l."title" AS "lessonTitle", c."title" AS "courseTitle"
        ${join} ORDER BY n."pinned" DESC, n."updatedAt" DESC, n."id" ASC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
      `),
      this.db.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${join}`),
    ]);
    return { items, total: Number(count[0].total), page: q.page, pageSize: q.pageSize };
  }

  @Get('lessons/:id/note')
  async read(@CurrentActor() actor: Actor, @Param('id') lessonId: string) {
    const source = await this.source(actor, lessonId);
    const note = await this.db.lessonNote.findFirst({
      where: { userId: actor.id, organizationId: actor.organizationId, lessonId },
    });
    return { ...source, note };
  }

  @Put('lessons/:id/note')
  async save(@CurrentActor() actor: Actor, @Param('id') lessonId: string, @Body() body: unknown) {
    const d = noteInput.parse(body);
    const source = await this.source(actor, lessonId);
    // Notes are personal data, including when the active role manages the source course.
    const where = { userId: actor.id, organizationId: actor.organizationId, lessonId };
    const note = await this.db.$transaction(async (tx) => {
      if (d.revision === 0)
        return tx.lessonNote.create({
          data: { ...where, courseId: source.course.id, body: d.body, pinned: d.pinned },
        });
      const result = await tx.lessonNote.updateMany({
        where: { ...where, id: d.noteId, revision: d.revision },
        data: { body: d.body, pinned: d.pinned, revision: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new ConflictException('笔记已在其他页面更新，请先载入最新版本；当前输入尚未覆盖');
      return tx.lessonNote.findFirstOrThrow({ where });
    });
    return { ...source, note };
  }

  @Delete('lessons/:id/note')
  async remove(@CurrentActor() actor: Actor, @Param('id') lessonId: string, @Body() body: unknown) {
    const d = z
      .object({ revision: z.number().int().min(1).max(2147483647), noteId: z.string().min(1).max(100) })
      .strict()
      .parse(body);
    await this.source(actor, lessonId);
    const result = await this.db.lessonNote.deleteMany({
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
  }
}
