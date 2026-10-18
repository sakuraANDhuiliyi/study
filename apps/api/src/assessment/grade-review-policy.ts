export type ReviewAttempt = {
  status: string;
  gradingStatus: string;
  releaseStatus: string;
  scoreCents: number | null;
  exam: {
    status: string;
    scoreReleaseAt: Date | null;
    appealDeadline: Date | null;
    audience: { userId: string; eligible: boolean }[];
  };
};
export function reviewScoreVisible(
  a: { releaseStatus: string; gradingStatus?: string; exam: { scoreReleaseAt: Date | null } },
  now: Date,
) {
  return (
    a.releaseStatus === 'released' &&
    (a.gradingStatus === undefined || a.gradingStatus === 'graded') &&
    !!a.exam.scoreReleaseAt &&
    a.exam.scoreReleaseAt <= now
  );
}
export function reviewBlockedReason(a: ReviewAttempt, userId: string, now: Date) {
  if (a.exam.status !== 'published' || !a.exam.audience.some((x) => x.userId === userId && x.eligible))
    return '考试已取消或参考资格已撤销';
  if (!['submitted', 'timed_out'].includes(a.status)) return '请先完成交卷';
  if (!reviewScoreVisible(a, now) || a.gradingStatus !== 'graded' || a.scoreCents === null)
    return '正式成绩尚未公开';
  if (a.exam.appealDeadline && a.exam.appealDeadline <= now) return '已超过成绩复核期限';
  return '';
}
