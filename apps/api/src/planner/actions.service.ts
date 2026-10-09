import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { learningActionDto, type LearningActionRow } from './actions.dto';
import {
  learningActionCoursesQuery,
  learningActionRange,
  learningActionsQuery,
  learningCourseSearchPattern,
} from './actions.schemas';
import { allowedActionCourses, courseActionFacts } from './course-action-facts';

type ActionResult = {
  items: LearningActionRow[];
  counts: { today: number; upcoming: number; overdue: number };
  courseIds: string[];
  selectedCourseAllowed: boolean;
};

type CoursePage = { items: { id: string; title: string }[]; total: number; verified: number };

@Injectable()
export class LearningActionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private student(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('学习行动清单仅供学生使用');
    this.auth.require(actor, 'learning.use');
  }

  private async fresh(actor: Actor, courseContent: boolean) {
    const current = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.sessionId !== actor.sessionId ||
      current.organizationId !== actor.organizationId ||
      current.accountMode !== actor.accountMode ||
      current.role !== actor.role ||
      current.csrfToken !== actor.csrfToken
    )
      throw new UnauthorizedException('当前身份已变化，请重新登录');
    this.student(current);
    if (courseContent) this.auth.require(current, 'course.read');
    return current;
  }

  async courses(actor: Actor, query: unknown) {
    this.student(actor);
    this.auth.require(actor, 'course.read');
    const input = learningActionCoursesQuery.parse(query);
    const search = input.search
      ? Prisma.sql`WHERE title ILIKE ${learningCourseSearchPattern(input.search)} ESCAPE ${'\\'}`
      : Prisma.empty;
    const page = async (sourceIds: string[]) => {
      const [result] = await this.db.$queryRaw<CoursePage[]>`
        WITH allowed_courses AS MATERIALIZED (${allowedActionCourses(actor)}),
        matched AS MATERIALIZED (SELECT id, title FROM allowed_courses ${search}),
        selected AS (
          SELECT id, title FROM matched ORDER BY title ASC, id ASC
          LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
        )
        SELECT COALESCE((SELECT jsonb_agg(to_jsonb(selected) ORDER BY title ASC, id ASC)
          FROM selected), '[]'::jsonb) AS items,
          (SELECT COUNT(*)::int FROM matched) AS total,
          (SELECT COUNT(*)::int FROM allowed_courses
            WHERE id IN (SELECT jsonb_array_elements_text(${JSON.stringify(sourceIds)}::jsonb))) AS verified
      `;
      return result ?? { items: [], total: 0, verified: 0 };
    };
    const first = await page([]);
    await this.fresh(actor, true);
    // A bounded page of old private titles is guarded independently of search;
    // the second statement supplies the complete current count and page. Never
    // enumerate every matching course ID or retain an older count after trimming.
    const sourceIds = first.items.map((course) => course.id);
    const result = await page(sourceIds);
    if (result.verified !== sourceIds.length)
      throw new ForbiddenException('课程访问资格已变化，请刷新后重试');
    await this.fresh(actor, true);
    return {
      items: result.items.map((course) => ({ id: course.id, title: course.title })),
      total: result.total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async list(actor: Actor, query: unknown) {
    this.student(actor);
    const input = learningActionsQuery.parse(query);
    if (input.courseId || input.type === 'assignment' || input.type === 'exam')
      this.auth.require(actor, 'course.read');
    const now = new Date();
    const range = learningActionRange(now);
    // Personal tasks stay available without course.read. This endpoint requires
    // learning.use; course content additionally requires live membership/audience.
    const courseContent =
      input.type !== 'personal' &&
      actor.permissions.includes('course.read') &&
      actor.permissions.includes('learning.use');
    const direction = input.bucket === 'overdue' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const [result] = await this.db.$queryRaw<ActionResult[]>`
      WITH ${courseActionFacts(actor, now, courseContent, input.courseId)}, facts AS (
        SELECT t.id, 'personal'::text AS kind, t.title, t."dueAt" AS "dueAt",
          NULL::text AS "courseId", NULL::text AS "courseTitle", t.revision,
          NULL::timestamptz AS "originalDueAt", NULL::timestamptz AS "startsAt",
          NULL::text AS "latestStatus", NULL::int AS "latestNumber", NULL::int AS "maxAttempts",
          NULL::int AS "extraAttempts", NULL::boolean AS "allowLate", NULL::text AS "attemptId"
        FROM "PersonalTask" t
        WHERE t."organizationId" = ${actor.organizationId} AND t."userId" = ${actor.id}
          AND t."completedAt" IS NULL AND t."dueAt" < ${range.upcomingEnd}
          AND ${!input.courseId && (input.type === 'all' || input.type === 'personal')}
        UNION ALL
        SELECT id, kind, title, "dueAt", "courseId", "courseTitle", revision,
          "originalDueAt", "startsAt", "latestStatus", "latestNumber", "maxAttempts",
          "extraAttempts", "allowLate", "attemptId"
        FROM course_action_facts WHERE "showInPlanner" AND "dueAt" < ${range.upcomingEnd}
          AND (kind <> 'assignment' OR "originalDueAt" < ${range.upcomingEnd})
          AND (${input.type === 'all'} OR kind = ${input.type})
      ), classified AS (
        SELECT facts.*, CASE WHEN "dueAt" < ${now} THEN 'overdue'
          WHEN "dueAt" < ${range.tomorrowStart} THEN 'today' ELSE 'upcoming' END AS bucket
        FROM facts WHERE "dueAt" < ${range.upcomingEnd}
      ), selected AS (
        SELECT * FROM classified WHERE bucket = ${input.bucket}
        ORDER BY "dueAt" ${direction}, kind ASC, id ASC
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      )
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(selected) - 'bucket'
        ORDER BY "dueAt" ${direction}, kind ASC, id ASC) FROM selected), '[]'::jsonb) AS items,
        COALESCE((SELECT jsonb_agg(DISTINCT "courseId") FROM classified
          WHERE "courseId" IS NOT NULL), '[]'::jsonb) AS "courseIds",
        jsonb_build_object(
          'today', (SELECT COUNT(*) FROM classified WHERE bucket = 'today'),
          'upcoming', (SELECT COUNT(*) FROM classified WHERE bucket = 'upcoming'),
          'overdue', (SELECT COUNT(*) FROM classified WHERE bucket = 'overdue')
        ) AS counts
        , ${input.courseId ? Prisma.sql`EXISTS (SELECT 1 FROM allowed_courses)` : Prisma.sql`TRUE`}
          AS "selectedCourseAllowed"
    `;
    if (input.courseId && !result?.selectedCourseAllowed) throw new ForbiddenException('无权访问所选课程');
    const courseIds = [
      ...new Set([...(result?.courseIds ?? []), ...(input.courseId ? [input.courseId] : [])]),
    ];
    const grants = (result?.items ?? [])
      .filter((item) => item.courseId)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        courseId: item.courseId,
      }));
    if (courseIds.length) {
      // The first SELECT may have waited with an older snapshot. Validate every
      // course contributing to counts, plus the <=20 displayed item audiences,
      // against a new committed snapshot. A rejected read never trims items while
      // retaining old totals, and the internal courseIds are not in the DTO.
      const [verified] = await this.db.$queryRaw<{ courses: number; items: number }[]>`
        WITH live_courses AS (
          SELECT c.id FROM "Course" c
          JOIN "Enrollment" e ON e."courseId" = c.id AND e."userId" = ${actor.id} AND e.active
          WHERE c."organizationId" = ${actor.organizationId} AND c.status IN ('PUBLISHED', 'ARCHIVED')
            AND c.id IN (${Prisma.join(courseIds)})
        ), shown AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(grants)}::jsonb)
            AS g(id text, kind text, "courseId" text)
        )
        SELECT (SELECT COUNT(*)::int FROM live_courses) AS courses,
          (SELECT COUNT(*)::int FROM shown g JOIN live_courses c ON c.id = g."courseId"
            WHERE (g.kind = 'assignment' AND EXISTS (
              SELECT 1 FROM "Assignment" a JOIN "AssignmentAudience" audience ON audience."assignmentId" = a.id
              WHERE a.id = g.id AND a."courseId" = c.id AND a."organizationId" = ${actor.organizationId}
                AND a.status = 'published' AND audience."userId" = ${actor.id}
            )) OR (g.kind = 'exam' AND EXISTS (
              SELECT 1 FROM "Exam" x JOIN "ExamAudience" audience ON audience."examId" = x.id
              WHERE x.id = g.id AND x."courseId" = c.id AND x."organizationId" = ${actor.organizationId}
                AND x.status = 'published' AND x."gradesReleasedAt" IS NULL
                AND audience."userId" = ${actor.id} AND audience.eligible
            ))) AS items
      `;
      if (verified?.courses !== courseIds.length || verified.items !== grants.length)
        throw new ForbiddenException('课程或任务访问资格已变化，请刷新后重试');
    }
    // Re-resolve only after all private SELECTs, including the fresh course check,
    // so a wait during either query cannot publish an old session's private data.
    await this.fresh(actor, courseContent);
    const counts = result?.counts ?? { today: 0, upcoming: 0, overdue: 0 };
    return {
      items: (result?.items ?? []).map((item) => learningActionDto(item, now)),
      counts,
      total: counts[input.bucket],
      page: input.page,
      pageSize: input.pageSize,
      bucket: input.bucket,
      filters: { type: input.type, courseId: input.courseId ?? null },
      timezone: 'Asia/Shanghai',
      serverTime: now.toISOString(),
      range: {
        todayStart: range.todayStart.toISOString(),
        tomorrowStart: range.tomorrowStart.toISOString(),
        upcomingEnd: range.upcomingEnd.toISOString(),
      },
    };
  }
}
