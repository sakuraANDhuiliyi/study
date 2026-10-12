import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Actor } from '../auth/auth.guard';
import { AssessmentContext } from './assessment-context';
import { content, itemInclude, json, questionInclude, secureShuffle } from './assessment-values';
import * as schema from './assessment.schemas';
import { QuestionSelectionService } from './question-selection.service';
import { paginate, publicQuestion, QuestionData } from './scoring';

@Injectable()
export class QuestionBankService {
  constructor(
    private readonly context: AssessmentContext,
    private readonly selection: QuestionSelectionService,
  ) {}

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

  async questions(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.context.require(actor, 'question.manage');
    const courses = await this.context.auth.courseIds(actor);
    if (query.courseId) await this.context.scoped(actor, query.courseId);
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
    const [items, total] = await this.context.db.$transaction([
      this.context.db.question.findMany({
        where,
        include: questionInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.question.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async exportQuestions(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.context.require(actor, 'question.manage');
    const page = await this.questions(actor, query);
    await this.context.auditEvent(actor, 'question.export', 'Question', 'page', {
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
    this.context.require(actor, 'question.manage');
    await this.context.scoped(actor, courseId, true);
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
    const student = this.context.student(actor);
    this.context.require(actor, student ? 'learning.use' : 'question.manage');
    const q = await this.context.db.question.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: questionInclude,
    });
    if (!q) throw new NotFoundException('题目不存在');
    await this.context.scoped(actor, q.courseId);
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
    this.context.require(actor, 'question.manage');
    await this.context.scoped(actor, input.courseId, true);
    if (
      input.chapterId &&
      !(await this.context.db.chapter.findFirst({ where: { id: input.chapterId, courseId: input.courseId } }))
    )
      throw new BadRequestException('章节不属于课程');
    this.validateContent(content(input));
    const { courseId, chapterId, scope, practiceEnabled, ...version } = input;
    const q = await this.context.db.question.create({
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
    await this.context.auditEvent(actor, 'question.create', 'Question', q.id);
    return q;
  }

  async updateQuestion(actor: Actor, id: string, input: z.infer<typeof schema.questionPatchSchema>) {
    this.context.require(actor, 'question.manage');
    const q = await this.question(actor, id);
    await this.context.scoped(actor, q.courseId, true);
    if (!('creatorId' in q) || q.creatorId !== actor.id)
      throw new ForbiddenException('只能修改本人创建的题目，可复制共享题目后编辑');
    if (input.courseId && input.courseId !== q.courseId) throw new BadRequestException('题目不能迁移课程');
    if (input.practiceEnabled) await this.selection.assertNoUnreleasedExam([id]);
    if (
      input.chapterId &&
      !(await this.context.db.chapter.findFirst({ where: { id: input.chapterId, courseId: q.courseId } }))
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
    const updated = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `question:${id}`);
      if (input.practiceEnabled) await this.selection.assertNoUnreleasedExam([id], tx);
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
    await this.context.auditEvent(actor, 'question.version', 'Question', id, {
      oldVersion: input.expectedVersion,
      newVersion: updated.currentVersion,
    });
    return updated;
  }

  async questionVersions(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    this.context.require(actor, 'question.manage');
    await this.question(actor, id);
    const p = paginate(query);
    const [items, total] = await this.context.db.$transaction([
      this.context.db.questionVersion.findMany({
        where: { questionId: id },
        orderBy: { version: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.questionVersion.count({ where: { questionId: id } }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async copyQuestion(actor: Actor, id: string) {
    this.context.require(actor, 'question.manage');
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
    this.context.require(actor, 'question.manage');
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
        await this.context.scoped(actor, parsed.data.courseId, true);
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
      await this.context.db.$transaction(
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
    this.context.require(actor, 'assessment.manage');
    const ids = await this.context.auth.courseIds(actor);
    if (query.courseId) await this.context.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = {
      organizationId: actor.organizationId,
      creatorId: actor.id,
      courseId: query.courseId ?? { in: ids },
      ...(query.search ? { title: { contains: query.search } } : {}),
    };
    const [items, total] = await this.context.db.$transaction([
      this.context.db.paper.findMany({
        where,
        include: { items: { include: itemInclude, orderBy: { position: 'asc' } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.paper.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async createPaper(actor: Actor, input: z.infer<typeof schema.paperSchema>) {
    this.context.require(actor, 'assessment.manage');
    await this.context.scoped(actor, input.courseId, true);
    let ids = input.questionVersionIds;
    if (input.rule) {
      const rule = input.rule;
      const pool = await this.selection.sampleVersions(actor, input.courseId, { ...rule, owned: true });
      if (pool.length < rule.count)
        throw new BadRequestException(`符合规则的题目不足：需要 ${rule.count} 道，仅有 ${pool.length} 道`);
      ids = secureShuffle(pool)
        .slice(0, rule.count)
        .map((q) => q.id);
    }
    const versions = await this.selection.versionSelection(actor, input.courseId, ids);
    return this.context.db.paper.create({
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
}
