import { z } from 'zod';
import { noteQuery } from './notes.schemas';

const noNul = (value: string) => !value.includes('\0');
const category = z
  .string()
  .trim()
  .max(60)
  .refine(noNul, '分类不能包含空字符')
  .nullable()
  .transform((value) => value || null);
const content = {
  title: z.string().trim().min(1, '请填写笔记标题').max(120).refine(noNul, '标题不能包含空字符'),
  category,
  body: z
    .string()
    .max(10000)
    .refine((value) => value.trim().length > 0, '请填写笔记内容')
    .refine(noNul, '正文不能包含空字符'),
  pinned: z.boolean(),
};

export const standaloneCreate = z
  .object({ ...content, category: category.optional(), pinned: content.pinned.default(false) })
  .strict();
export const standalonePatch = z
  .object(content)
  .partial()
  .extend({
    revision: z.number().int().min(1).max(2147483646),
  })
  .strict()
  .refine((data) => Object.keys(content).some((key) => key in data), '请提供需要修改的字段');
export const standaloneDelete = z.object({ revision: z.number().int().min(1).max(2147483647) }).strict();
export const standaloneId = z.string().min(1).max(100).refine(noNul);
export const combinedNoteQuery = noteQuery
  .extend({
    search: z.string().trim().max(120).refine(noNul).optional(),
    courseId: standaloneId.optional(),
    category: z.string().trim().min(1).max(60).refine(noNul).optional(),
    source: z.enum(['all', 'lesson', 'standalone']),
  })
  .strict();
export type CombinedNoteQuery = z.infer<typeof combinedNoteQuery>;
