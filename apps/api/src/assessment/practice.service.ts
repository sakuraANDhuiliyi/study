import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
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

  private async scoped<T>(
    actor: Actor,
    key: string,
    run: (service: PracticeService, current: Actor) => Promise<T>,
  ) {
    return this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, key);
      const db = tx as PrismaService,
        auth = new AuthService(db);
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
        current.clientType !== actor.clientType
      )
        throw new UnauthorizedException('会话或身份已变化，请重新登录');
      auth.require(current, 'learning.use');
      await auth.checkFeature(current, '/api/practice');
      const context = new AssessmentContext(db, auth, new AuditService(db));
      return run(new PracticeService(context, new QuestionSelectionService(context)), current);
    });
  }
  createPractice(actor: Actor, input: z.infer<typeof schema.practiceSchema>, mobileKey?: string) {
    return this.scoped(actor, 'practice-create:' + actor.id, (s, a) => s.createInside(a, input, mobileKey));
  }
  practices(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    return this.scoped(actor, 'practice-list:' + actor.id, (s, a) => s.listInside(a, query));
  }
  practice(actor: Actor, id: string) {
    return this.scoped(actor, 'practice:' + id, (s, a) => s.readInside(a, id));
  }
  savePracticeProgress(actor: Actor, id: string, input: z.infer<typeof schema.practiceProgressSchema>) {
    return this.scoped(actor, 'practice:' + id, (s, a) => s.progressInside(a, id, input));
  }
  answerPractice(actor: Actor, id: string, input: z.infer<typeof schema.answerSchema>) {
    return this.scoped(actor, 'practice:' + id, (s, a) => s.answerInside(a, id, input));
  }

  mobileCreate(actor: Actor, input: z.infer<typeof schema.practiceSchema>, key: string) {
    return this.scoped(actor, 'practice-create:' + actor.id, async (s, a) => {
      const d = await s.createInside(a, input, key);
      return s.mobileInside(a, d.id);
    });
  }
  mobileRead(actor: Actor, id: string) {
    return this.scoped(actor, 'practice:' + id, (s, a) => s.mobileInside(a, id));
  }
  mobileAnswer(actor: Actor, id: string, input: z.infer<typeof schema.answerSchema>) {
    return this.scoped(actor, 'practice:' + id, async (s, a) => {
      await s.answerInside(a, id, input);
      return s.mobileInside(a, id);
    });
  }
  private async mobileInside(actor: Actor, id: string) {
    const d = await this.readInside(actor, id);
    const questions = d.items as Record<string, any>[];
    const available = await this.context.db.question.findMany({
      where: {
        id: { in: questions.map((q) => q.questionId) },
        organizationId: actor.organizationId,
        courseId: d.courseId,
        practiceEnabled: true,
        active: true,
      },
      select: { id: true },
    });
    const allowed = new Set(
      questions.filter((q) => available.some((row) => row.id === q.questionId)).map((q) => q.id),
    );
    const course = await this.context.scoped(actor, d.courseId);
    return {
      ...d,
      courseTitle: course.title,
      items: questions.map((q) =>
        allowed.has(q.id)
          ? { ...q, available: true }
          : {
              id: q.id,
              type: q.type,
              available: false,
              stem: '该题已停止开放练习',
              options: [],
              children: [],
              scoreCents: 0,
            },
      ),
      answers: d.answers
        .filter((a) => allowed.has(a.questionVersionId))
        .map((a) => ({
          questionVersionId: a.questionVersionId,
          value: a.value,
          scoreCents: a.scoreCents,
          correct: a.correct,
          answeredAt: a.answeredAt,
        })),
    };
  }

  private async createInside(actor: Actor, input: z.infer<typeof schema.practiceSchema>, mobileKey?: string) {
    this.context.require(actor, 'learning.use');
    await this.context.scoped(actor, input.courseId);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (mobileKey) {
      const prior = await this.context.db.practiceSession.findUnique({
        where: { userId_mobileCreateKey: { userId: actor.id, mobileCreateKey: mobileKey } },
      });
      if (prior) {
        if (prior.organizationId !== actor.organizationId || prior.mobileCreateHash !== requestHash)
          throw new ConflictException('创建标识已用于其他练习条件，请先核对最近练习');
        return this.readInside(actor, prior.id);
      }
    }
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
        ...(mobileKey ? { mobileCreateKey: mobileKey, mobileCreateHash: requestHash } : {}),
      },
    });
    return this.readInside(actor, session.id);
  }

  private async listInside(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.context.require(actor, 'learning.use');
    const ids = await this.context.auth.courseIds(actor);
    if (query.courseId) await this.context.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = {
      organizationId: actor.organizationId,
      userId: actor.id,
      courseId: query.courseId ?? { in: ids },
      ...(['active', 'completed'].includes(query.status || '') ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
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

  private async readInside(actor: Actor, id: string) {
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

  private async progressInside(
    actor: Actor,
    id: string,
    input: z.infer<typeof schema.practiceProgressSchema>,
  ) {
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

  private async answerInside(actor: Actor, id: string, input: z.infer<typeof schema.answerSchema>) {
    const session = await this.practiceAccess(actor, id);
    const questions = session.snapshot as unknown as QuestionData[];
    const question = questions.find((q) => q.id === input.questionVersionId);
    if (!question) throw new BadRequestException('题目不属于本次练习');
    this.context.validateAnswerValues([input], [question]);
    const current = await this.context.db.question.findUnique({ where: { id: question.questionId } });
    if (
      !current?.practiceEnabled ||
      !current.active ||
      current.organizationId !== actor.organizationId ||
      current.courseId !== session.courseId
    )
      throw new ForbiddenException('题目已停止开放练习');
    const score = autoScore(question, input.value);
    const correct = score === null ? null : score === question.scoreCents;
    const answer = await (async () => {
      const tx = this.context.db;
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
    })();
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
