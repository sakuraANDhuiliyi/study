import { z } from 'zod';
const page = (max: number, fallback: number) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().min(1).max(max))
    .default(fallback);
export const mobileAdminPage = z.object({ page: page(100000, 1), pageSize: page(50, 20) });
export const mobileAdminReportQuery = mobileAdminPage
  .extend({ status: z.enum(['PENDING', 'RESOLVED', 'DISMISSED', 'ALL']).default('PENDING') })
  .strict();
export const mobileAdminReportResolution = z
  .object({ action: z.enum(['hide', 'dismiss']), reason: z.string().trim().min(3).max(1000) })
  .strict();
export const mobileAdminId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const mobileAdminAuditQuery = mobileAdminPage
  .extend({
    search: z.string().trim().max(200).optional(),
    action: z.string().max(200).optional(),
    resourceType: z.string().max(100).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || new Date(v.from) <= new Date(v.to), '开始时间不能晚于结束时间');
const reason = z.string().trim().min(5).max(500);
export const mobileAdminSettingInput = z.discriminatedUnion('key', [
  z.object({ key: z.literal('platformName'), value: z.string().trim().min(1).max(80), reason }).strict(),
  z.object({ key: z.literal('notificationEnabled'), value: z.boolean(), reason }).strict(),
  z
    .object({
      key: z.literal('features'),
      value: z
        .object({ practice: z.boolean(), communication: z.boolean(), live: z.boolean().optional() })
        .strict(),
      reason,
    })
    .strict(),
  z.object({ key: z.literal('maxUploadMB'), value: z.number().int().min(1).max(50), reason }).strict(),
  z
    .object({
      key: z.literal('loginPolicy'),
      value: z.object({ sessionHours: z.number().int().min(1).max(72) }).strict(),
      reason,
    })
    .strict(),
]);
export const mobileAdminSettingKeys = [
  'platformName',
  'notificationEnabled',
  'features',
  'maxUploadMB',
  'loginPolicy',
] as const;
export function mobileAdminControlsRouteAllowed(path: string, method: string) {
  if (method === 'GET') return /^\/api\/mobile\/admin-controls\/(reports|audit|settings)\/?$/.test(path);
  if (method === 'PATCH') return /^\/api\/mobile\/admin-controls\/settings\/?$/.test(path);
  return (
    method === 'POST' &&
    /^\/api\/mobile\/admin-controls\/reports\/[a-zA-Z0-9_-]{1,100}\/resolve\/?$/.test(path)
  );
}
