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
import { content, json, unique } from './assessment-values';
import * as schema from './assessment.schemas';
import { ExamAccessService } from './exam-access.service';
import { ExamAttemptsService } from './exam-attempts.service';
import { ExamDeadlineService } from './exam-deadline.service';
import { itemAccumulator } from './item-analysis';
import { paginate, publicQuestion } from './scoring';

@Injectable()
export class ExamGradingService {
  constructor(
    private readonly context: AssessmentContext,
    private readonly access: ExamAccessService,
    private readonly attempts: ExamAttemptsService,
    private readonly deadlines: ExamDeadlineService,
  ) {}

  async examAttempts(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    this.context.require(actor, 'assessment.grade');
    this.access.requireExamGrader(actor, await this.access.examAccess(actor, id));
    const p = paginate(query);
    const where = { examId: id, ...(query.status ? { gradingStatus: query.status } : {}) };
    const [items, total] = await this.context.db.$transaction([
      this.context.db.examAttempt.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.examAttempt.count({ where }),
    ]);
    const users = await this.context.db.user.findMany({
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
    this.context.require(actor, 'assessment.grade');
    const exam = await this.access.examAccess(actor, id);
    this.access.requireExamGrader(actor, exam);
    const p = paginate(query);
    const audience = exam.audience.sort((a, b) => a.userId.localeCompare(b.userId));
    const page = audience.slice(p.skip, p.skip + p.take);
    const users = await this.context.db.user.findMany({
      where: { id: { in: page.map((a) => a.userId) } },
      select: { id: true, name: true, username: true },
    });
    const attempts = await this.context.db.examAttempt.findMany({
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
    if (this.context.student(actor)) throw new ForbiddenException('学生不能访问考试内部题目分析');
    this.context.require(actor, 'assessment.grade');
    const administrator = ['ADMIN', 'SUPER_ADMIN'].includes(actor.role);
    if (administrator && !actor.permissions.includes('analysis.sensitive'))
      throw new ForbiddenException('未获教学统计敏感授权');
    const exam = await this.access.examAccess(actor, id);
    this.access.requireExamGrader(actor, exam);
    const page = paginate({ ...query, pageSize: Math.min(query.pageSize ?? 20, 50) });
    const allItems = exam.snapshot?.items ?? [];
    const items = allItems.slice(page.skip, page.skip + page.take);
    const report = await this.context.db.$transaction(
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
      await this.context.auditEvent(actor, 'analysis.sensitive.read', 'Exam', id, {
        report: 'item-analysis',
      });
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
    this.context.require(actor, 'assessment.grade');
    const exam = await this.access.examAccess(actor, id);
    this.access.requireExamGrader(actor, exam);
    const snapshotItem = exam.snapshot?.items.find((item) => item.questionVersionId === questionVersionId);
    if (!snapshotItem) throw new NotFoundException('此题不属于该考试的固定试卷');
    const p = paginate(query);
    const where: Prisma.ExamAttemptWhereInput = {
      examId: id,
      status: { in: ['submitted', 'timed_out'] },
      ...(query.status ? { gradingStatus: query.status } : {}),
    };
    const [attempts, total] = await this.context.db.$transaction([
      this.context.db.examAttempt.findMany({
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
      this.context.db.examAttempt.count({ where }),
    ]);
    const users = await this.context.db.user.findMany({
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
    this.context.require(actor, 'assessment.grade');
    const attempt = await this.access.attemptAccess(actor, id, true);
    if (!['submitted', 'timed_out'].includes(attempt.status))
      throw new ConflictException('只能批阅已提交答卷');
    if (attempt.releaseStatus === 'released')
      throw new ConflictException('成绩已发布，改分须使用复核流程并具备独立改分授权');
    const questions = (attempt.exam.snapshot?.items ?? []).map((item) => content(item.content));
    this.context.validateAnswers(
      input.items.map((item) => ({ questionVersionId: item.questionVersionId, value: item.scoreCents })),
      questions.map((q) => q.id),
    );
    input.items.forEach((item) => {
      if (item.scoreCents > questions.find((q) => q.id === item.questionVersionId)!.scoreCents)
        throw new BadRequestException('得分不能超过题目满分');
    });
    await this.context.db.$transaction(async (tx) => {
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
    await this.context.auditEvent(actor, 'exam.grade', 'ExamAttempt', id, {
      gradingRevision: input.revision + 1,
      markedQuestions: input.items.length,
    });
    return this.attempts.attempt(actor, id);
  }

  async releaseExam(actor: Actor, id: string) {
    this.context.require(actor, 'assessment.grade');
    const exam = await this.access.examAccess(actor, id);
    this.access.requireExamGrader(actor, exam);
    await this.context.scoped(actor, exam.courseId, true);
    if (exam.status !== 'published') throw new ConflictException('只能发布有效考试的成绩');
    if (new Date() < exam.endsAt) throw new ConflictException('考试窗口尚未结束，不能统一发布');
    await this.deadlines.sweepDueAttempts();
    const result = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `exam-lifecycle:${id}`);
      const current = await tx.exam.findUniqueOrThrow({ where: { id } });
      this.access.requireExamGrader(actor, current);
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
    await this.context.auditEvent(actor, 'exam.release', 'Exam', id, result);
    await this.context.notify(
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
}
