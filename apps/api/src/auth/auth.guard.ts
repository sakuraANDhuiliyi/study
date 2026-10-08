import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { AuthService } from './auth.service';
export interface Actor {
  id: string;
  organizationId: string;
  role: string;
  permissions: string[];
  name: string;
  sessionId?: string;
  csrfToken?: string;
  requestId?: string;
}
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor,
);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const actor = await this.auth.resolveSession(req.cookies?.lms_session);
    if (!actor) throw new UnauthorizedException('登录已失效，请重新登录');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.headers['x-csrf-token'] || req.headers['x-csrf-token'] !== actor.csrfToken)
        throw new ForbiddenException('安全校验失败，请刷新页面');
      const origin = req.headers.origin;
      if (origin && origin !== process.env.APP_ORIGIN) throw new ForbiddenException('请求来源不被允许');
    }
    await this.auth.checkFeature(actor, req.path);
    req.actor = { ...actor, requestId: req.requestId };
    return true;
  }
}
