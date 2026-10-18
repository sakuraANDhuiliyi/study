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
  accountMode?: string;
  majorId?: string | null;
  role: string;
  permissions: string[];
  name: string;
  sessionId?: string;
  csrfToken?: string;
  requestId?: string;
  clientType?: 'WEB' | 'MOBILE';
}
export function mobileRouteAllowed(path: string, method: string) {
  if (/^\/api\/mobile\/auth\/(me|logout)\/?$/.test(path)) return true;
  if (method === 'GET' && /^\/api\/mobile\/assignments(?:\/[^/]+(?:\/files\/[^/]+)?)?\/?$/.test(path))
    return true;
  if (method === 'PUT' && /^\/api\/mobile\/assignments\/[^/]+\/draft\/?$/.test(path)) return true;
  if (method === 'POST' && /^\/api\/mobile\/assignments\/[^/]+\/(submit|files)\/?$/.test(path)) return true;
  if (/^\/api\/live(?:\/|$)/.test(path)) return true;
  if (method === 'GET' && /^\/api\/courses(?:\/[^/]+)?\/?$/.test(path)) return true;
  if (method === 'GET' && /^\/api\/planner(?:\/actions(?:\/courses)?|\/tasks\/[^/]+)?\/?$/.test(path))
    return true;
  if (method === 'POST' && /^\/api\/planner\/tasks\/?$/.test(path)) return true;
  if (['PATCH', 'DELETE'].includes(method) && /^\/api\/planner\/tasks\/[^/]+\/?$/.test(path)) return true;
  return method === 'PUT' && /^\/api\/lessons\/[^/]+\/progress\/?$/.test(path);
}
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor,
);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const bearer = req.headers.authorization;
    const mobile = typeof bearer === 'string';
    if (mobile && (req.cookies?.lms_session || req.headers.origin))
      throw new ForbiddenException('手机会话不能与网页凭据混用');
    const actor = mobile
      ? await this.auth.resolveMobileAccess(/^Bearer (ma1_[A-Za-z0-9_-]{43})$/.exec(bearer)?.[1] || '')
      : await this.auth.resolveSession(req.cookies?.lms_session);
    if (!actor) throw new UnauthorizedException('登录已失效，请重新登录');
    if (mobile && !mobileRouteAllowed(req.path, req.method))
      throw new ForbiddenException('此操作请在网站中完成');
    if (!mobile && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
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
