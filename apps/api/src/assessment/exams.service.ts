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
import { QuestionSelectionService } from './question-selection.service';
import { paginate, publicQuestion } from './scoring';

@Injectable()
export class ExamsService {
  constructor(
    private readonly context: AssessmentContext,
    private readonly selection: QuestionSelectionService,
    private readonly access: ExamAccessService,
  ) {}

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
    this.context.require(actor, this.context.student(actor) ? 'learning.use' : 'assessment.manage');
    const ids = await this.context.auth.courseIds(actor);
    if (query.courseId) await this.context.scoped(actor, query.courseId);
    const p = paginate(query);
    const where: Prisma.ExamWhereInput = {
      organizationId: actor.organizationId,
      courseId: query.courseId ?? { in: ids },
      ...(query.search ? { title: { contains: query.search } } : {}),
      ...(this.context.student(actor)
        ? { status: { not: 'draft' }, audience: { some: { userId: actor.id } } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const [items, total] = await this.context.db.$transaction([
      this.context.db.exam.findMany({
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
      this.context.db.exam.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize, serverTime: new Date().toISOString() };
  }

  async createExam(actor: Actor, input: z.infer<typeof schema.examSchema>) {
    this.context.require(actor, 'assessment.manage');
    await this.context.scoped(actor, input.courseId, true);
    this.validateExamTimes(input);
    const versions = await this.selection.versionSelection(actor, input.courseId, input.questionVersionIds);
    const totalCents = versions.reduce((sum, q) => sum + q.scoreCents, 0);
    if (input.passCents > totalCents) throw new BadRequestException('及格分不能超过试卷满分');
    const audience = await this.context.audience(actor, input.courseId, input.audienceIds);
    const { questionVersionIds: _versions, audienceIds: _audience, ...data } = input;
    const exam = await this.context.db.exam.create({
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
    await this.context.auditEvent(actor, 'exam.create', 'Exam', exam.id);
    return this.exam(actor, exam.id);
  }

  async exam(actor: Actor, id: string) {
    const exam = await this.access.examAccess(actor, id);
    const { snapshot, audience, ...details } = exam;
    const attempts = await this.context.db.examAttempt.findMany({
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
      items: this.context.student(actor)
        ? undefined
        : snapshot?.items.map((item) => ({
            ...publicQuestion(content(item.content), true, true),
            questionVersionId: item.questionVersionId,
          })),
      audience:
        this.context.student(actor) || (exam.graderIds.length && !exam.graderIds.includes(actor.id))
          ? undefined
          : audience,
      eligible: this.context.student(actor)
        ? audience.find((a) => a.userId === actor.id)?.eligible
        : undefined,
      attempts,
      serverTime: new Date().toISOString(),
    };
  }

  async updateExam(actor: Actor, id: string, input: z.infer<typeof schema.examPatchSchema>) {
    const exam = await this.access.examAccess(actor, id, true);
    if (exam.status !== 'draft')
      throw new ConflictException('发布后试卷及关键规则冻结；请创建新考试或使用个别延时/补考授权');
    const { revision, courseId, audienceIds, questionVersionIds, ...data } = input;
    if (courseId && courseId !== exam.courseId) throw new BadRequestException('不能改变考试所属课程');
    this.validateExamTimes({ ...exam, ...data });
    const versions = questionVersionIds
      ? await this.selection.versionSelection(actor, exam.courseId, questionVersionIds)
      : undefined;
    const audience = audienceIds ? await this.context.audience(actor, exam.courseId, audienceIds) : undefined;
    const totalCents = versions?.reduce((sum, q) => sum + q.scoreCents, 0) ?? exam.totalCents;
    if ((data.passCents ?? exam.passCents) > totalCents)
      throw new BadRequestException('及格分不能超过试卷满分');
    await this.context.db.$transaction(async (tx) => {
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
    await this.context.auditEvent(actor, 'exam.update', 'Exam', id, { revision: revision + 1 });
    return this.exam(actor, id);
  }

  async publishExam(actor: Actor, id: string) {
    const exam = await this.access.examAccess(actor, id, true);
    this.validateExamTimes(exam);
    if (exam.status !== 'draft') throw new ConflictException('考试已发布或取消');
    if (exam.endsAt <= new Date()) throw new BadRequestException('考试结束时间已过');
    if (!exam.snapshot?.items.length) throw new BadRequestException('试卷不能为空');
    await this.context.audience(
      actor,
      exam.courseId,
      exam.audience.map((a) => a.userId),
    );
    const versions = await this.selection.versionSelection(
      actor,
      exam.courseId,
      exam.snapshot.items.map((item) => item.questionVersionId),
    );
    if (versions.some((version) => version.question.practiceEnabled || version.question.everPracticeEnabled))
      throw new BadRequestException('正式考试不能使用曾开放过练习的题目；请创建独立保密考试题');
    if (
      await this.context.db.assignmentItem.count({
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
      const teachers = await this.context.db.teachingAssignment.count({
        where: { courseId: exam.courseId, userId: { in: unique(exam.graderIds) }, active: true },
      });
      if (teachers !== unique(exam.graderIds).length)
        throw new BadRequestException('阅卷教师必须是本课程的在职授课教师');
    }
    await this.context.db.$transaction(async (tx) => {
      const questionIds = versions.map((q) => q.questionId).sort();
      for (const questionId of questionIds) await this.context.lock(tx, `question:${questionId}`);
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
    await this.context.auditEvent(actor, 'exam.publish', 'Exam', id);
    await this.context.notify(
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
    const exam = await this.access.examAccess(actor, id, true);
    await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `exam-lifecycle:${id}`);
      await tx.exam.update({ where: { id }, data: { status: 'cancelled', revision: { increment: 1 } } });
      await tx.examAttempt.updateMany({
        where: { examId: id, status: 'in_progress' },
        data: { status: 'cancelled', revision: { increment: 1 } },
      });
    });
    await this.context.auditEvent(actor, 'exam.cancel', 'Exam', id, { reason });
    await this.context.notify(
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

  async extendExam(actor: Actor, id: string, input: z.infer<typeof schema.extensionSchema>) {
    const exam = await this.access.examAccess(actor, id, true);
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
    const extension = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `exam-lifecycle:${id}`);
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
    await this.context.auditEvent(actor, 'exam.extension', 'Exam', id, input);
    await this.context.notify(
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
    await this.access.examAccess(actor, id, true);
    const result = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `exam-lifecycle:${id}`);
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
    await this.context.auditEvent(actor, 'exam.eligibility', 'Exam', id, input);
    return result;
  }
}
