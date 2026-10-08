import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type AiStudyReport } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import type { Actor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { QuestionData } from '../assessment/scoring';
import { AiGateway } from './ai.gateway';
import { downloadStudySource } from './safe-download';
import type { AiAnalysis, AiMistake, AiSearchResult } from './ai-study.schemas';

type Tx = Prisma.TransactionClient;
type Source = {
  mistakeId: string;
  courseId: string;
  questionId: string;
  questionVersionId: string;
  practiceAnswerId: string;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const FAILED = 'AI 服务暂时未能完成，请稍后重试。';
const EXPIRED = '上次请求已超时，可重新发起请求。';
const safeErrors: Record<string, string> = {
  PROVIDER_QUOTA: '外部 AI 或搜索服务额度不足、请求过多，请稍后重试或联系管理员。',
  PROVIDER_TIMEOUT: '外部 AI 或搜索服务响应超时，请稍后重试。',
  PROVIDER_CONFIGURATION: 'AI 或搜索服务认证、配置不可用，请管理员检查服务器密钥和模型。',
  PROVIDER_RESPONSE: '服务未返回有效结果，或不支持当前模型和接口参数，请稍后重试或联系管理员。',
  PROVIDER_INPUT: '选中的题目内容不适合本次请求，请减少题目数量后重试。',
  ACCESS_CHANGED: '学习权限发生变化，本次请求已停止。',
  LEASE_EXPIRED: EXPIRED,
};
const markdownText = (value: unknown) => String(value ?? '').replace(/[\\`*_{}\[\]()#+!|<>]/g, '\\$&');

@Injectable()
export class AiStudyService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly gateway: AiGateway,
  ) {}

  private requireStudent(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('AI 错题复盘仅供学生查看本人学习记录');
    this.auth.require(actor, 'learning.use');
    this.auth.require(actor, 'course.read');
  }
  private async freshActor(actor: Actor) {
    const fresh = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (!fresh || fresh.id !== actor.id || fresh.organizationId !== actor.organizationId)
      throw new ForbiddenException('当前学习会话已失效');
    this.requireStudent(fresh);
    await this.auth.checkFeature(fresh, '/api/ai-study');
    return fresh;
  }
  status(actor: Actor) {
    this.requireStudent(actor);
    return this.gateway.getStatus();
  }

  private async availableSource(actor: Actor, source: Source) {
    this.requireStudent(actor);
    await this.auth.course(actor, source.courseId);
    const question = await this.db.question.findFirst({
      where: {
        id: source.questionId,
        organizationId: actor.organizationId,
        courseId: source.courseId,
        active: true,
        practiceEnabled: true,
      },
    });
    if (!question) throw new ForbiddenException('错题已停止开放练习，无法继续查看或导出复盘');
    const wrong = await this.db.practiceAnswer.findFirst({
      where: {
        id: source.practiceAnswerId,
        questionId: source.questionId,
        questionVersionId: source.questionVersionId,
        correct: false,
        session: { userId: actor.id, organizationId: actor.organizationId, courseId: source.courseId },
      },
    });
    if (!wrong) throw new ForbiddenException('原始错题作答不再可用');
    const unreleased = await this.db.examPaperItem.count({
      where: {
        questionId: source.questionId,
        snapshot: {
          exam: {
            status: { not: 'draft' },
            OR: [{ answerReleaseAt: null }, { answerReleaseAt: { gt: new Date() } }],
          },
        },
      },
    });
    if (unreleased) throw new ForbiddenException('题目涉及尚未公开的考试内容');
  }
  private async mistakes(actor: Actor, ids: string[]) {
    this.requireStudent(actor);
    const mistakes: AiMistake[] = [],
      sources: Source[] = [];
    for (const id of ids) {
      const mistake = await this.db.mistakeRecord.findFirst({ where: { id, userId: actor.id } });
      if (!mistake) throw new NotFoundException('本人错题记录不存在');
      const wrong = await this.db.practiceAnswer.findFirst({
        where: {
          questionId: mistake.questionId,
          correct: false,
          session: { userId: actor.id, organizationId: actor.organizationId, courseId: mistake.courseId },
        },
        include: { session: true },
        orderBy: [{ answeredAt: 'desc' }, { id: 'desc' }],
      });
      if (!wrong) throw new BadRequestException('错题缺少本人已判错的练习记录，不能生成复盘');
      const source = {
        mistakeId: id,
        courseId: mistake.courseId,
        questionId: mistake.questionId,
        questionVersionId: wrong.questionVersionId,
        practiceAnswerId: wrong.id,
      };
      await this.availableSource(actor, source);
      const snapshot = wrong.session.snapshot as unknown as QuestionData[];
      const fixed = Array.isArray(snapshot)
        ? snapshot.find((q) => q.id === wrong.questionVersionId && q.questionId === wrong.questionId)
        : undefined;
      if (!fixed) throw new BadRequestException('错题缺少原练习固定版本，不能使用题库新版本替代');
      const course = await this.auth.course(actor, mistake.courseId);
      sources.push(source);
      mistakes.push({
        mistakeId: id,
        questionId: source.questionId,
        questionVersionId: source.questionVersionId,
        courseId: source.courseId,
        courseTitle: course.title,
        stem: fixed.stem,
        type: fixed.type,
        options: fixed.options,
        studentAnswer: wrong.value,
        correctAnswer: fixed.answer,
        explanation: fixed.explanation,
        knowledgePoints: fixed.knowledgePoints,
        wrongCount: mistake.wrongCount,
        answeredAt: wrong.answeredAt.toISOString(),
        scoreCents: wrong.scoreCents,
        maxScoreCents: fixed.scoreCents,
      });
    }
    return { mistakes, sources };
  }
  private async lock(tx: Tx, actor: Actor) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`ai-study:${actor.organizationId}:${actor.id}`}))`;
  }
  private async recover(tx: Tx, actor: Actor) {
    const now = new Date();
    const expired = await tx.aiStudyOperation.findMany({
      where: {
        organizationId: actor.organizationId,
        userId: actor.id,
        status: 'pending',
        leaseExpiresAt: { lte: now },
      },
    });
    for (const operation of expired) {
      await tx.aiStudyOperation.update({
        where: { id: operation.id },
        data: { status: 'failed', errorCode: 'LEASE_EXPIRED', completedAt: now },
      });
      if (operation.reportId && operation.kind === 'analysis')
        await tx.aiStudyReport.updateMany({
          where: { id: operation.reportId, status: 'pending' },
          data: { status: 'failed', error: EXPIRED },
        });
      if (operation.reportId && operation.kind === 'search')
        await tx.aiStudyReport.updateMany({
          where: { id: operation.reportId },
          data: { searchError: EXPIRED },
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
    kind: 'analysis' | 'search' | 'download',
    reportId?: string,
    creation?: { reflection: string; mistakes: AiMistake[]; sources: Source[] },
  ) {
    const limits = this.gateway.getLimits();
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      await this.recover(tx, actor);
      if (
        await tx.aiStudyOperation.count({
          where: { userId: actor.id, organizationId: actor.organizationId, status: 'pending' },
        })
      )
        throw new ConflictException('已有 AI 请求正在处理，请等待完成');
      const now = new Date(),
        shifted = new Date(now.getTime() + 8 * 3600000);
      const day = new Date(
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600000,
      );
      if (
        (await tx.aiStudyOperation.count({
          where: {
            userId: actor.id,
            organizationId: actor.organizationId,
            createdAt: { gte: day, lt: new Date(day.getTime() + 86400000) },
          },
        })) >= limits.dailyRequests
      )
        throw new HttpException('今日 AI、联网搜索和资料下载额度已用完，请明天再试', 429);
      if (creation) {
        const report = await tx.aiStudyReport.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.id,
            reflection: creation.reflection,
            mistakes: json(creation.mistakes),
            sources: { create: creation.sources },
          },
        });
        reportId = report.id;
      }
      return tx.aiStudyOperation.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          reportId,
          kind,
          leaseExpiresAt: new Date(
            now.getTime() + (kind === 'download' ? limits.downloadTimeoutMs : limits.timeoutMs) + 30000,
          ),
        },
      });
    });
  }
  private async finish(
    actor: Actor,
    operationId: string,
    data?: Prisma.AiStudyReportUpdateManyMutationInput,
  ) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const operation = await tx.aiStudyOperation.findUniqueOrThrow({ where: { id: operationId } });
      if (operation.status !== 'pending' || operation.leaseExpiresAt <= new Date())
        throw new ConflictException('AI 请求已过期，请重新发起');
      await tx.aiStudyOperation.update({
        where: { id: operation.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      if (operation.reportId && data)
        await tx.aiStudyReport.updateMany({ where: { id: operation.reportId, userId: actor.id }, data });
    });
  }
  private async fail(actor: Actor, operationId: string, code: string) {
    const message = safeErrors[code] || FAILED;
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const operation = await tx.aiStudyOperation.findUnique({ where: { id: operationId } });
      if (!operation || operation.status !== 'pending') return;
      await tx.aiStudyOperation.update({
        where: { id: operation.id },
        data: { status: 'failed', errorCode: code, completedAt: new Date() },
      });
      if (operation.reportId && operation.kind === 'analysis')
        await tx.aiStudyReport.updateMany({
          where: { id: operation.reportId },
          data: { status: 'failed', error: message },
        });
      if (operation.reportId && operation.kind === 'search')
        await tx.aiStudyReport.updateMany({
          where: { id: operation.reportId },
          data: { searchError: message },
        });
    });
  }
  private permissionError(error: unknown) {
    return error instanceof HttpException && [401, 403, 404, 409].includes(error.getStatus());
  }
  private providerCode(error: unknown) {
    if (!(error instanceof HttpException)) return 'PROVIDER_FAILED';
    if (error.getStatus() === 409) return 'LEASE_EXPIRED';
    if ([401, 403, 404].includes(error.getStatus())) return 'ACCESS_CHANGED';
    return (
      (
        {
          400: 'PROVIDER_INPUT',
          429: 'PROVIDER_QUOTA',
          502: 'PROVIDER_RESPONSE',
          503: 'PROVIDER_CONFIGURATION',
          504: 'PROVIDER_TIMEOUT',
        } as Record<number, string>
      )[error.getStatus()] || 'PROVIDER_FAILED'
    );
  }
  private dto(report: AiStudyReport) {
    return {
      id: report.id,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      error: report.error,
      reflection: report.reflection,
      mistakes: report.mistakes as unknown as AiMistake[],
      analysis: report.analysis as unknown as AiAnalysis | null,
      search: report.search as unknown as AiSearchResult | null,
      ...(report.searchError ? { searchError: report.searchError } : {}),
    };
  }
  private async owned(actor: Actor, id: string, checkSources = true) {
    this.requireStudent(actor);
    const report = await this.db.aiStudyReport.findFirst({
      where: { id, userId: actor.id, organizationId: actor.organizationId },
      include: { sources: true },
    });
    if (!report) throw new NotFoundException('复盘报告不存在');
    if (checkSources) {
      if (!report.sources.length) throw new ForbiddenException('报告缺少可校验的错题来源');
      for (const source of report.sources) await this.availableSource(actor, source);
    }
    return report;
  }
  async report(actor: Actor, id: string) {
    this.requireStudent(actor);
    await this.recoverPending(actor);
    return this.dto(await this.owned(actor, id));
  }

  async list(actor: Actor, query: { page: number; pageSize: number }) {
    this.requireStudent(actor);
    await this.recoverPending(actor);
    // All sources must still be readable. Filter before pagination so revoked reports do not leak metadata/counts.
    const condition = Prisma.sql`r."organizationId" = ${actor.organizationId} AND r."userId" = ${actor.id}
      AND EXISTS (SELECT 1 FROM "AiStudyReportSource" s WHERE s."reportId" = r.id)
      AND NOT EXISTS (
        SELECT 1 FROM "AiStudyReportSource" s
        LEFT JOIN "Question" q ON q.id = s."questionId"
        LEFT JOIN "Course" c ON c.id = s."courseId"
        LEFT JOIN "Enrollment" e ON e."courseId" = c.id AND e."userId" = ${actor.id} AND e.active = true
        LEFT JOIN "PracticeAnswer" a ON a.id = s."practiceAnswerId"
        LEFT JOIN "PracticeSession" p ON p.id = a."sessionId"
        WHERE s."reportId" = r.id AND (
          q.id IS NULL OR q."organizationId" <> ${actor.organizationId} OR q."courseId" <> s."courseId" OR NOT q.active OR NOT q."practiceEnabled"
          OR c."organizationId" <> ${actor.organizationId} OR c.status NOT IN ('PUBLISHED','ARCHIVED') OR e.id IS NULL
          OR a.correct IS DISTINCT FROM false OR a."questionId" <> s."questionId" OR a."questionVersionId" <> s."questionVersionId"
          OR p."userId" <> ${actor.id} OR p."organizationId" <> ${actor.organizationId} OR p."courseId" <> s."courseId"
          OR EXISTS (SELECT 1 FROM "ExamPaperItem" i JOIN "ExamPaperSnapshot" ps ON ps.id = i."snapshotId" JOIN "Exam" ex ON ex.id = ps."examId"
            WHERE i."questionId" = s."questionId" AND ex.status <> 'draft' AND (ex."answerReleaseAt" IS NULL OR ex."answerReleaseAt" > NOW()))
        )
      )`;
    const [counts, items] = await this.db.$transaction(
      [
        this.db.$queryRaw<
          { total: number }[]
        >`SELECT COUNT(*)::integer AS total FROM "AiStudyReport" r WHERE ${condition}`,
        this.db
          .$queryRaw`SELECT r.id, r.status, r."createdAt", r."updatedAt", COALESCE(r.analysis->>'summary', '') AS summary,
        r.error, jsonb_array_length(r.mistakes)::integer AS "mistakeCount"
        FROM "AiStudyReport" r WHERE ${condition} ORDER BY r."createdAt" DESC, r.id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items, total: counts[0].total, ...query };
  }
  async create(actor: Actor, input: { mistakeIds: string[]; reflection: string }) {
    this.requireStudent(actor);
    if (!this.gateway.getStatus().analysis.available)
      throw new ServiceUnavailableException(this.gateway.getStatus().analysis.reason);
    const selected = await this.mistakes(actor, input.mistakeIds);
    const operation = await this.reserve(actor, 'analysis', undefined, {
      ...selected,
      reflection: input.reflection,
    });
    try {
      const analysis = await this.gateway.analyze(selected.mistakes, input.reflection);
      const fresh = await this.freshActor(actor);
      await this.owned(fresh, operation.reportId!);
      await this.finish(fresh, operation.id, { status: 'ready', analysis: json(analysis), error: null });
    } catch (error) {
      await this.fail(actor, operation.id, this.providerCode(error));
      if (this.permissionError(error)) throw error;
    }
    await this.audit.record(actor, 'ai-study.analysis', 'AiStudyReport', operation.reportId!, {
      mistakeCount: selected.mistakes.length,
    });
    return this.report(await this.freshActor(actor), operation.reportId!);
  }
  async search(actor: Actor, id: string, query: string) {
    const report = await this.owned(actor, id);
    if (report.status !== 'ready') throw new ConflictException('请先完成错题复盘');
    if (!this.gateway.getStatus().search.available)
      throw new ServiceUnavailableException(this.gateway.getStatus().search.reason);
    const operation = await this.reserve(actor, 'search', id);
    try {
      const result = await this.gateway.search(query);
      const fresh = await this.freshActor(actor);
      await this.owned(fresh, id);
      await this.finish(fresh, operation.id, { search: json(result), searchError: null });
    } catch (error) {
      await this.fail(actor, operation.id, this.providerCode(error));
      if (this.permissionError(error)) throw error;
    }
    await this.audit.record(actor, 'ai-study.search', 'AiStudyReport', id);
    return this.report(await this.freshActor(actor), id);
  }
  async remove(actor: Actor, id: string) {
    await this.owned(actor, id, false);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      await this.recover(tx, actor);
      if (await tx.aiStudyOperation.count({ where: { reportId: id, status: 'pending' } }))
        throw new ConflictException('报告仍有请求正在处理，请稍后删除');
      await tx.aiStudyReport.deleteMany({
        where: { id, userId: actor.id, organizationId: actor.organizationId },
      });
    });
    await this.audit.record(actor, 'ai-study.delete', 'AiStudyReport', id);
    return { success: true };
  }
  async export(actor: Actor, id: string, format: 'md' | 'json') {
    const report = await this.report(actor, id);
    await this.audit.record(actor, 'ai-study.export', 'AiStudyReport', id, { format });
    if (format === 'json')
      return {
        text: JSON.stringify(report, null, 2),
        contentType: 'application/json; charset=utf-8',
        filename: `ai-study-${id}.json`,
      };
    const lines = [
      '# AI 错题复盘',
      '',
      'AI 内容仅供学习参考，请结合教师讲解核对。',
      '',
      `状态：${report.status}`,
      `生成时间：${new Date(report.createdAt).toISOString()}`,
      '',
      '## 我的反思',
      markdownText(report.reflection),
      '',
      '## 错题来源',
    ];
    for (const item of report.mistakes)
      lines.push(
        `### ${markdownText(item.courseTitle)}`,
        markdownText(item.stem),
        `我的答案：${markdownText(JSON.stringify(item.studentAnswer))}`,
        `参考答案：${markdownText(JSON.stringify(item.correctAnswer))}`,
        markdownText(item.explanation),
        '',
      );
    if (report.analysis) {
      lines.push('## 复盘总结', markdownText(report.analysis.summary), '', '## 错误模式');
      for (const pattern of report.analysis.patterns)
        lines.push(
          `### ${markdownText(pattern.label)}`,
          markdownText(pattern.evidence),
          markdownText(pattern.advice),
          '',
        );
      lines.push('## 逐题复盘');
      for (const item of report.analysis.items)
        lines.push(
          `### ${markdownText(item.mistakeId)}`,
          markdownText(item.diagnosis),
          markdownText(item.reasoning),
          markdownText(item.correction),
          '',
        );
      lines.push('## 复习计划', ...report.analysis.reviewPlan.map((step) => `- ${markdownText(step)}`));
    }
    if (report.search) {
      lines.push('', '## 联网资料', markdownText(report.search.query), markdownText(report.search.summary));
      for (const source of report.search.sources)
        lines.push(
          `- [${markdownText(source.title)}](<${new URL(source.url).href.replace(/[<>\s]/g, encodeURIComponent)}>)`,
          `  ${markdownText(source.snippet)}`,
        );
    }
    if (report.error) lines.push('', markdownText(report.error));
    if (report.searchError) lines.push('', markdownText(report.searchError));
    return {
      text: lines.join('\n'),
      contentType: 'text/markdown; charset=utf-8',
      filename: `ai-study-${id}.md`,
    };
  }
  async download(actor: Actor, id: string, sourceId: string) {
    const report = this.dto(await this.owned(actor, id));
    const source = report.search?.sources.find((item) => item.id === sourceId);
    if (!source) throw new NotFoundException('报告中的资料来源不存在');
    const limits = this.gateway.getLimits(),
      operation = await this.reserve(actor, 'download', id);
    try {
      const result = await downloadStudySource(source.url, {
        maxBytes: limits.maxDownloadMb * 1024 * 1024,
        timeoutMs: limits.downloadTimeoutMs,
      });
      const fresh = await this.freshActor(actor);
      await this.owned(fresh, id);
      await this.finish(fresh, operation.id);
      await this.audit.record(actor, 'ai-study.download', 'AiStudyReport', id);
      return {
        ...result,
        filename: `study-source-${sourceId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'document'}${result.extension.startsWith('.') ? '' : '.'}${result.extension}`,
      };
    } catch (error) {
      await this.fail(
        actor,
        operation.id,
        this.permissionError(error) ? 'ACCESS_CHANGED' : 'DOWNLOAD_FAILED',
      );
      if (this.permissionError(error)) throw error;
      throw new ServiceUnavailableException('资料暂时无法安全下载，请查看原文链接或稍后重试');
    }
  }
}
