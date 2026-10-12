import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Actor } from '../auth/auth.guard';
import { AssessmentContext } from './assessment-context';

@Injectable()
export class ExamAccessService {
  constructor(private readonly context: AssessmentContext) {}

  async examAccess(actor: Actor, id: string, manage = false) {
    this.context.require(
      actor,
      this.context.student(actor) ? 'learning.use' : manage ? 'assessment.manage' : 'assessment.grade',
    );
    const exam = await this.context.db.exam.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { audience: true, snapshot: { include: { items: { orderBy: { position: 'asc' } } } } },
    });
    if (!exam) throw new NotFoundException('考试不存在');
    await this.context.scoped(actor, exam.courseId, manage);
    if (
      this.context.student(actor) &&
      (exam.status === 'draft' || !exam.audience.some((a) => a.userId === actor.id))
    )
      throw new ForbiddenException('没有本考试资格');
    return exam;
  }

  requireExamGrader(actor: Actor, exam: { graderIds: string[] }) {
    if (!this.context.student(actor) && exam.graderIds.length && !exam.graderIds.includes(actor.id))
      throw new ForbiddenException('未被指定为本考试阅卷教师');
  }

  async attemptAccess(actor: Actor, id: string, grade = false) {
    this.context.require(actor, this.context.student(actor) ? 'learning.use' : 'assessment.grade');
    const attempt = await this.context.db.examAttempt.findUnique({
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
    await this.context.scoped(actor, attempt.exam.courseId, grade);
    if (this.context.student(actor) && attempt.userId !== actor.id)
      throw new ForbiddenException('只能访问自己的答卷');
    this.requireExamGrader(actor, attempt.exam);
    return attempt;
  }
}
