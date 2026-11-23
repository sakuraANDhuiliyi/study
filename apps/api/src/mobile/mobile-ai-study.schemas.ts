import { z } from 'zod';
import { aiReportQuery } from '../ai-study/ai-study.schemas';
const page = (max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .pipe(z.coerce.number<string | number>().int().min(1).max(max))
    .default(fallback);
export const mobileAiReportQuery = aiReportQuery
  .extend({ page: page(10000, 1), pageSize: page(20, 10) })
  .strict();
