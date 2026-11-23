import { z } from 'zod';
import { academicRecordQuery } from '../academics/academics.schemas';
const page = (max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .pipe(z.coerce.number<string | number>().int().min(1).max(max))
    .default(fallback);
export const mobileAcademicRecordQuery = academicRecordQuery
  .extend({ page: page(10000, 1), pageSize: page(20, 12) })
  .strict();
