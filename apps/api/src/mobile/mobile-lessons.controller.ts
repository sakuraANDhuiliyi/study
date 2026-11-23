import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  NotFoundException,
  Param,
  Put,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import { progressInput, saveLessonProgress } from '../courses/lesson-progress';
import { recheckPrivateStream } from './private-stream';
import { byteRange } from '../communication/byte-range';
const nativeProgress = progressInput
  .extend({ expectedUpdatedAt: progressInput.shape.expectedUpdatedAt.unwrap() })
  .strict();
const fileSelect = { id: true, originalName: true, mime: true, size: true } as const;
@Controller('mobile/lessons')
@UseGuards(AuthGuard)
export class MobileLessonsController {
  private mediaActive = new Map<string, number>();
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private files: CommunicationService,
  ) {}
  private async scope(a: Actor, id: string) {
    if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT') throw new ForbiddenException('请使用学生手机会话');
    const fresh = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (!fresh || fresh.id !== a.id || fresh.role !== a.role || fresh.organizationId !== a.organizationId)
      throw new UnauthorizedException('会话已变化，请重新登录');
    this.auth.require(fresh, 'learning.use');
    await this.auth.checkFeature(fresh, '/api/courses');
    const l = await this.db.lesson.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('课时不存在');
    await this.auth.course(fresh, l.courseId);
    if (l.opensAt && l.opensAt > new Date()) throw new ForbiddenException('课时尚未开放');
    return l;
  }
  @Get(':id') async detail(@CurrentActor() a: Actor, @Param('id') id: string) {
    const l = await this.scope(a, id);
    const resources = await this.db.attachment.findMany({
      where: {
        id: { in: [...(l.attachmentId ? [l.attachmentId] : []), ...l.attachmentIds] },
        organizationId: a.organizationId,
        courseId: l.courseId,
        exportJobId: null,
      },
      select: fileSelect,
    });
    const progress = await this.db.learningProgress.findUnique({
      where: { userId_lessonId: { userId: a.id, lessonId: id } },
      select: { completed: true, positionSeconds: true, updatedAt: true },
    });
    const after = await this.scope(a, id);
    if (
      JSON.stringify([l.attachmentId, l.attachmentIds]) !==
      JSON.stringify([after.attachmentId, after.attachmentIds])
    )
      throw new ForbiddenException('课时资源已变化，请刷新');
    return {
      id: l.id,
      title: l.title,
      type: l.type,
      content: l.content,
      resourceUrl: l.resourceUrl,
      attachmentId: l.attachmentId,
      progress,
      files: resources.map((f) => ({ id: f.id, name: f.originalName, mime: f.mime, size: f.size })),
    };
  }
  @Put(':id/progress') async progress(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.scope(a, id);
    return saveLessonProgress(this.db, a, id, nativeProgress.parse(body));
  }
  @Get(':id/files/:fileId') async download(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const check = async () => {
      const l = await this.scope(a, id);
      if (fileId !== l.attachmentId && !l.attachmentIds.includes(fileId))
        throw new NotFoundException('文件不属于当前课时');
      const f = await this.db.attachment.findFirst({
        where: { id: fileId, organizationId: a.organizationId, courseId: l.courseId, exportJobId: null },
        select: fileSelect,
      });
      if (!f) throw new NotFoundException('课时文件不存在');
      if (f.size > 50 * 1024 * 1024)
        throw new BadRequestException('资源超过手机端单次下载上限50 MiB，请在网页查看');
      return f;
    };
    await check();
    const f = await this.files.download(a, fileId);
    await recheckPrivateStream(f.stream, check);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(f.stream, {
      type: f.mime,
      length: f.size,
      disposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    })
      .setErrorHandler((_e, r) => {
        if (r.destroyed) return;
        if (r.headersSent) {
          r.end();
          return;
        }
        r.statusCode = 404;
        r.send('课时资源暂不可用，请刷新后重试');
      })
      .setErrorLogger(() => {});
  }
  @Get(':id/media/:fileId') async media(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('range') requestedRange?: string,
  ) {
    const key = a.organizationId + ':' + a.id;
    if (
      (this.mediaActive.get(key) || 0) >= 4 ||
      [...this.mediaActive.values()].reduce((sum, n) => sum + n, 0) >= 64
    )
      throw new HttpException('视频连接较多，请关闭其他播放窗口后重试', 429);
    this.mediaActive.set(key, (this.mediaActive.get(key) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = (this.mediaActive.get(key) || 1) - 1;
      if (next) this.mediaActive.set(key, next);
      else this.mediaActive.delete(key);
    };
    const check = async () => {
      const lesson = await this.scope(a, id);
      if (lesson.type !== 'VIDEO' || lesson.attachmentId !== fileId)
        throw new NotFoundException('视频不属于当前课时');
      const file = await this.db.attachment.findFirst({
        where: { id: fileId, organizationId: a.organizationId, courseId: lesson.courseId, exportJobId: null },
        select: fileSelect,
      });
      if (!file) throw new NotFoundException('视频不存在');
      if (file.mime !== 'video/mp4')
        throw new BadRequestException('此课程视频不支持原生分段播放，请下载后打开');
      return file;
    };
    try {
      const metadata = await check();
      let range: ReturnType<typeof byteRange>;
      try {
        range = byteRange(requestedRange, metadata.size);
      } catch {
        res.setHeader('Content-Range', `bytes */${metadata.size}`);
        throw new HttpException('请求的视频范围无效', 416);
      }
      const file = await this.files.download(a, fileId, range || undefined);
      await recheckPrivateStream(file.stream, check);
      if (file.size !== metadata.size) {
        file.stream.destroy();
        throw new BadRequestException('视频内容已变化，请重新加载');
      }
      let checking = false;
      const timer = setInterval(() => {
        if (checking) return;
        checking = true;
        void check()
          .catch(() => file.stream.destroy())
          .finally(() => {
            checking = false;
          });
      }, 5000);
      timer.unref();
      const clear = () => {
        clearInterval(timer);
        release();
      };
      file.stream.once('close', clear);
      file.stream.once('error', clear);
      res.once('close', () => {
        file.stream.destroy();
        clear();
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Accept-Ranges', 'bytes');
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
      }
      return new StreamableFile(file.stream, {
        type: file.mime,
        length: range ? range.end - range.start + 1 : file.size,
        disposition: 'inline; filename="lesson.mp4"',
      })
        .setErrorHandler((_e, r) => {
          clear();
          if (r.destroyed) return;
          if (r.headersSent) {
            r.end();
            return;
          }
          r.statusCode = 404;
          r.send('课时视频暂不可用，请重新加载');
        })
        .setErrorLogger(() => {});
    } catch (error) {
      release();
      throw error;
    }
  }
}
