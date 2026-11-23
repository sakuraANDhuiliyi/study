import { z } from 'zod';

const categories = z.enum(['课程学习', '算法练习', '作业实验', '复习整理', '自由专注']);
const statuses = z.enum(['COMPLETED', 'ABANDONED']);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !s.includes('\0'), '不能包含空字符');
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine((value) => Number.isFinite(value.getTime()), '时间无效');
const pageNumber = (max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .max(8)
    .transform(Number)
    .pipe(z.int().max(max));
export const focusQuery = z.strictObject({
  category: categories.optional(),
  status: statuses.optional(),
  page: pageNumber(100000).default(1),
  pageSize: pageNumber(100).default(20),
});
export const emptyFocusQuery = z.strictObject({});
export const focusId = z.string().regex(/^[a-z\d_-]{1,100}$/i);
export const focusInput = z
  .strictObject({
    title: text(120).refine((s) => s.length > 0, '请填写专注主题'),
    category: categories.nullish().transform((value) => value ?? null),
    mode: z.enum(['FOCUS', 'SHORT_BREAK', 'LONG_BREAK']),
    plannedMinutes: z.int().min(1).max(180),
    actualSeconds: z.int().min(1).max(14400),
    status: statuses,
    reflection: text(500)
      .nullish()
      .transform((value) => value || null),
    startedAt: instant,
    endedAt: instant,
  })
  .superRefine((value, ctx) => {
    if (!(value.startedAt instanceof Date) || !(value.endedAt instanceof Date)) return;
    if (value.endedAt.getTime() > Date.now())
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: '结束时间不能晚于当前时间' });
    if (value.endedAt.getTime() - value.startedAt.getTime() < value.actualSeconds * 1000)
      ctx.addIssue({ code: 'custom', path: ['actualSeconds'], message: '计时时长不能超过起止时间间隔' });
  });

type DailyTotal = { date: string; seconds: number; completedCount: number };

// SQL supplies one row per Beijing calendar day with completed focus sessions.
export function focusSummary(rows: DailyTotal[], now: Date) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const day = new Date(today + 'T00:00:00Z');
  const key = (offset: number) => new Date(day.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = key(i - 6);
    const { seconds, completedCount } = byDate.get(date) ?? { seconds: 0, completedCount: 0 };
    return { date, seconds, minutes: Math.floor(seconds / 60), completedCount };
  });
  const monday = key(-((day.getUTCDay() + 6) % 7));
  const weekSeconds = days.filter((row) => row.date >= monday).reduce((sum, row) => sum + row.seconds, 0);
  const todaySeconds = days[6].seconds;
  let offset = byDate.has(today) ? 0 : -1;
  let streakDays = 0;
  while (byDate.has(key(offset))) {
    streakDays++;
    offset--;
  }
  return {
    todayMinutes: Math.floor(todaySeconds / 60),
    weekMinutes: Math.floor(weekSeconds / 60),
    todaySeconds,
    weekSeconds,
    streakDays,
    completedCount: rows.reduce((sum, row) => sum + row.completedCount, 0),
    days,
  };
}
