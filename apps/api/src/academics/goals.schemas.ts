import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\0'), '不能包含空字符');
const revision = z.number().int().min(0).max(2147483646);
export const academicGoalDate = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$|^2100-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '请选择2000至2100年的有效日期');
export const academicGoalQuery = z
  .object({ status: z.enum(['active', 'archived', 'all']).default('active') })
  .strict();
export const academicGoalCreate = z
  .object({
    moduleId: text(100),
    title: text(160),
    targetCount: z.number().int().min(1).max(1000),
    dueDate: academicGoalDate.nullable().optional(),
  })
  .strict();
export const academicGoalPatch = academicGoalCreate
  .omit({ moduleId: true })
  .partial()
  .extend({
    revision,
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.targetCount !== undefined ||
      value.dueDate !== undefined ||
      value.archived !== undefined,
    '请提供要更新的内容',
  );
export const academicGoalDelete = z.object({ revision }).strict();
