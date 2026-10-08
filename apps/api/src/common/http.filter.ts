import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private logger = new Logger('HTTP');
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp(),
      req = ctx.getRequest(),
      res = ctx.getResponse();
    let status = 500,
      message = '服务器处理失败，请稍后重试',
      fields: unknown;
    if (error instanceof ZodError) {
      status = 400;
      message = '请检查输入内容';
      fields = error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      message = typeof body === 'string' ? body : (body as any).message;
      fields = typeof body === 'object' ? (body as any).fields : undefined;
    } else if ((error as any)?.type === 'entity.parse.failed') {
      status = 400;
      message = '请求内容不是有效的 JSON';
    } else if ((error as any)?.type === 'entity.too.large') {
      status = 413;
      message = '请求内容超过允许大小';
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2002', 'P2034'].includes(error.code)) {
        status = 409;
        message = '数据已存在或发生并发冲突，请刷新后重试';
      } else if (error.code === 'P2025') {
        status = 404;
        message = '资源不存在';
      } else if (error.code === 'P2003') {
        status = 400;
        message = '引用的数据无效，或正在被历史记录使用';
      }
    }
    if (status === 500)
      this.logger.error(
        JSON.stringify({
          requestId: req.requestId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          code: (error as any)?.code || null,
        }),
      );
    res.status(status).json({
      error: { code: status, message, fields, requestId: req.requestId },
      message,
      requestId: req.requestId,
    });
  }
}
