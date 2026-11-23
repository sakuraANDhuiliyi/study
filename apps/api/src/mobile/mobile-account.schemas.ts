import { z } from 'zod';
import { ForbiddenException } from '@nestjs/common';
import { registrationSchema } from '../accounts/accounts.schemas';
import { username, password } from '../common/utils';

export const mobileRegistrationInput = registrationSchema
  .extend({ deviceName: z.string().trim().min(1).max(60) })
  .strict();
export const mobileRecoveryInput = z
  .object({ username, code: z.string().regex(/^lmsr_[A-Za-z0-9_-]{43}$/), newPassword: password })
  .strict();
export const mobileRecoveryCodeInput = z.object({ oldPassword: z.string().min(1).max(128) }).strict();
export const mobileRoleInput = z
  .object({ role: z.enum(['STUDENT', 'TEACHER', 'ADMIN', 'SUPER_ADMIN']) })
  .strict();
export const mobileSessionId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export function mobileAccountRouteAllowed(path: string, method: string) {
  if (method === 'GET' && /^\/api\/mobile\/auth\/(?:recovery|sessions)\/?$/.test(path)) return true;
  if (method === 'POST' && /^\/api\/mobile\/auth\/(?:recovery-code|role)\/?$/.test(path)) return true;
  return method === 'DELETE' && /^\/api\/mobile\/auth\/sessions\/[a-zA-Z0-9_-]{1,100}\/?$/.test(path);
}

export function assertPublicNativeAccountRequest(req: {
  headers: { origin?: unknown; authorization?: unknown };
  cookies?: { lms_session?: unknown };
}) {
  if (req.headers.origin || req.cookies?.lms_session || req.headers.authorization)
    throw new ForbiddenException('请使用独立手机会话，不能混用网页凭据');
}
