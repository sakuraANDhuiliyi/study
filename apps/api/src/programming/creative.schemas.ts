import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
export const creativeListQuery = z
  .object({
    q: z.string().trim().max(100).default(''),
    category: z.string().trim().max(64).default(''),
    collection: z.enum(['all', 'saved']).default('all'),
    edition: z.enum(['all', 'new', 'foundation']).default('all'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(24).default(12),
  })
  .strict();
export const creativeFavoriteInput = z.object({ saved: z.boolean() }).strict();
export const creativeRevisionInput = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const creativeProjectInput = creativeRevisionInput.extend({ title: text(160) }).strict();
export type CreativeListQuery = z.infer<typeof creativeListQuery>;
