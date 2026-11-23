import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import type { UploadOperation } from '@prisma/client';
import { UploadSafetyService } from '../communication/upload-safety.service';
import { UploadAdmissionInterceptor } from '../communication/upload-admission.interceptor';
import { communicationFileEmpty, communicationFilesQuery } from './mobile-communication-files.policy';
import type { Response } from 'express';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import * as policy from './mobile-messages.policy';
import { recheckPrivateStream } from './private-stream';

@Controller('mobile/messages')
@UseGuards(AuthGuard)
export class MobileMessagesController {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly service: CommunicationService,
    private readonly uploads: UploadSafetyService,
  ) {}
  private async scope(actor: Actor) {
    if (actor.clientType !== 'MOBILE') throw new ForbiddenException('请使用独立手机会话');
    const current = await this.auth.resolveMobileSessionId(actor.sessionId!);
    if (
      !current ||
      current.id !== actor.id ||
      current.role !== actor.role ||
      current.organizationId !== actor.organizationId
    )
      throw new UnauthorizedException('登录身份已变化，请重新登录');
    await this.auth.checkFeature(current, '/api/communication');
    this.auth.require(current, 'communication.read');
    return current;
  }
  @Get('contacts') async contacts(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const q = policy.mobileContactQuery.parse(query);
    return this.service.contacts(await this.scope(actor), q.page, q.pageSize, q.q);
  }
  @Get('classes') async classes(@CurrentActor() actor: Actor) {
    return this.service.classes(await this.scope(actor));
  }
  @Post('classes/:classId/conversation') async classConversation(
    @CurrentActor() actor: Actor,
    @Param('classId') id: string,
  ) {
    const c = await this.service.classConversation(await this.scope(actor), policy.mobileMessageId.parse(id));
    return { id: c.id, title: c.title, kind: c.kind };
  }
  @Get('conversations') async conversations(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const q = policy.mobileMessagePage.parse(query),
      result = await this.service.conversations(await this.scope(actor), q.page, q.pageSize);
    return {
      ...result,
      items: result.items.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        updatedAt: c.updatedAt,
        unreadCount: c.unreadCount,
        lastMessage: c.lastMessage,
      })),
    };
  }
  @Post('conversations') async direct(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const q = policy.mobileDirectInput.parse(body),
      c = await this.service.directConversation(await this.scope(actor), q.userId);
    return { id: c.id, title: c.title, kind: c.kind };
  }
  @Get('conversations/:id/messages') async messages(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.service.messages(
      await this.scope(actor),
      policy.mobileMessageId.parse(id),
      policy.mobileMessageQuery.parse(query),
    );
  }
  @Post('conversations/:id/messages') async send(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = policy.mobileMessageInput.parse(body),
      result = await this.service.sendMessage(await this.scope(actor), policy.mobileMessageId.parse(id), {
        ...input,
        attachmentIds: input.attachmentIds || [],
      });
    // A receipt never returns raw hidden/retracted content from an idempotent replay.
    return {
      id: result.id,
      conversationId: result.conversationId,
      clientId: result.clientId,
      createdAt: result.createdAt,
    };
  }
  @Post('conversations/:id/read') async read(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.markConversationRead(
      await this.scope(actor),
      policy.mobileMessageId.parse(id),
      policy.mobileMessageReadInput.parse(body).messageId,
    );
  }
  @Delete('messages/:id') async retract(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.retract(await this.scope(actor), policy.mobileMessageId.parse(id));
  }
  @Post('reports') async report(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const result = await this.service.report(
      await this.scope(actor),
      policy.mobileMessageReportInput.parse(body),
    );
    return { id: result.id, status: result.status };
  }
  @Get('conversations/:id/files') async files(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    policy.mobileMessageId.parse(id);
    const q = communicationFilesQuery.parse(query),
      current = await this.scope(actor);
    await this.service.conversationAccess(current, id);
    const where = {
      organizationId: current.organizationId,
      ownerId: current.id,
      conversationId: id,
      courseId: null,
      assignmentId: null,
      exportJobId: null,
    };
    const [rows, total, maxUploadBytes] = await Promise.all([
      this.db.attachment.findMany({
        where,
        select: { id: true, originalName: true, mime: true, size: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.attachment.count({ where }),
      this.uploads.maximumBytes(current),
    ]);
    await this.service.conversationAccess(await this.scope(actor), id);
    return {
      items: rows.map(({ originalName, ...r }) => ({ ...r, name: originalName })),
      total,
      ...q,
      maxUploadBytes,
    };
  }
  @Post('conversations/:id/files')
  @UseInterceptors(UploadAdmissionInterceptor)
  async upload(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() req: { uploadLease: UploadOperation },
  ) {
    policy.mobileMessageId.parse(id);
    communicationFileEmpty.parse(body);
    const current = await this.scope(actor);
    await this.service.conversationAccess(current, id, true);
    return this.service.upload(current, file, { conversationId: id }, req.uploadLease);
  }
  @Delete('conversations/:id/files/:fileId') async removeFile(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    policy.mobileMessageId.parse(id);
    policy.mobileMessageId.parse(fileId);
    const current = await this.scope(actor);
    await this.service.conversationAccess(current, id);
    if (
      !(await this.db.attachment.findFirst({
        where: {
          id: fileId,
          organizationId: current.organizationId,
          ownerId: current.id,
          conversationId: id,
          courseId: null,
          assignmentId: null,
          exportJobId: null,
        },
        select: { id: true },
      }))
    )
      throw new NotFoundException('附件不存在或不属于本会话');
    return this.service.removeAttachment(current, fileId);
  }
  @Get('conversations/:id/files/:fileId') async download(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    policy.mobileMessageId.parse(id);
    policy.mobileMessageId.parse(fileId);
    const check = async () => {
      const current = await this.scope(actor);
      // The service rechecks the current conversation membership; a file must also be published in a visible message.
      await this.service.messages(current, id, { page: 1, pageSize: 1 });
      const file = await this.db.attachment.findFirst({
        where: { id: fileId, organizationId: current.organizationId, conversationId: id, exportJobId: null },
      });
      if (
        !file ||
        !(await this.db.message.findFirst({
          where: {
            conversationId: id,
            organizationId: current.organizationId,
            attachmentIds: { has: fileId },
            hidden: false,
            retractedAt: null,
          },
        }))
      )
        throw new NotFoundException('此消息附件不可访问');
      if (file.size > 50 * 1024 * 1024)
        throw new BadRequestException('附件超过手机端50 MiB下载上限，请使用网页');
      return current;
    };
    const current = await check(),
      file = await this.service.download(current, fileId);
    await recheckPrivateStream(file.stream, check);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.stream, {
      type: file.mime,
      length: file.size,
      disposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    }).setErrorHandler((_error, response) => {
      if (response.destroyed) return;
      if (!response.headersSent) response.statusCode = 404;
      response.end();
    });
  }
}
