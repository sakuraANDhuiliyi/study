import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { AssessmentService } from '../assessment/assessment.service';
import { listSchema, saveSchema, submitExamSchema } from '../assessment/assessment.schemas';
const querySchema = listSchema
  .pick({ page: true, pageSize: true, courseId: true, search: true })
  .extend({ pageSize: z.coerce.number().int().min(1).max(20).default(10) })
  .strict();
@Controller('mobile')
@UseGuards(AuthGuard)
export class MobileExamsController {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private service: AssessmentService,
  ) {}
  private async current(a: Actor) {
    if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT') throw new ForbiddenException('请使用学生手机会话');
    const fresh = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (!fresh || fresh.id !== a.id || fresh.role !== a.role || fresh.organizationId !== a.organizationId)
      throw new UnauthorizedException('会话或身份已变化，请重新登录');
    this.auth.require(fresh, 'learning.use');
    return fresh;
  }
  private async scope(a: Actor, id: string) {
    const current = await this.current(a);
    const exam = await this.db.exam.findFirst({
      where: {
        id,
        organizationId: current.organizationId,
        status: { not: 'draft' },
        audience: { some: { userId: current.id } },
      },
    });
    if (!exam) throw new NotFoundException('考试不存在或没有访问资格');
    await this.auth.course(current, exam.courseId);
    return current;
  }
  private async attemptScope(a: Actor, id: string) {
    const current = await this.current(a);
    const attempt = await this.db.examAttempt.findFirst({
      where: { id, userId: current.id, exam: { organizationId: current.organizationId } },
    });
    if (!attempt) throw new NotFoundException('答卷不存在或不属于本人');
    return this.scope(current, attempt.examId);
  }
  @Get('exams')
  async list(@CurrentActor() a: Actor, @Query() query: unknown) {
    const current = await this.current(a),
      q = querySchema.parse(query);
    const before = JSON.stringify((await this.auth.courseIds(current)).sort());
    const page = await this.service.exams(current, q);
    const courses = await this.db.course.findMany({
      where: { id: { in: page.items.map((x) => x.courseId) }, organizationId: current.organizationId },
      select: { id: true, title: true },
    });
    for (const x of page.items) await this.scope(a, x.id);
    if (before !== JSON.stringify((await this.auth.courseIds(await this.current(a))).sort()))
      throw new ForbiddenException('课程资格已变化，请刷新');
    return {
      ...page,
      items: page.items.map((x) => ({
        id: x.id,
        title: x.title,
        courseId: x.courseId,
        courseTitle: courses.find((c) => c.id === x.courseId)?.title || '',
        startsAt: x.startsAt,
        endsAt: x.endsAt,
        status: x.status,
        durationMinutes: x.durationMinutes,
        totalCents: x.totalCents,
        latest: x.attempts[0] || null,
      })),
    };
  }
  @Get('exams/:id')
  async detail(@CurrentActor() a: Actor, @Param('id') id: string) {
    const d = await this.service.exam(await this.scope(a, id), id);
    const extension = await this.db.examExtension.findUnique({
      where: { examId_userId: { examId: id, userId: a.id } },
    });
    await this.scope(a, id);
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      courseId: d.courseId,
      status: d.status,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      entryClosesAt: d.entryClosesAt,
      durationMinutes: d.durationMinutes,
      maxAttempts: d.maxAttempts,
      totalCents: d.totalCents,
      allowBacktrack: d.allowBacktrack,
      eligible: d.eligible,
      attempts: d.attempts,
      extension: extension
        ? { deadlineAt: extension.deadlineAt, extraAttempts: extension.extraAttempts }
        : null,
      serverTime: d.serverTime,
    };
  }
  @Post('exams/:id/start')
  async start(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    z.object({}).strict().parse(body);
    return this.service.startExam(await this.scope(a, id), id);
  }
  @Get('exam-attempts/:id')
  async attempt(@CurrentActor() a: Actor, @Param('id') id: string) {
    const d = await this.service.attempt(await this.attemptScope(a, id), id);
    await this.attemptScope(a, id);
    return d;
  }
  @Put('exam-attempts/:id/answers')
  async save(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.saveAnswers(await this.attemptScope(a, id), id, saveSchema.strict().parse(body));
  }
  @Post('exam-attempts/:id/submit')
  async submit(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.submitExam(
      await this.attemptScope(a, id),
      id,
      submitExamSchema.strict().parse(body).idempotencyKey,
    );
  }
}
