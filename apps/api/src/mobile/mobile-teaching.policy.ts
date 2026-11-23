import { z } from 'zod';
import {
  listSchema,
  questionPatchSchema,
  assignmentPatchSchema,
  examPatchSchema,
} from '../assessment/assessment.schemas';
const scalar = (max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .pipe(z.coerce.number<string | number>().int().min(1).max(max))
    .default(fallback);
export const teachingId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const teachingQuery = listSchema
  .pick({ courseId: true, search: true, status: true, type: true })
  .extend({ page: scalar(10000, 1), pageSize: scalar(20, 20) })
  .strict();
export const teachingPage = teachingQuery.pick({ page: true, pageSize: true });
export const teachingMembers = teachingPage
  .extend({ search: z.string().max(200).optional(), kind: z.enum(['student', 'teacher']).default('student') })
  .strict();
export const teachingQuestionPatch = questionPatchSchema.omit({ courseId: true }).strict();
export const teachingAssignmentPatch = assignmentPatchSchema.omit({ courseId: true }).strict();
export const teachingExamPatch = examPatchSchema.omit({ courseId: true }).strict();
export const teachingChapter = z
  .object({ title: z.string().trim().min(1).max(160), sortOrder: z.number().int().min(0).default(0) })
  .strict();
export const teachingChapterPatch = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0, '请提供要修改的章节字段');
export const teachingEmpty = z.object({}).strict();
/** Exact native teaching operations; no generic assessment, file or admin proxy. */
export function mobileTeachingRouteAllowed(path: string, method: string) {
  const root = '/api/mobile/teaching',
    id = '[A-Za-z0-9_-]{1,100}';
  const test = (suffix: string) => new RegExp('^' + root + '/' + suffix + '$').test(path);
  if (method === 'GET')
    return (
      test('(courses|questions|papers|assignments|exams)') ||
      test('courses/' + id + '(?:/(members|files))?') ||
      test('courses/' + id + '/files/' + id) ||
      test('questions/' + id + '(?:/versions)?') ||
      test('(assignments|exams)/' + id + '(?:/roster)?')
    );
  if (method === 'POST')
    return (
      test('(papers|assignments|exams)') ||
      test('courses/' + id + '/(chapters|files)') ||
      test('chapters/' + id + '/lessons') ||
      test('questions/' + id + '/copy') ||
      test('assignments/' + id + '/(publish|exceptions)') ||
      test('submissions/' + id + '/return') ||
      test('exams/' + id + '/(publish|extension|eligibility)')
    );
  return method === 'PATCH' && test('(questions|assignments|exams|chapters|lessons)/' + id);
}
