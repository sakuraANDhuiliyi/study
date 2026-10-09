export type LearningActionKind = 'personal' | 'assignment' | 'exam';
export type LearningActionRow = {
  id: string;
  kind: LearningActionKind;
  title: string;
  dueAt: string;
  courseId: string | null;
  courseTitle: string | null;
  revision: number | null;
  originalDueAt: string | null;
  startsAt: string | null;
  latestStatus: string | null;
  latestNumber: number | null;
  maxAttempts: number | null;
  extraAttempts: number | null;
  allowLate: boolean | null;
  attemptId: string | null;
};

export function learningActionDto(row: LearningActionRow, now: Date) {
  const due = new Date(row.dueAt);
  const overdue = due < now;
  const base = {
    id: row.id,
    type: row.kind,
    title: row.title,
    dueAt: due.toISOString(),
    overdue,
    ...(row.courseId ? { courseId: row.courseId, courseTitle: row.courseTitle ?? '' } : {}),
  };
  if (row.kind === 'personal')
    return {
      ...base,
      revision: row.revision!,
      status: overdue ? 'overdue' : 'pending',
      action: 'complete_task',
      actionLabel: '标为完成',
      path: '/planner',
      reason: null,
    };
  if (row.kind === 'assignment') {
    const limited = (row.latestNumber ?? 0) >= (row.maxAttempts ?? 0) + (row.extraAttempts ?? 0);
    const closed = overdue && !row.allowLate;
    const returned = row.latestStatus === 'returned';
    return {
      ...base,
      originalDueAt: new Date(row.originalDueAt!).toISOString(),
      status: closed ? 'closed' : returned ? 'returned' : overdue ? 'overdue' : 'not_submitted',
      action: closed || limited ? 'view' : returned ? 'resubmit' : 'submit',
      actionLabel: closed || limited ? '查看作业' : returned ? '重新提交' : overdue ? '补交作业' : '提交作业',
      path: `/assignments/${row.id}`,
      reason: closed ? 'deadline_passed' : limited ? 'attempt_limit' : null,
    };
  }
  const continuing = row.latestStatus === 'in_progress';
  const waiting = !continuing && new Date(row.startsAt!) > now;
  const limited = !continuing && (row.latestNumber ?? 0) >= (row.maxAttempts ?? 0) + (row.extraAttempts ?? 0);
  return {
    ...base,
    startsAt: new Date(row.startsAt!).toISOString(),
    status: continuing ? 'in_progress' : waiting ? 'upcoming' : 'available',
    action: continuing ? 'continue_exam' : limited ? 'view' : waiting ? 'wait_exam' : 'start_exam',
    actionLabel: continuing
      ? '继续答卷'
      : waiting || limited
        ? '查看考试'
        : row.latestNumber
          ? '再次考试'
          : '进入考试',
    path: continuing ? `/exam-attempts/${row.attemptId}` : `/exams/${row.id}`,
    reason: limited ? 'attempt_limit' : waiting ? 'exam_not_started' : null,
  };
}
