import { z } from 'zod';

export const academicRecordExportInput = z
  .object({
    format: z.enum(['csv', 'md']).default('csv'),
    moduleId: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !value.includes('\0'))
      .optional(),
    status: z.enum(['all', 'DRAFT', 'COMPLETED']).default('all'),
    limit: z.number().int().min(1).max(5000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.format === 'md' && value.limit !== undefined && value.limit > 50)
      ctx.addIssue({ code: 'custom', path: ['limit'], message: 'Markdown每次最多导出50条记录' });
  });
export type AcademicRecordExportInput = z.infer<typeof academicRecordExportInput>;
