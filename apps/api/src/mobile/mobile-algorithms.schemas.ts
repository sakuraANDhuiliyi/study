import { z } from 'zod';
import { algorithmProblemQuery } from '../algorithms/algorithms.schemas';
const page = (max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .pipe(z.coerce.number<string | number>().int().min(1).max(max))
    .default(fallback);
export const mobileAlgorithmQuery = algorithmProblemQuery
  .extend({ page: page(10000, 1), pageSize: page(20, 10) })
  .strict();
