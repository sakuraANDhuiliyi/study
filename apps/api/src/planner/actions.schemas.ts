import { z } from 'zod';

// Express query values must be scalar. Keep numeric direct callers compatible,
// but never let number coercion silently accept a one-element array/object.
const pageNumber = (maximum: number) =>
  z.preprocess(
    (value) => (typeof value === 'number' || (typeof value === 'string' && value.length <= 20) ? value : NaN),
    z.coerce.number().int().min(1).max(maximum),
  );
const text = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !value.includes('\0'));
const optionalCourse = text(128)
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const learningActionsQuery = z
  .object({
    bucket: z.enum(['today', 'upcoming', 'overdue']).default('today'),
    page: pageNumber(10000).default(1),
    pageSize: pageNumber(20).default(10),
    type: z.enum(['all', 'personal', 'assignment', 'exam']).default('all'),
    courseId: optionalCourse,
  })
  .strict()
  .refine((input) => input.type !== 'personal' || !input.courseId, {
    path: ['courseId'],
    message: '个人待办未归属课程，不能同时筛选课程',
  });
export type LearningActionsQuery = z.infer<typeof learningActionsQuery>;
export type ActionBucket = LearningActionsQuery['bucket'];

export const learningActionCoursesQuery = z
  .object({
    search: text(100).default(''),
    page: pageNumber(10000).default(1),
    pageSize: pageNumber(50).default(20),
  })
  .strict();

export function learningCourseSearchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Today uses the server clock in Shanghai; upcoming is the following seven calendar days. */
export function learningActionRange(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const todayStart = new Date(`${day}T00:00:00+08:00`);
  return {
    todayStart,
    tomorrowStart: new Date(todayStart.getTime() + 86400000),
    upcomingEnd: new Date(todayStart.getTime() + 8 * 86400000),
  };
}

export function learningActionBucket(dueAt: Date, now: Date): ActionBucket | null {
  const range = learningActionRange(now);
  if (dueAt < now) return 'overdue';
  if (dueAt < range.tomorrowStart) return 'today';
  if (dueAt < range.upcomingEnd) return 'upcoming';
  return null;
}
