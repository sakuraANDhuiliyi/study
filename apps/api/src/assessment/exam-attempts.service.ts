import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor } from '../auth/auth.guard';
import { AssessmentContext } from './assessment-context';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { content, json, secureShuffle, type Tx } from './assessment-values';
import * as schema from './assessment.schemas';
import { ExamAccessService } from './exam-access.service';
import { autoScore, personalDeadline, publicQuestion } from './scoring';

@Injectable()
export class ExamAttemptsService {
  constructor(
    private readonly context: AssessmentContext,
    private readonly access: ExamAccessService,
  ) {}

  /** Recheck session and course on the locked transaction connection, including queued requests. */
  private async currentWriter(actor: Actor, courseId: string, tx: Tx) {
    const auth = new AuthService(tx as PrismaService);
    const fresh = actor.sessionId ? await auth.resolveSessionId(actor.sessionId) : null;
    if (
      !fresh ||
      fresh.id !== actor.id ||
      fresh.role !== actor.role ||
      fresh.organizationId !== actor.organizationId ||
      fresh.clientType !== actor.clientType ||
      fresh.csrfToken !== actor.csrfToken
    )
      throw new UnauthorizedException('身份或会话已变化，请重新登录');
    auth.require(fresh, 'learning.use');
    await auth.course(fresh, courseId);
  }

  async startExam(actor: Actor, id: string) {
    this.context.require(actor, 'learning.use');
    const exam = await this.access.examAccess(actor, id);
    if (exam.status !== 'published') throw new ConflictException('考试尚未发布或已取消');
    const attempt = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `exam-lifecycle:${id}`);
      await this.context.lock(tx, `exam-start:${id}:${actor.id}`);
      await this.currentWriter(actor, exam.courseId, tx);
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
    await this.context.auditEvent(actor, 'exam.start', 'ExamAttempt', attempt.id, {
      deadlineAt: attempt.deadlineAt,
      number: attempt.number,
    });
    return this.attempt(actor, attempt.id);
  }

  async attempt(actor: Actor, id: string) {
    let attempt = await this.access.attemptAccess(actor, id);
    if (attempt.status === 'in_progress' && attempt.deadlineAt <= new Date()) {
      await this.finalizeAttempt(id, 'deadline');
      attempt = await this.access.attemptAccess(actor, id);
    }
    const teacher = !this.context.student(actor);
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
    this.context.require(actor, 'learning.use');
    const attempt = await this.access.attemptAccess(actor, id);
    if (attempt.userId !== actor.id) throw new ForbiddenException('只能修改本人答卷');
    if (attempt.status !== 'in_progress') throw new ConflictException('已交卷，不能修改答案');
    if (attempt.deadlineAt <= new Date()) {
      await this.finalizeAttempt(id, 'deadline');
      throw new ConflictException('考试已到时，服务器已交卷；迟到的本地草稿未接收');
    }
    const order = attempt.questionOrder as string[];
    this.context.validateAnswerValues(
      input.answers,
      (attempt.exam.snapshot?.items ?? []).map((item) => content(item.content)),
    );
    if (input.flags?.some((flag) => !order.includes(flag)))
      throw new BadRequestException('标记题目不属于此试卷');
    if (input.currentPosition !== undefined && input.currentPosition >= order.length)
      throw new BadRequestException('题目位置无效');
    return this.context.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id = ${id} FOR UPDATE`;
      // Policies depending on the current revision/position must be checked after
      // the row lock. A client can otherwise predict the next revision while its
      // request is still validating an older position outside the transaction.
      const current = await tx.examAttempt.findUniqueOrThrow({
        where: { id },
        include: { exam: { include: { audience: true } } },
      });
      await this.currentWriter(actor, current.exam.courseId, tx);
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
  async finalizeAttempt(id: string, source: 'manual' | 'deadline', key?: string, actor?: Actor) {
    return this.context.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id = ${id} FOR UPDATE`;
        const initial = await tx.examAttempt.findUnique({
          where: { id },
          include: { exam: { include: { snapshot: { include: { items: true } } } } },
        });
        if (!initial) throw new NotFoundException('答卷不存在');
        if (actor) {
          await this.currentWriter(actor, initial.exam.courseId, tx);
          if (initial.userId !== actor.id) throw new ForbiddenException('只能提交本人答卷');
          const eligible = await tx.examAudience.findUnique({
            where: { examId_userId: { examId: initial.examId, userId: actor.id } },
          });
          if (initial.exam.status !== 'published' || !eligible?.eligible)
            throw new ForbiddenException('考试已取消或资格已撤销');
        }
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
    this.context.require(actor, 'learning.use');
    const attempt = await this.access.attemptAccess(actor, id);
    if (attempt.userId !== actor.id) throw new ForbiddenException('只能提交本人答卷');
    if (attempt.status === 'cancelled') throw new ConflictException('考试或个人资格已取消');
    await this.finalizeAttempt(id, 'manual', key, actor);
    return this.attempt(actor, id);
  }
}
