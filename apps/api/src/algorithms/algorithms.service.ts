import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  type AlgorithmAnalysis,
  type AlgorithmSubmission,
  type AlgorithmLearningState,
} from '@prisma/client';
import type { z } from 'zod';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { AlgorithmAiGateway } from './algorithm-ai.gateway';
import { algorithmProblems, getAlgorithmProblem, type AlgorithmProblem } from './algorithms.catalog';
import { algorithmPlans } from './algorithms.learning';
import { getAlgorithmEditorial } from './algorithms.editorials';
import {
  type AlgorithmAnalysisInput,
  type AlgorithmSubmissionInput,
  type AlgorithmLanguage,
  type algorithmProblemQuery,
  type AlgorithmLearningInput,
} from './algorithms.schemas';
import { JudgeGateway, type JudgeExecutionRequest, type JudgeExecutionResult } from './judge.gateway';

type Tx = Prisma.TransactionClient;
type Pagination = { page: number; pageSize: number };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const EXPIRED = '上次请求已超时，请重新发起。';
const bounded = (value: unknown) => (typeof value === 'string' ? value.slice(0, 16000) : '');
const metric = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(2147483647, Math.max(0, Math.round(value)))
    : null;
const statuses = new Set([
  'accepted',
  'wrong_answer',
  'compile_error',
  'runtime_error',
  'time_limit',
  'memory_limit',
  'system_error',
]);

export type AlgorithmProblemSummary = {
  id: string;
  number: number;
  title: string;
  difficulty: AlgorithmProblem['difficulty'];
  tags: string[];
  status: 'todo' | 'attempted' | 'solved';
  favorite: boolean;
  reviewStatus: string;
};
type ActivityDay = { date: string; submissions: number; accepted: number; solved: number };
const DAY_MS = 86400000;
export const algorithmDate = (now: Date) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
/** Calendar days are anchored to Beijing, independent of host time zone and daylight saving. */
export function algorithmActivity(days: ActivityDay[], now: Date) {
  const today = algorithmDate(now);
  const dayTime = Date.parse(`${today}T00:00:00.000Z`);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const key = (offset: number) => new Date(dayTime + offset * DAY_MS).toISOString().slice(0, 10);
  const activity = Array.from({ length: 28 }, (_, index) => {
    const date = key(index - 27),
      row = byDate.get(date);
    return { date, submissions: row?.submissions ?? 0, solved: row?.solved ?? 0 };
  });
  let offset = (byDate.get(today)?.submissions ?? 0) > 0 ? 0 : -1,
    streak = 0;
  while ((byDate.get(key(offset))?.submissions ?? 0) > 0) {
    streak++;
    offset--;
  }
  return { activity, streak, dayNumber: Math.floor(dayTime / DAY_MS) };
}

export function algorithmLearningDto(state: AlgorithmLearningState | null) {
  return {
    favorite: state?.favorite ?? false,
    reviewStatus: state?.reviewStatus ?? 'none',
    note: state?.note ?? '',
    revision: state?.revision ?? 0,
    updatedAt: state?.updatedAt ?? null,
  };
}

export function publicAlgorithmProblem(problem: AlgorithmProblem) {
  return {
    id: problem.id,
    number: problem.number,
    title: problem.title,
    difficulty: problem.difficulty,
    tags: problem.tags,
    description: problem.description,
    inputFormat: problem.inputFormat,
    outputFormat: problem.outputFormat,
    constraints: problem.constraints,
    examples: problem.examples,
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    starterCode: problem.starterCode,
  };
}

/** Persist only the public projection, so echoes of secret test data never reach history or AI. */
export function sanitizeJudgeResult(result: JudgeExecutionResult, cases: JudgeExecutionRequest['cases']) {
  const results = cases.map((test, i) => {
    const raw = result.results[i];
    const status = raw && statuses.has(raw.status) ? raw.status : 'system_error';
    const base = {
      index: i + 1,
      status,
      hidden: test.hidden,
      runtimeMs: metric(raw?.runtimeMs),
      memoryKb: metric(raw?.memoryKb),
    };
    return test.hidden
      ? base
      : {
          ...base,
          input: test.input,
          ...(test.output === undefined ? {} : { expectedOutput: test.output }),
          stdout: bounded(raw?.stdout),
          stderr: bounded(raw?.stderr),
        };
  });
  const passed = results.filter((r) => r.status === 'accepted').length;
  const status =
    statuses.has(result.status) && (result.status !== 'accepted' || passed === cases.length)
      ? result.status
      : 'system_error';
  return {
    status,
    passed,
    total: cases.length,
    runtimeMs: metric(result.runtimeMs),
    memoryKb: metric(result.memoryKb),
    compileOutput: cases.some((c) => c.hidden) ? '' : bounded(result.compileOutput),
    // Gateway output is never used as an error message: arbitrary runtime messages may echo hidden input.
    error:
      status === 'system_error'
        ? '判题服务暂时无法完成，请稍后重试。'
        : status === 'compile_error' && cases.some((c) => c.hidden)
          ? '编译失败，请运行样例查看编译信息。'
          : null,
    results,
  };
}

async function boundedRequest<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpException('服务响应超时，请稍后重试', 504)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class AlgorithmsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly judge: JudgeGateway,
    private readonly ai: AlgorithmAiGateway,
  ) {}

  private scope(actor: Actor) {
    return { organizationId: actor.organizationId, userId: actor.id };
  }
  private async access(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('算法练习仅供学生使用');
    this.auth.require(actor, 'learning.use');
    await this.auth.checkFeature(actor, '/api/algorithms');
  }
  private async freshActor(actor: Actor) {
    const fresh = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (!fresh || fresh.id !== actor.id || fresh.organizationId !== actor.organizationId)
      throw new ForbiddenException('当前学习会话已失效');
    await this.access(fresh);
  }
  private catalog(id: string) {
    const problem = getAlgorithmProblem(id);
    if (!problem) throw new NotFoundException('算法题不存在');
    return problem;
  }
  async status(actor: Actor) {
    await this.access(actor);
    return { judge: this.judge.status(), ai: this.ai.status() };
  }
  private async summaries(actor: Actor): Promise<AlgorithmProblemSummary[]> {
    const [submitted, learning] = await Promise.all([
      this.db.algorithmSubmission.groupBy({
        where: { ...this.scope(actor), mode: 'submit', customInput: false },
        by: ['problemId', 'status'],
      }),
      this.db.algorithmLearningState.findMany({
        where: this.scope(actor),
        select: { problemId: true, favorite: true, reviewStatus: true },
      }),
    ]);
    const attempted = new Set(submitted.map((s) => s.problemId));
    const solved = new Set(submitted.filter((s) => s.status === 'accepted').map((s) => s.problemId));
    const states = new Map(learning.map((state) => [state.problemId, state]));
    return algorithmProblems.map((problem) => ({
      id: problem.id,
      number: problem.number,
      title: problem.title,
      difficulty: problem.difficulty,
      tags: problem.tags,
      status: solved.has(problem.id) ? 'solved' : attempted.has(problem.id) ? 'attempted' : 'todo',
      favorite: states.get(problem.id)?.favorite ?? false,
      reviewStatus: states.get(problem.id)?.reviewStatus ?? 'none',
    }));
  }
  async list(actor: Actor, query: z.infer<typeof algorithmProblemQuery>) {
    await this.access(actor);
    await this.recoverPending(actor);
    const items = await this.summaries(actor);
    const term = query.q.trim().toLocaleLowerCase();
    const filtered = items.filter(
      (p) =>
        (!term || `${p.number} ${p.title} ${p.tags.join(' ')}`.toLocaleLowerCase().includes(term)) &&
        (!query.difficulty || p.difficulty === query.difficulty) &&
        (!query.tag || p.tags.includes(query.tag)) &&
        (!query.status || p.status === query.status) &&
        (query.favorite === undefined || p.favorite === (query.favorite === 'true')) &&
        (!query.review || p.reviewStatus === query.review),
    );
    return {
      items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
      stats: {
        total: items.length,
        attempted: items.filter((p) => p.status !== 'todo').length,
        solved: items.filter((p) => p.status === 'solved').length,
      },
      tags: [...new Set(algorithmProblems.flatMap((p) => p.tags))].sort(),
    };
  }
  async problem(actor: Actor, id: string) {
    await this.access(actor);
    const problem = this.catalog(id);
    const where = { ...this.scope(actor), problemId: id };
    const [draft, state] = await Promise.all([
      this.db.algorithmDraft.findFirst({ where }),
      this.db.algorithmLearningState.findFirst({ where }),
    ]);
    const position = algorithmProblems.findIndex((item) => item.id === id);
    return {
      ...publicAlgorithmProblem(problem),
      draft: draft ? { language: draft.language, code: draft.code, updatedAt: draft.updatedAt } : null,
      learningState: algorithmLearningDto(state),
      navigation: {
        previousProblemId: algorithmProblems[position - 1]?.id ?? null,
        nextProblemId: algorithmProblems[position + 1]?.id ?? null,
      },
    };
  }
  async learning(actor: Actor, problemId: string) {
    await this.access(actor);
    this.catalog(problemId);
    return algorithmLearningDto(
      await this.db.algorithmLearningState.findFirst({ where: { ...this.scope(actor), problemId } }),
    );
  }
  async updateLearning(actor: Actor, problemId: string, input: AlgorithmLearningInput) {
    await this.access(actor);
    this.catalog(problemId);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const where = { ...this.scope(actor), problemId };
      const current = await tx.algorithmLearningState.findFirst({ where });
      if ((current?.revision ?? 0) !== input.revision)
        throw new ConflictException('学习记录已在其他页面更新，请刷新记录后再保存');
      // Omitted fields are preserved; explicit empty notes, false favorites and none clear their values.
      const patch = {
        ...(input.favorite === undefined ? {} : { favorite: input.favorite }),
        ...(input.reviewStatus === undefined ? {} : { reviewStatus: input.reviewStatus }),
        ...(input.note === undefined ? {} : { note: input.note }),
      };
      if (!current)
        return algorithmLearningDto(
          await tx.algorithmLearningState.create({ data: { ...where, ...patch, revision: 1 } }),
        );
      const updated = await tx.algorithmLearningState.updateMany({
        where: { ...where, revision: input.revision },
        data: { ...patch, revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('学习记录已更新，请刷新后再保存');
      return algorithmLearningDto(await tx.algorithmLearningState.findFirstOrThrow({ where }));
    });
  }
  async editorial(actor: Actor, problemId: string) {
    await this.access(actor);
    this.catalog(problemId);
    const editorial = getAlgorithmEditorial(problemId);
    if (!editorial) throw new NotFoundException('本题题解尚未发布');
    const items = await this.summaries(actor);
    const byId = new Map(items.map((item) => [item.id, item]));
    const relatedProblems = [...new Set(editorial.relatedProblemIds)]
      .filter((id) => id !== problemId)
      .map((id) => byId.get(id))
      .filter((item): item is AlgorithmProblemSummary => !!item);
    return { editorial, relatedProblems };
  }
  async overview(actor: Actor) {
    await this.access(actor);
    await this.recoverPending(actor);
    const now = new Date();
    const [items, days] = await Promise.all([
      this.summaries(actor),
      this.db.$queryRaw<
        ActivityDay[]
      >`SELECT to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS "date",
        COUNT(*)::integer AS "submissions",
        COUNT(*) FILTER (WHERE "status" = 'accepted')::integer AS "accepted",
        COUNT(DISTINCT "problemId") FILTER (WHERE "status" = 'accepted')::integer AS "solved"
        FROM "AlgorithmSubmission"
        WHERE "organizationId" = ${actor.organizationId} AND "userId" = ${actor.id}
          AND "mode" = 'submit' AND NOT "customInput" AND "createdAt" <= ${now}
        GROUP BY "date" ORDER BY "date"`,
    ]);
    const { activity, streak, dayNumber } = algorithmActivity(days, now);
    const byId = new Map(items.map((item) => [item.id, item]));
    const plans = algorithmPlans.map((plan) => {
      const ids = [...new Set(plan.chapters.flatMap((chapter) => chapter.problemIds))].filter((id) =>
        byId.has(id),
      );
      return {
        ...plan,
        chapters: plan.chapters.map((chapter) => ({
          ...chapter,
          problems: chapter.problemIds
            .map((id) => byId.get(id))
            .filter((item): item is AlgorithmProblemSummary => !!item),
        })),
        total: ids.length,
        solved: ids.filter((id) => byId.get(id)?.status === 'solved').length,
        nextProblemId: ids.find((id) => byId.get(id)?.status !== 'solved') ?? null,
      };
    });
    const planned = plans
      .map((plan) => (plan.nextProblemId ? byId.get(plan.nextProblemId) : undefined))
      .find((item) => item !== undefined);
    return {
      dailyProblem: items[((dayNumber % items.length) + items.length) % items.length] ?? null,
      recommendation:
        items.find((item) => item.reviewStatus === 'review') ??
        items.find((item) => item.status === 'attempted') ??
        planned ??
        items.find((item) => item.status !== 'solved') ??
        null,
      activity,
      stats: {
        submitted: days.reduce((total, day) => total + day.submissions, 0),
        accepted: days.reduce((total, day) => total + day.accepted, 0),
        solved: items.filter((item) => item.status === 'solved').length,
        streak,
      },
      plans,
    };
  }
  async saveDraft(actor: Actor, problemId: string, input: { language: AlgorithmLanguage; code: string }) {
    await this.access(actor);
    this.catalog(problemId);
    const key = { ...this.scope(actor), problemId };
    const draft = await this.db.algorithmDraft.upsert({
      where: { organizationId_userId_problemId: key },
      create: { ...key, ...input },
      update: input,
    });
    return { language: draft.language, code: draft.code, updatedAt: draft.updatedAt };
  }
  private async lock(tx: Tx, actor: Actor) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`algorithms:${actor.organizationId}:${actor.id}`}))`;
  }
  private async recover(tx: Tx, actor: Actor) {
    const now = new Date();
    const expired = await tx.algorithmOperation.findMany({
      where: { ...this.scope(actor), status: 'pending', leaseExpiresAt: { lte: now } },
    });
    for (const operation of expired) {
      await tx.algorithmOperation.updateMany({
        where: { ...this.scope(actor), id: operation.id, status: 'pending' },
        data: { status: 'failed', completedAt: now },
      });
      if (operation.submissionId)
        await tx.algorithmSubmission.updateMany({
          where: { ...this.scope(actor), id: operation.submissionId, status: 'running' },
          data: { status: 'system_error', error: EXPIRED },
        });
      if (operation.analysisId)
        await tx.algorithmAnalysis.updateMany({
          where: { ...this.scope(actor), id: operation.analysisId, status: 'pending' },
          data: { status: 'failed', error: EXPIRED },
        });
    }
  }
  private async recoverPending(actor: Actor) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      await this.recover(tx, actor);
    });
  }
  private async reserve(
    actor: Actor,
    kind: 'judge' | 'analysis',
    problemId: string,
    input: AlgorithmSubmissionInput | AlgorithmAnalysisInput,
    timeoutMs: number,
    dailyRequests: number,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      await this.recover(tx, actor);
      if (await tx.algorithmOperation.count({ where: { ...this.scope(actor), kind, status: 'pending' } }))
        throw new ConflictException(
          kind === 'judge' ? '已有代码正在运行，请等待完成' : '已有 AI 解析正在生成，请等待完成',
        );
      const now = new Date();
      const shifted = new Date(now.getTime() + 8 * 3600000);
      const start = new Date(
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600000,
      );
      const [daily, recent] = await Promise.all([
        tx.algorithmOperation.count({
          where: {
            ...this.scope(actor),
            kind,
            createdAt: { gte: start, lt: new Date(start.getTime() + 86400000) },
          },
        }),
        tx.algorithmOperation.count({
          where: { ...this.scope(actor), kind, createdAt: { gte: new Date(now.getTime() - 60000) } },
        }),
      ]);
      if (daily >= dailyRequests)
        throw new HttpException(
          kind === 'judge'
            ? '今日运行与提交额度已用完，请明天再试'
            : '今日算法 AI 解析额度已用完，请明天再试',
          429,
        );
      if (recent >= (kind === 'judge' ? 10 : 3)) throw new HttpException('操作过于频繁，请稍后再试', 429);
      let submissionId: string | undefined;
      let analysisId: string | undefined;
      const base = {
        ...this.scope(actor),
        problemId,
        language: input.language,
        code: input.code,
        mode: input.mode,
      };
      if (kind === 'judge') {
        const submission = input as AlgorithmSubmissionInput;
        const record = await tx.algorithmSubmission.create({
          data: { ...base, customInput: submission.stdin !== undefined, results: [] },
        });
        submissionId = record.id;
      } else {
        const record = await tx.algorithmAnalysis.create({
          data: { ...base, submissionId: (input as AlgorithmAnalysisInput).submissionId },
        });
        analysisId = record.id;
      }
      return tx.algorithmOperation.create({
        data: {
          ...this.scope(actor),
          kind,
          submissionId,
          analysisId,
          leaseExpiresAt: new Date(now.getTime() + timeoutMs + 30000),
        },
      });
    });
  }
  private async finish(
    actor: Actor,
    operationId: string,
    submission?: Prisma.AlgorithmSubmissionUpdateManyMutationInput,
    analysis?: Prisma.AlgorithmAnalysisUpdateManyMutationInput,
  ) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const operation = await tx.algorithmOperation.findFirst({
        where: { ...this.scope(actor), id: operationId },
      });
      if (!operation || operation.status !== 'pending' || operation.leaseExpiresAt <= new Date())
        throw new ConflictException('请求已过期，请重新发起');
      if (operation.submissionId && submission)
        await tx.algorithmSubmission.updateMany({
          where: { ...this.scope(actor), id: operation.submissionId, status: 'running' },
          data: submission,
        });
      if (operation.analysisId && analysis)
        await tx.algorithmAnalysis.updateMany({
          where: { ...this.scope(actor), id: operation.analysisId, status: 'pending' },
          data: analysis,
        });
      await tx.algorithmOperation.updateMany({
        where: { ...this.scope(actor), id: operationId, status: 'pending' },
        data: { status: 'completed', completedAt: new Date() },
      });
    });
  }
  private async fail(actor: Actor, operationId: string, message: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const operation = await tx.algorithmOperation.findFirst({
        where: { ...this.scope(actor), id: operationId, status: 'pending' },
      });
      if (!operation) return;
      if (operation.submissionId)
        await tx.algorithmSubmission.updateMany({
          where: { ...this.scope(actor), id: operation.submissionId, status: 'running' },
          data: { status: 'system_error', error: message },
        });
      if (operation.analysisId)
        await tx.algorithmAnalysis.updateMany({
          where: { ...this.scope(actor), id: operation.analysisId, status: 'pending' },
          data: { status: 'failed', error: message },
        });
      await tx.algorithmOperation.updateMany({
        where: { ...this.scope(actor), id: operation.id, status: 'pending' },
        data: { status: 'failed', completedAt: new Date() },
      });
    });
  }
  private safeError(error: unknown, kind: 'judge' | 'analysis') {
    const status = error instanceof HttpException ? error.getStatus() : 502;
    if ([401, 403, 404].includes(status)) return '学习权限已变化，本次请求已停止。';
    if ([409, 504].includes(status)) return EXPIRED;
    if (status === 429) return '外部服务请求额度不足，请稍后再试。';
    return kind === 'judge'
      ? '判题服务暂时无法完成，请稍后重试。'
      : 'AI 解析暂时无法完成，请稍后重试或联系管理员检查配置。';
  }
  private submissionDto(row: AlgorithmSubmission) {
    return {
      id: row.id,
      problemId: row.problemId,
      language: row.language,
      code: row.code,
      mode: row.mode,
      customInput: row.customInput,
      status: row.status,
      passed: row.passed,
      total: row.total,
      runtimeMs: row.runtimeMs,
      memoryKb: row.memoryKb,
      compileOutput: row.compileOutput,
      error: row.error,
      results: row.results,
      createdAt: row.createdAt,
    };
  }
  private analysisDto(row: AlgorithmAnalysis) {
    return {
      id: row.id,
      problemId: row.problemId,
      mode: row.mode,
      language: row.language,
      status: row.status,
      content: row.content,
      error: row.error,
      createdAt: row.createdAt,
    };
  }
  async submit(actor: Actor, problemId: string, input: AlgorithmSubmissionInput) {
    await this.access(actor);
    const problem = this.catalog(problemId);
    const status = this.judge.status();
    if (!status.available) throw new ServiceUnavailableException(status.reason);
    const cases =
      input.mode === 'submit'
        ? problem.testCases
        : input.stdin !== undefined
          ? [{ input: input.stdin, hidden: false }]
          : problem.testCases.filter((c) => !c.hidden);
    if (!cases.length) throw new BadRequestException('题目暂时没有可运行的用例');
    // Judge transport caps its own request at 60 seconds; allow a small scheduling margin.
    const timeoutMs = 65000;
    const operation = await this.reserve(actor, 'judge', problemId, input, timeoutMs, 200);
    try {
      const result = await boundedRequest(
        this.judge.execute({
          language: input.language,
          code: input.code,
          cases,
          timeLimitMs: problem.timeLimitMs,
          memoryLimitMb: problem.memoryLimitMb,
        }),
        timeoutMs,
      );
      const safe = sanitizeJudgeResult(result, cases);
      await this.freshActor(actor);
      await this.finish(actor, operation.id, { ...safe, results: json(safe.results) });
    } catch (error) {
      await this.fail(actor, operation.id, this.safeError(error, 'judge'));
      if (error instanceof HttpException && [401, 403, 404].includes(error.getStatus())) throw error;
    }
    await this.freshActor(actor);
    return this.submission(actor, operation.submissionId!);
  }
  async submissions(actor: Actor, problemId: string, query: Pagination) {
    await this.access(actor);
    this.catalog(problemId);
    await this.recoverPending(actor);
    const where = { ...this.scope(actor), problemId };
    const [items, total] = await this.db.$transaction([
      this.db.algorithmSubmission.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.algorithmSubmission.count({ where }),
    ]);
    return { items: items.map((item) => this.submissionDto(item)), total, ...query };
  }
  async submission(actor: Actor, id: string) {
    await this.access(actor);
    await this.recoverPending(actor);
    const record = await this.db.algorithmSubmission.findFirst({ where: { ...this.scope(actor), id } });
    if (!record) throw new NotFoundException('提交记录不存在');
    return this.submissionDto(record);
  }
  async analyze(actor: Actor, problemId: string, input: AlgorithmAnalysisInput) {
    await this.access(actor);
    const problem = this.catalog(problemId);
    const status = this.ai.status();
    if (!status.available) throw new ServiceUnavailableException(status.reason);
    let execution: unknown;
    if (input.submissionId) {
      const submission = await this.db.algorithmSubmission.findFirst({
        where: { ...this.scope(actor), id: input.submissionId, problemId },
      });
      if (!submission) throw new NotFoundException('提交记录不存在');
      if (submission.status === 'running') throw new ConflictException('请等待代码执行完成后再分析');
      if (submission.code !== input.code || submission.language !== input.language)
        throw new BadRequestException('代码已修改，请重新运行后分析该次结果');
      const dto = this.submissionDto(submission);
      const results = Array.isArray(dto.results)
        ? dto.results.map((raw) => {
            const item = raw as Record<string, unknown>;
            return item.hidden
              ? { index: item.index, hidden: true, status: item.status }
              : {
                  index: item.index,
                  hidden: false,
                  status: item.status,
                  input: bounded(item.input).slice(0, 2000),
                  expectedOutput: bounded(item.expectedOutput).slice(0, 2000),
                  stdout: bounded(item.stdout).slice(0, 2000),
                  stderr: bounded(item.stderr).slice(0, 2000),
                };
          })
        : [];
      execution = {
        status: dto.status,
        passed: dto.passed,
        total: dto.total,
        compileOutput: dto.compileOutput?.slice(0, 4000),
        results,
      };
    }
    const limits = this.ai.getLimits();
    const operation = await this.reserve(
      actor,
      'analysis',
      problemId,
      input,
      limits.timeoutMs,
      limits.dailyRequests,
    );
    try {
      const content = await boundedRequest(this.ai.analyze(problem, input, execution), limits.timeoutMs);
      await this.freshActor(actor);
      await this.finish(actor, operation.id, undefined, { status: 'ready', content: json(content) });
    } catch (error) {
      await this.fail(actor, operation.id, this.safeError(error, 'analysis'));
      if (error instanceof HttpException && [401, 403, 404].includes(error.getStatus())) throw error;
    }
    await this.freshActor(actor);
    const row = await this.db.algorithmAnalysis.findFirstOrThrow({
      where: { ...this.scope(actor), id: operation.analysisId! },
    });
    return this.analysisDto(row);
  }
  async analyses(actor: Actor, problemId: string) {
    await this.access(actor);
    this.catalog(problemId);
    await this.recoverPending(actor);
    const items = await this.db.algorithmAnalysis.findMany({
      where: { ...this.scope(actor), problemId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
    });
    return { items: items.map((item) => this.analysisDto(item)) };
  }
}
