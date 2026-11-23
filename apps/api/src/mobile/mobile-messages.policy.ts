import { communicationAttachmentIds } from './mobile-communication-files.policy';
import { z } from 'zod';
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const page = (max: number, fallback: number) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().min(1).max(max))
    .default(fallback);
export const mobileMessageId = id;
export const mobileMessagePage = z.object({ page: page(100000, 1), pageSize: page(50, 20) }).strict();
export const mobileContactQuery = mobileMessagePage.extend({ q: z.string().max(80).default('') }).strict();
export const mobileMessageQuery = mobileMessagePage.extend({ afterId: id.optional() }).strict();
export const mobileDirectInput = z.object({ userId: id }).strict();
export const mobileMessageInput = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(10000)
      .refine((v) => !v.includes('\0')),
    attachmentIds: communicationAttachmentIds.optional(),
    clientId: z
      .string()
      .min(8)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
  })
  .strict();
export const mobileMessageReadInput = z.object({ messageId: id }).strict();
export const mobileMessageReportInput = z
  .object({
    targetType: z.enum(['post', 'reply', 'message']),
    targetId: id,
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export function mobileMessagesRouteAllowed(path: string, method: string) {
  const root = '/api/mobile/messages',
    key = '[a-zA-Z0-9_-]{1,100}';
  if (method === 'GET')
    return (
      new RegExp(`^${root}/(?:contacts|classes|conversations)/?$`).test(path) ||
      new RegExp(`^${root}/conversations/${key}/messages/?$`).test(path) ||
      new RegExp(`^${root}/conversations/${key}/files/${key}/?$`).test(path)
    );
  if (method === 'POST')
    return (
      new RegExp(`^${root}/(?:conversations|reports)/?$`).test(path) ||
      new RegExp(`^${root}/classes/${key}/conversation/?$`).test(path) ||
      new RegExp(`^${root}/conversations/${key}/(?:messages|read)/?$`).test(path)
    );
  return method === 'DELETE' && new RegExp(`^${root}/messages/${key}/?$`).test(path);
}
