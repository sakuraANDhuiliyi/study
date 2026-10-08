import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, type QuestionVersion } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import {
  autoScore,
  paginate,
  personalDeadline,
  publicQuestion,
  QuestionData,
  shuffled,
  validAnswerValue,
} from './scoring';
import { itemAccumulator } from './item-analysis';
import * as schema from './assessment.schemas';
import { z } from 'zod';

type Tx = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull =>
  value === undefined || value === null
    ? Prisma.JsonNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
const content = (value: unknown) => value as QuestionData;
const questionInclude = { versions: { orderBy: { version: 'desc' as const }, take: 1 } };
const itemInclude = { questionVersion: true };
const secureShuffle = <T>(values: T[]) => shuffled(values, () => randomInt(0, 1000000000) / 1000000000);
const unique = <T>(values: T[]) => [...new Set(values)];

@Injectable()
export class AssessmentService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly deadlineRetries = new Map<string, number>();
  private readonly logger = new Logger(AssessmentService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}
  onModuleInit() {
    if (process.env.DISABLE_JOBS !== 'true') {
      this.timer = setInterval(() => void this.sweepDueAttempts(), 10000);
      this.timer.unref();
      void this.sweepDueAttempts();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private require(actor: Actor, permission: string) {
    this.auth.require(actor, permission);
  }
  private async scoped(actor: Actor, courseId: string, write = false) {
    return this.auth.course(actor, courseId, write);
  }
  private student(actor: Actor) {
    return actor.role === 'STUDENT';
  }
  private async auditEvent(actor: Actor, action: string, type: string, id: string, details: unknown = {}) {
    await this.audit.record(actor, action, type, id, details);
  }
  private async notify(
    actor: Actor,
    ids: string[],
    type: string,
    title: string,
    body: string,
    link: string,
    event: string,
  ) {
    try {
      await this.audit.notify(ids, actor.organizationId, type, title, body, link, event);
    } catch {
      this.logger.warn(`通知已留待重试: ${event}`);
    }
  }
  private async lock(tx: Tx, key: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
  }
  private async audience(actor: Actor, courseId: string, ids: string[]) {
    const enrolled = await this.db.enrollment.findMany({
      where: { courseId, active: true },
      select: { userId: true },
    });
    const all = enrolled.map((x) => x.userId);
    const chosen = ids.length ? unique(ids) : all;
    if (!chosen.length) throw new BadRequestException('发布对象不能为空；请先为课程添加学生');
    if (chosen.some((id) => !all.includes(id))) throw new BadRequestException('发布对象必须是当前课程学生');
    const count = await this.db.user.count({
      where: { id: { in: chosen }, organizationId: actor.organizationId, active: true },
    });
    if (count !== chosen.length) throw new BadRequestException('发布对象包含停用或无效账号');
    return chosen;
  }
  private validateContent(q: Pick<QuestionData, 'type' | 'options' | 'answer' | 'scoreCents' | 'children'>) {
    if (new Set(q.options.map((o) => o.id)).size !== q.options.length)
      throw new BadRequestException('选项 ID 不能重复');
    const options = q.options.map((o) => o.id);
    if (
      q.type === 'single' &&
      (options.length < 2 || typeof q.answer !== 'string' || !options.includes(q.answer))
    )
      throw new BadRequestException('单选题须有至少两个选项，答案须为选项 ID');
    if (
      q.type === 'multiple' &&
      (options.length < 2 ||
        !Array.isArray(q.answer) ||
        !q.answer.length ||
        q.answer.some((x) => typeof x !== 'string' || !options.includes(x)) ||
        new Set(q.answer).size !== q.answer.length)
    )
      throw new BadRequestException('多选题答案须为不重复的有效选项 ID 数组');
    if (q.type === 'boolean' && ![true, false, 'true', 'false'].includes(q.answer as boolean))
      throw new BadRequestException('判断题答案须为 true 或 false');
    if (
      q.type === 'blank' &&
      (!Array.isArray(q.answer) ||
        !q.answer.length ||
        q.answer.some(
          (x) => !Array.isArray(x) || !x.length || x.some((s) => typeof s !== 'string' || !s.trim()),
        ))
    )
      throw new BadRequestException(
        '填空答案格式为每空可接受答案数组，例如 [["答案一", "同义词"], ["答案二"]]',
      );
    if (q.type === 'short' && typeof q.answer !== 'string')
      throw new BadRequestException('简答题参考答案须为文字');
    if (q.type === 'composite') {
      if (!q.children.length || q.children.reduce((sum, child) => sum + child.scoreCents, 0) !== q.scoreCents)
        throw new BadRequestException('综合题子题分数之和必须等于总分');
      if (new Set(q.children.map((child) => child.id)).size !== q.children.length)
        throw new BadRequestException('综合题子题 ID 不能重复');
      q.children.forEach((child) => {
        if (child.type === 'composite') throw new BadRequestException('综合题不支持嵌套综合题');
        this.validateContent(child);
      });
    }
  }
  private async assertNoUnreleasedExam(questionIds: string[], database: Tx | PrismaService = this.db) {
    if (
      await database.examPaperItem.count({
        where: {
          questionId: { in: questionIds },
          snapshot: {
            exam: {
              status: { not: 'cancelled' },
              OR: [{ answerReleaseAt: null }, { answerReleaseAt: { gt: new Date() } }],
            },
          },
        },
      })
    )
      throw new ConflictException('题目已用于尚未公开答案的考试，不能开放练习或发布到作业');
  }
  private async versionSelection(actor: Actor, courseId: string, ids: string[]) {
    if (!ids.length || unique(ids).length !== ids.length)
      throw new BadRequestException('须选择题目且不能重复');
    const versions = await this.db.questionVersion.findMany({
      where: {
        id: { in: ids },
        question: {
          organizationId: actor.organizationId,
          courseId,
          active: true,
          OR: [{ creatorId: actor.id }, { scope: 'shared' }],
        },
      },
      include: { question: true },
    });
    if (versions.length !== ids.length)
      throw new ForbiddenException('题目不可用、不是本课程或没有题库访问权限');
    if (unique(versions.map((v) => v.questionId)).length !== versions.length)
      throw new BadRequestException('不能选择同一道题目的多个版本');
    return ids.map((id) => versions.find((version) => version.id === id)!);
  }
  private async validateAttachments(
    actor: Actor,
    ids: string[],
    assignmentId?: string,
    courseId?: string,
    requireOwnership = true,
  ) {
    if (!ids.length) return;
    const attachments = await this.db.attachment.findMany({
      where: {
        id: { in: unique(ids) },
        organizationId: actor.organizationId,
        ownerId: requireOwnership ? actor.id : undefined,
      },
    });
    if (
      attachments.length !== unique(ids).length ||
      attachments.some(
        (file) =>
          Boolean(file.exportJobId) ||
          (assignmentId
            ? file.assignmentId !== assignmentId &&
              (file.assignmentId || file.courseId || file.conversationId)
            : Boolean(
                file.conversationId || file.assignmentId || (file.courseId && file.courseId !== courseId),
              )),
      )
    )
      throw new ForbiddenException('附件不存在或没有使用权限');
  }

  async questions(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, 'question.manage');
    const courses = await this.auth.courseIds(actor);
    if (query.courseId) await this.scoped(actor, query.courseId);
    const p = paginate(query);
    const where: Prisma.QuestionWhereInput = {
      organizationId: actor.organizationId,
      courseId: query.courseId ?? { in: courses },
      OR: [{ creatorId: actor.id }, { scope: 'shared' }],
      ...(query.chapterId ? { chapterId: query.chapterId } : {}),
      ...(query.creatorId ? { creatorId: query.creatorId } : {}),
      ...(query.status === 'inactive' ? { active: false } : { active: true }),
      versions: {
        some: {
          ...(query.search ? { stem: { contains: query.search, mode: 'insensitive' } } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(query.difficulty ? { difficulty: query.difficulty } : {}),
          ...(query.knowledgePoint ? { knowledgePoints: { has: query.knowledgePoint } } : {}),
        },
      },
    };
    const [items, total] = await this.db.$transaction([
      this.db.question.findMany({
        where,
        include: questionInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.question.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  async exportQuestions(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, 'question.manage');
    const page = await this.questions(actor, query);
    await this.auditEvent(actor, 'question.export', 'Question', 'page', {
      page: page.page,
      count: page.items.length,
      courseId: query.courseId,
    });
    return {
      ...page,
      items: page.items.map((q) => ({
        ...q.versions[0],
        courseId: q.courseId,
        chapterId: q.chapterId,
        scope: q.scope,
        practiceEnabled: q.practiceEnabled,
      })),
      format: 'zhixue-question-json-v1',
    };
  }
  async questionTemplate(actor: Actor, courseId: string) {
    this.require(actor, 'question.manage');
    await this.scoped(actor, courseId, true);
    return {
      rows: [
        {
          courseId,
          type: 'single',
          stem: '请替换题干',
          options: [
            { id: 'A', text: '选项一' },
            { id: 'B', text: '选项二' },
          ],
          answer: 'A',
          explanation: '请填写解析',
          scoreCents: 1000,
          difficulty: 2,
          knowledgePoints: [],
          tags: [],
          scope: 'private',
          practiceEnabled: false,
        },
      ],
      commit: false,
      instructions:
        '每个 rows 项对应一题；先 commit=false 预览；所有行通过后 commit=true 原子写入。分页导出的 items 可以直接作为 rows 导入。',
    };
  }
  async question(actor: Actor, id: string) {
    const student = this.student(actor);
    this.require(actor, student ? 'learning.use' : 'question.manage');
    const q = await this.db.question.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: questionInclude,
    });
    if (!q) throw new NotFoundException('题目不存在');
    await this.scoped(actor, q.courseId);
    if (student) {
      if (!q.practiceEnabled || !q.active) throw new ForbiddenException('此题未开放练习');
      return {
        id: q.id,
        courseId: q.courseId,
        practiceEnabled: true,
        versions: q.versions.map((v) => publicQuestion(content(v))),
      };
    }
    if (q.scope === 'private' && q.creatorId !== actor.id)
      throw new ForbiddenException('无权查看他人私有题库');
    return q;
  }
  async createQuestion(actor: Actor, input: schema.QuestionInput) {
    this.require(actor, 'question.manage');
    await this.scoped(actor, input.courseId, true);
    if (
      input.chapterId &&
      !(await this.db.chapter.findFirst({ where: { id: input.chapterId, courseId: input.courseId } }))
    )
      throw new BadRequestException('章节不属于课程');
    this.validateContent(content(input));
    const { courseId, chapterId, scope, practiceEnabled, ...version } = input;
    const q = await this.db.question.create({
      data: {
        organizationId: actor.organizationId,
        courseId,
        chapterId,
        scope,
        practiceEnabled,
        everPracticeEnabled: practiceEnabled,
        creatorId: actor.id,
        versions: {
          create: {
            ...version,
            options: json(version.options),
            answer: json(version.answer),
            rules: json(version.rules),
            children: json(version.children),
            version: 1,
          },
        },
      },
      include: questionInclude,
    });
    await this.auditEvent(actor, 'question.create', 'Question', q.id);
    return q;
  }
  async updateQuestion(actor: Actor, id: string, input: z.infer<typeof schema.questionPatchSchema>) {
    this.require(actor, 'question.manage');
    const q = await this.question(actor, id);
    await this.scoped(actor, q.courseId, true);
    if (!('creatorId' in q) || q.creatorId !== actor.id)
      throw new ForbiddenException('只能修改本人创建的题目，可复制共享题目后编辑');
    if (input.courseId && input.courseId !== q.courseId) throw new BadRequestException('题目不能迁移课程');
    if (input.practiceEnabled) await this.assertNoUnreleasedExam([id]);
    if (
      input.chapterId &&
      !(await this.db.chapter.findFirst({ where: { id: input.chapterId, courseId: q.courseId } }))
    )
      throw new BadRequestException('章节不属于课程');
    const old = content(q.versions[0]);
    const merged = schema.questionSchema.parse({ ...old, ...input, courseId: q.courseId });
    this.validateContent(content(merged));
    const {
      courseId: _course,
      chapterId: _chapter,
      scope: _scope,
      practiceEnabled: _practice,
      ...version
    } = merged;
    const updated = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `question:${id}`);
      if (input.practiceEnabled) await this.assertNoUnreleasedExam([id], tx);
      const changed = await tx.question.updateMany({
        where: { id, currentVersion: input.expectedVersion },
        data: {
          currentVersion: { increment: 1 },
          active: input.active,
          scope: input.scope,
          practiceEnabled: input.practiceEnabled,
          everPracticeEnabled: input.practiceEnabled ? true : undefined,
          chapterId: input.chapterId,
        },
      });
      if (changed.count !== 1) throw new ConflictException('题目已被修改，请刷新后重试');
      await tx.questionVersion.create({
        data: {
          ...version,
          questionId: id,
          version: input.expectedVersion + 1,
          options: json(version.options),
          answer: json(version.answer),
          rules: json(version.rules),
          children: json(version.children),
        },
      });
      return tx.question.findUniqueOrThrow({ where: { id }, include: questionInclude });
    });
    await this.auditEvent(actor, 'question.version', 'Question', id, {
      oldVersion: input.expectedVersion,
      newVersion: updated.currentVersion,
    });
    return updated;
  }
  async questionVersions(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, 'question.manage');
    await this.question(actor, id);
    const p = paginate(query);
    const [items, total] = await this.db.$transaction([
      this.db.questionVersion.findMany({
        where: { questionId: id },
        orderBy: { version: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.db.questionVersion.count({ where: { questionId: id } }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  async copyQuestion(actor: Actor, id: string) {
    this.require(actor, 'question.manage');
    const q = await this.question(actor, id);
    return this.createQuestion(
      actor,
      schema.questionSchema.parse({
        ...q.versions[0],
        courseId: q.courseId,
        scope: 'private',
        practiceEnabled: false,
      }),
    );
  }
  async importQuestions(actor: Actor, rows: unknown[], commit: boolean) {
    this.require(actor, 'question.manage');
    if (!Array.isArray(rows) || !rows.length || rows.length > 500)
      throw new BadRequestException('每次导入 1 至 500 行');
    const results: { row: number; success: boolean; errors?: unknown; id?: string }[] = [];
    for (const [index, row] of rows.entries()) {
      const parsed = schema.questionSchema.safeParse(row);
      if (!parsed.success) {
        results.push({ row: index + 1, success: false, errors: parsed.error.flatten() });
        continue;
      }
      try {
        await this.scoped(actor, parsed.data.courseId, true);
        this.validateContent(content(parsed.data));
        results.push({ row: index + 1, success: true });
      } catch (error) {
        results.push({
          row: index + 1,
          success: false,
          errors: error instanceof Error ? error.message : '验证失败',
        });
      }
    }
    if (commit && results.some((row) => !row.success))
      throw new BadRequestException({ message: '导入验证失败，未写入任何题目', rows: results });
    if (commit) {
      await this.db.$transaction(
        async (tx) => {
          for (const [index, row] of rows.entries()) {
            const parsed = schema.questionSchema.parse(row);
            const { courseId, chapterId, scope, practiceEnabled, ...version } = parsed;
            if (chapterId && !(await tx.chapter.findFirst({ where: { id: chapterId, courseId } })))
              throw new BadRequestException(`第 ${index + 1} 行章节不属于课程，已回滚全部导入`);
            const created = await tx.question.create({
              data: {
                organizationId: actor.organizationId,
                creatorId: actor.id,
                courseId,
                chapterId,
                scope,
                practiceEnabled,
                everPracticeEnabled: practiceEnabled,
                versions: {
                  create: {
                    ...version,
                    version: 1,
                    options: json(version.options),
                    answer: json(version.answer),
                    rules: json(version.rules),
                    children: json(version.children),
                  },
                },
              },
            });
            results[index]!.id = created.id;
          }
          await tx.auditLog.create({
            data: {
              organizationId: actor.organizationId,
              userId: actor.id,
              action: 'question.import',
              resourceType: 'Question',
              resourceId: 'batch',
              details: { count: rows.length },
            },
          });
        },
        { timeout: 30000 },
      );
    }
    return { committed: commit, items: results, total: rows.length };
  }
  async papers(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, 'assessment.manage');
    const ids = await this.auth.courseIds(actor);
    if (query.courseId) await this.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = {
      organizationId: actor.organizationId,
      creatorId: actor.id,
      courseId: query.courseId ?? { in: ids },
      ...(query.search ? { title: { contains: query.search } } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.paper.findMany({
        where,
        include: { items: { include: itemInclude, orderBy: { position: 'asc' } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.paper.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  private async sampleVersions(
    actor: Actor,
    courseId: string,
    filters: {
      count: number;
      type?: string;
      difficulty?: number;
      knowledgePoint?: string;
      chapterId?: string;
      questionIds?: string[];
      practiceEnabled?: boolean;
      owned?: boolean;
      mode?: 'random' | 'mistakes' | 'favorites';
    },
  ): Promise<QuestionVersion[]> {
    // Apply current-version criteria and sample in PostgreSQL; never load an entire question bank.
    const clauses = [
      Prisma.sql`q."organizationId" = ${actor.organizationId}`,
      Prisma.sql`q."courseId" = ${courseId}`,
      Prisma.sql`q."active" = TRUE`,
    ];
    if (filters.practiceEnabled !== undefined)
      clauses.push(Prisma.sql`q."practiceEnabled" = ${filters.practiceEnabled}`);
    if (filters.owned) clauses.push(Prisma.sql`(q."creatorId" = ${actor.id} OR q."scope" = 'shared')`);
    if (filters.type) clauses.push(Prisma.sql`v."type" = ${filters.type}`);
    if (filters.difficulty) clauses.push(Prisma.sql`v."difficulty" = ${filters.difficulty}`);
    if (filters.knowledgePoint)
      clauses.push(Prisma.sql`${filters.knowledgePoint} = ANY(v."knowledgePoints")`);
    if (filters.chapterId) clauses.push(Prisma.sql`q."chapterId" = ${filters.chapterId}`);
    if (filters.questionIds)
      clauses.push(
        filters.questionIds.length
          ? Prisma.sql`q."id" IN (${Prisma.join(filters.questionIds)})`
          : Prisma.sql`FALSE`,
      );
    if (filters.mode === 'mistakes')
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "MistakeRecord" m WHERE m."questionId" = q."id" AND m."userId" = ${actor.id} AND m."mastered" = FALSE)`,
      );
    if (filters.mode === 'favorites')
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "QuestionFavorite" f WHERE f."questionId" = q."id" AND f."userId" = ${actor.id})`,
      );
    return this.db.$queryRaw<QuestionVersion[]>(
      Prisma.sql`SELECT v.* FROM "Question" q JOIN "QuestionVersion" v ON v."questionId" = q."id" AND v."version" = q."currentVersion" WHERE ${Prisma.join(clauses, ' AND ')} ORDER BY random() LIMIT ${filters.count}`,
    );
  }
  async createPaper(actor: Actor, input: z.infer<typeof schema.paperSchema>) {
    this.require(actor, 'assessment.manage');
    await this.scoped(actor, input.courseId, true);
    let ids = input.questionVersionIds;
    if (input.rule) {
      const rule = input.rule;
      const pool = await this.sampleVersions(actor, input.courseId, { ...rule, owned: true });
      if (pool.length < rule.count)
        throw new BadRequestException(`符合规则的题目不足：需要 ${rule.count} 道，仅有 ${pool.length} 道`);
      ids = secureShuffle(pool)
        .slice(0, rule.count)
        .map((q) => q.id);
    }
    const versions = await this.versionSelection(actor, input.courseId, ids);
    return this.db.paper.create({
      data: {
        organizationId: actor.organizationId,
        courseId: input.courseId,
        creatorId: actor.id,
        title: input.title,
        totalCents: versions.reduce((sum, q) => sum + q.scoreCents, 0),
        items: { create: ids.map((questionVersionId, position) => ({ questionVersionId, position })) },
      },
      include: { items: { include: itemInclude, orderBy: { position: 'asc' } } },
    });
  }

  private async assignmentAccess(actor: Actor, id: string, write = false) {
    this.require(
      actor,
      this.student(actor) ? 'learning.use' : write ? 'assessment.manage' : 'assessment.grade',
    );
    const assignment = await this.db.assignment.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { items: { include: itemInclude, orderBy: { position: 'asc' } }, audience: true },
    });
    if (!assignment) throw new NotFoundException('作业不存在');
    await this.scoped(actor, assignment.courseId, write);
    if (
      this.student(actor) &&
      (assignment.status !== 'published' || !assignment.audience.some((item) => item.userId === actor.id))
    )
      throw new ForbiddenException('没有此作业的访问资格');
    return assignment;
  }
  private submissionView(submission: Record<string, unknown>, student: boolean) {
    if (!student || submission.releasedAt) return submission;
    const { scoreCents: _score, feedback: _feedback, grading: _grading, ...safe } = submission;
    return { ...safe, scoreCents: null, feedback: '', grading: [] };
  }
  async assignments(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, this.student(actor) ? 'learning.use' : 'assessment.manage');
    const ids = await this.auth.courseIds(actor);
    if (query.courseId) await this.scoped(actor, query.courseId);
    const p = paginate(query);
    const where: Prisma.AssignmentWhereInput = {
      organizationId: actor.organizationId,
      courseId: query.courseId ?? { in: ids },
      ...(query.search ? { title: { contains: query.search } } : {}),
      ...(this.student(actor)
        ? { status: 'published', audience: { some: { userId: actor.id } } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.assignment.findMany({
        where,
        include: {
          submissions: {
            where: this.student(actor) ? { userId: actor.id } : undefined,
            orderBy: { submittedAt: 'desc' },
            take: 1,
          },
          _count: { select: { audience: true, submissions: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.assignment.count({ where }),
    ]);
    return {
      items: items.map((assignment) => ({
        ...assignment,
        submissions: assignment.submissions.map((submission) =>
          this.submissionView(submission, this.student(actor)),
        ),
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  async createAssignment(actor: Actor, input: z.infer<typeof schema.assignmentSchema>) {
    this.require(actor, 'assessment.manage');
    await this.scoped(actor, input.courseId, true);
    if (input.dueAt <= input.opensAt) throw new BadRequestException('截止时间必须晚于开放时间');
    const versions = await this.versionSelection(actor, input.courseId, input.questionVersionIds);
    const audience = await this.audience(actor, input.courseId, input.audienceIds);
    await this.validateAttachments(actor, input.attachmentIds, undefined, input.courseId);
    const { audienceIds: _audience, questionVersionIds, ...data } = input;
    const assignment = await this.db.assignment.create({
      data: {
        ...data,
        organizationId: actor.organizationId,
        creatorId: actor.id,
        totalCents: versions.reduce((sum, q) => sum + q.scoreCents, 0),
        audience: { create: audience.map((userId) => ({ userId })) },
        items: {
          create: questionVersionIds.map((questionVersionId, position) => ({ questionVersionId, position })),
        },
      },
    });
    await this.auditEvent(actor, 'assignment.create', 'Assignment', assignment.id);
    return assignment;
  }
  async assignment(actor: Actor, id: string) {
    const assignment = await this.assignmentAccess(actor, id);
    const student = this.student(actor);
    const [draft, submissions, exception] = await Promise.all([
      this.db.assignmentDraft.findUnique({
        where: { assignmentId_userId: { assignmentId: id, userId: actor.id } },
      }),
      this.db.assignmentSubmission.findMany({
        where: { assignmentId: id, userId: actor.id },
        include: { grading: { orderBy: { revision: 'asc' } } },
        orderBy: { version: 'desc' },
      }),
      this.db.assignmentException.findUnique({
        where: { assignmentId_userId: { assignmentId: id, userId: actor.id } },
      }),
    ]);
    const opened = !student || assignment.opensAt <= new Date();
    const { audience, items, ...details } = assignment;
    return {
      ...details,
      audience: student ? undefined : audience,
      items: opened
        ? items.map((item) => ({
            id: item.id,
            position: item.position,
            questionVersionId: item.questionVersionId,
            question: publicQuestion(
              content(item.questionVersion),
              !student || Boolean(submissions.some((s) => s.releasedAt)),
              !student || Boolean(submissions.some((s) => s.releasedAt)),
            ),
          }))
        : [],
      draft,
      exception,
      mySubmissions: submissions.map((submission) => this.submissionView(submission, student)),
      serverTime: new Date().toISOString(),
    };
  }
  async updateAssignment(actor: Actor, id: string, input: z.infer<typeof schema.assignmentPatchSchema>) {
    const old = await this.assignmentAccess(actor, id, true);
    const { revision, reason, audienceIds, questionVersionIds, courseId, ...data } = input;
    if (courseId && courseId !== old.courseId) throw new BadRequestException('不能改变作业所属课程');
    if (old.status !== 'draft') {
      if (
        audienceIds ||
        questionVersionIds ||
        data.opensAt ||
        data.maxAttempts !== undefined ||
        data.allowLate !== undefined ||
        data.attachmentIds
      )
        throw new ConflictException('已发布作业仅可修改标题、说明和截止时间；补交请使用个别授权');
      if (!reason || reason.length < 3) throw new BadRequestException('修改已发布作业需要填写原因');
      if (data.dueAt && data.dueAt < old.dueAt) throw new ConflictException('已发布作业不能提前截止');
    }
    if ((data.dueAt ?? old.dueAt) <= (data.opensAt ?? old.opensAt))
      throw new BadRequestException('截止时间必须晚于开放时间');
    const versions = questionVersionIds
      ? await this.versionSelection(actor, old.courseId, questionVersionIds)
      : undefined;
    const audience = audienceIds ? await this.audience(actor, old.courseId, audienceIds) : undefined;
    if (data.attachmentIds)
      await this.validateAttachments(actor, data.attachmentIds, undefined, old.courseId);
    await this.db.$transaction(async (tx) => {
      const changed = await tx.assignment.updateMany({
        where: { id, revision, status: old.status },
        data: {
          ...data,
          totalCents: versions?.reduce((sum, v) => sum + v.scoreCents, 0),
          revision: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException('作业已变更，请刷新');
      if (questionVersionIds) {
        await tx.assignmentItem.deleteMany({ where: { assignmentId: id } });
        await tx.assignmentItem.createMany({
          data: questionVersionIds.map((questionVersionId, position) => ({
            assignmentId: id,
            questionVersionId,
            position,
          })),
        });
      }
      if (audience) {
        await tx.assignmentAudience.deleteMany({ where: { assignmentId: id } });
        await tx.assignmentAudience.createMany({
          data: audience.map((userId) => ({ assignmentId: id, userId })),
        });
      }
    });
    await this.auditEvent(actor, 'assignment.update', 'Assignment', id, {
      reason,
      oldDueAt: old.dueAt,
      newDueAt: data.dueAt ?? old.dueAt,
    });
    if (old.status === 'published')
      await this.notify(
        actor,
        old.audience.map((row) => row.userId),
        'assignment',
        '作业安排已调整',
        `${old.title}：${reason}`,
        `/assignments/${id}`,
        `assignment:${id}:change:${revision + 1}`,
      );
    return this.assignment(actor, id);
  }
  async publishAssignment(actor: Actor, id: string) {
    const assignment = await this.assignmentAccess(actor, id, true);
    if (assignment.status !== 'draft') throw new ConflictException('作业已经发布');
    if (assignment.dueAt <= new Date()) throw new BadRequestException('截止时间已过，请调整后发布');
    await this.versionSelection(
      actor,
      assignment.courseId,
      assignment.items.map((item) => item.questionVersionId),
    );
    await this.validateAttachments(actor, assignment.attachmentIds, undefined, assignment.courseId, false);
    await this.audience(
      actor,
      assignment.courseId,
      assignment.audience.map((a) => a.userId),
    );
    await this.assertNoUnreleasedExam(assignment.items.map((item) => item.questionVersion.questionId));
    await this.db.$transaction(async (tx) => {
      const questionIds = assignment.items.map((item) => item.questionVersion.questionId).sort();
      for (const questionId of questionIds) await this.lock(tx, `question:${questionId}`);
      await this.assertNoUnreleasedExam(questionIds, tx);
      if (
        await tx.question.count({
          where: {
            id: { in: questionIds },
            OR: [{ active: false }, { scope: 'private', creatorId: { not: actor.id } }],
          },
        })
      )
        throw new ConflictException('作业题目已被停用或共享授权已撤销，请调整后发布');
      const changed = await tx.assignment.updateMany({
        where: { id, status: 'draft', revision: assignment.revision },
        data: { status: 'published', revision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('作业已被修改');
    });
    await this.auditEvent(actor, 'assignment.publish', 'Assignment', id);
    await this.notify(
      actor,
      assignment.audience.map((a) => a.userId),
      'assignment',
      '新作业已发布',
      assignment.title,
      `/assignments/${id}`,
      `assignment:${id}:published`,
    );
    return this.assignment(actor, id);
  }
  private validateAnswers(answers: { questionVersionId: string; value: unknown }[], ids: string[]) {
    if (
      unique(answers.map((a) => a.questionVersionId)).length !== answers.length ||
      answers.some((answer) => !ids.includes(answer.questionVersionId))
    )
      throw new BadRequestException('答案题目不属于当前任务或存在重复');
    if (JSON.stringify(answers).length > 500000) throw new BadRequestException('答案内容过大');
  }
  private validateAnswerValues(
    answers: { questionVersionId: string; value: unknown }[],
    questions: QuestionData[],
  ) {
    this.validateAnswers(
      answers,
      questions.map((question) => question.id),
    );
    if (
      answers.some(
        (answer) =>
          !validAnswerValue(
            questions.find((question) => question.id === answer.questionVersionId)!,
            answer.value,
          ),
      )
    )
      throw new BadRequestException('答案格式、选项或综合题子题与题目不匹配');
  }
  private checkAssignmentWindow(
    assignment: { opensAt: Date; dueAt: Date; allowLate: boolean },
    exception?: { allowUntil: Date | null; exempt: boolean } | null,
  ) {
    const now = new Date();
    if (assignment.opensAt > now) throw new ForbiddenException('作业尚未开放');
    if (exception?.exempt) throw new ConflictException('此作业已豁免，无需提交');
    if (
      !assignment.allowLate &&
      now > assignment.dueAt &&
      (!exception?.allowUntil || now > exception.allowUntil)
    )
      throw new ConflictException('作业已截止，草稿不等于正式提交；可向教师申请补交');
  }
  async saveAssignmentDraft(actor: Actor, id: string, input: z.infer<typeof schema.draftSchema>) {
    this.require(actor, 'learning.use');
    const assignment = await this.assignmentAccess(actor, id);
    const exception = await this.db.assignmentException.findUnique({
      where: { assignmentId_userId: { assignmentId: id, userId: actor.id } },
    });
    this.checkAssignmentWindow(assignment, exception);
    this.validateAnswerValues(
      input.answers,
      assignment.items.map((item) => content(item.questionVersion)),
    );
    await this.validateAttachments(actor, input.attachmentIds, id);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, `assignment:${id}:${actor.id}`);
      const draft = await tx.assignmentDraft.findUnique({
        where: { assignmentId_userId: { assignmentId: id, userId: actor.id } },
      });
      if ((draft?.revision ?? 0) !== input.revision)
        throw new ConflictException('另一页面已保存新草稿，请刷新后继续');
      return tx.assignmentDraft.upsert({
        where: { assignmentId_userId: { assignmentId: id, userId: actor.id } },
        create: {
          assignmentId: id,
          userId: actor.id,
          answers: json(input.answers),
          attachmentIds: input.attachmentIds,
          revision: 1,
        },
        update: {
          answers: json(input.answers),
          attachmentIds: input.attachmentIds,
          revision: { increment: 1 },
        },
      });
    });
  }
  async submitAssignment(actor: Actor, id: string, input: z.infer<typeof schema.submissionSchema>) {
    this.require(actor, 'learning.use');
    const assignment = await this.assignmentAccess(actor, id);
    this.validateAnswerValues(
      input.answers,
      assignment.items.map((item) => content(item.questionVersion)),
    );
    await this.validateAttachments(actor, input.attachmentIds, id);
    const submission = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `assignment:${id}:${actor.id}`);
      const prior = await tx.assignmentSubmission.findUnique({
        where: {
          assignmentId_userId_idempotencyKey: {
            assignmentId: id,
            userId: actor.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (prior) {
        if (
          !isDeepStrictEqual(prior.answers, input.answers) ||
          !isDeepStrictEqual(prior.attachmentIds, input.attachmentIds)
        )
          throw new ConflictException('同一幂等键不能用于不同提交内容');
        return prior;
      }
      const exception = await tx.assignmentException.findUnique({
        where: { assignmentId_userId: { assignmentId: id, userId: actor.id } },
      });
      this.checkAssignmentWindow(assignment, exception);
      const last = await tx.assignmentSubmission.findFirst({
        where: { assignmentId: id, userId: actor.id },
        orderBy: { version: 'desc' },
      });
      if ((last?.version ?? 0) >= assignment.maxAttempts + (exception?.extraAttempts ?? 0))
        throw new ConflictException('已达提交次数上限，请申请重交');
      const scores = assignment.items.map((item) =>
        autoScore(
          content(item.questionVersion),
          input.answers.find((a) => a.questionVersionId === item.questionVersionId)?.value,
        ),
      );
      const complete = scores.every((score) => score !== null);
      const created = await tx.assignmentSubmission.create({
        data: {
          assignmentId: id,
          userId: actor.id,
          version: (last?.version ?? 0) + 1,
          idempotencyKey: input.idempotencyKey,
          answers: json(input.answers),
          attachmentIds: input.attachmentIds,
          late: new Date() > assignment.dueAt,
          gradingStatus: complete ? 'graded' : 'pending',
          scoreCents: complete ? (scores as number[]).reduce((a, b) => a + b, 0) : null,
        },
      });
      await tx.assignmentDraft.deleteMany({ where: { assignmentId: id, userId: actor.id } });
      return created;
    });
    await this.auditEvent(actor, 'assignment.submit', 'AssignmentSubmission', submission.id, {
      version: submission.version,
      late: submission.late,
    });
    return this.submissionView(submission, this.student(actor));
  }
  async submissions(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    await this.assignmentAccess(actor, id);
    const p = paginate(query);
    const where = {
      assignmentId: id,
      ...(this.student(actor) ? { userId: actor.id } : {}),
      ...(query.status ? { gradingStatus: query.status } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.assignmentSubmission.findMany({
        where,
        include: { grading: { orderBy: { revision: 'desc' } } },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.assignmentSubmission.count({ where }),
    ]);
    const users = await this.db.user.findMany({
      where: { id: { in: unique(items.map((s) => s.userId)) } },
      select: { id: true, name: true, username: true },
    });
    return {
      items: items.map((submission) => ({
        ...this.submissionView(submission, this.student(actor)),
        user: users.find((u) => u.id === submission.userId),
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  async assignmentRoster(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, 'assessment.grade');
    const assignment = await this.assignmentAccess(actor, id);
    const p = paginate(query);
    const ids = assignment.audience.map((a) => a.userId).sort();
    const pageIds = ids.slice(p.skip, p.skip + p.take);
    const [users, submissions, exceptions] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: pageIds } },
        select: { id: true, name: true, username: true },
      }),
      this.db.assignmentSubmission.findMany({
        where: { assignmentId: id, userId: { in: pageIds } },
        orderBy: { version: 'desc' },
      }),
      this.db.assignmentException.findMany({ where: { assignmentId: id, userId: { in: pageIds } } }),
    ]);
    return {
      items: users.map((user) => {
        const submission = submissions.find((s) => s.userId === user.id);
        const exception = exceptions.find((e) => e.userId === user.id);
        return {
          user,
          submission,
          exception,
          status: exception?.exempt
            ? 'exempt'
            : !submission
              ? 'not_submitted'
              : submission.status === 'returned'
                ? 'returned'
                : submission.late
                  ? 'late'
                  : submission.gradingStatus,
        };
      }),
      total: ids.length,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  async gradeSubmission(actor: Actor, id: string, input: z.infer<typeof schema.gradeSchema>) {
    this.require(actor, 'assessment.grade');
    const submission = await this.db.assignmentSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('提交不存在');
    const assignment = await this.assignmentAccess(actor, submission.assignmentId);
    await this.scoped(actor, assignment.courseId, true);
    if (submission.releasedAt) throw new ConflictException('已公开成绩不能覆盖；退回重交会保留该版本及批注');
    if (submission.status === 'returned') throw new ConflictException('此版本已退回，不再批阅');
    this.validateAnswers(
      input.items.map((item) => ({ questionVersionId: item.questionVersionId, value: item.scoreCents })),
      assignment.items.map((item) => item.questionVersionId),
    );
    const answers = submission.answers as { questionVersionId: string; value: unknown }[];
    const priorFeedback = await this.db.assignmentFeedback.findFirst({
      where: { submissionId: id },
      orderBy: { revision: 'desc' },
    });
    const previousItems = (priorFeedback?.items ?? []) as {
      questionVersionId: string;
      scoreCents: number | null;
      comment: string;
    }[];
    const grades = assignment.items.map((item) => {
      const custom =
        input.items.find((grade) => grade.questionVersionId === item.questionVersionId) ??
        previousItems.find((grade) => grade.questionVersionId === item.questionVersionId);
      const score =
        custom?.scoreCents ??
        autoScore(
          content(item.questionVersion),
          answers.find((answer) => answer.questionVersionId === item.questionVersionId)?.value,
        );
      if (score === null && input.finalize)
        throw new BadRequestException('仍有主观题未批阅；可使用 finalize=false 暂存');
      if (score !== null && score > item.questionVersion.scoreCents)
        throw new BadRequestException('得分不能超过题目满分');
      return { questionVersionId: item.questionVersionId, scoreCents: score, comment: custom?.comment ?? '' };
    });
    const total = grades.reduce((sum, grade) => sum + (grade.scoreCents ?? 0), 0);
    const complete = input.finalize && grades.every((grade) => grade.scoreCents !== null);
    const graded = await this.db.$transaction(async (tx) => {
      const changed = await tx.assignmentSubmission.updateMany({
        where: { id, revision: input.revision, releasedAt: null, status: 'submitted' },
        data: {
          gradingStatus: complete ? 'graded' : 'pending',
          scoreCents: complete ? total : null,
          feedback: input.comment,
          revision: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException('批阅已变更，请刷新以免覆盖他人的批改');
      await tx.assignmentFeedback.create({
        data: {
          submissionId: id,
          graderId: actor.id,
          revision: input.revision + 1,
          items: json(grades),
          totalCents: total,
          comment: input.comment,
        },
      });
      return tx.assignmentSubmission.findUniqueOrThrow({ where: { id }, include: { grading: true } });
    });
    await this.auditEvent(actor, 'assignment.grade', 'AssignmentSubmission', id, {
      scoreCents: total,
      version: submission.version,
    });
    return graded;
  }
  async releaseAssignment(actor: Actor, id: string) {
    this.require(actor, 'assessment.grade');
    const assignment = await this.assignmentAccess(actor, id);
    await this.scoped(actor, assignment.courseId, true);
    const releasedAt = new Date();
    const result = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `assignment-release:${id}`);
      if (
        await tx.assignmentSubmission.count({
          where: { assignmentId: id, status: 'submitted', gradingStatus: { not: 'graded' } },
        })
      )
        throw new ConflictException('仍有提交待批改，不能统一发布');
      const changed = await tx.assignmentSubmission.updateMany({
        where: { assignmentId: id, status: 'submitted', gradingStatus: 'graded', releasedAt: null },
        data: { releasedAt },
      });
      await tx.assignment.update({ where: { id }, data: { releaseAt: releasedAt } });
      return { released: changed.count, releasedAt };
    });
    await this.auditEvent(actor, 'assignment.release', 'Assignment', id, result);
    await this.notify(
      actor,
      assignment.audience.map((a) => a.userId),
      'grade',
      '作业批改结果已发布',
      assignment.title,
      `/assignments/${id}`,
      `assignment:${id}:release:${releasedAt.toISOString()}`,
    );
    return result;
  }
  async assignmentException(actor: Actor, id: string, input: z.infer<typeof schema.exceptionSchema>) {
    const assignment = await this.assignmentAccess(actor, id, true);
    if (!assignment.audience.some((row) => row.userId === input.userId))
      throw new BadRequestException('学生不是作业对象');
    const result = await this.db.assignmentException.upsert({
      where: { assignmentId_userId: { assignmentId: id, userId: input.userId } },
      create: { ...input, assignmentId: id, approvedBy: actor.id },
      update: { ...input, approvedBy: actor.id },
    });
    await this.auditEvent(actor, 'assignment.exception', 'Assignment', id, input);
    await this.notify(
      actor,
      [input.userId],
      'assignment',
      '作业个别安排已更新',
      input.reason,
      `/assignments/${id}`,
      `assignment-exception:${result.id}:${result.createdAt.toISOString()}:${input.extraAttempts}`,
    );
    return result;
  }
  async returnSubmission(actor: Actor, id: string, reason: string) {
    this.require(actor, 'assessment.grade');
    const submission = await this.db.assignmentSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('提交不存在');
    const assignment = await this.assignmentAccess(actor, submission.assignmentId);
    await this.scoped(actor, assignment.courseId, true);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, `assignment:${assignment.id}:${submission.userId}`);
      const changed = await tx.assignmentSubmission.updateMany({
        where: { id, status: 'submitted' },
        data: { status: 'returned' },
      });
      if (!changed.count) throw new ConflictException('已退回该版本');
      await tx.assignmentException.upsert({
        where: { assignmentId_userId: { assignmentId: assignment.id, userId: submission.userId } },
        create: {
          assignmentId: assignment.id,
          userId: submission.userId,
          approvedBy: actor.id,
          reason,
          extraAttempts: 1,
          allowUntil: new Date(Math.max(assignment.dueAt.getTime(), Date.now() + 7 * 86400000)),
        },
        update: {
          extraAttempts: { increment: 1 },
          reason,
          approvedBy: actor.id,
          allowUntil: new Date(Math.max(assignment.dueAt.getTime(), Date.now() + 7 * 86400000)),
        },
      });
    });
    await this.auditEvent(actor, 'assignment.return', 'AssignmentSubmission', id, { reason });
    await this.notify(
      actor,
      [submission.userId],
      'assignment',
      '作业已退回重做',
      reason,
      `/assignments/${assignment.id}`,
      `assignment-return:${id}`,
    );
    return { returned: true };
  }

  async createPractice(actor: Actor, input: z.infer<typeof schema.practiceSchema>) {
    this.require(actor, 'learning.use');
    await this.scoped(actor, input.courseId);
    const matching = await this.sampleVersions(actor, input.courseId, {
      ...input,
      count: input.count ?? 10,
      practiceEnabled: true,
    });
    if (!matching.length) throw new BadRequestException('没有符合条件且已开放练习的题目');
    if (input.count && matching.length < input.count)
      throw new BadRequestException(
        `符合条件的练习题不足：需要 ${input.count} 道，仅有 ${matching.length} 道`,
      );
    const selected = secureShuffle(matching).slice(0, input.count ?? Math.min(10, matching.length));
    const session = await this.db.practiceSession.create({
      data: {
        organizationId: actor.organizationId,
        courseId: input.courseId,
        userId: actor.id,
        snapshot: json(selected),
      },
    });
    return this.practice(actor, session.id);
  }
  async practices(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, 'learning.use');
    const ids = await this.auth.courseIds(actor);
    if (query.courseId) await this.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = { userId: actor.id, courseId: query.courseId ?? { in: ids } };
    const [items, total] = await this.db.$transaction([
      this.db.practiceSession.findMany({
        where,
        select: {
          id: true,
          courseId: true,
          status: true,
          createdAt: true,
          completedAt: true,
          _count: { select: { answers: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.practiceSession.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  private async practiceAccess(actor: Actor, id: string) {
    this.require(actor, 'learning.use');
    const session = await this.db.practiceSession.findFirst({
      where: { id, userId: actor.id, organizationId: actor.organizationId },
      include: { answers: true },
    });
    if (!session) throw new NotFoundException('练习不存在');
    await this.scoped(actor, session.courseId);
    return session;
  }
  async practice(actor: Actor, id: string) {
    const session = await this.practiceAccess(actor, id);
    const snapshot = session.snapshot as unknown as QuestionData[];
    return {
      id: session.id,
      courseId: session.courseId,
      status: session.status,
      flags: session.flags,
      currentPosition: session.currentPosition,
      revision: session.revision,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      items: snapshot.map((q) =>
        publicQuestion(
          q,
          session.answers.some((a) => a.questionVersionId === q.id),
          session.answers.some((a) => a.questionVersionId === q.id),
        ),
      ),
      answers: session.answers,
      report: this.practiceReport(snapshot, session.answers),
    };
  }
  async savePracticeProgress(actor: Actor, id: string, input: z.infer<typeof schema.practiceProgressSchema>) {
    const session = await this.practiceAccess(actor, id);
    const questions = session.snapshot as unknown as QuestionData[];
    if (input.currentPosition >= questions.length) throw new BadRequestException('练习位置超出题目范围');
    if (input.flags.some((flag) => !questions.some((question) => question.id === flag)))
      throw new BadRequestException('标记包含不属于本次练习的题目');
    const flags = unique(input.flags);
    const saved = await this.db.practiceSession.updateMany({
      where: { id, userId: actor.id, organizationId: actor.organizationId, revision: input.revision },
      data: { flags, currentPosition: input.currentPosition, revision: { increment: 1 } },
    });
    if (!saved.count) throw new ConflictException('练习进度已在其他页面更新，请刷新后继续');
    return { flags, currentPosition: input.currentPosition, revision: input.revision + 1 };
  }
  private practiceReport(
    questions: QuestionData[],
    answers: { correct: boolean | null; scoreCents: number | null }[],
  ) {
    return {
      answered: answers.length,
      total: questions.length,
      objectivelyScored: answers.filter((a) => a.correct !== null).length,
      correct: answers.filter((a) => a.correct).length,
      scoreCents: answers.reduce((sum, a) => sum + (a.scoreCents ?? 0), 0),
      totalCents: questions.reduce((sum, q) => sum + q.scoreCents, 0),
      note: '正确率仅包含已自动评分的客观题；简答和综合题按参考答案自主复盘，不计客观正确率。',
    };
  }
  async answerPractice(actor: Actor, id: string, input: z.infer<typeof schema.answerSchema>) {
    const session = await this.practiceAccess(actor, id);
    const questions = session.snapshot as unknown as QuestionData[];
    const question = questions.find((q) => q.id === input.questionVersionId);
    if (!question) throw new BadRequestException('题目不属于本次练习');
    this.validateAnswerValues([input], [question]);
    const current = await this.db.question.findUnique({ where: { id: question.questionId } });
    if (!current?.practiceEnabled) throw new ForbiddenException('题目已停止开放练习');
    const score = autoScore(question, input.value);
    const correct = score === null ? null : score === question.scoreCents;
    const answer = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `practice:${id}`);
      const existing = await tx.practiceAnswer.findUnique({
        where: { sessionId_questionVersionId: { sessionId: id, questionVersionId: input.questionVersionId } },
      });
      if (existing) return existing;
      const result = await tx.practiceAnswer.create({
        data: {
          sessionId: id,
          questionVersionId: question.id,
          questionId: question.questionId,
          value: json(input.value),
          scoreCents: score,
          correct,
        },
      });
      if (correct === false)
        await tx.mistakeRecord.upsert({
          where: { userId_questionId: { userId: actor.id, questionId: question.questionId } },
          create: { userId: actor.id, courseId: session.courseId, questionId: question.questionId },
          update: { wrongCount: { increment: 1 }, mastered: false, lastAnsweredAt: new Date() },
        });
      else
        await tx.mistakeRecord.updateMany({
          where: { userId: actor.id, questionId: question.questionId },
          data: { lastAnsweredAt: new Date() },
        });
      if ((await tx.practiceAnswer.count({ where: { sessionId: id } })) === questions.length)
        await tx.practiceSession.update({
          where: { id },
          data: { status: 'completed', completedAt: new Date() },
        });
      return result;
    });
    const answers = await this.db.practiceAnswer.findMany({ where: { sessionId: id } });
    return {
      answer,
      question: publicQuestion(question, true, true),
      report: this.practiceReport(questions, answers),
    };
  }
  async questionCollection(
    actor: Actor,
    type: 'mistakes' | 'favorites',
    query: z.infer<typeof schema.listSchema>,
  ) {
    this.require(actor, 'learning.use');
    const courses = await this.auth.courseIds(actor);
    if (query.courseId) await this.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = { userId: actor.id, courseId: query.courseId ?? { in: courses } };
    const [rows, total] =
      type === 'mistakes'
        ? await this.db.$transaction([
            this.db.mistakeRecord.findMany({
              where,
              orderBy: [{ lastAnsweredAt: 'desc' }, { id: 'desc' }],
              skip: p.skip,
              take: p.take,
            }),
            this.db.mistakeRecord.count({ where }),
          ])
        : await this.db.$transaction([
            this.db.questionFavorite.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: p.skip,
              take: p.take,
            }),
            this.db.questionFavorite.count({ where }),
          ]);
    const questions = await this.db.question.findMany({
      where: { id: { in: rows.map((r) => r.questionId) }, practiceEnabled: true, active: true },
      include: questionInclude,
    });
    return {
      items: rows.map((row) => {
        const question = questions.find((q) => q.id === row.questionId);
        return {
          ...row,
          available: Boolean(question),
          question: question ? publicQuestion(content(question.versions[0])) : null,
        };
      }),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  async favorite(actor: Actor, id: string, favorite: boolean) {
    this.require(actor, 'learning.use');
    const q = await this.db.question.findFirst({
      where: { id, organizationId: actor.organizationId, practiceEnabled: true, active: true },
    });
    if (!q) throw new NotFoundException('开放练习题目不存在');
    await this.scoped(actor, q.courseId);
    if (favorite)
      return this.db.questionFavorite.upsert({
        where: { userId_questionId: { userId: actor.id, questionId: id } },
        create: { userId: actor.id, courseId: q.courseId, questionId: id },
        update: {},
      });
    await this.db.questionFavorite.deleteMany({ where: { userId: actor.id, questionId: id } });
    return { favorite: false };
  }
  async masterMistake(actor: Actor, id: string, mastered: boolean) {
    this.require(actor, 'learning.use');
    const mistake = await this.db.mistakeRecord.findFirst({ where: { id, userId: actor.id } });
    if (!mistake) throw new NotFoundException('错题记录不存在');
    await this.scoped(actor, mistake.courseId);
    return this.db.mistakeRecord.update({ where: { id }, data: { mastered } });
  }

  private async examAccess(actor: Actor, id: string, manage = false) {
    this.require(
      actor,
      this.student(actor) ? 'learning.use' : manage ? 'assessment.manage' : 'assessment.grade',
    );
    const exam = await this.db.exam.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { audience: true, snapshot: { include: { items: { orderBy: { position: 'asc' } } } } },
    });
    if (!exam) throw new NotFoundException('考试不存在');
    await this.scoped(actor, exam.courseId, manage);
    if (this.student(actor) && (exam.status === 'draft' || !exam.audience.some((a) => a.userId === actor.id)))
      throw new ForbiddenException('没有本考试资格');
    return exam;
  }
  private requireExamGrader(actor: Actor, exam: { graderIds: string[] }) {
    if (!this.student(actor) && exam.graderIds.length && !exam.graderIds.includes(actor.id))
      throw new ForbiddenException('未被指定为本考试阅卷教师');
  }
  private validateExamTimes(exam: {
    startsAt: Date;
    endsAt: Date;
    entryClosesAt: Date;
    durationMinutes: number;
    scoreReleaseAt?: Date | null;
    answerReleaseAt?: Date | null;
    explanationReleaseAt?: Date | null;
    commentReleaseAt?: Date | null;
    appealDeadline?: Date | null;
  }) {
    if (
      exam.endsAt <= exam.startsAt ||
      exam.entryClosesAt < exam.startsAt ||
      exam.entryClosesAt > exam.endsAt
    )
      throw new BadRequestException('考试窗口或允许进入时间范围不正确');
    if (
      [exam.scoreReleaseAt, exam.answerReleaseAt, exam.explanationReleaseAt, exam.commentReleaseAt].some(
        (date) => date && date < exam.endsAt,
      )
    )
      throw new BadRequestException('成绩、答案、解析、评语最早只能在考试窗口结束后公开');
    if (exam.appealDeadline && exam.appealDeadline <= (exam.scoreReleaseAt ?? exam.endsAt))
      throw new BadRequestException('复核期限必须晚于成绩公开时间');
  }
  async exams(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, this.student(actor) ? 'learning.use' : 'assessment.manage');
    const ids = await this.auth.courseIds(actor);
    if (query.courseId) await this.scoped(actor, query.courseId);
    const p = paginate(query);
    const where: Prisma.ExamWhereInput = {
      organizationId: actor.organizationId,
      courseId: query.courseId ?? { in: ids },
      ...(query.search ? { title: { contains: query.search } } : {}),
      ...(this.student(actor)
        ? { status: { not: 'draft' }, audience: { some: { userId: actor.id } } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.exam.findMany({
        where,
        include: {
          attempts: {
            where: { userId: actor.id },
            orderBy: { number: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              gradingStatus: true,
              releaseStatus: true,
              number: true,
              deadlineAt: true,
            },
          },
          _count: { select: { audience: true, attempts: true } },
        },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.exam.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize, serverTime: new Date().toISOString() };
  }
  async createExam(actor: Actor, input: z.infer<typeof schema.examSchema>) {
    this.require(actor, 'assessment.manage');
    await this.scoped(actor, input.courseId, true);
    this.validateExamTimes(input);
    const versions = await this.versionSelection(actor, input.courseId, input.questionVersionIds);
    const totalCents = versions.reduce((sum, q) => sum + q.scoreCents, 0);
    if (input.passCents > totalCents) throw new BadRequestException('及格分不能超过试卷满分');
    const audience = await this.audience(actor, input.courseId, input.audienceIds);
    const { questionVersionIds: _versions, audienceIds: _audience, ...data } = input;
    const exam = await this.db.exam.create({
      data: {
        ...data,
        organizationId: actor.organizationId,
        creatorId: actor.id,
        totalCents,
        audience: { create: audience.map((userId) => ({ userId })) },
        snapshot: {
          create: {
            items: {
              create: versions.map((version, position) => ({
                questionId: version.questionId,
                questionVersionId: version.id,
                position,
                content: json(version),
              })),
            },
          },
        },
      },
    });
    await this.auditEvent(actor, 'exam.create', 'Exam', exam.id);
    return this.exam(actor, exam.id);
  }
  async exam(actor: Actor, id: string) {
    const exam = await this.examAccess(actor, id);
    const { snapshot, audience, ...details } = exam;
    const attempts = await this.db.examAttempt.findMany({
      where: { examId: id, userId: actor.id },
      select: {
        id: true,
        status: true,
        gradingStatus: true,
        releaseStatus: true,
        number: true,
        deadlineAt: true,
        startedAt: true,
        submittedAt: true,
      },
      orderBy: { number: 'desc' },
    });
    return {
      ...details,
      items: this.student(actor)
        ? undefined
        : snapshot?.items.map((item) => ({
            ...publicQuestion(content(item.content), true, true),
            questionVersionId: item.questionVersionId,
          })),
      audience:
        this.student(actor) || (exam.graderIds.length && !exam.graderIds.includes(actor.id))
          ? undefined
          : audience,
      eligible: this.student(actor) ? audience.find((a) => a.userId === actor.id)?.eligible : undefined,
      attempts,
      serverTime: new Date().toISOString(),
    };
  }
  async updateExam(actor: Actor, id: string, input: z.infer<typeof schema.examPatchSchema>) {
    const exam = await this.examAccess(actor, id, true);
    if (exam.status !== 'draft')
      throw new ConflictException('发布后试卷及关键规则冻结；请创建新考试或使用个别延时/补考授权');
    const { revision, courseId, audienceIds, questionVersionIds, ...data } = input;
    if (courseId && courseId !== exam.courseId) throw new BadRequestException('不能改变考试所属课程');
    this.validateExamTimes({ ...exam, ...data });
    const versions = questionVersionIds
      ? await this.versionSelection(actor, exam.courseId, questionVersionIds)
      : undefined;
    const audience = audienceIds ? await this.audience(actor, exam.courseId, audienceIds) : undefined;
    const totalCents = versions?.reduce((sum, q) => sum + q.scoreCents, 0) ?? exam.totalCents;
    if ((data.passCents ?? exam.passCents) > totalCents)
      throw new BadRequestException('及格分不能超过试卷满分');
    await this.db.$transaction(async (tx) => {
      const changed = await tx.exam.updateMany({
        where: { id, revision, status: 'draft' },
        data: { ...data, totalCents, revision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('考试已被修改或发布，请刷新');
      if (audience) {
        await tx.examAudience.deleteMany({ where: { examId: id } });
        await tx.examAudience.createMany({ data: audience.map((userId) => ({ examId: id, userId })) });
      }
      if (versions) {
        await tx.examPaperItem.deleteMany({ where: { snapshotId: exam.snapshot!.id } });
        await tx.examPaperItem.createMany({
          data: versions.map((version, position) => ({
            snapshotId: exam.snapshot!.id,
            questionId: version.questionId,
            questionVersionId: version.id,
            position,
            content: json(version),
          })),
        });
      }
    });
    await this.auditEvent(actor, 'exam.update', 'Exam', id, { revision: revision + 1 });
    return this.exam(actor, id);
  }
  async publishExam(actor: Actor, id: string) {
    const exam = await this.examAccess(actor, id, true);
    this.validateExamTimes(exam);
    if (exam.status !== 'draft') throw new ConflictException('考试已发布或取消');
    if (exam.endsAt <= new Date()) throw new BadRequestException('考试结束时间已过');
    if (!exam.snapshot?.items.length) throw new BadRequestException('试卷不能为空');
    await this.audience(
      actor,
      exam.courseId,
      exam.audience.map((a) => a.userId),
    );
    const versions = await this.versionSelection(
      actor,
      exam.courseId,
      exam.snapshot.items.map((item) => item.questionVersionId),
    );
    if (versions.some((version) => version.question.practiceEnabled || version.question.everPracticeEnabled))
      throw new BadRequestException('正式考试不能使用曾开放过练习的题目；请创建独立保密考试题');
    if (
      await this.db.assignmentItem.count({
        where: {
          questionVersion: { questionId: { in: versions.map((q) => q.questionId) } },
          assignment: { status: 'published' },
        },
      })
    )
      throw new BadRequestException('题目已用于公开作业，不能作为保密考试题');
    const subjective = versions.some((q) => ['short', 'composite'].includes(q.type));
    if (subjective && !exam.graderIds.length) throw new BadRequestException('试卷含主观题，必须指定阅卷教师');
    if (exam.graderIds.length) {
      const teachers = await this.db.teachingAssignment.count({
        where: { courseId: exam.courseId, userId: { in: unique(exam.graderIds) }, active: true },
      });
      if (teachers !== unique(exam.graderIds).length)
        throw new BadRequestException('阅卷教师必须是本课程的在职授课教师');
    }
    await this.db.$transaction(async (tx) => {
      const questionIds = versions.map((q) => q.questionId).sort();
      for (const questionId of questionIds) await this.lock(tx, `question:${questionId}`);
      if (
        await tx.question.count({
          where: {
            id: { in: questionIds },
            OR: [{ practiceEnabled: true }, { everPracticeEnabled: true }, { active: false }],
          },
        })
      )
        throw new ConflictException('题目刚被公开或停用，请重新检查试卷');
      if (
        await tx.assignmentItem.count({
          where: {
            questionVersion: { questionId: { in: questionIds } },
            assignment: { status: 'published' },
          },
        })
      )
        throw new ConflictException('题目已发布到作业，不能用于保密考试');
      if (
        await tx.examPaperItem.count({
          where: {
            questionId: { in: questionIds },
            snapshot: {
              exam: { id: { not: id }, OR: [{ status: 'published' }, { attempts: { some: {} } }] },
            },
          },
        })
      )
        throw new ConflictException(
          '题目已用于其他正式考试或已有历史答卷；取消考试不能撤回已暴露内容，请使用独立考试题',
        );
      const changed = await tx.exam.updateMany({
        where: { id, revision: exam.revision, status: 'draft' },
        data: { status: 'published', revision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('考试已被修改');
    });
    await this.auditEvent(actor, 'exam.publish', 'Exam', id);
    await this.notify(
      actor,
      exam.audience.map((a) => a.userId),
      'exam',
      '新考试已发布',
      exam.title,
      `/exams/${id}`,
      `exam:${id}:published`,
    );
    return this.exam(actor, id);
  }
  async cancelExam(actor: Actor, id: string, reason: string) {
    const exam = await this.examAccess(actor, id, true);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, `exam-lifecycle:${id}`);
      await tx.exam.update({ where: { id }, data: { status: 'cancelled', revision: { increment: 1 } } });
      await tx.examAttempt.updateMany({
        where: { examId: id, status: 'in_progress' },
        data: { status: 'cancelled', revision: { increment: 1 } },
      });
    });
    await this.auditEvent(actor, 'exam.cancel', 'Exam', id, { reason });
    await this.notify(
      actor,
      exam.audience.map((a) => a.userId),
      'exam',
      '考试已取消',
      reason,
      `/exams/${id}`,
      `exam:${id}:cancelled`,
    );
    return { cancelled: true };
  }
  async startExam(actor: Actor, id: string) {
    this.require(actor, 'learning.use');
    const exam = await this.examAccess(actor, id);
    if (exam.status !== 'published') throw new ConflictException('考试尚未发布或已取消');
    const attempt = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `exam-lifecycle:${id}`);
      await this.lock(tx, `exam-start:${id}:${actor.id}`);
      const lifecycle = await tx.exam.findUniqueOrThrow({ where: { id } });
      if (lifecycle.status !== 'published' || lifecycle.gradesReleasedAt)
        throw new ConflictException('考试已取消或成绩已发布，不能继续开始考试');
      const eligibility = await tx.examAudience.findUnique({
        where: { examId_userId: { examId: id, userId: actor.id } },
      });
      if (!eligibility?.eligible) throw new ForbiddenException('当前没有参考资格');
      const last = await tx.examAttempt.findFirst({
        where: { examId: id, userId: actor.id },
        orderBy: { number: 'desc' },
      });
      if (last?.status === 'in_progress') return last;
      const extension = await tx.examExtension.findUnique({
        where: { examId_userId: { examId: id, userId: actor.id } },
      });
      const now = new Date();
      if (now < exam.startsAt) throw new ForbiddenException('考试尚未开始');
      if (now >= (extension?.deadlineAt ?? exam.entryClosesAt))
        throw new ForbiddenException('已超过允许进入的时间');
      if ((last?.number ?? 0) >= exam.maxAttempts + (extension?.extraAttempts ?? 0))
        throw new ConflictException('已达允许作答次数上限');
      if (!exam.snapshot) throw new ConflictException('试卷快照不存在');
      const questionOrder = exam.shuffleQuestions
        ? secureShuffle(exam.snapshot.items.map((item) => item.questionVersionId))
        : exam.snapshot.items.map((item) => item.questionVersionId);
      const optionOrder = Object.fromEntries(
        exam.snapshot.items.map((item) => {
          const options = content(item.content).options.map((option) => option.id);
          return [item.questionVersionId, exam.shuffleOptions ? secureShuffle(options) : options];
        }),
      );
      return tx.examAttempt.create({
        data: {
          examId: id,
          userId: actor.id,
          number: (last?.number ?? 0) + 1,
          deadlineAt: personalDeadline(now, exam.durationMinutes, exam.endsAt, extension?.deadlineAt),
          questionOrder: json(questionOrder),
          optionOrder: json(optionOrder),
          flags: [],
        },
      });
    });
    await this.auditEvent(actor, 'exam.start', 'ExamAttempt', attempt.id, {
      deadlineAt: attempt.deadlineAt,
      number: attempt.number,
    });
    return this.attempt(actor, attempt.id);
  }
  private async attemptAccess(actor: Actor, id: string, grade = false) {
    this.require(actor, this.student(actor) ? 'learning.use' : 'assessment.grade');
    const attempt = await this.db.examAttempt.findUnique({
      where: { id },
      include: {
        answers: true,
        exam: {
          include: { snapshot: { include: { items: { orderBy: { position: 'asc' } } } }, audience: true },
        },
      },
    });
    if (!attempt || attempt.exam.organizationId !== actor.organizationId)
      throw new NotFoundException('答卷不存在');
    await this.scoped(actor, attempt.exam.courseId, grade);
    if (this.student(actor) && attempt.userId !== actor.id)
      throw new ForbiddenException('只能访问自己的答卷');
    this.requireExamGrader(actor, attempt.exam);
    return attempt;
  }
  async attempt(actor: Actor, id: string) {
    let attempt = await this.attemptAccess(actor, id);
    if (attempt.status === 'in_progress' && attempt.deadlineAt <= new Date()) {
      await this.finalizeAttempt(id, 'deadline');
      attempt = await this.attemptAccess(actor, id);
    }
    const teacher = !this.student(actor);
    const now = new Date();
    const visible =
      teacher ||
      (attempt.releaseStatus === 'released' &&
        Boolean(attempt.exam.scoreReleaseAt && attempt.exam.scoreReleaseAt <= now));
    const finished = ['submitted', 'timed_out'].includes(attempt.status);
    const showAnswers =
      teacher || (finished && Boolean(attempt.exam.answerReleaseAt && attempt.exam.answerReleaseAt <= now));
    const showExplanation =
      teacher ||
      (finished && Boolean(attempt.exam.explanationReleaseAt && attempt.exam.explanationReleaseAt <= now));
    const commentVisibleAt = attempt.exam.commentReleaseAt ?? attempt.exam.scoreReleaseAt;
    const showComments =
      teacher ||
      (finished &&
        attempt.releaseStatus === 'released' &&
        Boolean(commentVisibleAt && commentVisibleAt <= now));
    const order = attempt.questionOrder as string[];
    const optionOrder = attempt.optionOrder as Record<string, string[]>;
    const items = order.map((versionId) => {
      const item = attempt.exam.snapshot?.items.find((row) => row.questionVersionId === versionId);
      if (!item) throw new ConflictException('考试快照缺失');
      const q = content(item.content);
      return {
        ...publicQuestion(q, showAnswers, showExplanation),
        options: (optionOrder[versionId] ?? q.options.map((o) => o.id)).map((optionId) =>
          q.options.find((o) => o.id === optionId)!,
        ),
      };
    });
    return {
      id: attempt.id,
      examId: attempt.examId,
      userId: teacher ? attempt.userId : undefined,
      number: attempt.number,
      status: attempt.status,
      gradingStatus: attempt.gradingStatus,
      releaseStatus: visible ? attempt.releaseStatus : 'hidden',
      revision: attempt.revision,
      gradingRevision: teacher ? attempt.gradingRevision : undefined,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      submittedAt: attempt.submittedAt,
      lastSavedAt: attempt.lastSavedAt,
      flags: attempt.flags,
      currentPosition: attempt.currentPosition,
      serverTime: now.toISOString(),
      exam: {
        id: attempt.exam.id,
        title: attempt.exam.title,
        description: attempt.exam.description,
        courseId: attempt.exam.courseId,
        totalCents: attempt.exam.totalCents,
        passCents: attempt.exam.passCents,
        allowBacktrack: attempt.exam.allowBacktrack,
        scoreReleaseAt: attempt.exam.scoreReleaseAt,
        answerReleaseAt: attempt.exam.answerReleaseAt,
        explanationReleaseAt: attempt.exam.explanationReleaseAt,
        commentReleaseAt: commentVisibleAt,
        appealDeadline: attempt.exam.appealDeadline,
      },
      items,
      ...(showComments ? { feedback: attempt.feedback } : {}),
      scoreAdjustmentCents:
        visible && attempt.scoreCents !== null
          ? attempt.scoreCents - attempt.answers.reduce((sum, answer) => sum + (answer.scoreCents ?? 0), 0)
          : undefined,
      answers: attempt.answers.map((answer) => ({
        questionVersionId: answer.questionVersionId,
        value: answer.value,
        ...(visible ? { scoreCents: answer.scoreCents, graded: answer.graded } : {}),
        ...(showComments ? { comment: answer.comment } : {}),
      })),
      ...(visible && attempt.gradingStatus === 'graded'
        ? { scoreCents: attempt.scoreCents }
        : { scoreCents: null }),
    };
  }
  async saveAnswers(actor: Actor, id: string, input: z.infer<typeof schema.saveSchema>) {
    this.require(actor, 'learning.use');
    const attempt = await this.attemptAccess(actor, id);
    if (attempt.userId !== actor.id) throw new ForbiddenException('只能修改本人答卷');
    if (attempt.status !== 'in_progress') throw new ConflictException('已交卷，不能修改答案');
    if (attempt.deadlineAt <= new Date()) {
      await this.finalizeAttempt(id, 'deadline');
      throw new ConflictException('考试已到时，服务器已交卷；迟到的本地草稿未接收');
    }
    const order = attempt.questionOrder as string[];
    this.validateAnswerValues(
      input.answers,
      (attempt.exam.snapshot?.items ?? []).map((item) => content(item.content)),
    );
    if (input.flags?.some((flag) => !order.includes(flag)))
      throw new BadRequestException('标记题目不属于此试卷');
    if (input.currentPosition !== undefined && input.currentPosition >= order.length)
      throw new BadRequestException('题目位置无效');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id = ${id} FOR UPDATE`;
      // Policies depending on the current revision/position must be checked after
      // the row lock. A client can otherwise predict the next revision while its
      // request is still validating an older position outside the transaction.
      const current = await tx.examAttempt.findUniqueOrThrow({
        where: { id },
        include: { exam: { include: { audience: true } } },
      });
      if (
        current.exam.status !== 'published' ||
        !current.exam.audience.some((row) => row.userId === actor.id && row.eligible)
      )
        throw new ForbiddenException('考试已取消或资格已撤销');
      if (!current.exam.allowBacktrack) {
        const position = input.currentPosition ?? current.currentPosition;
        if (
          position < current.currentPosition ||
          position > current.currentPosition + 1 ||
          input.answers.some(
            (answer) =>
              order.indexOf(answer.questionVersionId) < current.currentPosition ||
              order.indexOf(answer.questionVersionId) > position,
          )
        )
          throw new ConflictException('本考试不允许返回上一题或跳过题目');
      }
      const now = new Date();
      const changed = await tx.examAttempt.updateMany({
        where: { id, revision: input.revision, status: 'in_progress', deadlineAt: { gt: now } },
        data: {
          revision: { increment: 1 },
          flags: input.flags,
          currentPosition: input.currentPosition,
          lastSavedAt: now,
        },
      });
      if (!changed.count)
        throw new ConflictException('保存冲突或考试已结束，请读取服务器版本后合并，旧页面不得覆盖新答案');
      for (const answer of input.answers)
        await tx.examAnswer.upsert({
          where: {
            attemptId_questionVersionId: { attemptId: id, questionVersionId: answer.questionVersionId },
          },
          create: { attemptId: id, questionVersionId: answer.questionVersionId, value: json(answer.value) },
          update: { value: json(answer.value) },
        });
      return { revision: input.revision + 1, lastSavedAt: now.toISOString(), serverTime: now.toISOString() };
    });
  }
  /** The row claim serializes manual submit, deadline submit, autosave, and marking. */
  private async finalizeAttempt(id: string, source: 'manual' | 'deadline', key?: string) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id = ${id} FOR UPDATE`;
        const initial = await tx.examAttempt.findUnique({
          where: { id },
          include: { exam: { include: { snapshot: { include: { items: true } } } } },
        });
        if (!initial) throw new NotFoundException('答卷不存在');
        if (initial.status !== 'in_progress') return initial;
        if (source === 'deadline' && initial.deadlineAt > new Date()) return initial;
        const timedOut = initial.deadlineAt <= new Date();
        const changed = await tx.examAttempt.updateMany({
          where: { id, status: 'in_progress' },
          data: {
            status: timedOut ? 'timed_out' : 'submitted',
            submittedAt: new Date(),
            submissionKey: key ?? `deadline:${id}`,
            revision: { increment: 1 },
          },
        });
        if (!changed.count) return tx.examAttempt.findUniqueOrThrow({ where: { id } });
        const answers = await tx.examAnswer.findMany({ where: { attemptId: id } });
        let total = 0;
        let complete = true;
        for (const item of initial.exam.snapshot?.items ?? []) {
          const existing = answers.find((answer) => answer.questionVersionId === item.questionVersionId);
          const score = autoScore(content(item.content), existing?.value);
          if (score === null) complete = false;
          else total += score;
          await tx.examAnswer.upsert({
            where: {
              attemptId_questionVersionId: { attemptId: id, questionVersionId: item.questionVersionId },
            },
            create: {
              attemptId: id,
              questionVersionId: item.questionVersionId,
              value: json(existing?.value),
              scoreCents: score,
              graded: score !== null,
            },
            update: { scoreCents: score, graded: score !== null },
          });
        }
        await tx.auditLog.create({
          data: {
            organizationId: initial.exam.organizationId,
            userId: source === 'manual' ? initial.userId : null,
            action: timedOut ? 'exam.timeout_submit' : 'exam.submit',
            resourceType: 'ExamAttempt',
            resourceId: id,
            details: { source, number: initial.number },
          },
        });
        return tx.examAttempt.update({
          where: { id },
          data: { gradingStatus: complete ? 'graded' : 'pending', scoreCents: complete ? total : null },
        });
      },
      { timeout: 20000 },
    );
  }
  async submitExam(actor: Actor, id: string, key: string) {
    this.require(actor, 'learning.use');
    const attempt = await this.attemptAccess(actor, id);
    if (attempt.userId !== actor.id) throw new ForbiddenException('只能提交本人答卷');
    if (attempt.status === 'cancelled') throw new ConflictException('考试或个人资格已取消');
    await this.finalizeAttempt(id, 'manual', key);
    return this.attempt(actor, id);
  }
  async sweepDueAttempts() {
    if (this.running) return;
    this.running = true;
    let runId: string | undefined;
    try {
      const now = Date.now();
      for (const [id, retryAt] of this.deadlineRetries) if (retryAt <= now) this.deadlineRetries.delete(id);
      const due = await this.db.examAttempt.findMany({
        where: {
          status: 'in_progress',
          deadlineAt: { lte: new Date() },
          id: { notIn: [...this.deadlineRetries.keys()] },
        },
        select: { id: true },
        orderBy: [{ deadlineAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
      if (!due.length) return;
      const run = await this.db.assessmentJobRun.create({
        data: { type: 'exam_deadline', status: 'running' },
      });
      runId = run.id;
      let processed = 0;
      const failed: string[] = [];
      for (const attempt of due) {
        try {
          await this.finalizeAttempt(attempt.id, 'deadline');
          processed++;
          this.deadlineRetries.delete(attempt.id);
        } catch {
          failed.push(attempt.id);
          this.deadlineRetries.set(attempt.id, Date.now() + 60000);
          this.logger.error(`答卷到期交卷失败，已隔离并将在一分钟后重试: ${attempt.id}`);
        }
      }
      await this.db.assessmentJobRun.update({
        where: { id: run.id },
        data: {
          status: failed.length ? 'failed' : 'completed',
          processed,
          error: failed.length ? JSON.stringify({ failedAttemptIds: failed, retryAfterMs: 60000 }) : null,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error('到期交卷任务失败，将在下轮从未完成答卷恢复');
      if (runId)
        await this.db.assessmentJobRun
          .update({
            where: { id: runId },
            data: {
              status: 'failed',
              error: error instanceof Error ? error.name : 'UnknownError',
              completedAt: new Date(),
            },
          })
          .catch(() => undefined);
    } finally {
      this.running = false;
    }
  }

  async examAttempts(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, 'assessment.grade');
    this.requireExamGrader(actor, await this.examAccess(actor, id));
    const p = paginate(query);
    const where = { examId: id, ...(query.status ? { gradingStatus: query.status } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.examAttempt.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.examAttempt.count({ where }),
    ]);
    const users = await this.db.user.findMany({
      where: { id: { in: unique(items.map((a) => a.userId)) } },
      select: { id: true, name: true, username: true },
    });
    return {
      items: items.map((attempt) => ({ ...attempt, user: users.find((u) => u.id === attempt.userId) })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  async examRoster(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, 'assessment.grade');
    const exam = await this.examAccess(actor, id);
    this.requireExamGrader(actor, exam);
    const p = paginate(query);
    const audience = exam.audience.sort((a, b) => a.userId.localeCompare(b.userId));
    const page = audience.slice(p.skip, p.skip + p.take);
    const users = await this.db.user.findMany({
      where: { id: { in: page.map((a) => a.userId) } },
      select: { id: true, name: true, username: true },
    });
    const attempts = await this.db.examAttempt.findMany({
      where: { examId: id, userId: { in: page.map((a) => a.userId) } },
      orderBy: { number: 'desc' },
    });
    return {
      items: page.map((a) => {
        const attempt = attempts.find((row) => row.userId === a.userId);
        return {
          user: users.find((u) => u.id === a.userId),
          eligible: a.eligible,
          reason: a.reason,
          attempt,
          status: !a.eligible
            ? 'cancelled'
            : (attempt?.status ?? (new Date() >= exam.endsAt ? 'absent' : 'not_started')),
        };
      }),
      total: audience.length,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  async examItemAnalysis(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    if (this.student(actor)) throw new ForbiddenException('学生不能访问考试内部题目分析');
    this.require(actor, 'assessment.grade');
    const administrator = ['ADMIN', 'SUPER_ADMIN'].includes(actor.role);
    if (administrator && !actor.permissions.includes('analysis.sensitive'))
      throw new ForbiddenException('未获教学统计敏感授权');
    const exam = await this.examAccess(actor, id);
    this.requireExamGrader(actor, exam);
    const page = paginate({ ...query, pageSize: Math.min(query.pageSize ?? 20, 50) });
    const allItems = exam.snapshot?.items ?? [];
    const items = allItems.slice(page.skip, page.skip + page.take);
    const report = await this.db.$transaction(
      async (tx) => {
        // Select the last *finished* attempt, so a later in-progress retake never hides a submission.
        const [counts] = await tx.$queryRaw<{ participantCount: number; submittedAttemptCount: number }[]>`
          SELECT COUNT(DISTINCT "userId")::integer AS "participantCount",
            COUNT(*)::integer AS "submittedAttemptCount"
          FROM "ExamAttempt" WHERE "examId" = ${id} AND status IN ('submitted', 'timed_out')`;
        const accumulators = new Map(
          items.map((item) => [
            item.questionVersionId,
            itemAccumulator(content(item.content), counts.participantCount),
          ]),
        );
        if (counts.participantCount && items.length) {
          let cursor: string | undefined;
          for (;;) {
            const answers: {
              id: string;
              questionVersionId: string;
              value: Prisma.JsonValue;
              scoreCents: number | null;
              graded: boolean;
            }[] = await tx.$queryRaw`
              WITH latest AS (
                SELECT DISTINCT ON ("userId") id FROM "ExamAttempt"
                WHERE "examId" = ${id} AND status IN ('submitted', 'timed_out')
                ORDER BY "userId", number DESC
              )
              SELECT a.id, a."questionVersionId", a.value, a."scoreCents", a.graded
              FROM "ExamAnswer" a JOIN latest ON latest.id = a."attemptId"
              WHERE a."questionVersionId" IN (${Prisma.join(items.map((item) => item.questionVersionId))})
                AND ${cursor ? Prisma.sql`a.id > ${cursor}` : Prisma.sql`TRUE`}
              ORDER BY a.id ASC LIMIT 1000`;
            for (const answer of answers) accumulators.get(answer.questionVersionId)!.add(answer);
            if (answers.length < 1000) break;
            cursor = answers[answers.length - 1].id;
          }
        }
        return {
          ...counts,
          items: items.map((item) => {
            const question = content(item.content);
            return {
              questionVersionId: item.questionVersionId,
              position: item.position,
              type: question.type,
              stem: question.stem,
              scoreCents: question.scoreCents,
              ...accumulators.get(item.questionVersionId)!.result(),
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
    if (administrator)
      await this.auditEvent(actor, 'analysis.sensitive.read', 'Exam', id, { report: 'item-analysis' });
    return {
      exam: { id: exam.id, title: exam.title, status: exam.status },
      ...report,
      total: allItems.length,
      page: page.page,
      pageSize: page.pageSize,
      attemptPolicy: 'latest_finished_per_student',
      smallSample: report.participantCount < 5,
      generatedAt: new Date().toISOString(),
      rules: [
        ...(exam.status === 'cancelled'
          ? ['本考试已取消；以下仅为历史交卷的描述性数据，不代表当前有效测验结果。']
          : []),
        '每人取最近一次已交卷或超时交卷；正在作答和取消的答卷不计入。保留本考试的历史交卷群体。',
        '作答人数不含空答；客观完全正确率以本题参考人数为分母，空答计为未答对，部分得分不算完全正确。',
        '平均得分及得分率只统计本题已评分答案，待批阅不计零分。综合题按整题统计。',
        '选项频次以本题参考人数为分母；多选同一选项只计一次，各选项比例之和可以超过100%。',
        '正确率按考试固定答案与评分规则计算；平均得分使用当前题目评分。总分复核调整不分摊至各题。',
        '不足5人时标记小样本，仅展示描述性结果，不据此判定题目质量。',
      ],
    };
  }

  async examQuestionAnswers(
    actor: Actor,
    id: string,
    questionVersionId: string,
    query: z.infer<typeof schema.listSchema>,
  ) {
    this.require(actor, 'assessment.grade');
    const exam = await this.examAccess(actor, id);
    this.requireExamGrader(actor, exam);
    const snapshotItem = exam.snapshot?.items.find((item) => item.questionVersionId === questionVersionId);
    if (!snapshotItem) throw new NotFoundException('此题不属于该考试的固定试卷');
    const p = paginate(query);
    const where: Prisma.ExamAttemptWhereInput = {
      examId: id,
      status: { in: ['submitted', 'timed_out'] },
      ...(query.status ? { gradingStatus: query.status } : {}),
    };
    const [attempts, total] = await this.db.$transaction([
      this.db.examAttempt.findMany({
        where,
        select: {
          id: true,
          userId: true,
          number: true,
          status: true,
          submittedAt: true,
          gradingStatus: true,
          gradingRevision: true,
          releaseStatus: true,
          answers: { where: { questionVersionId } },
        },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.examAttempt.count({ where }),
    ]);
    const users = await this.db.user.findMany({
      where: { id: { in: unique(attempts.map((attempt) => attempt.userId)) } },
      select: { id: true, name: true, username: true },
    });
    const question = content(snapshotItem.content);
    return {
      exam: { id: exam.id, title: exam.title, status: exam.status },
      question: { ...publicQuestion(question, true, true), rules: question.rules },
      items: attempts.map(({ answers, ...attempt }) => ({
        ...attempt,
        user: users.find((user) => user.id === attempt.userId),
        answer: answers[0] ?? null,
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  async gradeAttempt(actor: Actor, id: string, input: z.infer<typeof schema.examGradeSchema>) {
    this.require(actor, 'assessment.grade');
    const attempt = await this.attemptAccess(actor, id, true);
    if (!['submitted', 'timed_out'].includes(attempt.status))
      throw new ConflictException('只能批阅已提交答卷');
    if (attempt.releaseStatus === 'released')
      throw new ConflictException('成绩已发布，改分须使用复核流程并具备独立改分授权');
    const questions = (attempt.exam.snapshot?.items ?? []).map((item) => content(item.content));
    this.validateAnswers(
      input.items.map((item) => ({ questionVersionId: item.questionVersionId, value: item.scoreCents })),
      questions.map((q) => q.id),
    );
    input.items.forEach((item) => {
      if (item.scoreCents > questions.find((q) => q.id === item.questionVersionId)!.scoreCents)
        throw new BadRequestException('得分不能超过题目满分');
    });
    await this.db.$transaction(async (tx) => {
      const changed = await tx.examAttempt.updateMany({
        where: {
          id,
          gradingRevision: input.revision,
          releaseStatus: 'hidden',
          status: { in: ['submitted', 'timed_out'] },
        },
        data: { gradingRevision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('批阅版本已变化，请刷新，不能覆盖其他教师的批阅');
      for (const item of input.items)
        await tx.examAnswer.update({
          where: {
            attemptId_questionVersionId: { attemptId: id, questionVersionId: item.questionVersionId },
          },
          data: { scoreCents: item.scoreCents, comment: item.comment, graded: true },
        });
      const answers = await tx.examAnswer.findMany({ where: { attemptId: id } });
      const complete = answers.length === questions.length && answers.every((a) => a.graded);
      await tx.examAttempt.update({
        where: { id },
        data: {
          gradingStatus: complete ? 'graded' : 'pending',
          scoreCents: complete ? answers.reduce((sum, answer) => sum + (answer.scoreCents ?? 0), 0) : null,
          feedback: input.comment ?? attempt.feedback,
        },
      });
      await tx.gradingRecord.create({
        data: {
          attemptId: id,
          graderId: actor.id,
          revision: input.revision + 1,
          items: json(input.items),
          comment: input.comment ?? attempt.feedback,
        },
      });
    });
    await this.auditEvent(actor, 'exam.grade', 'ExamAttempt', id, {
      gradingRevision: input.revision + 1,
      markedQuestions: input.items.length,
    });
    return this.attempt(actor, id);
  }
  async releaseExam(actor: Actor, id: string) {
    this.require(actor, 'assessment.grade');
    const exam = await this.examAccess(actor, id);
    this.requireExamGrader(actor, exam);
    await this.scoped(actor, exam.courseId, true);
    if (exam.status !== 'published') throw new ConflictException('只能发布有效考试的成绩');
    if (new Date() < exam.endsAt) throw new ConflictException('考试窗口尚未结束，不能统一发布');
    await this.sweepDueAttempts();
    const result = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `exam-lifecycle:${id}`);
      const current = await tx.exam.findUniqueOrThrow({ where: { id } });
      this.requireExamGrader(actor, current);
      if (current.status !== 'published' || new Date() < current.endsAt)
        throw new ConflictException('考试已取消或窗口尚未结束，不能统一发布');
      if (current.gradesReleasedAt)
        return { released: 0, releasedAt: current.gradesReleasedAt, visibleAt: current.scoreReleaseAt };
      if (
        await tx.examAttempt.count({
          where: {
            examId: id,
            OR: [
              { status: 'in_progress' },
              { status: { in: ['submitted', 'timed_out'] }, gradingStatus: { not: 'graded' } },
            ],
          },
        })
      )
        throw new ConflictException('仍有作答中或未完成阅卷的答卷');
      const releasedAt = new Date();
      const released = await tx.examAttempt.updateMany({
        where: {
          examId: id,
          status: { in: ['submitted', 'timed_out'] },
          gradingStatus: 'graded',
          releaseStatus: 'hidden',
        },
        data: { releaseStatus: 'released' },
      });
      await tx.exam.update({
        where: { id },
        data: {
          gradesReleasedAt: releasedAt,
          scoreReleaseAt: exam.scoreReleaseAt ?? releasedAt,
          commentReleaseAt: exam.commentReleaseAt ?? exam.scoreReleaseAt ?? releasedAt,
        },
      });
      return { released: released.count, releasedAt, visibleAt: exam.scoreReleaseAt ?? releasedAt };
    });
    await this.auditEvent(actor, 'exam.release', 'Exam', id, result);
    await this.notify(
      actor,
      exam.audience.filter((a) => a.eligible).map((a) => a.userId),
      'grade',
      '考试成绩已发布',
      `${exam.title}，请在公开时间后查看`,
      `/exams/${id}`,
      `exam:${id}:grades-released`,
    );
    return result;
  }
  async extendExam(actor: Actor, id: string, input: z.infer<typeof schema.extensionSchema>) {
    const exam = await this.examAccess(actor, id, true);
    if (exam.status !== 'published' || exam.gradesReleasedAt)
      throw new ConflictException('仅未发布成绩的有效考试支持延时或补考');
    if (!exam.audience.some((a) => a.userId === input.userId && a.eligible))
      throw new BadRequestException('学生不具备考试资格');
    if (input.deadlineAt <= new Date()) throw new BadRequestException('延时截止必须晚于当前时间');
    const disclosureTimes = [
      exam.scoreReleaseAt,
      exam.answerReleaseAt,
      exam.explanationReleaseAt,
      exam.commentReleaseAt,
    ].filter((d): d is Date => Boolean(d));
    if (disclosureTimes.some((date) => input.deadlineAt > date))
      throw new ConflictException('延时不能超过已安排的成绩、答案、解析或评语公开时间，以免泄题；请另建补考');
    const extension = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `exam-lifecycle:${id}`);
      const current = await tx.exam.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'published' || current.gradesReleasedAt)
        throw new ConflictException('考试已取消或成绩已发布');
      const audience = await tx.examAudience.findUnique({
        where: { examId_userId: { examId: id, userId: input.userId } },
      });
      if (!audience?.eligible) throw new ForbiddenException('学生参考资格已撤销');
      const active = await tx.examAttempt.findFirst({
        where: { examId: id, userId: input.userId, status: 'in_progress' },
      });
      if (active && input.deadlineAt <= active.deadlineAt)
        throw new BadRequestException('延时不能缩短已有考试截止时间');
      const result = await tx.examExtension.upsert({
        where: { examId_userId: { examId: id, userId: input.userId } },
        create: { ...input, examId: id, approvedBy: actor.id },
        update: { ...input, approvedBy: actor.id },
      });
      await tx.examAttempt.updateMany({
        where: { examId: id, userId: input.userId, status: 'in_progress' },
        data: { deadlineAt: input.deadlineAt, revision: { increment: 1 } },
      });
      return result;
    });
    await this.auditEvent(actor, 'exam.extension', 'Exam', id, input);
    await this.notify(
      actor,
      [input.userId],
      'exam',
      '考试个别安排已更新',
      input.reason,
      `/exams/${id}`,
      `exam-extension:${extension.id}:${extension.deadlineAt.toISOString()}`,
    );
    return extension;
  }
  async eligibility(actor: Actor, id: string, input: z.infer<typeof schema.eligibilitySchema>) {
    await this.examAccess(actor, id, true);
    const result = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `exam-lifecycle:${id}`);
      const row = await tx.examAudience.findUnique({
        where: { examId_userId: { examId: id, userId: input.userId } },
      });
      if (!row) throw new NotFoundException('参考对象不存在');
      if (!input.eligible)
        await tx.examAttempt.updateMany({
          where: { examId: id, userId: input.userId, status: 'in_progress' },
          data: { status: 'cancelled', revision: { increment: 1 } },
        });
      return tx.examAudience.update({
        where: { id: row.id },
        data: { eligible: input.eligible, reason: input.reason },
      });
    });
    await this.auditEvent(actor, 'exam.eligibility', 'Exam', id, input);
    return result;
  }
  async appeal(actor: Actor, id: string, reason: string) {
    this.require(actor, 'learning.use');
    const attempt = await this.attemptAccess(actor, id);
    if (attempt.userId !== actor.id) throw new ForbiddenException('只能申请复核本人成绩');
    if (
      attempt.releaseStatus !== 'released' ||
      !attempt.exam.scoreReleaseAt ||
      attempt.exam.scoreReleaseAt > new Date()
    )
      throw new ConflictException('成绩尚未公开');
    if (attempt.exam.appealDeadline && attempt.exam.appealDeadline < new Date())
      throw new ConflictException('已超过成绩复核期限');
    const appeal = await this.db.gradeAppeal.upsert({
      where: { attemptId_userId: { attemptId: id, userId: actor.id } },
      create: { attemptId: id, userId: actor.id, reason },
      update: {},
    });
    await this.auditEvent(actor, 'grade.appeal', 'GradeAppeal', appeal.id);
    return appeal;
  }
  async appeals(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.require(actor, this.student(actor) ? 'learning.use' : 'assessment.grade');
    const ids = await this.auth.courseIds(actor);
    if (query.courseId) await this.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = {
      ...(this.student(actor) ? { userId: actor.id } : {}),
      ...(query.status ? { status: query.status } : {}),
      attempt: {
        exam: {
          organizationId: actor.organizationId,
          courseId: query.courseId ?? { in: ids },
          ...(this.student(actor)
            ? {}
            : { OR: [{ graderIds: { isEmpty: true } }, { graderIds: { has: actor.id } }] }),
        },
      },
    };
    const [items, total] = await this.db.$transaction([
      this.db.gradeAppeal.findMany({
        where,
        include: {
          attempt: {
            select: {
              id: true,
              scoreCents: true,
              exam: { select: { id: true, title: true, courseId: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.gradeAppeal.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  async resolveAppeal(actor: Actor, id: string, input: z.infer<typeof schema.resolveSchema>) {
    this.require(actor, 'assessment.grade');
    const appeal = await this.db.gradeAppeal.findUnique({ where: { id } });
    if (!appeal) throw new NotFoundException('复核申请不存在');
    const attempt = await this.attemptAccess(actor, appeal.attemptId, true);
    if (input.scoreCents !== undefined) this.require(actor, 'grade.revise');
    if (input.scoreCents !== undefined && input.scoreCents > attempt.exam.totalCents)
      throw new BadRequestException('复核总分不能超过试卷满分');
    const result = await this.db.$transaction(async (tx) => {
      await this.lock(tx, `grade-revision:${attempt.id}`);
      const changed = await tx.gradeAppeal.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'resolved',
          resolution: input.resolution,
          resolvedBy: actor.id,
          resolvedAt: new Date(),
        },
      });
      if (!changed.count) throw new ConflictException('此申请已经处理');
      if (input.scoreCents !== undefined) {
        const current = await tx.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        if (
          current.gradingStatus !== 'graded' ||
          current.scoreCents === null ||
          current.releaseStatus !== 'released'
        )
          throw new ConflictException('答卷还没有已发布的正式成绩');
        await tx.gradeRevision.create({
          data: {
            attemptId: attempt.id,
            actorId: actor.id,
            oldScoreCents: current.scoreCents,
            newScoreCents: input.scoreCents,
            reason: input.resolution,
            appealId: id,
          },
        });
        await tx.examAttempt.update({
          where: { id: attempt.id },
          data: { scoreCents: input.scoreCents, gradingRevision: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.id,
            action: 'grade.revise',
            resourceType: 'ExamAttempt',
            resourceId: attempt.id,
            details: {
              appealId: id,
              oldScoreCents: current.scoreCents,
              newScoreCents: input.scoreCents,
              reason: input.resolution,
            },
          },
        });
      }
      return tx.gradeAppeal.findUniqueOrThrow({ where: { id } });
    });
    await this.auditEvent(actor, 'grade.appeal.resolve', 'GradeAppeal', id, {
      changedScore: input.scoreCents !== undefined,
    });
    await this.notify(
      actor,
      [appeal.userId],
      'grade',
      '成绩复核已处理',
      input.resolution,
      `/attempts/${attempt.id}`,
      `appeal:${id}:resolved`,
    );
    return result;
  }
  async gradeHistory(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    const attempt = await this.attemptAccess(actor, id);
    if (
      this.student(actor) &&
      (attempt.releaseStatus !== 'released' ||
        !attempt.exam.scoreReleaseAt ||
        attempt.exam.scoreReleaseAt > new Date())
    )
      throw new ForbiddenException('成绩尚未公开');
    const p = paginate(query);
    const [items, total] = await this.db.$transaction([
      this.db.gradeRevision.findMany({
        where: { attemptId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.db.gradeRevision.count({ where: { attemptId: id } }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
}
