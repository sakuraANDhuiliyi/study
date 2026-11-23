import type { MobileClient } from './client';
export const teachingRoot = '/mobile/teaching';
export type TeachingPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export type TeachingMember = { id: string; name: string; username: string };
export type TeachingLesson = {
  id: string;
  title: string;
  content: string;
  type: 'TEXT' | 'VIDEO' | 'PDF' | 'DOCUMENT' | 'LINK';
  resourceUrl: string | null;
  attachmentId: string | null;
  opensAt: string | null;
  sortOrder: number;
  relatedTasks: { type: 'practice' | 'assignment' | 'exam'; id: string }[];
};
export type TeachingChapter = { id: string; title: string; sortOrder: number; lessons: TeachingLesson[] };
export type TeachingCourse = { id: string; title: string; chapters: TeachingChapter[] };
export type TeachingQuestionContent = {
  id: string;
  type: 'single' | 'multiple' | 'boolean' | 'blank' | 'short' | 'composite';
  stem: string;
  answer: unknown;
  options: { id: string; text: string }[];
  explanation: string;
  scoreCents: number;
  difficulty: number;
  children: TeachingQuestionContent[];
  rules: { partialCredit: boolean; caseSensitive: boolean; trim: boolean; collapseWhitespace: boolean };
  knowledgePoints: string[];
  tags: string[];
};
export type TeachingVersion = TeachingQuestionContent & { version: number };
export type TeachingQuestion = {
  id: string;
  creatorId: string;
  courseId: string;
  currentVersion: number;
  active: boolean;
  scope: 'private' | 'shared';
  practiceEnabled: boolean;
  versions: TeachingVersion[];
};
export type TeachingPaper = {
  id: string;
  title: string;
  totalCents: number;
  items: { questionVersionId: string; position: number; questionVersion: TeachingVersion }[];
};
export type TeachingAssessment = {
  id: string;
  title: string;
  courseId: string;
  status: string;
  revision: number;
  audience?: { userId: string }[];
  dueAt?: string;
  endsAt?: string;
  opensAt?: string;
  startsAt?: string;
  maxAttempts: number;
  graderIds?: string[];
};
export type TeachingRoster = {
  user: TeachingMember;
  status: string;
  eligible?: boolean;
  reason?: string;
  submission?: { id: string; status: string; version: number };
  exception?: { allowUntil: string | null; extraAttempts: number; exempt: boolean; reason: string };
  attempt?: { id: string; status: string; number: number };
};
export type TeachingFile = { id: string; originalName: string; mime: string; size: number };
export function teachingInteger(value: string, label: string, min: number, max: number) {
  if (!/^\d+$/.test(value.trim())) throw new Error(label + '须为整数');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label}须在 ${min} 至 ${max} 之间`);
  return n;
}
export function teachingDate(value: string, label: string) {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) throw new Error('请填写有效的' + label);
  return new Date(value).toISOString();
}
export function teachingScore(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('分值最多两位小数');
  const n = Math.round(Number(value) * 100);
  if (n < 1 || n > 1000000) throw new Error('每题分值须在 0.01 至 10000 分之间');
  return n;
}
export const teachingApi = {
  revise: (c: MobileClient, id: string, expectedVersion: number, changes: Record<string, unknown>) =>
    c.request<TeachingQuestion>(
      teachingRoot + '/questions/' + encodeURIComponent(id),
      { ...changes, expectedVersion },
      'PATCH',
    ),
  audience: (c: MobileClient, kind: 'assignments' | 'exams', record: TeachingAssessment, ids: string[]) =>
    c.request(
      teachingRoot + '/' + kind + '/' + encodeURIComponent(record.id),
      { revision: record.revision, audienceIds: [...new Set(ids)] },
      'PATCH',
    ),
};
