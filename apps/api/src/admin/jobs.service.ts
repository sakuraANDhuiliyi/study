import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { JobsService } from '../common/jobs.service';
import { AssessmentService } from '../assessment/assessment.service';
import { schedulerSnapshotDto } from '../common/scheduler-status';
import { jobsKindPattern, parseJobsQuery } from './jobs.schemas';

type JobRow = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  runAt: string;
  lastError: string | null;
  createdAt: string;
  organizationId: string;
  organizationName: string;
};
type DeadlineRun = {
  id: string;
  type: string;
  status: string;
  processed: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};
type JobResult = {
  items: JobRow[];
  total: number;
  serverTime: Date;
  stateCounts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    other: number;
    all: number;
  };
  examDeadlineRuns: DeadlineRun[];
};

@Injectable()
export class AdminJobsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly jobs: JobsService,
    private readonly assessment: AssessmentService,
  ) {}

  async list(actor: Actor, query: unknown) {
    this.auth.require(actor, 'audit.read');
    const input = parseJobsQuery(query);
    const platform = actor.permissions.includes('org.platform');
    const scope = platform
      ? Prisma.sql`o.kind = 'INSTITUTION'`
      : Prisma.sql`j."organizationId" = ${actor.organizationId}`;
    const keyword = input.action
      ? Prisma.sql`AND j.kind ILIKE ${jobsKindPattern(input.action)} ESCAPE ${'\\'}`
      : Prisma.empty;
    const status = input.status === 'ALL' ? Prisma.empty : Prisma.sql`WHERE status = ${input.status}`;
    // Ordinary readers never query the separate global AssessmentJobRun table.
    const runs = platform
      ? Prisma.sql`, deadline_runs AS (
      SELECT id, type, status, processed, error, "startedAt", "completedAt" FROM "AssessmentJobRun"
      ORDER BY "startedAt" DESC, id DESC LIMIT 20
    )`
      : Prisma.empty;
    const runResult = platform
      ? Prisma.sql`COALESCE((SELECT jsonb_agg(to_jsonb(r)
      ORDER BY r."startedAt" DESC, r.id DESC) FROM deadline_runs r), '[]'::jsonb)`
      : Prisma.sql`'[]'::jsonb`;
    const [result] = await this.db.$queryRaw<JobResult[]>`
      /* admin-jobs-list */
      WITH base AS MATERIALIZED (
        SELECT j.id, j.kind, j.status, j.attempts, j."runAt", j."lastError", j."createdAt",
          j."organizationId", o.name AS "organizationName"
        FROM "BackgroundJob" j JOIN "Organization" o ON o.id = j."organizationId"
        WHERE ${scope} ${keyword}
      ), matched AS MATERIALIZED (
        SELECT * FROM base ${status}
      ), selected AS (
        SELECT * FROM matched ORDER BY "createdAt" DESC, id ASC LIMIT ${input.pageSize} OFFSET ${input.skip}
      ) ${runs}
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."createdAt" DESC, s.id ASC)
        FROM selected s), '[]'::jsonb) AS items,
        (SELECT COUNT(*)::int FROM matched) AS total,
        (SELECT jsonb_build_object(
          'pending', COUNT(*) FILTER (WHERE status = 'PENDING'),
          'running', COUNT(*) FILTER (WHERE status = 'RUNNING'),
          'succeeded', COUNT(*) FILTER (WHERE status = 'SUCCEEDED'),
          'failed', COUNT(*) FILTER (WHERE status = 'FAILED'),
          'other', COUNT(*) FILTER (WHERE status NOT IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
          'all', COUNT(*)) FROM base) AS "stateCounts",
        ${runResult} AS "examDeadlineRuns", statement_timestamp() AS "serverTime"
    `;
    const schedulerStatus = platform
      ? {
          scope: 'responding_api_instance' as const,
          observedAt: new Date().toISOString(),
          common: schedulerSnapshotDto(this.jobs.schedulerSnapshot()),
          examDeadline: schedulerSnapshotDto(this.assessment.schedulerSnapshot()),
        }
      : undefined;
    // No transaction is held while AuthService borrows its own connection. The
    // last check follows every private read, including platform global run history.
    const current = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.organizationId !== actor.organizationId ||
      current.role !== actor.role ||
      current.accountMode !== actor.accountMode ||
      current.csrfToken !== actor.csrfToken
    )
      throw new UnauthorizedException('当前管理会话已变化，请重新登录');
    this.auth.require(current, 'audit.read');
    if (current.permissions.includes('org.platform') !== platform)
      throw new ForbiddenException('后台任务机构查看范围已变化，请刷新后重试');
    // Explicit allowlists keep future/raw columns out of this endpoint's DTO.
    return {
      items: result.items.map((job) => ({
        id: job.id,
        kind: job.kind,
        status: job.status,
        attempts: job.attempts,
        runAt: new Date(job.runAt).toISOString(),
        lastError: job.lastError,
        createdAt: new Date(job.createdAt).toISOString(),
        organizationId: job.organizationId,
        organizationName: job.organizationName,
      })),
      total: result.total,
      page: input.page,
      pageSize: input.pageSize,
      stateCounts: result.stateCounts,
      scope: platform ? 'platform_institutions' : 'current_organization',
      serverTime: result.serverTime.toISOString(),
      examDeadlineRuns: result.examDeadlineRuns.map((run) => ({
        id: run.id,
        type: run.type,
        status: run.status,
        processed: run.processed,
        error: run.error,
        startedAt: new Date(run.startedAt).toISOString(),
        completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
      })),
      ...(schedulerStatus ? { schedulerStatus } : {}),
    };
  }
}
