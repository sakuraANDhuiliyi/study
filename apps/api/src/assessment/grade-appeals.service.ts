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
import * as schema from './assessment.schemas';
import { ExamAccessService } from './exam-access.service';
import { paginate } from './scoring';

@Injectable()
export class GradeAppealsService {
  constructor(
    private readonly context: AssessmentContext,
    private readonly access: ExamAccessService,
  ) {}

  async appeal(actor: Actor, id: string, reason: string) {
    this.context.require(actor, 'learning.use');
    const attempt = await this.access.attemptAccess(actor, id);
    if (attempt.userId !== actor.id) throw new ForbiddenException('只能申请复核本人成绩');
    if (
      attempt.releaseStatus !== 'released' ||
      !attempt.exam.scoreReleaseAt ||
      attempt.exam.scoreReleaseAt > new Date()
    )
      throw new ConflictException('成绩尚未公开');
    if (attempt.exam.appealDeadline && attempt.exam.appealDeadline < new Date())
      throw new ConflictException('已超过成绩复核期限');
    const appeal = await this.context.db.gradeAppeal.upsert({
      where: { attemptId_userId: { attemptId: id, userId: actor.id } },
      create: { attemptId: id, userId: actor.id, reason },
      update: {},
    });
    await this.context.auditEvent(actor, 'grade.appeal', 'GradeAppeal', appeal.id);
    return appeal;
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
              exam: { select: { id: true, title: true, courseId: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.context.db.gradeAppeal.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
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
