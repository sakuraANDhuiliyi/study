import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { learningActionDto, type LearningActionRow } from './actions.dto';
import { learningActionRange, learningActionsQuery } from './actions.schemas';
import { courseActionFacts } from './course-action-facts';

type ActionResult = {
  items: LearningActionRow[];
  counts: { today: number; upcoming: number; overdue: number };
  courseIds: string[];
};

@Injectable()
export class LearningActionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(actor: Actor, query: unknown) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('学习行动清单仅供学生使用');
    this.auth.require(actor, 'learning.use');
    const input = learningActionsQuery.parse(query);
    const now = new Date();
    const range = learningActionRange(now);
    // Personal tasks stay available without course.read. This endpoint requires
    // learning.use; course content additionally requires live membership/audience.
    const courseContent =
      actor.permissions.includes('course.read') && actor.permissions.includes('learning.use');
    const direction = input.bucket === 'overdue' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const [result] = await this.db.$queryRaw<ActionResult[]>`
      WITH ${courseActionFacts(actor, now, courseContent)}, facts AS (
        SELECT t.id, 'personal'::text AS kind, t.title, t."dueAt" AS "dueAt",
          NULL::text AS "courseId", NULL::text AS "courseTitle", t.revision,
          NULL::timestamptz AS "originalDueAt", NULL::timestamptz AS "startsAt",
          NULL::text AS "latestStatus", NULL::int AS "latestNumber", NULL::int AS "maxAttempts",
          NULL::int AS "extraAttempts", NULL::boolean AS "allowLate", NULL::text AS "attemptId"
        FROM "PersonalTask" t
        WHERE t."organizationId" = ${actor.organizationId} AND t."userId" = ${actor.id}
          AND t."completedAt" IS NULL AND t."dueAt" < ${range.upcomingEnd}
        UNION ALL
        SELECT id, kind, title, "dueAt", "courseId", "courseTitle", revision,
          "originalDueAt", "startsAt", "latestStatus", "latestNumber", "maxAttempts",
          "extraAttempts", "allowLate", "attemptId"
        FROM course_action_facts WHERE "showInPlanner" AND "dueAt" < ${range.upcomingEnd}
          AND (kind <> 'assignment' OR "originalDueAt" < ${range.upcomingEnd})
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
    `;
    const courseIds = result?.courseIds ?? [];
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
    const fresh = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (
      !fresh ||
      fresh.id !== actor.id ||
      fresh.organizationId !== actor.organizationId ||
      fresh.role !== actor.role ||
      fresh.csrfToken !== actor.csrfToken
    )
      throw new UnauthorizedException('当前身份已变化，请重新登录');
    this.auth.require(fresh, 'learning.use');
    if (courseContent) this.auth.require(fresh, 'course.read');
    const counts = result?.counts ?? { today: 0, upcoming: 0, overdue: 0 };
    return {
      items: (result?.items ?? []).map((item) => learningActionDto(item, now)),
      counts,
      total: counts[input.bucket],
      page: input.page,
      pageSize: input.pageSize,
      bucket: input.bucket,
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
