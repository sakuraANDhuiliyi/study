import { z } from 'zod';
import { getAlgorithmProblem } from './algorithms.catalog';

export const trainingPlanLimits = { maxPlans: 20, maxProblems: 50 } as const;
const plainText = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !value.includes('\0'), '不能包含空字符');
const title = z
  .string()
  .max(120)
  .trim()
  .min(1, '请填写训练计划名称')
  .refine((value) => !value.includes('\0'), '不能包含空字符');
const description = plainText(800);
const problemIds = z
  .array(plainText(100, 1))
  .min(1, '请至少选择一道题')
  .max(trainingPlanLimits.maxProblems, '每份计划最多选择50道题')
  .refine((ids) => new Set(ids).size === ids.length, '同一计划不能重复选择题目')
  .refine((ids) => ids.every((id) => !!getAlgorithmProblem(id)), '计划包含不存在的算法题');
const revision = z.number().int().min(0).max(2147483646);

export const trainingPlanCreate = z
  .object({ title, description: description.default(''), problemIds })
  .strict();
export const trainingPlanPatch = z
  .object({
    revision,
    title: title.optional(),
    description: description.optional(),
    problemIds: problemIds.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.problemIds !== undefined ||
      value.archived !== undefined,
    '请提供需要修改的训练计划内容',
  );
export const trainingPlanDelete = z.object({ revision }).strict();
