import { z } from 'zod';
import { password, username } from '../common/utils';

export const majorIdSchema = z.string().trim().min(1).max(100).nullable();
export const registrationSchema = z
  .object({
    username,
    password,
    name: z.string().trim().min(1).max(80),
    majorId: majorIdSchema.optional(),
  })
  .strict();
export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    majorId: majorIdSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, '请提供需要修改的资料');
export const joinRequestSchema = z
  .object({
    inviteCode: z.string().trim().min(16).max(100),
    majorId: majorIdSchema.optional(),
    note: z
      .string()
      .trim()
      .max(500)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 1500, '申请说明过长')
      .default(''),
  })
  .strict();
export const joinReviewSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']),
    majorId: majorIdSchema.optional(),
  })
  .strict();
export const joinListSchema = z
  .object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
