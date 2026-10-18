import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { AssessmentContext } from './assessment-context';
import { content, itemInclude, json, unique, type Tx } from './assessment-values';
import * as schema from './assessment.schemas';
import { QuestionSelectionService } from './question-selection.service';
import { autoScore, paginate, publicQuestion } from './scoring';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly context: AssessmentContext,
    private readonly selection: QuestionSelectionService,
  ) {}

  private async assignmentAccess(
    actor: Actor,
    id: string,
    write = false,
    database: PrismaService | Tx = this.context.db,
  ) {
    this.context.require(
      actor,
      this.context.student(actor) ? 'learning.use' : write ? 'assessment.manage' : 'assessment.grade',
    );
    const assignment = await database.assignment.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { items: { include: itemInclude, orderBy: { position: 'asc' } }, audience: true },
    });
    if (!assignment) throw new NotFoundException('作业不存在');
    await new AuthService(database as PrismaService).course(actor, assignment.courseId, write);
    if (
      this.context.student(actor) &&
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
    this.context.require(actor, this.context.student(actor) ? 'learning.use' : 'assessment.manage');
    const ids = await this.context.auth.courseIds(actor);
    if (query.courseId) await this.context.scoped(actor, query.courseId);
    const p = paginate(query);
    const where: Prisma.AssignmentWhereInput = {
      organizationId: actor.organizationId,
      courseId: query.courseId ?? { in: ids },
      ...(query.search ? { title: { contains: query.search } } : {}),
      ...(this.context.student(actor)
        ? { status: 'published', audience: { some: { userId: actor.id } } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const [items, total] = await this.context.db.$transaction([
      this.context.db.assignment.findMany({
        where,
        include: {
          submissions: {
            where: this.context.student(actor) ? { userId: actor.id } : undefined,
            orderBy: { submittedAt: 'desc' },
            take: 1,
          },
          _count: { select: { audience: true, submissions: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.assignment.count({ where }),
    ]);
    return {
      items: items.map((assignment) => ({
        ...assignment,
        submissions: assignment.submissions.map((submission) =>
          this.submissionView(submission, this.context.student(actor)),
        ),
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }

  async createAssignment(actor: Actor, input: z.infer<typeof schema.assignmentSchema>) {
    this.context.require(actor, 'assessment.manage');
    await this.context.scoped(actor, input.courseId, true);
    if (input.dueAt <= input.opensAt) throw new BadRequestException('截止时间必须晚于开放时间');
    const versions = await this.selection.versionSelection(actor, input.courseId, input.questionVersionIds);
    const audience = await this.context.audience(actor, input.courseId, input.audienceIds);
    await this.context.validateAttachments(actor, input.attachmentIds, undefined, input.courseId);
    const { audienceIds: _audience, questionVersionIds, ...data } = input;
    const assignment = await this.context.db.assignment.create({
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
    await this.context.auditEvent(actor, 'assignment.create', 'Assignment', assignment.id);
    return assignment;
  }

  async assignment(actor: Actor, id: string) {
    const assignment = await this.assignmentAccess(actor, id);
    const student = this.context.student(actor);
    const [draft, submissions, exception] = await Promise.all([
      this.context.db.assignmentDraft.findUnique({
        where: { assignmentId_userId: { assignmentId: id, userId: actor.id } },
      }),
      this.context.db.assignmentSubmission.findMany({
        where: { assignmentId: id, userId: actor.id },
        include: { grading: { orderBy: { revision: 'asc' } } },
        orderBy: { version: 'desc' },
      }),
      this.context.db.assignmentException.findUnique({
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
      ? await this.selection.versionSelection(actor, old.courseId, questionVersionIds)
      : undefined;
    const audience = audienceIds ? await this.context.audience(actor, old.courseId, audienceIds) : undefined;
    if (data.attachmentIds)
      await this.context.validateAttachments(actor, data.attachmentIds, undefined, old.courseId);
    await this.context.db.$transaction(async (tx) => {
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
    await this.context.auditEvent(actor, 'assignment.update', 'Assignment', id, {
      reason,
      oldDueAt: old.dueAt,
      newDueAt: data.dueAt ?? old.dueAt,
    });
    if (old.status === 'published')
      await this.context.notify(
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
    await this.selection.versionSelection(
      actor,
      assignment.courseId,
      assignment.items.map((item) => item.questionVersionId),
    );
    await this.context.validateAttachments(
      actor,
      assignment.attachmentIds,
      undefined,
      assignment.courseId,
      false,
    );
    await this.context.audience(
      actor,
      assignment.courseId,
      assignment.audience.map((a) => a.userId),
    );
    await this.selection.assertNoUnreleasedExam(
      assignment.items.map((item) => item.questionVersion.questionId),
    );
    await this.context.db.$transaction(async (tx) => {
      const questionIds = assignment.items.map((item) => item.questionVersion.questionId).sort();
      for (const questionId of questionIds) await this.context.lock(tx, `question:${questionId}`);
      await this.selection.assertNoUnreleasedExam(questionIds, tx);
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
    await this.context.auditEvent(actor, 'assignment.publish', 'Assignment', id);
    await this.context.notify(
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

  private async currentWriter(actor: Actor, id: string, tx: Tx) {
    const current = actor.sessionId
      ? await new AuthService(tx as PrismaService).resolveSessionId(actor.sessionId)
      : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.organizationId !== actor.organizationId ||
      current.role !== actor.role ||
      current.clientType !== actor.clientType ||
      current.csrfToken !== actor.csrfToken
    )
      throw new UnauthorizedException('身份或会话已变化，请重新登录');
    this.context.require(current, 'learning.use');
    const assignment = await this.assignmentAccess(current, id, false, tx);
    const exception = await tx.assignmentException.findUnique({
      where: { assignmentId_userId: { assignmentId: id, userId: current.id } },
    });
    return { current, assignment, exception };
  }

  async saveAssignmentDraft(actor: Actor, id: string, input: z.infer<typeof schema.draftSchema>) {
    this.context.require(actor, 'learning.use');
    return this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `assignment:${id}:${actor.id}`);
      const { current, assignment, exception } = await this.currentWriter(actor, id, tx);
      this.checkAssignmentWindow(assignment, exception);
      this.context.validateAnswerValues(
        input.answers,
        assignment.items.map((item) => content(item.questionVersion)),
      );
      await this.context.validateAttachments(current, input.attachmentIds, id, undefined, true, tx);
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
    this.context.require(actor, 'learning.use');
    const submission = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `assignment:${id}:${actor.id}`);
      const { current, assignment, exception } = await this.currentWriter(actor, id, tx);
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
      this.checkAssignmentWindow(assignment, exception);
      this.context.validateAnswerValues(
        input.answers,
        assignment.items.map((item) => content(item.questionVersion)),
      );
      await this.context.validateAttachments(current, input.attachmentIds, id, undefined, true, tx);
      if (input.expectedDraftRevision !== undefined) {
        const draft = await tx.assignmentDraft.findUnique({
          where: { assignmentId_userId: { assignmentId: id, userId: actor.id } },
        });
        if ((draft?.revision ?? 0) !== input.expectedDraftRevision)
          throw new ConflictException('另一页面已保存新草稿，请刷新后再提交');
      }
      const last = await tx.assignmentSubmission.findFirst({
        where: { assignmentId: id, userId: actor.id },
        orderBy: { version: 'desc' },
      });
      if (
        input.expectedSubmissionVersion !== undefined &&
        (last?.version ?? 0) !== input.expectedSubmissionVersion
      )
        throw new ConflictException('其他页面已提交新版本，请刷新后确认再提交');
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
    await this.context.auditEvent(actor, 'assignment.submit', 'AssignmentSubmission', submission.id, {
      version: submission.version,
      late: submission.late,
    });
    return this.submissionView(submission, this.context.student(actor));
  }

  async submissions(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    await this.assignmentAccess(actor, id);
    const p = paginate(query);
    const where = {
      assignmentId: id,
      ...(this.context.student(actor) ? { userId: actor.id } : {}),
      ...(query.status ? { gradingStatus: query.status } : {}),
    };
    const [items, total] = await this.context.db.$transaction([
      this.context.db.assignmentSubmission.findMany({
        where,
        include: { grading: { orderBy: { revision: 'desc' } } },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.assignmentSubmission.count({ where }),
    ]);
    const users = await this.context.db.user.findMany({
      where: { id: { in: unique(items.map((s) => s.userId)) } },
      select: { id: true, name: true, username: true },
    });
    return {
      items: items.map((submission) => ({
        ...this.submissionView(submission, this.context.student(actor)),
        user: users.find((u) => u.id === submission.userId),
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }

  async assignmentRoster(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    this.context.require(actor, 'assessment.grade');
    const assignment = await this.assignmentAccess(actor, id);
    const p = paginate(query);
    const ids = assignment.audience.map((a) => a.userId).sort();
    const pageIds = ids.slice(p.skip, p.skip + p.take);
    const [users, submissions, exceptions] = await Promise.all([
      this.context.db.user.findMany({
        where: { id: { in: pageIds } },
        select: { id: true, name: true, username: true },
      }),
      this.context.db.assignmentSubmission.findMany({
        where: { assignmentId: id, userId: { in: pageIds } },
        orderBy: { version: 'desc' },
      }),
      this.context.db.assignmentException.findMany({ where: { assignmentId: id, userId: { in: pageIds } } }),
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
    this.context.require(actor, 'assessment.grade');
    const submission = await this.context.db.assignmentSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('提交不存在');
    const assignment = await this.assignmentAccess(actor, submission.assignmentId);
    await this.context.scoped(actor, assignment.courseId, true);
    if (submission.releasedAt) throw new ConflictException('已公开成绩不能覆盖；退回重交会保留该版本及批注');
    if (submission.status === 'returned') throw new ConflictException('此版本已退回，不再批阅');
    this.context.validateAnswers(
      input.items.map((item) => ({ questionVersionId: item.questionVersionId, value: item.scoreCents })),
      assignment.items.map((item) => item.questionVersionId),
    );
    const answers = submission.answers as { questionVersionId: string; value: unknown }[];
    const priorFeedback = await this.context.db.assignmentFeedback.findFirst({
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
    const graded = await this.context.db.$transaction(async (tx) => {
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
    await this.context.auditEvent(actor, 'assignment.grade', 'AssignmentSubmission', id, {
      scoreCents: total,
      version: submission.version,
    });
    return graded;
  }

  async releaseAssignment(actor: Actor, id: string) {
    this.context.require(actor, 'assessment.grade');
    const assignment = await this.assignmentAccess(actor, id);
    await this.context.scoped(actor, assignment.courseId, true);
    const releasedAt = new Date();
    const result = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `assignment-release:${id}`);
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
    await this.context.auditEvent(actor, 'assignment.release', 'Assignment', id, result);
    await this.context.notify(
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
    const result = await this.context.db.assignmentException.upsert({
      where: { assignmentId_userId: { assignmentId: id, userId: input.userId } },
      create: { ...input, assignmentId: id, approvedBy: actor.id },
      update: { ...input, approvedBy: actor.id },
    });
    await this.context.auditEvent(actor, 'assignment.exception', 'Assignment', id, input);
    await this.context.notify(
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
    this.context.require(actor, 'assessment.grade');
    const submission = await this.context.db.assignmentSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('提交不存在');
    const assignment = await this.assignmentAccess(actor, submission.assignmentId);
    await this.context.scoped(actor, assignment.courseId, true);
    await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `assignment:${assignment.id}:${submission.userId}`);
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
    await this.context.auditEvent(actor, 'assignment.return', 'AssignmentSubmission', id, { reason });
    await this.context.notify(
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
}
