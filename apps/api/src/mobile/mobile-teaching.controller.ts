import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import type { UploadOperation } from '@prisma/client';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AssessmentService } from '../assessment/assessment.service';
import * as schema from '../assessment/assessment.schemas';
import { CoursesController, lessonInput } from '../courses/courses.controller';
import { sparsePartial } from '../common/sparse-partial';
import { PrismaService } from '../common/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import { UploadAdmissionInterceptor } from '../communication/upload-admission.interceptor';
import { UploadSafetyService } from '../communication/upload-safety.service';
import { recheckPrivateStream } from './private-stream';
import * as p from './mobile-teaching.policy';
const stringQuery = (q: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(q)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
@Controller('mobile/teaching')
@UseGuards(AuthGuard)
export class MobileTeachingController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: PrismaService,
    private readonly assessment: AssessmentService,
    private readonly courses: CoursesController,
    private readonly files: CommunicationService,
    private readonly uploads: UploadSafetyService,
  ) {}
  private async current(a: Actor) {
    if (
      a.clientType !== 'MOBILE' ||
      a.accountMode !== 'ORGANIZATION' ||
      !['TEACHER', 'ADMIN', 'SUPER_ADMIN'].includes(a.role)
    )
      throw new ForbiddenException('请使用机构教职人员手机身份');
    const f = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (
      !f ||
      f.id !== a.id ||
      f.organizationId !== a.organizationId ||
      f.role !== a.role ||
      f.accountMode !== 'ORGANIZATION'
    )
      throw new UnauthorizedException('身份已变化，请重新登录');
    return f;
  }
  private async read<T>(a: Actor, run: (f: Actor) => Promise<T>) {
    const out = await run(await this.current(a));
    await this.current(a);
    return out;
  }
  private async course(a: Actor, id: string) {
    const fresh = await this.current(a);
    await this.auth.course(fresh, p.teachingId.parse(id), true);
    return fresh;
  }
  @Get('courses') listCourses(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.read(a, (f) =>
      this.courses.list(
        f,
        stringQuery(p.teachingQuery.pick({ page: true, pageSize: true, search: true }).parse(q)),
      ),
    );
  }
  @Get('courses/:id') async detail(@CurrentActor() a: Actor, @Param('id') id: string) {
    const f = await this.course(a, id);
    const row = await this.courses.detail(f, id);
    await this.course(a, id);
    return row;
  }
  @Get('courses/:id/members') async members(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    const f = await this.course(a, id);
    const out = await this.courses.members(f, id, stringQuery(p.teachingMembers.parse(q)));
    await this.course(a, id);
    return out;
  }
  @Post('courses/:id/chapters') async chapter(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.courses.chapter(await this.current(a), p.teachingId.parse(id), p.teachingChapter.parse(b));
  }
  @Patch('chapters/:id') async chapterEdit(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.courses.chapterEdit(
      await this.current(a),
      p.teachingId.parse(id),
      p.teachingChapterPatch.parse(b),
    );
  }
  @Post('chapters/:id/lessons') async lesson(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.courses.lesson(await this.current(a), p.teachingId.parse(id), lessonInput.strict().parse(b));
  }
  @Patch('lessons/:id') async lessonEdit(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.courses.lessonEdit(
      await this.current(a),
      p.teachingId.parse(id),
      sparsePartial(lessonInput).strict().parse(b),
    );
  }
  @Get('questions') questions(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.read(a, (f) => this.assessment.questions(f, p.teachingQuery.parse(q)));
  }
  @Get('questions/:id') question(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.read(a, (f) => this.assessment.question(f, p.teachingId.parse(id)));
  }
  @Get('questions/:id/versions') versions(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.read(a, (f) =>
      this.assessment.questionVersions(f, p.teachingId.parse(id), p.teachingPage.parse(q)),
    );
  }
  @Patch('questions/:id') async revise(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.assessment.updateQuestion(
      await this.current(a),
      p.teachingId.parse(id),
      p.teachingQuestionPatch.parse(b),
    );
  }
  @Post('questions/:id/copy') async copy(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    p.teachingEmpty.parse(b);
    return this.assessment.copyQuestion(await this.current(a), p.teachingId.parse(id));
  }
  @Get('papers') papers(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.read(a, (f) => this.assessment.papers(f, p.teachingQuery.parse(q)));
  }
  @Post('papers') async paper(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.assessment.createPaper(await this.current(a), schema.paperSchema.strict().parse(b));
  }
  @Get('assignments') assignments(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.read(a, (f) => this.assessment.assignments(f, p.teachingQuery.parse(q)));
  }
  @Get('assignments/:id') assignment(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.read(a, (f) => this.assessment.assignment(f, p.teachingId.parse(id)));
  }
  @Post('assignments') async createAssignment(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.assessment.createAssignment(await this.current(a), schema.assignmentSchema.strict().parse(b));
  }
  @Patch('assignments/:id') async updateAssignment(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.assessment.updateAssignment(
      await this.current(a),
      p.teachingId.parse(id),
      p.teachingAssignmentPatch.parse(b),
    );
  }
  @Post('assignments/:id/publish') async publishAssignment(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    p.teachingEmpty.parse(b);
    return this.assessment.publishAssignment(await this.current(a), p.teachingId.parse(id));
  }
  @Get('assignments/:id/roster') assignmentRoster(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.read(a, (f) =>
      this.assessment.assignmentRoster(f, p.teachingId.parse(id), p.teachingPage.parse(q)),
    );
  }
  @Post('assignments/:id/exceptions') async exception(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.assessment.assignmentException(
      await this.current(a),
      p.teachingId.parse(id),
      schema.exceptionSchema.strict().parse(b),
    );
  }
  @Post('submissions/:id/return') async returnSubmission(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.assessment.returnSubmission(
      await this.current(a),
      p.teachingId.parse(id),
      schema.returnSchema.strict().parse(b).reason,
    );
  }
  @Get('exams') exams(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.read(a, (f) => this.assessment.exams(f, p.teachingQuery.parse(q)));
  }
  @Get('exams/:id') exam(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.read(a, (f) => this.assessment.exam(f, p.teachingId.parse(id)));
  }
  @Post('exams') async createExam(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.assessment.createExam(await this.current(a), schema.examSchema.strict().parse(b));
  }
  @Patch('exams/:id') async updateExam(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.assessment.updateExam(
      await this.current(a),
      p.teachingId.parse(id),
      p.teachingExamPatch.parse(b),
    );
  }
  @Post('exams/:id/publish') async publishExam(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    p.teachingEmpty.parse(b);
    return this.assessment.publishExam(await this.current(a), p.teachingId.parse(id));
  }
  @Get('exams/:id/roster') examRoster(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.read(a, (f) =>
      this.assessment.examRoster(f, p.teachingId.parse(id), p.teachingPage.parse(q)),
    );
  }
  @Post('exams/:id/extension') async extension(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.assessment.extendExam(
      await this.current(a),
      p.teachingId.parse(id),
      schema.extensionSchema.strict().parse(b),
    );
  }
  @Post('exams/:id/eligibility') async eligibility(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.assessment.eligibility(
      await this.current(a),
      p.teachingId.parse(id),
      schema.eligibilitySchema.strict().parse(b),
    );
  }
  private async fileWhere(f: Actor, courseId: string) {
    const lessons = await this.db.lesson.findMany({
      where: { courseId },
      select: { attachmentId: true, attachmentIds: true },
    });
    const referenced = [
      ...new Set(lessons.flatMap((l) => [...(l.attachmentId ? [l.attachmentId] : []), ...l.attachmentIds])),
    ];
    return {
      organizationId: f.organizationId,
      courseId,
      exportJobId: null,
      OR: [{ ownerId: f.id }, { id: { in: referenced } }],
    };
  }
  @Get('courses/:id/files') async courseFiles(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    const f = await this.course(a, id),
      query = p.teachingPage.parse(q),
      where = await this.fileWhere(f, id);
    const [items, total, maxUploadBytes] = await Promise.all([
      this.db.attachment.findMany({
        where,
        select: { id: true, originalName: true, mime: true, size: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.attachment.count({ where }),
      this.uploads.maximumBytes(f),
    ]);
    await this.course(a, id);
    return { items, total, ...query, maxUploadBytes };
  }
  @Post('courses/:id/files')
  @UseInterceptors(UploadAdmissionInterceptor)
  async upload(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() b: unknown,
    @Req() req: { uploadLease: UploadOperation },
  ) {
    p.teachingEmpty.parse(b);
    return this.files.upload(
      await this.course(a, id),
      file,
      { courseId: id },
      req.uploadLease,
      async (tx, fresh) => {
        // Shared uploads authorize course reading; teacher maintenance also needs
        // current write permission and a non-archived course at commit time.
        await new AuthService(tx as PrismaService).course(fresh, id, true);
      },
    );
  }
  @Get('courses/:id/files/:fileId') async download(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scope = async () => {
      const f = await this.course(a, id);
      const row = await this.db.attachment.findFirst({
        where: { ...(await this.fileWhere(f, id)), id: p.teachingId.parse(fileId) },
      });
      if (!row) throw new NotFoundException('课件不存在或不属于可复用课程资源');
      if (row.size > 50 * 1024 * 1024) throw new BadRequestException('课件超过手机下载上限');
      return f;
    };
    const file = await this.files.download(await scope(), fileId);
    await recheckPrivateStream(file.stream, scope);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.stream, {
      type: file.mime,
      length: file.size,
      disposition: `attachment; filename="course-file"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    })
      .setErrorHandler((_e, r) => {
        if (r.destroyed) return;
        if (r.headersSent) {
          r.end();
          return;
        }
        r.statusCode = 404;
        r.send('课件暂不可用，请刷新后重试');
      })
      .setErrorLogger(() => {});
  }
}
