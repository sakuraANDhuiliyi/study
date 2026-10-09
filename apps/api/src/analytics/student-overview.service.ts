import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { courseActionFacts } from '../planner/course-action-facts';

type LegacyTask = { id: string; type: string; courseId: string };
type OverviewCount = { assignmentCount: number; examCount: number };

@Injectable()
export class StudentOverviewService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}

  requireStudent(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('学习概览仅供学生使用');
    this.auth.require(actor, 'learning.use');
    this.auth.require(actor, 'course.read');
  }

  private async fresh(actor: Actor) {
    const current = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.organizationId !== actor.organizationId ||
      current.accountMode !== actor.accountMode ||
      current.role !== actor.role ||
      current.csrfToken !== actor.csrfToken
    )
      throw new UnauthorizedException('当前身份已变化，请重新登录');
    this.requireStudent(current);
  }

  // Invoke after every other dashboard private read. Old course/task payloads must
  // still be authorized; the subsequent count statement sees current audiences,
  // membership, personalized windows and latest formal state across all records.
  async read(actor: Actor, now: Date, legacyCourseIds: string[], legacyTasks: LegacyTask[]) {
    this.requireStudent(actor);
    // This first statement can wait with an older READ COMMITTED snapshot. Never
    // return its totals: the final ACL statement also recomputes every count.
    await this.db.$queryRaw<OverviewCount[]>`
      /* student_learning_overview_initial_counts */
      WITH ${courseActionFacts(actor, now)}
      SELECT COUNT(*) FILTER (WHERE kind = 'assignment' AND "canAct")::int AS "assignmentCount",
        COUNT(*) FILTER (WHERE kind = 'exam' AND "canAct")::int AS "examCount"
      FROM course_action_facts
    `;
    await this.fresh(actor);
    const courseIds = [...new Set(legacyCourseIds)];
    const [verified] = await this.db.$queryRaw<(OverviewCount & { courses: number; tasks: number })[]>`
        /* student_learning_overview_final_counts */
        WITH ${courseActionFacts(actor, now)}, live_courses AS (
          SELECT c.id FROM "Course" c
          JOIN "Enrollment" e ON e."courseId" = c.id AND e."userId" = ${actor.id} AND e.active
          WHERE c."organizationId" = ${actor.organizationId} AND c.status IN ('PUBLISHED', 'ARCHIVED')
            AND c.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(courseIds)}::jsonb))
        ), shown AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(legacyTasks)}::jsonb)
            AS g(id text, type text, "courseId" text)
        )
        SELECT (SELECT COUNT(*)::int FROM live_courses) AS courses,
          (SELECT COUNT(*) FILTER (WHERE kind = 'assignment' AND "canAct")::int FROM course_action_facts)
            AS "assignmentCount",
          (SELECT COUNT(*) FILTER (WHERE kind = 'exam' AND "canAct")::int FROM course_action_facts)
            AS "examCount",
          (SELECT COUNT(*)::int FROM shown g JOIN live_courses c ON c.id = g."courseId"
            WHERE (g.type = 'assignment' AND EXISTS (
              SELECT 1 FROM "Assignment" a
              JOIN "AssignmentAudience" audience ON audience."assignmentId" = a.id AND audience."userId" = ${actor.id}
              WHERE a.id = g.id AND a."courseId" = c.id AND a."organizationId" = ${actor.organizationId}
                AND a.status = 'published' AND a."opensAt" <= ${now}
                AND NOT EXISTS (SELECT 1 FROM "AssignmentException" ex
                  WHERE ex."assignmentId" = a.id AND ex."userId" = ${actor.id} AND ex.exempt)
            )) OR (g.type = 'exam' AND EXISTS (
              SELECT 1 FROM "Exam" x
              JOIN "ExamAudience" audience ON audience."examId" = x.id AND audience."userId" = ${actor.id} AND audience.eligible
              WHERE x.id = g.id AND x."courseId" = c.id AND x."organizationId" = ${actor.organizationId}
                AND x.status = 'published'
            ))) AS tasks
      `;
    if (verified?.courses !== courseIds.length || verified.tasks !== legacyTasks.length)
      throw new ForbiddenException('课程或任务访问资格已变化，请刷新后重试');
    await this.fresh(actor);
    return {
      assignmentCount: verified.assignmentCount,
      examCount: verified.examCount,
      metadata: { serverTime: now.toISOString(), timezone: 'Asia/Shanghai', scope: 'actionable_now' },
    };
  }
}
