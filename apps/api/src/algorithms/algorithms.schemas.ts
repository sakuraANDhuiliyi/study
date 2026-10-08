import { z } from 'zod';

export const algorithmLanguage = z.enum(['cpp', 'python', 'javascript', 'java']);
export type AlgorithmLanguage = z.infer<typeof algorithmLanguage>;
const text = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((v) => !v.includes('\0'), '不能包含空字符');
const code = text(16000).refine((v) => Buffer.byteLength(v, 'utf8') <= 48000, '代码过长');
export const algorithmPagination = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const algorithmProblemQuery = algorithmPagination.extend({
  q: text(100).default(''),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  tag: text(60).optional(),
  status: z.enum(['todo', 'attempted', 'solved']).optional(),
  favorite: z.enum(['true', 'false']).optional(),
  review: z.enum(['review', 'mastered']).optional(),
});
export const algorithmLearningInput = z
  .object({
    revision: z.number().int().min(0).max(2147483646),
    favorite: z.boolean().optional(),
    reviewStatus: z.enum(['none', 'review', 'mastered']).optional(),
    note: text(12000)
      .refine((v) => Buffer.byteLength(v, 'utf8') <= 36000, '笔记过长')
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.favorite !== undefined || value.reviewStatus !== undefined || value.note !== undefined,
    '请提供需要修改的学习状态',
  );
export type AlgorithmLearningInput = z.infer<typeof algorithmLearningInput>;
export const algorithmDraftInput = z.object({ language: algorithmLanguage, code }).strict();
export const algorithmSubmissionInput = algorithmDraftInput
  .extend({
    code: code.refine((v) => v.trim().length > 0, '请先编写代码'),
    mode: z.enum(['run', 'submit']),
    stdin: text(16000)
      .refine((v) => Buffer.byteLength(v, 'utf8') <= 32000, '输入过长')
      .optional(),
  })
  .refine((v) => v.mode === 'run' || v.stdin === undefined, '正式提交不能提供自定义输入');
export const algorithmAnalysisInput = algorithmDraftInput.extend({
  mode: z.enum(['hint', 'explain', 'debug']),
  submissionId: text(100, 1).optional(),
});
export const algorithmAnalysisContent = z
  .object({
    summary: text(3000, 1),
    approach: z.array(text(2000, 1)).min(1).max(12),
    complexity: text(2000, 1),
    pitfalls: z.array(text(1000, 1)).max(12),
    suggestedCode: text(16000),
  })
  .strict();
export type AlgorithmSubmissionInput = z.infer<typeof algorithmSubmissionInput>;
export type AlgorithmAnalysisInput = z.infer<typeof algorithmAnalysisInput>;
export type AlgorithmAnalysisContent = z.infer<typeof algorithmAnalysisContent>;
