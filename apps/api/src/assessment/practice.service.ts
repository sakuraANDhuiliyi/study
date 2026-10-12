import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor } from '../auth/auth.guard';
import { AssessmentContext } from './assessment-context';
import { content, json, questionInclude, secureShuffle, unique } from './assessment-values';
import * as schema from './assessment.schemas';
import { QuestionSelectionService } from './question-selection.service';
import { autoScore, paginate, publicQuestion, QuestionData } from './scoring';

@Injectable()
export class PracticeService {
  constructor(
    private readonly context: AssessmentContext,
    private readonly selection: QuestionSelectionService,
  ) {}

  async createPractice(actor: Actor, input: z.infer<typeof schema.practiceSchema>) {
    this.context.require(actor, 'learning.use');
    await this.context.scoped(actor, input.courseId);
    const matching = await this.selection.sampleVersions(actor, input.courseId, {
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
    const session = await this.context.db.practiceSession.create({
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
    this.context.require(actor, 'learning.use');
    const ids = await this.context.auth.courseIds(actor);
    if (query.courseId) await this.context.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = { userId: actor.id, courseId: query.courseId ?? { in: ids } };
    const [items, total] = await this.context.db.$transaction([
      this.context.db.practiceSession.findMany({
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
      this.context.db.practiceSession.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  private async practiceAccess(actor: Actor, id: string) {
    this.context.require(actor, 'learning.use');
    const session = await this.context.db.practiceSession.findFirst({
      where: { id, userId: actor.id, organizationId: actor.organizationId },
      include: { answers: true },
    });
    if (!session) throw new NotFoundException('练习不存在');
    await this.context.scoped(actor, session.courseId);
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
    const saved = await this.context.db.practiceSession.updateMany({
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
    this.context.validateAnswerValues([input], [question]);
    const current = await this.context.db.question.findUnique({ where: { id: question.questionId } });
    if (!current?.practiceEnabled) throw new ForbiddenException('题目已停止开放练习');
    const score = autoScore(question, input.value);
    const correct = score === null ? null : score === question.scoreCents;
    const answer = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `practice:${id}`);
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
    const answers = await this.context.db.practiceAnswer.findMany({ where: { sessionId: id } });
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
    this.context.require(actor, 'learning.use');
    const courses = await this.context.auth.courseIds(actor);
    if (query.courseId) await this.context.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = { userId: actor.id, courseId: query.courseId ?? { in: courses } };
    const [rows, total] =
      type === 'mistakes'
        ? await this.context.db.$transaction([
            this.context.db.mistakeRecord.findMany({
              where,
              orderBy: [{ lastAnsweredAt: 'desc' }, { id: 'desc' }],
              skip: p.skip,
              take: p.take,
            }),
            this.context.db.mistakeRecord.count({ where }),
          ])
        : await this.context.db.$transaction([
            this.context.db.questionFavorite.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: p.skip,
              take: p.take,
            }),
            this.context.db.questionFavorite.count({ where }),
          ]);
    const questions = await this.context.db.question.findMany({
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
    this.context.require(actor, 'learning.use');
    const q = await this.context.db.question.findFirst({
      where: { id, organizationId: actor.organizationId, practiceEnabled: true, active: true },
    });
    if (!q) throw new NotFoundException('开放练习题目不存在');
    await this.context.scoped(actor, q.courseId);
    if (favorite)
      return this.context.db.questionFavorite.upsert({
        where: { userId_questionId: { userId: actor.id, questionId: id } },
        create: { userId: actor.id, courseId: q.courseId, questionId: id },
        update: {},
      });
    await this.context.db.questionFavorite.deleteMany({ where: { userId: actor.id, questionId: id } });
    return { favorite: false };
  }

  async masterMistake(actor: Actor, id: string, mastered: boolean) {
    this.context.require(actor, 'learning.use');
    const mistake = await this.context.db.mistakeRecord.findFirst({ where: { id, userId: actor.id } });
    if (!mistake) throw new NotFoundException('错题记录不存在');
    await this.context.scoped(actor, mistake.courseId);
    return this.context.db.mistakeRecord.update({ where: { id }, data: { mastered } });
  }
}
