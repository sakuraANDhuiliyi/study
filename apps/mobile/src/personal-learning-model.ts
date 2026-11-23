import type { MobileClient } from './client';
export type PersonalNote = {
  id: string;
  title: string;
  category: string | null;
  body: string;
  pinned: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type PersonalNoteEdit = Pick<PersonalNote, 'title' | 'category' | 'body' | 'pinned'>;
export type PersonalNoteList = {
  items: (Omit<PersonalNote, 'body'> & {
    source: 'standalone' | 'lesson';
    preview: string;
    lessonId: string | null;
    courseTitle: string | null;
  })[];
  total: number;
  page: number;
  pageSize: number;
};
export function personalNoteInput(input: PersonalNoteEdit): PersonalNoteEdit {
  if (!input.title.trim() || input.title.trim().length > 120 || input.title.includes('\0'))
    throw new Error('标题需填写1至120字符');
  if (!input.body.trim() || input.body.length > 10000 || input.body.includes('\0'))
    throw new Error('正文需填写1至10000字符，不能包含空字符');
  if ((input.category?.trim().length || 0) > 60 || input.category?.includes('\0'))
    throw new Error('分类最多60字符，不能包含空字符');
  return {
    title: input.title.trim(),
    category: input.category?.trim() || null,
    body: input.body,
    pinned: input.pinned,
  };
}
export function samePersonalNote(a: PersonalNoteEdit, b: PersonalNoteEdit) {
  return a.title === b.title && a.category === b.category && a.body === b.body && a.pinned === b.pinned;
}
export function reconcilePersonalNote(base: PersonalNote, intent: PersonalNoteEdit, current: PersonalNote) {
  if (current.id === base.id && current.revision === base.revision + 1 && samePersonalNote(intent, current))
    return 'applied';
  if (current.id === base.id && current.revision === base.revision && samePersonalNote(base, current))
    return 'unchanged';
  return 'conflict';
}
const noteBase = '/mobile/personal/notes/standalone';
export const personalNotesApi = {
  list: (
    c: MobileClient,
    query: { source: 'all' | 'lesson' | 'standalone'; page: number; search: string; pinned?: 'true' },
  ) =>
    c.request<PersonalNoteList>(
      '/mobile/personal/notes?' + new URLSearchParams({ ...query, page: String(query.page), pageSize: '10' }),
    ),
  read: (c: MobileClient, id: string) => c.request<PersonalNote>(noteBase + '/' + encodeURIComponent(id)),
  create: (c: MobileClient, intent: PersonalNoteEdit) =>
    c.request<PersonalNote>(noteBase, personalNoteInput(intent), 'POST'),
  save: (c: MobileClient, base: PersonalNote, intent: PersonalNoteEdit) =>
    c.request<PersonalNote>(
      noteBase + '/' + encodeURIComponent(base.id),
      { ...personalNoteInput(intent), revision: base.revision },
      'PATCH',
    ),
  remove: (c: MobileClient, base: PersonalNote) =>
    c.request<{ deleted: true }>(
      noteBase + '/' + encodeURIComponent(base.id),
      { revision: base.revision },
      'DELETE',
    ),
};
export const focusCategories = ['课程学习', '算法练习', '作业实验', '复习整理', '自由专注'] as const;
export type FocusMode = 'FOCUS' | 'SHORT_BREAK' | 'LONG_BREAK';
export type FocusInput = {
  title: string;
  category: string | null;
  mode: FocusMode;
  plannedMinutes: number;
  actualSeconds: number;
  status: 'COMPLETED' | 'ABANDONED';
  reflection: string | null;
  startedAt: string;
  endedAt: string;
};
export type FocusRecord = FocusInput & { id: string; createdAt: string };
export type FocusTimer = Pick<FocusInput, 'title' | 'category' | 'mode' | 'plannedMinutes'> & {
  startedAt: number;
  resumedAt: number | null;
  elapsedMs: number;
};
export function startFocus(
  title: string,
  category: string | null,
  mode: FocusMode,
  minutes: number,
  now: number,
): FocusTimer {
  if (!title.trim() || title.trim().length > 120 || title.includes('\0'))
    throw new Error('请填写1至120字符的专注主题');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180)
    throw new Error('计划时长需为1至180分钟的整数');
  return {
    title: title.trim(),
    category,
    mode,
    plannedMinutes: minutes,
    startedAt: now,
    resumedAt: now,
    elapsedMs: 0,
  };
}
export function focusElapsed(timer: FocusTimer, now: number) {
  return Math.max(
    0,
    Math.min(
      timer.plannedMinutes * 60000,
      timer.elapsedMs + (timer.resumedAt === null ? 0 : Math.max(0, now - timer.resumedAt)),
      Math.max(0, now - timer.startedAt),
    ),
  );
}
export function toggleFocusPause(timer: FocusTimer, now: number): FocusTimer {
  return timer.resumedAt === null
    ? { ...timer, resumedAt: now }
    : { ...timer, elapsedMs: focusElapsed(timer, now), resumedAt: null };
}
export function finishFocus(timer: FocusTimer, now: number): FocusInput {
  const elapsed = focusElapsed(timer, now),
    actualSeconds = Math.floor(elapsed / 1000),
    completed = elapsed >= timer.plannedMinutes * 60000;
  if (actualSeconds < 1) throw new Error('计时不足1秒，请稍后再结束');
  const end =
    completed && timer.resumedAt !== null
      ? Math.min(now, timer.resumedAt + timer.plannedMinutes * 60000 - timer.elapsedMs)
      : now;
  return {
    title: timer.title,
    category: timer.category,
    mode: timer.mode,
    plannedMinutes: timer.plannedMinutes,
    actualSeconds,
    status: completed ? 'COMPLETED' : 'ABANDONED',
    reflection: null,
    startedAt: new Date(timer.startedAt).toISOString(),
    endedAt: new Date(end).toISOString(),
  };
}
export function sameFocusRecord(a: FocusInput, b: FocusInput) {
  return (
    [
      'title',
      'category',
      'mode',
      'plannedMinutes',
      'actualSeconds',
      'status',
      'reflection',
      'startedAt',
      'endedAt',
    ] as const
  ).every((key) => a[key] === b[key]);
}
export const focusApi = {
  list: (c: MobileClient, page = 1) =>
    c.request<{ items: FocusRecord[]; total: number; page: number; pageSize: number }>(
      '/mobile/personal/focus/sessions?pageSize=10&page=' + page,
    ),
  summary: (c: MobileClient) =>
    c.request<{ todayMinutes: number; weekMinutes: number; streakDays: number; completedCount: number }>(
      '/mobile/personal/focus/summary',
    ),
  create: (c: MobileClient, input: FocusInput) =>
    c.request<FocusRecord>('/mobile/personal/focus/sessions', input, 'POST'),
};
