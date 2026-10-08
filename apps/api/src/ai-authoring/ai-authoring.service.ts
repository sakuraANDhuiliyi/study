import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type AiAuthoringDraft } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import type { Actor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { AiGateway } from '../ai-study/ai.gateway';
import { AiAuthoringGateway } from './ai-authoring.gateway';
import { toQuestionInput, type AuthoringGenerateInput, type AuthoringQuestion } from './ai-authoring.schemas';

type Tx = Prisma.TransactionClient;
type CommitInput = { revision: number; title: string; questions: AuthoringQuestion[] };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const EXPIRED = '上次生成请求已超时，请重新生成。';
const safeErrors: Record<string, string> = {
  PROVIDER_FAILED: 'AI 暂时未能完成出题，请稍后重试。',
  PROVIDER_QUOTA: 'AI 服务额度不足或请求过多，请稍后重试或联系管理员。',
  PROVIDER_TIMEOUT: 'AI 出题超时，请减少题目数量后重试。',
  PROVIDER_CONFIGURATION: 'AI 服务认证或模型配置不可用，请联系管理员。',
  PROVIDER_RESPONSE: 'AI 未返回有效题目，请调整要求后重新生成。',
  PROVIDER_INPUT: '本次出题材料或要求无法处理，请调整后重试。',
  ACCESS_CHANGED: '授课权限或当前会话发生变化，本次生成已停止。',
  LEASE_EXPIRED: EXPIRED,
};

@Injectable()
export class AiAuthoringService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly gateway: AiAuthoringGateway,
    private readonly ai: AiGateway,
  ) {}

  private requireTeacher(actor: Actor, mode?: string) {
    if (actor.role !== 'TEACHER') throw new ForbiddenException('AI 出题仅供当前教师身份使用');
    this.auth.require(actor, 'question.manage');
    this.auth.require(actor, 'course.read');
    if (mode === 'paper') this.auth.require(actor, 'assessment.manage');
  }
  private async freshActor(actor: Actor, mode?: string) {
    const fresh = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (!fresh || fresh.id !== actor.id || fresh.organizationId !== actor.organizationId)
      throw new ForbiddenException('当前教师会话已失效');
    this.requireTeacher(fresh, mode);
    await this.auth.checkFeature(fresh, '/api/ai-authoring');
    return { ...fresh, requestId: actor.requestId };
  }
  private async access(
    actor: Actor,
    scope: { courseId: string; chapterId?: string | null; mode: string },
    write = false,
  ) {
    this.requireTeacher(actor, scope.mode);
    await this.auth.course(actor, scope.courseId, write);
    if (
      scope.chapterId &&
      !(await this.db.chapter.findFirst({ where: { id: scope.chapterId, courseId: scope.courseId } }))
    )
      throw new BadRequestException('章节不属于当前课程');
  }
  status(actor: Actor) {
    this.requireTeacher(actor);
    const status = this.ai.getStatus();
    return {
      available: status.analysis.available,
      reason: status.analysis.reason,
      model: status.model,
      limits: { maxQuestions: 10, dailyRequests: status.limits.dailyRequests },
    };
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
      take: 1,
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
    // Another AI entry point can recover the shared operation before this draft is visited.
    await tx.$executeRaw`UPDATE "AiAuthoringDraft" d SET status = 'failed', error = ${EXPIRED}, revision = revision + 1, "updatedAt" = ${now}
      WHERE d."organizationId" = ${actor.organizationId} AND d."userId" = ${actor.id} AND d.status = 'pending'
      AND EXISTS (SELECT 1 FROM "AiStudyOperation" o WHERE o.id = d."operationId" AND o.status = 'failed')`;
  }
  private async recoverPending(actor: Actor) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      await this.recover(tx, actor);
    });
  }
  private async owned(actor: Actor, id: string, write = false, db: Tx | PrismaService = this.db) {
    this.requireTeacher(actor);
    const draft = await db.aiAuthoringDraft.findFirst({
      where: { id, organizationId: actor.organizationId, userId: actor.id },
    });
    if (!draft) throw new NotFoundException('AI 出题草稿不存在');
    await this.access(actor, draft, write);
    return draft;
  }
  private dto(draft: AiAuthoringDraft) {
    return {
      id: draft.id,
      mode: draft.mode,
      courseId: draft.courseId,
      chapterId: draft.chapterId,
      status: draft.status,
      title: draft.title,
      input: draft.input,
      questions: draft.questions,
      revision: draft.revision,
      error: draft.error,
      model: draft.model,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      savedQuestionIds: draft.savedQuestionIds,
      savedPaperId: draft.savedPaperId,
    };
  }
  async detail(actor: Actor, id: string) {
    this.requireTeacher(actor);
    await this.recoverPending(actor);
    return this.dto(await this.owned(actor, id));
  }
  async list(actor: Actor, query: { page: number; pageSize: number }) {
    this.requireTeacher(actor);
    await this.recoverPending(actor);
    const condition = Prisma.sql`d."organizationId" = ${actor.organizationId} AND d."userId" = ${actor.id}
      AND (${actor.permissions.includes('assessment.manage')} OR d.mode = 'questions')
      AND EXISTS (SELECT 1 FROM "Course" c JOIN "TeachingAssignment" t ON t."courseId" = c.id
        WHERE c.id = d."courseId" AND c."organizationId" = ${actor.organizationId} AND t."userId" = ${actor.id} AND t.active = true)
      AND (d."chapterId" IS NULL OR EXISTS (SELECT 1 FROM "Chapter" ch WHERE ch.id = d."chapterId" AND ch."courseId" = d."courseId"))`;
    const [counts, items] = await this.db.$transaction(
      [
        this.db.$queryRaw<
          { total: number }[]
        >`SELECT COUNT(*)::integer AS total FROM "AiAuthoringDraft" d WHERE ${condition}`,
        this.db.$queryRaw`SELECT d.id, d.mode, d."courseId", d.title, d.status,
        jsonb_array_length(d.questions)::integer AS "questionCount", d.error, d."createdAt", d."updatedAt"
        FROM "AiAuthoringDraft" d WHERE ${condition} ORDER BY d."createdAt" DESC, d.id DESC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items, total: counts[0].total, ...query };
  }
  private async audit(tx: Tx, actor: Actor, action: string, id: string, details: Prisma.InputJsonValue) {
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        action,
        resourceType: 'AiAuthoringDraft',
        resourceId: id,
        details,
        requestId: actor.requestId,
      },
    });
  }
  private async reserve(actor: Actor, input: AuthoringGenerateInput) {
    const limits = this.ai.getLimits();
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
      const operation = await tx.aiStudyOperation.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          kind: 'authoring',
          leaseExpiresAt: new Date(now.getTime() + limits.timeoutMs + 30000),
        },
      });
      const draft = await tx.aiAuthoringDraft.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          courseId: input.courseId,
          chapterId: input.chapterId,
          operationId: operation.id,
          mode: input.mode,
          title: input.title,
          input: json(input),
          questions: [],
          model: this.ai.getStatus().model,
        },
      });
      await this.audit(tx, actor, 'ai-authoring.generate', draft.id, {
        mode: input.mode,
        courseId: input.courseId,
        questionCount: input.blueprint.reduce((sum, row) => sum + row.count, 0),
      });
      return draft;
    });
  }
  private errorCode(error: unknown) {
    if (!(error instanceof HttpException)) return 'PROVIDER_FAILED';
    return (
      (
        {
          400: 'PROVIDER_INPUT',
          401: 'ACCESS_CHANGED',
          403: 'ACCESS_CHANGED',
          404: 'ACCESS_CHANGED',
          409: 'LEASE_EXPIRED',
          429: 'PROVIDER_QUOTA',
          502: 'PROVIDER_RESPONSE',
          503: 'PROVIDER_CONFIGURATION',
          504: 'PROVIDER_TIMEOUT',
        } as Record<number, string>
      )[error.getStatus()] || 'PROVIDER_FAILED'
    );
  }
  private async fail(actor: Actor, draft: AiAuthoringDraft, code: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const updated = await tx.aiStudyOperation.updateMany({
        where: { id: draft.operationId, status: 'pending' },
        data: { status: 'failed', completedAt: new Date(), errorCode: code },
      });
      if (updated.count)
        await tx.aiAuthoringDraft.updateMany({
          where: { id: draft.id, status: 'pending' },
          data: {
            status: 'failed',
            error: safeErrors[code] || safeErrors.PROVIDER_FAILED,
            revision: { increment: 1 },
          },
        });
      await this.recover(tx, actor);
    });
  }
  async create(actor: Actor, input: AuthoringGenerateInput) {
    await this.access(actor, input, true);
    const status = this.status(actor);
    if (!status.available) throw new ServiceUnavailableException(status.reason);
    const draft = await this.reserve(actor, input);
    try {
      const generated = await this.gateway.generate(input);
      const fresh = await this.freshActor(actor, draft.mode);
      await this.access(fresh, draft, true);
      await this.db.$transaction(async (tx) => {
        await this.lock(tx, actor);
        const operation = await tx.aiStudyOperation.findUniqueOrThrow({ where: { id: draft.operationId } });
        if (operation.status !== 'pending' || operation.leaseExpiresAt <= new Date())
          throw new ConflictException('AI 生成请求已过期，请重新发起');
        await tx.aiStudyOperation.update({
          where: { id: operation.id },
          data: { status: 'completed', completedAt: new Date() },
        });
        await tx.aiAuthoringDraft.update({
          where: { id: draft.id },
          data: {
            title: generated.title,
            questions: json(generated.questions),
            status: 'ready',
            revision: { increment: 1 },
          },
        });
        await this.audit(tx, fresh, 'ai-authoring.generated', draft.id, {
          questionCount: generated.questions.length,
        });
      });
      return this.detail(fresh, draft.id);
    } catch (error) {
      await this.fail(actor, draft, this.errorCode(error));
      if (error instanceof HttpException && [401, 403, 404, 409].includes(error.getStatus())) throw error;
      return this.detail(await this.freshActor(actor, draft.mode), draft.id);
    }
  }
  async commit(actor: Actor, id: string, input: CommitInput) {
    await this.owned(actor, id, true);
    const saved = await this.db.$transaction(
      async (tx) => {
        await this.lock(tx, actor);
        await tx.$queryRaw`SELECT id FROM "AiAuthoringDraft" WHERE id = ${id} AND "userId" = ${actor.id} AND "organizationId" = ${actor.organizationId} FOR UPDATE`;
        const fresh = await this.freshActor(actor);
        const draft = await this.owned(fresh, id, true, tx);
        if (draft.status === 'saved') return draft;
        if (draft.status !== 'ready') throw new ConflictException('仅生成完成的草稿可以保存');
        if (draft.revision !== input.revision) throw new ConflictException('草稿已变更，请刷新后重试');
        // Lock the mutable scope rows for the short commit transaction; revocation cannot interleave with inserts.
        const courses = await tx.$queryRaw<
          { id: string }[]
        >`SELECT c.id FROM "Course" c JOIN "TeachingAssignment" t ON t."courseId" = c.id
        WHERE c.id = ${draft.courseId} AND c."organizationId" = ${fresh.organizationId} AND c.status <> 'ARCHIVED'
        AND t."userId" = ${fresh.id} AND t.active = true FOR SHARE OF c, t`;
        if (!courses.length) throw new ForbiddenException('课程不再允许当前教师保存题目');
        if (draft.chapterId) {
          const chapters = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Chapter" WHERE id = ${draft.chapterId} AND "courseId" = ${draft.courseId} FOR SHARE`;
          if (!chapters.length) throw new BadRequestException('章节不属于当前课程');
        }
        const versions = input.questions.map((question) =>
          toQuestionInput(question, draft.courseId, draft.chapterId),
        );
        const questionIds: string[] = [],
          versionIds: string[] = [];
        for (const converted of versions) {
          const {
            courseId,
            chapterId,
            scope: _scope,
            practiceEnabled: _practiceEnabled,
            ...version
          } = converted;
          const question = await tx.question.create({
            data: {
              organizationId: fresh.organizationId,
              creatorId: fresh.id,
              courseId,
              chapterId,
              scope: 'private',
              practiceEnabled: false,
              everPracticeEnabled: false,
              versions: {
                create: {
                  ...version,
                  version: 1,
                  options: json(version.options),
                  answer: json(version.answer),
                  rules: json(version.rules),
                  children: [],
                },
              },
            },
            include: { versions: true },
          });
          questionIds.push(question.id);
          versionIds.push(question.versions[0].id);
        }
        const paper =
          draft.mode === 'paper'
            ? await tx.paper.create({
                data: {
                  organizationId: fresh.organizationId,
                  creatorId: fresh.id,
                  courseId: draft.courseId,
                  title: input.title,
                  totalCents: versions.reduce((sum, question) => sum + question.scoreCents, 0),
                  items: {
                    create: versionIds.map((questionVersionId, position) => ({
                      questionVersionId,
                      position,
                    })),
                  },
                },
              })
            : null;
        const result = await tx.aiAuthoringDraft.update({
          where: { id: draft.id },
          data: {
            title: input.title,
            questions: json(input.questions),
            status: 'saved',
            revision: { increment: 1 },
            savedQuestionIds: questionIds,
            savedPaperId: paper?.id,
          },
        });
        await this.audit(tx, fresh, 'ai-authoring.commit', draft.id, {
          questionIds,
          paperId: paper?.id ?? null,
          mode: draft.mode,
        });
        return result;
      },
      { timeout: 15000 },
    );
    return this.dto(saved);
  }
  async remove(actor: Actor, id: string) {
    await this.owned(actor, id);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      await this.recover(tx, actor);
      const fresh = await this.freshActor(actor);
      const draft = await this.owned(fresh, id, false, tx);
      if (draft.status === 'pending') throw new ConflictException('生成中的草稿暂不可删除');
      await tx.aiAuthoringDraft.delete({ where: { id } });
      await this.audit(tx, fresh, 'ai-authoring.delete', id, { status: draft.status });
    });
    return { ok: true };
  }
}
