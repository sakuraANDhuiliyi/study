import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { finalize } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { UploadSafetyService } from './upload-safety.service';

@Injectable()
export class UploadAdmissionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UploadAdmissionInterceptor.name);
  constructor(
    private readonly auth: AuthService,
    private readonly safety: UploadSafetyService,
  ) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    this.auth.require(request.actor, 'file.upload');
    if (request.aborted || request.destroyed) throw new BadRequestException('上传连接已中断');
    const bytes = await this.safety.maximumBytes(request.actor);
    const lease = await this.safety.reserve(request.actor, bytes);
    request.uploadLease = lease;
    const release = () =>
      void this.safety
        .release(lease.id)
        .catch(() => this.logger.error('Upload reservation cleanup will retry'));
    let fail!: (error: Error) => void;
    const stopped = new Promise<never>((_, reject) => {
      fail = reject;
    });
    const aborted = () => fail(new BadRequestException('上传连接已中断'));
    request.once('aborted', aborted);
    const timeout = setTimeout(() => {
      request.destroy();
      fail(new RequestTimeoutException('上传超时，请重试'));
    }, 60000);
    timeout.unref();
    try {
      if (request.aborted || request.destroyed) throw new BadRequestException('上传连接已中断');
      const Parser = FileInterceptor('file', {
        storage: memoryStorage(),
        limits: {
          fileSize: bytes,
          files: 1,
          fields: 3,
          parts: 4,
          fieldSize: 1024,
          fieldNameSize: 100,
          headerPairs: 100,
        },
      });
      const result = await Promise.race([new Parser().intercept(context, next), stopped]);
      clearTimeout(timeout);
      request.removeListener('aborted', aborted);
      return result.pipe(finalize(release));
    } catch (error) {
      clearTimeout(timeout);
      request.removeListener('aborted', aborted);
      await this.safety.release(lease.id);
      throw error;
    }
  }
}
