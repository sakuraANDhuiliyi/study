import { z } from 'zod';
export const discussionId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const discussionPaging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(10),
});
export const discussionListQuery = discussionPaging
  .extend({
    courseId: discussionId.optional(),
    search: z.string().trim().max(100).default(''),
    featured: z.enum(['true', 'false']).optional(),
  })
  .strict();
const text = z
  .string()
  .trim()
  .min(1)
  .max(10000)
  .refine((s) => !s.includes('\0'));
export const mobilePostSchema = z
  .object({
    courseId: discussionId,
    title: text.pipe(z.string().max(160)),
    body: text,
    key: discussionId.min(8),
  })
  .strict();
export const mobileReplySchema = z
  .object({ body: text, quoteReplyId: discussionId.optional(), key: discussionId.min(8) })
  .strict();
