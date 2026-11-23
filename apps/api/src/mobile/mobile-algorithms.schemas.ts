import { z } from 'zod';
import { algorithmProblemQuery, algorithmSubmissionQuery } from '../algorithms/algorithms.schemas';
import { forumListQuery, forumPageQuery } from '../algorithm-forum/algorithm-forum.schemas';
const page = (max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .pipe(z.coerce.number<string | number>().int().min(1).max(max))
    .default(fallback);
export const mobileAlgorithmQuery = algorithmProblemQuery
  .extend({ page: page(10000, 1), pageSize: page(20, 10) })
  .strict();
export const mobileAlgorithmSubmissionQuery = algorithmSubmissionQuery
  .extend({ page: page(10000, 1), pageSize: page(20, 10) })
  .strict();
export const mobileForumPageQuery = forumPageQuery
  .extend({ page: page(10000, 1), pageSize: page(20, 10) })
  .strict();
export const mobileForumListQuery = forumListQuery
  .extend({ page: page(10000, 1), pageSize: page(20, 10) })
  .strict();
