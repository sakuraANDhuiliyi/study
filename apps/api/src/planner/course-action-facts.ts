import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';

// Both consumers use these full course facts. The planner alone adds its seven-day
// horizon; dashboard counts never depend on a displayed page or a sampled list.
export function allowedActionCourses(actor: Actor, courseContent = true, courseId?: string) {
  return Prisma.sql`
    SELECT c.id, c.title FROM "Course" c
    JOIN "Enrollment" e ON e."courseId" = c.id AND e."userId" = ${actor.id} AND e.active
    WHERE ${courseContent} AND c."organizationId" = ${actor.organizationId}
      AND c.status IN ('PUBLISHED', 'ARCHIVED')
      ${courseId ? Prisma.sql`AND c.id = ${courseId}` : Prisma.empty}
  `;
}

export function courseActionFacts(actor: Actor, now: Date, courseContent = true, courseId?: string) {
  return Prisma.sql`
    allowed_courses AS (
      ${allowedActionCourses(actor, courseContent, courseId)}
    ), assignment_facts AS (
      SELECT a.id, 'assignment'::text AS kind, a.title,
        GREATEST(a."dueAt", COALESCE(exception."allowUntil", a."dueAt")) AS "dueAt",
        a."courseId", c.title AS "courseTitle", NULL::int AS revision,
        a."dueAt" AS "originalDueAt", NULL::timestamptz AS "startsAt",
        latest.status AS "latestStatus", latest.version AS "latestNumber",
        a."maxAttempts", COALESCE(exception."extraAttempts", 0) AS "extraAttempts",
        a."allowLate", NULL::text AS "attemptId",
        (COALESCE(latest.version, 0) < a."maxAttempts" + COALESCE(exception."extraAttempts", 0)
          AND (a."allowLate" OR GREATEST(a."dueAt", COALESCE(exception."allowUntil", a."dueAt")) >= ${now}))
          AS "canAct", TRUE AS "showInPlanner"
      FROM "Assignment" a
      JOIN allowed_courses c ON c.id = a."courseId"
      JOIN "AssignmentAudience" audience ON audience."assignmentId" = a.id AND audience."userId" = ${actor.id}
      LEFT JOIN "AssignmentException" exception ON exception."assignmentId" = a.id AND exception."userId" = ${actor.id}
      LEFT JOIN LATERAL (
        SELECT s.status, s.version FROM "AssignmentSubmission" s
        WHERE s."assignmentId" = a.id AND s."userId" = ${actor.id}
        ORDER BY s.version DESC LIMIT 1
      ) latest ON TRUE
      WHERE a."organizationId" = ${actor.organizationId} AND a.status = 'published'
        AND a."opensAt" <= ${now} AND COALESCE(exception.exempt, FALSE) = FALSE
        AND (latest.status IS NULL OR latest.status = 'returned')
    ), exam_state AS (
      SELECT x.id, x.title, x."courseId", c.title AS "courseTitle", x."startsAt",
        x."maxAttempts", COALESCE(extension."extraAttempts", 0) AS "extraAttempts",
        latest.id AS "attemptId", latest.status AS "latestStatus", latest.number AS "latestNumber",
        CASE WHEN latest.status = 'in_progress' THEN latest."deadlineAt"
          WHEN x."startsAt" > ${now} THEN x."startsAt"
          ELSE COALESCE(extension."deadlineAt", x."entryClosesAt") END AS "dueAt",
        COALESCE(latest.status = 'in_progress' AND latest."deadlineAt" > ${now}, FALSE) AS "canContinue",
        (latest.status IS DISTINCT FROM 'in_progress'
          AND COALESCE(latest.number, 0) < x."maxAttempts" + COALESCE(extension."extraAttempts", 0)
          AND COALESCE(extension."deadlineAt", x."entryClosesAt") > ${now}) AS "entryAvailable"
      FROM "Exam" x
      JOIN allowed_courses c ON c.id = x."courseId"
      JOIN "ExamAudience" audience ON audience."examId" = x.id AND audience."userId" = ${actor.id} AND audience.eligible
      LEFT JOIN "ExamExtension" extension ON extension."examId" = x.id AND extension."userId" = ${actor.id}
      LEFT JOIN LATERAL (
        SELECT attempt.id, attempt.status, attempt.number, attempt."deadlineAt" FROM "ExamAttempt" attempt
        WHERE attempt."examId" = x.id AND attempt."userId" = ${actor.id}
        ORDER BY attempt.number DESC LIMIT 1
      ) latest ON TRUE
      WHERE x."organizationId" = ${actor.organizationId} AND x.status = 'published'
        AND x."gradesReleasedAt" IS NULL
    ), course_action_facts AS (
      SELECT * FROM assignment_facts
      UNION ALL
      SELECT id, 'exam', title, "dueAt", "courseId", "courseTitle", NULL::int,
        NULL::timestamptz, "startsAt", "latestStatus", "latestNumber", "maxAttempts", "extraAttempts",
        NULL::boolean, "attemptId",
        ("canContinue" OR ("entryAvailable" AND "startsAt" <= ${now})),
        ("canContinue" OR "entryAvailable")
      FROM exam_state
    )
  `;
}
