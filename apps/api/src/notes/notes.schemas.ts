import { z } from 'zod';
export const noteInput = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, '请填写笔记内容')
      .max(10000, '笔记最多 10000 个字符')
      .refine((value) => !value.includes('\u0000'), '笔记不能包含空字符'),
    pinned: z.boolean().default(false),
    revision: z.number().int().min(0).max(2147483646),
    noteId: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => (value.revision === 0 ? value.noteId === undefined : !!value.noteId), {
    path: ['noteId'],
    message: '更新笔记必须提供读取时的笔记标识，新建时不得指定标识',
  });
export const noteQuery = z.object({
  search: z.string().trim().max(120).optional(),
  courseId: z.string().min(1).max(100).optional(),
  pinned: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const noteDelete = z
  .object({ revision: z.number().int().min(1).max(2147483647), noteId: z.string().min(1).max(100) })
  .strict();
