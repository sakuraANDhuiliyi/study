import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';

export const queueQuery = z
  .object({
    type: z.enum(['all', 'assignment', 'exam', 'appeal']).default('all'),
    courseId: z.string().trim().min(1).max(128).optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
type Query = z.infer<typeof queueQuery>;
type Entry = {
  type: 'assignment' | 'exam' | 'appeal';
  id: string;
  parentId: string;
  title: string;
  courseId: string;
  courseTitle: string;
  studentName: string;
  submittedAt: Date;
  late: boolean;
  status: string;
};
type Summary = {
  pendingAssignments: number;
  pendingExams: number;
  pendingAppeals: number;
  totalPending: number;
};
export function gradingAllowed(actor: Pick<Actor, 'role' | 'accountMode' | 'permissions'>) {
  if (actor.accountMode !== 'ORGANIZATION' || !actor.permissions.includes('assessment.grade')) return false;
  if (actor.role === 'TEACHER')
    return ['course.read', 'course.manage'].every((p) => actor.permissions.includes(p));
  return ['ADMIN', 'SUPER_ADMIN'].includes(actor.role) && actor.permissions.includes('course.admin');
}

export function gradingTarget({ type, id, parentId }: Pick<Entry, 'type' | 'id' | 'parentId'>) {
  const key = encodeURIComponent(id);
  if (type === 'exam') return `/grading/exam/${key}`;
  if (type === 'appeal') return `/appeals?appeal=${key}`;
  return `/assignments/${encodeURIComponent(parentId)}?submission=${key}`;
}

@Injectable()
export class GradingQueueService {
  constructor(private readonly db: PrismaService) {}

  async read(actor: Actor, query: Query) {
    if (!gradingAllowed(actor)) throw new ForbiddenException('当前身份无权使用批阅中心');
    return this.db.$transaction(
      async (tx) => {
        const auth = new AuthService(tx as PrismaService);
        const current = actor.sessionId
          ? await (actor.clientType === 'MOBILE'
              ? auth.resolveMobileSessionId(actor.sessionId)
              : auth.resolveSessionId(actor.sessionId))
          : null;
        if (
          !current ||
          current.id !== actor.id ||
          current.organizationId !== actor.organizationId ||
          current.role !== actor.role ||
          current.csrfToken !== actor.csrfToken ||
          !gradingAllowed(current)
        )
          throw new ForbiddenException('批阅授权已变化');
        const courses = await auth.courseIds(current);
        if (query.courseId && !courses.includes(query.courseId))
          throw new ForbiddenException('无权使用该课程的批阅队列');
        const ids = query.courseId ? [query.courseId] : courses;
        const { page, pageSize, type } = query;
        const empty: Summary = { pendingAssignments: 0, pendingExams: 0, pendingAppeals: 0, totalPending: 0 };
        if (!ids.length) return { ...empty, items: [], total: 0, page, pageSize };
        // Read the same course set, grader assignments and state for both counters and the selected page.
        const rows = await tx.$queryRaw<(Entry & Summary & { total: number })[]>(Prisma.sql`
        WITH courses AS (
          SELECT id, title FROM "Course" WHERE "organizationId" = ${current.organizationId}
            AND id IN (${Prisma.join(ids)}) AND status <> 'ARCHIVED'
        ), exams AS (
          SELECT e.id, e.title, e.status, c.id AS "courseId", c.title AS "courseTitle"
          FROM "Exam" e JOIN courses c ON c.id = e."courseId"
          WHERE e."organizationId" = ${current.organizationId}
            AND (COALESCE(cardinality(e."graderIds"), 0) = 0 OR ${current.id} = ANY(e."graderIds"))
        ), queue AS (
          SELECT 'assignment' AS type, s.id, a.id AS "parentId", a.title, c.id AS "courseId",
            c.title AS "courseTitle", u.name AS "studentName", s."submittedAt", s.late, s.status
          FROM "AssignmentSubmission" s JOIN "Assignment" a ON a.id = s."assignmentId"
          JOIN courses c ON c.id = a."courseId"
          JOIN "User" u ON u.id = s."userId" AND u."organizationId" = ${current.organizationId}
          WHERE a."organizationId" = ${current.organizationId} AND s.status = 'submitted'
            AND s."gradingStatus" = 'pending' AND s."releasedAt" IS NULL
          UNION ALL
          SELECT 'exam', t.id, e.id, e.title, e."courseId", e."courseTitle", u.name, t."submittedAt", false, t.status
          FROM "ExamAttempt" t JOIN exams e ON e.id = t."examId"
          JOIN "User" u ON u.id = t."userId" AND u."organizationId" = ${current.organizationId}
          WHERE t.status IN ('submitted', 'timed_out') AND e.status = 'published'
            AND t."gradingStatus" = 'pending' AND t."releaseStatus" <> 'released'
          UNION ALL
          SELECT 'appeal', a.id, e.id, e.title, e."courseId", e."courseTitle", u.name, a."createdAt", false, a.status
          FROM "GradeAppeal" a JOIN "ExamAttempt" t ON t.id = a."attemptId"
          JOIN exams e ON e.id = t."examId"
          JOIN "User" u ON u.id = a."userId" AND u.id = t."userId" AND u."organizationId" = ${current.organizationId}
          WHERE a.status = 'pending'
        ), counts AS (
          SELECT count(*)::int AS "totalPending",
            (count(*) FILTER (WHERE type='assignment'))::int AS "pendingAssignments",
            (count(*) FILTER (WHERE type='exam'))::int AS "pendingExams",
            (count(*) FILTER (WHERE type='appeal'))::int AS "pendingAppeals",
            (count(*) FILTER (WHERE ${type} = 'all' OR type = ${type}))::int AS total FROM queue
        )
        SELECT p.*, counts.* FROM counts LEFT JOIN (
          SELECT * FROM queue WHERE ${type} = 'all' OR type = ${type}
          ORDER BY "submittedAt", type, id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        ) p ON TRUE ORDER BY p."submittedAt", p.type, p.id`);
        const { pendingAssignments, pendingExams, pendingAppeals, totalPending, total } = rows[0];
        return {
          pendingAssignments,
          pendingExams,
          pendingAppeals,
          totalPending,
          total,
          page,
          pageSize,
          items: rows
            .filter((row) => row.id !== null)
            .map((row) => ({
              id: row.id,
              type: row.type,
              ...(current.clientType === 'MOBILE' ? { parentId: row.parentId } : {}),
              title: row.title,
              courseId: row.courseId,
              courseTitle: row.courseTitle,
              studentName: row.studentName,
              submittedAt: row.submittedAt,
              late: row.late,
              status: row.status,
              targetPath: gradingTarget(row),
            })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
