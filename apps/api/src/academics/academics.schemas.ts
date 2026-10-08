import { z } from 'zod';
const text = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !v.includes('\0'), '不能包含空字符');
export const academicPreferencesInput = z
  .object({
    revision: z.number().int().min(0).max(2147483646),
    selectedModuleIds: z.array(text(100, 1)).max(60),
    majorId: text(100, 1).nullable().optional(),
  })
  .strict();
export const academicEvaluationInput = z
  .object({ title: text(160, 1).optional(), values: z.record(z.unknown()) })
  .strict()
  .refine((v) => Object.keys(v.values).length <= 60, '输入字段过多');
export const academicRecordQuery = z
  .object({
    moduleId: text(100, 1).optional(),
    status: z.enum(['all', 'DRAFT', 'COMPLETED']).default('all'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(12),
  })
  .strict();
export const academicRecordPatch = z
  .object({
    revision: z.number().int().min(0).max(2147483646),
    title: text(160, 1).optional(),
    notes: z
      .string()
      .max(12000)
      .refine((v) => !v.includes('\0') && Buffer.byteLength(v) <= 36000, '笔记过长或包含空字符')
      .optional(),
    status: z.enum(['DRAFT', 'COMPLETED']).optional(),
  })
  .strict()
  .refine(
    (v) => v.title !== undefined || v.notes !== undefined || v.status !== undefined,
    '请提供要更新的内容',
  );
export const academicSubjectCreate = z
  .object({ name: text(100, 1), description: text(4000).default('') })
  .strict();
export const academicSubjectPatch = academicSubjectCreate
  .partial()
  .extend({ revision: z.number().int().min(0).max(2147483646), active: z.boolean().optional() })
  .strict()
  .refine(
    (v) => v.name !== undefined || v.description !== undefined || v.active !== undefined,
    '请提供更新内容',
  );
export const academicMajorCreate = academicSubjectCreate
  .extend({ subjectId: text(100, 1), moduleIds: z.array(text(100, 1)).min(1).max(60) })
  .strict();
export const academicMajorPatch = academicMajorCreate
  .partial()
  .extend({ revision: z.number().int().min(0).max(2147483646), active: z.boolean().optional() })
  .strict()
  .refine(
    (v) =>
      ['name', 'description', 'active', 'subjectId', 'moduleIds'].some(
        (k) => (v as Record<string, unknown>)[k] !== undefined,
      ),
    '请提供更新内容',
  );
