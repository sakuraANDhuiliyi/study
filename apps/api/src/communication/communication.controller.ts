import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { type Response } from 'express';
import { z } from 'zod';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { CommunicationService } from './communication.service';
import { UploadAdmissionInterceptor } from './upload-admission.interceptor';
import {
  attachmentSchema,
  directSchema,
  messageQuerySchema,
  moderateSchema,
  muteSchema,
  notificationQuerySchema,
  pagingSchema,
  parse,
  postQuerySchema,
  postSchema,
  postUpdateSchema,
  readSchema,
  replySchema,
  reportSchema,
  sendMessageSchema,
} from './communication.schemas';

@ApiTags('交流')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('communication')
export class CommunicationController {
  constructor(private readonly service: CommunicationService) {}

  @Get('posts')
  @ApiOperation({ summary: '当前课程范围内讨论，分页、关键词、作者、创建时间范围筛选' })
  posts(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.service.listPosts(actor, parse(postQuerySchema, query));
  }
  @Post('posts')
  @ApiOperation({ summary: '课程发帖，校验课程与附件归属' })
  createPost(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.createPost(actor, parse(postSchema, body));
  }
  @Get('posts/:id')
  @ApiOperation({ summary: '讨论详情与分页回复；默认第一页20条' })
  post(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() query: unknown) {
    const p = parse(pagingSchema, query);
    return this.service.getPost(actor, id, p.page, p.pageSize);
  }
  @Post('posts/:id/replies')
  @ApiOperation({ summary: '回复或引用同一讨论中的回复' })
  reply(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.reply(actor, id, parse(replySchema, body));
  }
  @Patch('posts/:id')
  @ApiOperation({ summary: '置顶、精华、关闭讨论；作者可标记解决' })
  updatePost(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.updatePost(actor, id, parse(postUpdateSchema, body));
  }
  @Get('contacts')
  @ApiOperation({ summary: '当前同课程的师生联系人，管理员不返回私人联系人' })
  contacts(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const p = parse(pagingSchema.extend({ q: z.string().max(80).default('') }), query);
    return this.service.contacts(actor, p.page, p.pageSize, p.q);
  }
  @Get('classes')
  @ApiOperation({ summary: '当前允许访问交流区的班级' })
  classes(@CurrentActor() actor: Actor) {
    return this.service.classes(actor);
  }
  @Post('classes/:classId/conversation')
  @ApiOperation({ summary: '进入当前授权班级的交流会话' })
  classConversation(@CurrentActor() actor: Actor, @Param('classId') classId: string) {
    return this.service.classConversation(actor, classId);
  }
  @Get('conversations')
  @ApiOperation({ summary: '会话列表、最后消息、准确未读数；重新校验当前成员资格' })
  conversations(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const p = parse(pagingSchema, query);
    return this.service.conversations(actor, p.page, p.pageSize);
  }
  @Post('conversations')
  @ApiOperation({ summary: '建立或恢复同课程师生私人会话' })
  directConversation(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.directConversation(actor, parse(directSchema, body).userId);
  }
  @Get('conversations/:id/messages')
  @ApiOperation({ summary: '消息历史；afterId补取断线期间消息，稳定游标排序' })
  messages(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() query: unknown) {
    return this.service.messages(actor, id, parse(messageQuerySchema, query));
  }
  @Post('conversations/:id/messages')
  @ApiOperation({ summary: '幂等发送消息；相同clientId不同正文返回409' })
  send(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.sendMessage(actor, id, parse(sendMessageSchema, body));
  }
  @Post('conversations/:id/read')
  @ApiOperation({ summary: '推进已读位置，禁止游标回退' })
  read(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.markConversationRead(actor, id, parse(readSchema, body).messageId);
  }
  @Delete('messages/:id')
  @ApiOperation({ summary: '两分钟内撤回本人消息' })
  retract(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.retract(actor, id);
  }
  @Post('reports')
  @ApiOperation({ summary: '举报当前可访问的内容' })
  report(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.report(actor, parse(reportSchema, body));
  }
  @Get('reports')
  @ApiOperation({ summary: '授权治理范围内举报元数据；不会暴露私人会话正文' })
  reports(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const p = parse(
      pagingSchema.extend({ status: z.enum(['PENDING', 'RESOLVED', 'DISMISSED', 'ALL']).default('PENDING') }),
      query,
    );
    return this.service.reports(actor, p.page, p.pageSize, p.status);
  }
  @Post('reports/:id/resolve')
  @ApiOperation({ summary: '隐藏公开内容或记录举报处理结论，事务内保留审计' })
  resolve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(moderateSchema, body);
    return this.service.resolveReport(actor, id, input.action, input.reason);
  }
  @Get('blocks')
  @ApiOperation({ summary: '本人屏蔽列表' })
  blocks(@CurrentActor() actor: Actor) {
    return this.service.blocks(actor);
  }
  @Post('blocks')
  @ApiOperation({ summary: '屏蔽对方私信' })
  block(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.setBlock(actor, parse(directSchema, body).userId, true);
  }
  @Delete('blocks/:userId')
  @ApiOperation({ summary: '解除本人设置的屏蔽' })
  unblock(@CurrentActor() actor: Actor, @Param('userId') userId: string) {
    return this.service.setBlock(actor, userId, false);
  }
  @Get('mutes')
  @ApiOperation({ summary: '当前治理范围的有效禁言列表' })
  mutes(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const p = parse(pagingSchema, query);
    return this.service.mutes(actor, p.page, p.pageSize);
  }
  @Post('mutes')
  @ApiOperation({ summary: '有原因与有效期的禁言；教师只能禁言当前教学范围学生' })
  mute(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.mute(actor, parse(muteSchema, body));
  }
  @Delete('mutes/:id')
  @ApiOperation({ summary: '解除授权范围内的禁言，保留原始记录' })
  unmute(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.unmute(actor, id);
  }
}

@ApiTags('通知')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: CommunicationService) {}
  @Get()
  @ApiOperation({ summary: '本人通知与未读计数，类型筛选和分页' })
  list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.service.notifications(actor, parse(notificationQuerySchema, query));
  }
  @Post('read-all')
  @ApiOperation({ summary: '本人通知全部标记已读' })
  all(@CurrentActor() actor: Actor) {
    return this.service.readNotification(actor);
  }
  @Post(':id/read')
  @ApiOperation({ summary: '本人单条通知标记已读' })
  read(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.readNotification(actor, id);
  }
}

@ApiTags('私有附件')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly service: CommunicationService) {}
  @Post('assignments/:id/export')
  @ApiOperation({ summary: '提交作业版本/附件归档任务；需要独立data.export与assessment.grade权限' })
  exportAssignment(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const { clientId } = parse(
      z.object({
        clientId: z
          .string()
          .min(8)
          .max(100)
          .regex(/^[a-zA-Z0-9_-]+$/),
      }),
      body,
    );
    return this.service.requestAssignmentExport(actor, id, clientId);
  }
  @Get('exports/:id')
  @ApiOperation({ summary: '导出申请人查询任务状态；成功返回私有attachmentId，当前权限仍须有效' })
  exportStatus(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.assignmentExportStatus(actor, id);
  }
  @Post()
  @ApiOperation({ summary: '上传私有文件，courseId、conversationId、assignmentId最多选择一种业务范围' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        courseId: { type: 'string' },
        conversationId: { type: 'string' },
        assignmentId: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(UploadAdmissionInterceptor)
  upload(
    @CurrentActor() actor: Actor,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    return this.service.upload(actor, file, parse(attachmentSchema, body), request.uploadLease);
  }
  @Delete(':id')
  @ApiOperation({ summary: '删除本人尚未被业务记录引用的附件' })
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.removeAttachment(actor, id);
  }
  @Get(':id/download')
  @ApiOperation({ summary: '每次下载重新校验当前业务权限，不提供公开永久链接' })
  async download(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.service.download(actor, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.stream, {
      type: file.mime,
      length: file.size,
      disposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
  }
  @Get(':id/preview')
  @ApiOperation({ summary: '图片/PDF/MP4授权预览；文档类型仍需下载' })
  async preview(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.service.download(actor, id);
    if (!file.mime.startsWith('image/') && !['application/pdf', 'video/mp4'].includes(file.mime)) {
      file.stream.destroy();
      throw new BadRequestException('此文件类型不支持在线预览，请下载后查看');
    }
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.stream, {
      type: file.mime,
      length: file.size,
      disposition: `inline; filename="preview"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
  }
}
