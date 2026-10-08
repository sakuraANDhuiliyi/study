import { z } from 'zod';
import { dateString } from '../common/utils';
const date = dateString.refine((value) => {
  const year = new Date(value).getUTCFullYear();
  return year >= 2000 && year <= 2100;
}, '日期须在 2000 至 2100 年之间');
export const plannerRange = z
  .object({
    start: date,
    end: date,
    type: z.enum(['all', 'assignment', 'exam', 'personal']).default('all'),
  })
  .strict()
  .refine(({ start, end }) => {
    const span = Date.parse(end) - Date.parse(start);
    return span > 0 && span <= 93 * 86400000;
  }, '查询范围须大于 0 且不超过 93 天');
export const taskInput = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine((v) => !v.includes('\0'), '不支持空字符'),
    description: z
      .string()
      .max(10000)
      .refine((v) => !v.includes('\0'), '不支持空字符')
      .default(''),
    dueAt: date,
  })
  .strict();
export const taskPatch = taskInput
  .partial()
  .extend({
    revision: z.number().int().nonnegative().max(2147483646),
    completed: z.boolean().optional(),
  })
  .strict();
export const taskDelete = z.object({ revision: z.number().int().nonnegative().max(2147483647) }).strict();
