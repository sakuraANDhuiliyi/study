import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { CombinedNoteQuery } from './standalone.schemas';

export function canUseStandalone(actor: Actor) {
  return (
    (actor.role === 'STUDENT' && actor.permissions.includes('learning.use')) ||
    (actor.role === 'TEACHER' &&
      actor.accountMode === 'ORGANIZATION' &&
      actor.permissions.includes('course.read'))
  );
}

export async function lessonNotesFrom(
  tx: Prisma.TransactionClient,
  auth: AuthService,
  actor: Actor,
  q: Pick<CombinedNoteQuery, 'courseId' | 'search' | 'pinned'>,
) {
  const courseIds = await auth.courseIds(actor);
  if (q.courseId) await auth.course(actor, q.courseId);
  if (!courseIds.length) return null;
  const where = Prisma.sql`
      n."userId" = ${actor.id} AND n."organizationId" = ${actor.organizationId}
      AND n."courseId" IN (${Prisma.join(q.courseId ? [q.courseId] : courseIds)})
      AND c."organizationId" = ${actor.organizationId} AND l."courseId" = n."courseId"
      ${actor.role === 'STUDENT' ? Prisma.sql`AND (l."opensAt" IS NULL OR l."opensAt" <= ${new Date()})` : Prisma.empty}
      ${q.pinned !== undefined ? Prisma.sql`AND n."pinned" = ${q.pinned === 'true'}` : Prisma.empty}
      ${q.search ? Prisma.sql`AND (strpos(lower(n."body"), lower(${q.search})) > 0 OR strpos(lower(l."title"), lower(${q.search})) > 0 OR strpos(lower(c."title"), lower(${q.search})) > 0)` : Prisma.empty}
    `;
  return Prisma.sql`FROM "LessonNote" n JOIN "Lesson" l ON l."id" = n."lessonId" JOIN "Course" c ON c."id" = n."courseId" WHERE ${where}`;
}

export async function listCombinedNotes(
  tx: Prisma.TransactionClient,
  auth: AuthService,
  actor: Actor,
  q: CombinedNoteQuery,
) {
  const standalone = canUseStandalone(actor);
  const lessons =
    actor.accountMode === 'ORGANIZATION' &&
    (['STUDENT', 'TEACHER'].includes(actor.role)
      ? actor.permissions.includes('course.read')
      : actor.permissions.includes('course.admin'));
  if ((q.source === 'standalone' && !standalone) || (!standalone && !lessons))
    throw new ForbiddenException('当前身份没有笔记访问权限');

  const sources: Prisma.Sql[] = [];
  if (lessons && q.source !== 'standalone' && !q.category) {
    const from = await lessonNotesFrom(tx, auth, actor, q);
    if (from)
      sources.push(
        Prisma.sql`SELECT 'lesson'::text AS "source", n."id", l."title", NULL::text AS "category", n."body", n."pinned", n."revision", n."createdAt", n."updatedAt", n."courseId", n."lessonId", c."title" AS "courseTitle", l."title" AS "lessonTitle" ${from}`,
      );
  }
  if (standalone && q.source !== 'lesson' && !q.courseId) {
    sources.push(Prisma.sql`SELECT 'standalone'::text AS "source", n."id", n."title", n."category", n."body", n."pinned", n."revision", n."createdAt", n."updatedAt", NULL::text AS "courseId", NULL::text AS "lessonId", NULL::text AS "courseTitle", NULL::text AS "lessonTitle"
      FROM "StandaloneNote" n WHERE n."organizationId" = ${actor.organizationId} AND n."userId" = ${actor.id}
      ${q.pinned !== undefined ? Prisma.sql`AND n."pinned" = ${q.pinned === 'true'}` : Prisma.empty}
      ${q.category ? Prisma.sql`AND n."category" = ${q.category}` : Prisma.empty}
      ${q.search ? Prisma.sql`AND (strpos(lower(n."title"), lower(${q.search})) > 0 OR strpos(lower(n."body"), lower(${q.search})) > 0 OR strpos(lower(n."category"), lower(${q.search})) > 0)` : Prisma.empty}`);
  }
  if (!sources.length) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
  type Row = {
    source: 'lesson' | 'standalone';
    id: string;
    title: string;
    body: string;
    category: string | null;
    pinned: boolean;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
    courseId: string | null;
    lessonId: string | null;
    courseTitle: string | null;
    lessonTitle: string | null;
  };
  // One statement gives the count and the requested page the same snapshot, even for an empty last page.
  const rows = await tx.$queryRaw<(Row & { total: bigint })[]>(Prisma.sql`
    WITH notes AS (${Prisma.join(sources, ' UNION ALL ')})
    SELECT page.*, totals.total
    FROM (SELECT count(*) AS total FROM notes) totals
    LEFT JOIN (SELECT * FROM notes ORDER BY "pinned" DESC, "updatedAt" DESC, "id", "source"
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}) page ON TRUE
    ORDER BY page."pinned" DESC, page."updatedAt" DESC, page."id", page."source"`);
  return {
    items: rows
      .filter((row) => row.id !== null)
      .map(({ body, total: _total, ...row }) => ({
        ...row,
        preview: Array.from(body).slice(0, 300).join(''),
      })),
    total: Number(rows[0].total),
    page: q.page,
    pageSize: q.pageSize,
  };
}
