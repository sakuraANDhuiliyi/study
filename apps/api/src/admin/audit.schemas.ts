import { z } from 'zod';
import { paging } from '../common/utils';

const optionalText = (maximum: number, trim = true) =>
  z.preprocess(
    (value) => (typeof value === 'string' && (trim ? value.trim() : value) === '' ? undefined : value),
    (trim ? z.string().trim() : z.string())
      .max(maximum)
      .refine((value) => !value.includes('\0'))
      .optional(),
  );
const optionalInstant = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().datetime({ offset: true }).optional(),
);
const filterFields = {
  search: optionalText(200),
  action: optionalText(200, false),
  actorId: optionalText(128),
  resourceType: optionalText(100),
  resourceId: optionalText(256),
  requestId: optionalText(200),
  from: optionalInstant,
  to: optionalInstant,
};
type Range = { from?: string; to?: string };
function orderedRange(value: Range, context: z.RefinementCtx) {
  if (value.from && value.to && new Date(value.from) > new Date(value.to))
    context.addIssue({ code: 'custom', path: ['to'], message: '结束时间不能早于开始时间' });
}

// GET ignores unknown legacy query parameters, except attempts to override security scope.
// Express duplicate scalar query parameters arrive as arrays and fail these scalar schemas.
export const auditListQuery = z
  .object({
    ...filterFields,
    page: z
      .string()
      .max(200)
      .refine((value) => !value.includes('\0'))
      .optional(),
    pageSize: z
      .string()
      .max(200)
      .refine((value) => !value.includes('\0'))
      .optional(),
    organizationId: z.never().optional(),
    userId: z.never().optional(),
    role: z.never().optional(),
    permissions: z.never().optional(),
    sessionId: z.never().optional(),
    csrfToken: z.never().optional(),
  })
  .strip()
  .superRefine(orderedRange);
export const auditExportInput = z
  .object({ ...filterFields, limit: z.number().int().min(1).max(5000).default(5000) })
  .strict()
  .superRefine(orderedRange);
export type AuditFilters = Pick<
  z.infer<typeof auditExportInput>,
  'search' | 'action' | 'actorId' | 'resourceType' | 'resourceId' | 'requestId' | 'from' | 'to'
>;
export function parseAuditListQuery(query: unknown) {
  const parsed = auditListQuery.parse(query);
  return { filters: auditFilterSummary(parsed), ...paging(parsed) };
}

/** Allowlisted audit metadata; values come from parsed filters, never arbitrary request JSON. */
export function auditFilterSummary(filters: AuditFilters): AuditFilters {
  return Object.fromEntries(
    (['search', 'action', 'actorId', 'resourceType', 'resourceId', 'requestId', 'from', 'to'] as const)
      .filter((key) => filters[key] !== undefined)
      .map((key) => [key, filters[key]]),
  );
}
