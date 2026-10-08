const shanghaiParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function plannerLocalTime(value: string | Date = new Date()) {
  const parts = Object.fromEntries(
    shanghaiParts.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export const plannerDay = (value: string | Date = new Date()) => plannerLocalTime(value).slice(0, 10);
export function plannerISO(local: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('请选择有效的计划日期和时间');
  const value = new Date(`${local}:00+08:00`);
  if (!Number.isFinite(value.getTime()) || plannerLocalTime(value) !== local)
    throw new Error('请选择有效的计划日期和时间');
  return value.toISOString();
}
export function plannerMonthShift(month: string, amount: number) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0, 7);
}
export function plannerMonthDays(month: string) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) =>
    new Date(first.getTime() + (i - offset) * 86400000).toISOString().slice(0, 10),
  );
}
export function plannerRange(month: string) {
  const days = plannerMonthDays(month);
  const last = new Date(`${days[41]}T00:00:00+08:00`);
  return { start: plannerISO(`${days[0]}T00:00`), end: new Date(last.getTime() + 86400000).toISOString() };
}

export function plannerEventOnDay(event: { type: string; startAt: string; endAt?: string }, day: string) {
  if (event.type !== 'exam' || !event.endAt) return plannerDay(event.startAt) === day;
  const start = new Date(`${day}T00:00:00+08:00`).getTime();
  return new Date(event.startAt).getTime() < start + 86400000 && new Date(event.endAt).getTime() > start;
}
