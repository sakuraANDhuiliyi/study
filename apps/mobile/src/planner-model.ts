export type Task = {
  id: string;
  title: string;
  description: string;
  dueAt: string;
  revision: number;
  completedAt: string | null;
};
export type PlanEvent = {
  id: string;
  title: string;
  type: 'personal' | 'assignment' | 'exam';
  startAt: string;
  endAt?: string;
  originalDueAt?: string;
  entryClosesAt?: string;
  courseTitle?: string;
  status: string;
  description?: string;
  path?: string;
  revision?: number;
  completedAt?: string | null;
};
export type LearningAction = {
  id: string;
  title: string;
  type: PlanEvent['type'];
  courseTitle?: string;
  dueAt: string;
  originalDueAt?: string;
  startsAt?: string;
  revision?: number;
  status: string;
  actionLabel: string;
  reason: string | null;
  path: string;
};
export type ActionPage = {
  items: LearningAction[];
  counts: { today: number; upcoming: number; overdue: number };
  total: number;
  serverTime: string;
};
export type CalendarPage = { items: PlanEvent[]; truncated: boolean; serverTime: string };
export const kindLabels = { personal: '个人计划', assignment: '课程作业', exam: '课程考试' };
export const planStatus: Record<string, string> = {
  pending: '待完成',
  completed: '已完成',
  overdue: '已逾期',
  not_submitted: '待提交',
  returned: '待重交',
  submitted: '已提交',
  graded: '已批改',
  exempt: '已豁免',
  in_progress: '作答中',
  available: '可参与',
  upcoming: '未开始',
  published: '已发布',
  closed: '已截止',
  cancelled: '已取消',
  timed_out: '超时交卷',
};
export function shanghaiInput(value: string | Date = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('日期无效');
  // Work in fixed UTC+8, independent of the phone's timezone and DST.
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16);
}
export function parseTaskDate(day: string, time: string) {
  const input = `${day.trim()}T${time.trim()}`;
  if (!/^(20\d{2}|2100)-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input))
    throw new Error('请输入 2000 至 2100 年的日期（YYYY-MM-DD）和时间（HH:mm）。');
  const date = new Date(input + ':00+08:00');
  if (!Number.isFinite(date.getTime()) || shanghaiInput(date) !== input)
    throw new Error('日期或时间不存在，请检查月份、天数和小时。');
  return date.toISOString();
}
export function monthRange(month: string) {
  if (!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份超出范围');
  const [year, number] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, number, 1) - 8 * 3600000);
  // December 2100 is outside the API's exclusive-end year range.
  if (end.getUTCFullYear() > 2100) throw new Error('月份超出范围');
  return { start: parseTaskDate(month + '-01', '00:00'), end: end.toISOString() };
}
export function moveMonth(month: string, shift: number) {
  const [year, number] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, number - 1 + shift, 1)).toISOString().slice(0, 7);
  monthRange(next);
  return next;
}
export function assessmentPage(path?: string) {
  return path && /^\/(?:assignments|exams|exam-attempts)\/[a-zA-Z0-9_-]+$/.test(path) ? path : null;
}
export function formatPlanTime(value: string) {
  return shanghaiInput(value).replace('T', ' ');
}
