import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { recheckPrivateStream } from './private-stream';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AssessmentService } from '../assessment/assessment.service';
import { draftSchema, listSchema, submissionSchema } from '../assessment/assessment.schemas';
import { PrismaService } from '../common/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import { UploadAdmissionInterceptor } from '../communication/upload-admission.interceptor';
import { UploadSafetyService } from '../communication/upload-safety.service';

const querySchema = listSchema
  .pick({ page: true, pageSize: true, courseId: true, search: true })
  .extend({ pageSize: z.coerce.number().int().min(1).max(20).default(10) })
  .strict();
const nativeSubmission = submissionSchema
  .extend({
    expectedDraftRevision: z.number().int().min(0),
    expectedSubmissionVersion: z.number().int().min(0),
  })
  .strict();
const nativeDraft = draftSchema.strict();
const fileFields = {
  id: true,
  originalName: true,
  mime: true,
  size: true,
  ownerId: true,
  assignmentId: true,
  exportJobId: true,
} as const;
const fileDto = (f: { id: string; originalName: string; mime: string; size: number }) => ({
  id: f.id,
  name: f.originalName,
  mime: f.mime,
  size: f.size,
});

/** Student-only adapter: reuse assessment policies and expose no general file or grading scope. */
@Controller('mobile/assignments')
@UseGuards(AuthGuard)
export class MobileAssignmentsController {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private assessment: AssessmentService,
    private files: CommunicationService,
    private uploads: UploadSafetyService,
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
    const fresh = await this.current(a);
    const row = await this.db.assignment.findFirst({
      where: {
        id,
        organizationId: fresh.organizationId,
        status: 'published',
        audience: { some: { userId: fresh.id } },
      },
    });
    if (!row) throw new NotFoundException('作业不存在或没有访问资格');
    await this.auth.course(fresh, row.courseId);
    return { actor: fresh, assignment: row };
  }
  @Get()
  async list(@CurrentActor() a: Actor, @Query() query: unknown) {
    const current = await this.current(a),
      q = querySchema.parse(query);
    const before = (await this.auth.courseIds(current)).sort();
    const page = await this.assessment.assignments(current, q);
    const courseIds = [...new Set(page.items.map((x) => x.courseId))];
    const courses = await this.db.course.findMany({
      where: { id: { in: courseIds }, organizationId: a.organizationId },
      select: { id: true, title: true },
    });
    const after = await this.current(a);
    if (JSON.stringify(before) !== JSON.stringify((await this.auth.courseIds(after)).sort()))
      throw new ForbiddenException('课程资格已变化，请刷新作业列表');
    for (const item of page.items) await this.scope(after, item.id);
    return {
      ...page,
      items: page.items.map((x) => ({
        id: x.id,
        title: x.title,
        courseId: x.courseId,
        courseTitle: courses.find((c) => c.id === x.courseId)?.title || '',
        opensAt: x.opensAt,
        dueAt: x.dueAt,
        totalCents: x.totalCents,
        maxAttempts: x.maxAttempts,
        latest: x.submissions[0]
          ? {
              version: x.submissions[0].version,
              status: x.submissions[0].status,
              gradingStatus: x.submissions[0].gradingStatus,
              scoreCents: x.submissions[0].scoreCents,
              releasedAt: x.submissions[0].releasedAt,
            }
          : null,
      })),
      serverTime: new Date().toISOString(),
    };
  }
  @Get(':id')
  async detail(@CurrentActor() a: Actor, @Param('id') id: string) {
    const current = await this.current(a);
    const d = await this.assessment.assignment(current, id);
    const ids = [
      ...new Set([
        ...(d.items.length ? d.attachmentIds : []),
        ...(d.draft?.attachmentIds || []),
        ...d.mySubmissions.flatMap((s) => (s.attachmentIds || []) as string[]),
      ]),
    ];
    const files = await this.db.attachment.findMany({
      where: { id: { in: ids }, organizationId: current.organizationId, exportJobId: null },
      select: fileFields,
    });
    const maxUploadBytes = await this.uploads.maximumBytes(current);
    await this.scope(a, id);
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      courseId: d.courseId,
      opensAt: d.opensAt,
      dueAt: d.dueAt,
      allowLate: d.allowLate,
      maxAttempts: d.maxAttempts,
      totalCents: d.totalCents,
      items: d.items,
      draft: d.draft,
      exception: d.exception,
      mySubmissions: d.mySubmissions,
      attachmentIds: d.items.length ? d.attachmentIds : [],
      files: files.map(fileDto),
      maxUploadBytes,
      serverTime: new Date().toISOString(),
    };
  }
  @Put(':id/draft')
  async save(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const current = await this.current(a);
    return this.assessment.saveAssignmentDraft(current, id, nativeDraft.parse(body));
  }
  @Post(':id/submit')
  async submit(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const current = await this.current(a);
    return this.assessment.submitAssignment(current, id, nativeSubmission.parse(body));
  }
  @Post(':id/files')
  @UseInterceptors(UploadAdmissionInterceptor)
  async upload(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    z.object({}).strict().parse(body);
    const current = await this.current(a);
    const d = await this.assessment.assignment(current, id);
    if (d.exception?.exempt) throw new ConflictException('此作业已豁免，无需提交');
    // CommunicationService performs current membership, publication, type, quota and deadline checks.
    return this.files.upload(current, file, { assignmentId: id }, req.uploadLease);
  }
  @Get(':id/files/:fileId')
  async download(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = await this.assessment.assignment(await this.current(a), id);
    const referenced = new Set([
      ...(d.items.length ? d.attachmentIds : []),
      ...(d.draft?.attachmentIds || []),
      ...d.mySubmissions.flatMap((s) => (s.attachmentIds || []) as string[]),
    ]);
    const metadata = await this.db.attachment.findFirst({
      where: { id: fileId, organizationId: a.organizationId, exportJobId: null },
      select: fileFields,
    });
    if (!metadata || !(referenced.has(fileId) || (metadata.ownerId === a.id && metadata.assignmentId === id)))
      throw new NotFoundException('此文件不属于当前作业或本人提交');
    if (metadata.size > 50 * 1024 * 1024) throw new BadRequestException('文件超过手机端单次下载上限');
    const f = await this.files.download(a, fileId);
    await recheckPrivateStream(f.stream, () => this.scope(a, id));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(f.stream, {
      type: f.mime,
      length: f.size,
      disposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    })
      .setErrorHandler((_error, response) => {
        if (response.destroyed) return;
        if (response.headersSent) {
          response.end();
          return;
        }
        response.statusCode = 404;
        response.send('作业附件暂不可用，请刷新后重试');
      })
      .setErrorLogger(() => {});
  }
}
