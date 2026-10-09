import { z } from 'zod';
import { paging } from '../common/utils';

const scalar = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !value.includes('\0'));
export const jobsListQuery = z
  .object({
    // Nonempty keywords retain whitespace and all SQL wildcard characters literally.
    action: scalar(200).optional(),
    status: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.enum(['ALL', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']).default('ALL'),
    ),
    page: scalar(200).optional(),
    pageSize: scalar(200).optional(),
    organizationId: z.never().optional(),
    userId: z.never().optional(),
    role: z.never().optional(),
    permissions: z.never().optional(),
    sessionId: z.never().optional(),
    csrfToken: z.never().optional(),
    scope: z.never().optional(),
  })
  .strip();

export function parseJobsQuery(query: unknown) {
  const parsed = jobsListQuery.parse(query);
  return { action: parsed.action || undefined, status: parsed.status, ...paging(parsed) };
}

export function jobsKindPattern(keyword: string) {
  return `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
}
