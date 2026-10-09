import { z } from 'zod';

export const learningActionsQuery = z
  .object({
    bucket: z.enum(['today', 'upcoming', 'overdue']).default('today'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();
export type LearningActionsQuery = z.infer<typeof learningActionsQuery>;
export type ActionBucket = LearningActionsQuery['bucket'];

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
