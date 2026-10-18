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
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import type { Tx } from './assessment-values';
import { reviewBlockedReason, reviewScoreVisible } from './grade-review-policy';
import { AssessmentContext } from './assessment-context';
import * as schema from './assessment.schemas';
import { ExamAccessService } from './exam-access.service';
import { paginate } from './scoring';

@Injectable()
export class GradeAppealsService {
  constructor(
    private readonly context: AssessmentContext,
    private readonly access: ExamAccessService,
  ) {}

  private async currentActor(actor: Actor, tx: Tx, courseId: string, permission: string) {
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
    auth.require(fresh, permission);
    await auth.course(fresh, courseId, permission !== 'learning.use');
    return fresh;
  }

  private async lockedStudentAttempt(actor: Actor, id: string, tx: Tx) {
    await this.context.lock(tx, `grade-revision:${id}`);
    await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id = ${id} FOR UPDATE`;
    const attempt = await tx.examAttempt.findUnique({
      where: { id },
      include: { exam: { include: { audience: true } } },
    });
    if (!attempt || attempt.exam.organizationId !== actor.organizationId || attempt.userId !== actor.id)
      throw new NotFoundException('答卷不存在或不属于本人');
    const current = await this.currentActor(actor, tx, attempt.exam.courseId, 'learning.use');
    if (
      current.role !== 'STUDENT' ||
      attempt.exam.status === 'draft' ||
      !attempt.exam.audience.some((x) => x.userId === current.id)
    )
      throw new ForbiddenException('没有本考试资格');
    return attempt;
  }

  async appeal(actor: Actor, id: string, reason: string) {
    this.context.require(actor, 'learning.use');
    const result = await this.context.db.$transaction(async (tx) => {
      const attempt = await this.lockedStudentAttempt(actor, id, tx);
      const existing = await tx.gradeAppeal.findUnique({
        where: { attemptId_userId: { attemptId: id, userId: actor.id } },
      });
      // A lost response can be recovered after the deadline; it never changes the first reason.
      if (existing && reviewScoreVisible(attempt, new Date())) return { appeal: existing, created: false };
      const blocked = reviewBlockedReason(attempt, actor.id, new Date());
      if (blocked) throw new ConflictException(blocked);
      const appeal = await tx.gradeAppeal.create({ data: { attemptId: id, userId: actor.id, reason } });
      return { appeal, created: true };
    });
    if (result.created) await this.context.auditEvent(actor, 'grade.appeal', 'GradeAppeal', result.appeal.id);
    return result.appeal;
  }

  /** Safe per-attempt student receipt and paged grade changes, from one locked snapshot. */
  async studentReview(actor: Actor, id: string, query: { page: number; pageSize: number }) {
    return this.context.db.$transaction(async (tx) => {
      const attempt = await this.lockedStudentAttempt(actor, id, tx),
        now = new Date();
      const visible = reviewScoreVisible(attempt, now);
      const appeal = await tx.gradeAppeal.findUnique({
        where: { attemptId_userId: { attemptId: id, userId: actor.id } },
      });
      const p = paginate(query);
      const revisions = visible
        ? await tx.gradeRevision.findMany({
            where: { attemptId: id },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip: p.skip,
            take: p.take,
            select: { id: true, oldScoreCents: true, newScoreCents: true, reason: true, createdAt: true },
          })
        : [];
      const total = visible ? await tx.gradeRevision.count({ where: { attemptId: id } }) : 0;
      const blocked = reviewBlockedReason(attempt, actor.id, now);
      return {
        attemptId: id,
        examId: attempt.examId,
        title: attempt.exam.title,
        number: attempt.number,
        scoreCents: visible && attempt.gradingStatus === 'graded' ? attempt.scoreCents : null,
        deadlineAt: attempt.exam.appealDeadline,
        canApply: !appeal && !blocked,
        blockedReason: appeal ? '本次答卷已提交复核申请，请查看处理进度' : blocked,
        appeal: appeal
          ? {
              id: appeal.id,
              reason: appeal.reason,
              status: appeal.status,
              createdAt: appeal.createdAt,
              resolution: visible ? appeal.resolution : null,
              resolvedAt: appeal.resolvedAt,
            }
          : null,
        revisions: { items: revisions, total, page: query.page, pageSize: query.pageSize },
        serverTime: now.toISOString(),
      };
    });
  }

  async appeals(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    this.context.require(actor, this.context.student(actor) ? 'learning.use' : 'assessment.grade');
    const ids = await this.context.auth.courseIds(actor);
    if (query.courseId) await this.context.scoped(actor, query.courseId);
    const p = paginate(query);
    const where = {
      ...(this.context.student(actor) ? { userId: actor.id } : {}),
      ...(query.status ? { status: query.status } : {}),
      attempt: {
        exam: {
          organizationId: actor.organizationId,
          courseId: query.courseId ?? { in: ids },
          ...(this.context.student(actor)
            ? {}
            : { OR: [{ graderIds: { isEmpty: true } }, { graderIds: { has: actor.id } }] }),
        },
      },
    };
    const [items, total] = await this.context.db.$transaction([
      this.context.db.gradeAppeal.findMany({
        where,
        include: {
          attempt: {
            select: {
              id: true,
              scoreCents: true,
              gradingStatus: true,
              releaseStatus: true,
              exam: { select: { id: true, title: true, courseId: true, scoreReleaseAt: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.gradeAppeal.count({ where }),
    ]);
    const safeItems = this.context.student(actor)
      ? items.map((row) => {
          const visible = reviewScoreVisible(row.attempt, new Date());
          return {
            ...row,
            resolution: visible ? row.resolution : null,
            attempt: {
              ...row.attempt,
              scoreCents: visible && row.attempt.gradingStatus === 'graded' ? row.attempt.scoreCents : null,
            },
          };
        })
      : items;
    return { items: safeItems, total, page: p.page, pageSize: p.pageSize };
  }

  async resolveAppeal(actor: Actor, id: string, input: z.infer<typeof schema.resolveSchema>) {
    this.context.require(actor, 'assessment.grade');
    const appeal = await this.context.db.gradeAppeal.findUnique({ where: { id } });
    if (!appeal) throw new NotFoundException('复核申请不存在');
    const attempt = await this.access.attemptAccess(actor, appeal.attemptId, true);
    if (input.scoreCents !== undefined) this.context.require(actor, 'grade.revise');
    if (input.scoreCents !== undefined && input.scoreCents > attempt.exam.totalCents)
      throw new BadRequestException('复核总分不能超过试卷满分');
    const result = await this.context.db.$transaction(async (tx) => {
      await this.context.lock(tx, `grade-revision:${attempt.id}`);
      await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id = ${attempt.id} FOR UPDATE`;
      const fresh = await this.currentActor(actor, tx, attempt.exam.courseId, 'assessment.grade');
      if (input.scoreCents !== undefined) this.context.require(fresh, 'grade.revise');
      const latest = await tx.examAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        include: { exam: true },
      });
      if (latest.exam.organizationId !== fresh.organizationId) throw new NotFoundException('答卷不存在');
      this.access.requireExamGrader(fresh, latest.exam);
      if (input.scoreCents !== undefined && input.scoreCents > latest.exam.totalCents)
        throw new BadRequestException('复核总分不能超过试卷满分');

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
    await this.context.auditEvent(actor, 'grade.appeal.resolve', 'GradeAppeal', id, {
      changedScore: input.scoreCents !== undefined,
    });
    await this.context.notify(
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
    const attempt = await this.access.attemptAccess(actor, id);
    if (
      this.context.student(actor) &&
      (attempt.releaseStatus !== 'released' ||
        !attempt.exam.scoreReleaseAt ||
        attempt.exam.scoreReleaseAt > new Date())
    )
      throw new ForbiddenException('成绩尚未公开');
    const p = paginate(query);
    const [items, total] = await this.context.db.$transaction([
      this.context.db.gradeRevision.findMany({
        where: { attemptId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.gradeRevision.count({ where: { attemptId: id } }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
}
