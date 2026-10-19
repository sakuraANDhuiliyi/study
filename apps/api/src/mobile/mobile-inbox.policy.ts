export type InboxKind = 'assignment' | 'exam' | 'grade' | 'course' | 'other';
export type InboxTarget = { name: 'assignment' | 'exam' | 'review' | 'course'; id: string };
export const inboxLabels: Record<InboxKind, string> = {
  assignment: '作业动态',
  exam: '考试动态',
  grade: '成绩与复核动态',
  course: '课程动态',
  other: '其他平台通知',
};
export function inboxKind(type: string): InboxKind {
  if (['assignment', 'exam', 'grade'].includes(type)) return type as InboxKind;
  return ['MEMBERSHIP', 'ANNOUNCEMENT'].includes(type) ? 'course' : 'other';
}
// Never forward stored URLs, event keys, message bodies or grade snapshots to the App.
export function inboxTarget(type: string, link: string): InboxTarget | null {
  const match = /^\/(assignments|exams|attempts|courses)\/([A-Za-z0-9_-]{1,100})$/.exec(link);
  if (!match) return null;
  const [, route, id] = match,
    kind = inboxKind(type);
  if (route === 'assignments' && ['assignment', 'grade'].includes(kind)) return { name: 'assignment', id };
  if (route === 'exams' && ['exam', 'grade'].includes(kind)) return { name: 'exam', id };
  if (route === 'attempts' && kind === 'grade') return { name: 'review', id };
  if (route === 'courses' && kind === 'course') return { name: 'course', id };
  return null;
}
