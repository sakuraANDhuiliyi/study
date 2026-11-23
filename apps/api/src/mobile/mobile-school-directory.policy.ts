import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const scalar = (max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .pipe(z.coerce.number<string | number>().int().min(1).max(max))
    .default(fallback);
export const schoolDirectoryId = id;
export const schoolDirectoryQuery = z
  .object({ page: scalar(10000, 1), pageSize: scalar(20, 20), search: z.string().trim().max(200).optional() })
  .strict();
export const schoolDirectoryRoles = z
  .object({
    roles: z
      .array(z.enum(['STUDENT', 'TEACHER', 'ADMIN']))
      .min(1)
      .max(3),
  })
  .strict();
export const schoolDirectoryBinding = z
  .object({ courseId: id, name: z.string().trim().min(1).max(100).optional() })
  .strict();
// Preserve row-level domain validation while rejecting unrecognized authority fields.
const row = z
  .object({
    username: z.unknown().optional(),
    name: z.unknown().optional(),
    password: z.unknown().optional(),
    studentNo: z.unknown().optional(),
    roles: z.unknown().optional(),
    majorId: z.unknown().optional(),
  })
  .strict();
export const schoolDirectoryImport = z
  .object({ rows: z.array(row).min(1).max(100), commit: z.boolean().default(false) })
  .strict();
export function mobileSchoolDirectoryRouteAllowed(path: string, method: string) {
  const root = '/api/mobile/school-directory',
    id = '[A-Za-z0-9_-]{1,100}';
  const test = (s: string) => new RegExp('^' + root + '/' + s + '$').test(path);
  if (method === 'GET')
    return test('(users|users/template|users/export|classes|courses)') || test('classes/' + id + '/courses');
  if (method === 'POST') return test('users/import') || test('classes/' + id + '/courses');
  return method === 'PATCH' && test('users/' + id + '/roles');
}
