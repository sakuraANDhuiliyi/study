import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { Tx, unique } from './assessment-values';
import { QuestionData, validAnswerValue } from './scoring';

@Injectable()
export class AssessmentContext {
  private readonly logger = new Logger('AssessmentService');
  constructor(
    readonly db: PrismaService,
    readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  require(actor: Actor, permission: string) {
    this.auth.require(actor, permission);
  }

  async scoped(actor: Actor, courseId: string, write = false) {
    return this.auth.course(actor, courseId, write);
  }

  student(actor: Actor) {
    return actor.role === 'STUDENT';
  }

  async auditEvent(actor: Actor, action: string, type: string, id: string, details: unknown = {}) {
    await this.audit.record(actor, action, type, id, details);
  }

  async notify(
    actor: Actor,
    ids: string[],
    type: string,
    title: string,
    body: string,
    link: string,
    event: string,
  ) {
    try {
      await this.audit.notify(ids, actor.organizationId, type, title, body, link, event);
    } catch {
      this.logger.warn(`通知已留待重试: ${event}`);
    }
  }

  async lock(tx: Tx, key: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
  }

  async audience(actor: Actor, courseId: string, ids: string[]) {
    const enrolled = await this.db.enrollment.findMany({
      where: { courseId, active: true },
      select: { userId: true },
    });
    const all = enrolled.map((x) => x.userId);
    const chosen = ids.length ? unique(ids) : all;
    if (!chosen.length) throw new BadRequestException('发布对象不能为空；请先为课程添加学生');
    if (chosen.some((id) => !all.includes(id))) throw new BadRequestException('发布对象必须是当前课程学生');
    const count = await this.db.user.count({
      where: { id: { in: chosen }, organizationId: actor.organizationId, active: true },
    });
    if (count !== chosen.length) throw new BadRequestException('发布对象包含停用或无效账号');
    return chosen;
  }

  async validateAttachments(
    actor: Actor,
    ids: string[],
    assignmentId?: string,
    courseId?: string,
    requireOwnership = true,
  ) {
    if (!ids.length) return;
    const attachments = await this.db.attachment.findMany({
      where: {
        id: { in: unique(ids) },
        organizationId: actor.organizationId,
        ownerId: requireOwnership ? actor.id : undefined,
      },
    });
    if (
      attachments.length !== unique(ids).length ||
      attachments.some(
        (file) =>
          Boolean(file.exportJobId) ||
          (assignmentId
            ? file.assignmentId !== assignmentId &&
              (file.assignmentId || file.courseId || file.conversationId)
            : Boolean(
                file.conversationId || file.assignmentId || (file.courseId && file.courseId !== courseId),
              )),
      )
    )
      throw new ForbiddenException('附件不存在或没有使用权限');
  }

  validateAnswers(answers: { questionVersionId: string; value: unknown }[], ids: string[]) {
    if (
      unique(answers.map((a) => a.questionVersionId)).length !== answers.length ||
      answers.some((answer) => !ids.includes(answer.questionVersionId))
    )
      throw new BadRequestException('答案题目不属于当前任务或存在重复');
    if (JSON.stringify(answers).length > 500000) throw new BadRequestException('答案内容过大');
  }

  validateAnswerValues(answers: { questionVersionId: string; value: unknown }[], questions: QuestionData[]) {
    this.validateAnswers(
      answers,
      questions.map((question) => question.id),
    );
    if (
      answers.some(
        (answer) =>
          !validAnswerValue(
            questions.find((question) => question.id === answer.questionVersionId)!,
            answer.value,
          ),
      )
    )
      throw new BadRequestException('答案格式、选项或综合题子题与题目不匹配');
  }
}
