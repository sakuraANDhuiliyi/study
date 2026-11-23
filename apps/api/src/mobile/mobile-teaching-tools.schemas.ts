import { z } from 'zod';
import { authoringListQuery } from '../ai-authoring/ai-authoring.schemas';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const page = (max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .pipe(z.coerce.number<string | number>().int().min(1).max(max))
    .default(fallback);
export const mobileAuthoringListQuery = authoringListQuery
  .extend({ page: page(10000, 1), pageSize: page(20, 10) })
  .strict();
export const mobileAnalyticsQuery = z
  .object({ courseId: id.optional(), classId: id.optional(), termId: id.optional() })
  .strict();
export const mobileAnalyticsExportQuery = mobileAnalyticsQuery
  .extend({ format: z.literal('report').default('report') })
  .strict();
export const mobileAnnouncementInput = z
  .object({
    courseId: id,
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(20000),
  })
  .strict();
export const mobileAnnouncementQuery = z
  .object({ courseId: id, page: page(10000, 1), pageSize: page(20, 10) })
  .strict();
