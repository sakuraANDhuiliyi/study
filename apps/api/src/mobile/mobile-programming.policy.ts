import { z } from 'zod';
import { creativeListQuery } from '../programming/creative.schemas';
const integer = (max: number, fallback: number) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().min(1).max(max))
    .default(fallback);
export const mobileProgrammingId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const mobileProgrammingQuery = z
  .object({ page: integer(10000, 1), pageSize: integer(20, 12) })
  .strict();
export const mobileCreativeQuery = creativeListQuery.extend({
  page: integer(10000, 1),
  pageSize: integer(24, 12),
});
export function mobileProgrammingRouteAllowed(path: string, method: string) {
  const base = '/api/mobile/programming',
    id = '[a-zA-Z0-9_-]{1,100}';
  if (method === 'GET')
    return (
      new RegExp(`^${base}/(?:status|templates|projects|creative)/?$`).test(path) ||
      new RegExp(`^${base}/projects/${id}(?:/(?:backup|export)|/(?:versions|ai-drafts)(?:/${id})?)?/?$`).test(
        path,
      ) ||
      new RegExp(`^${base}/creative/${id}(?:/export)?/?$`).test(path)
    );
  if (method === 'POST')
    return (
      new RegExp(`^${base}/projects(?:/import)?/?$`).test(path) ||
      new RegExp(`^${base}/projects/${id}/(?:duplicate|versions|restore|ai-drafts)/?$`).test(path) ||
      new RegExp(`^${base}/projects/${id}/ai-drafts/${id}/apply/?$`).test(path) ||
      new RegExp(`^${base}/creative/${id}/projects/?$`).test(path)
    );
  if (method === 'PATCH' || method === 'DELETE') return new RegExp(`^${base}/projects/${id}/?$`).test(path);
  return method === 'PUT' && new RegExp(`^${base}/creative/${id}/favorite/?$`).test(path);
}
