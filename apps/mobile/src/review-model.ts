import { MobileApiError, type MobileClient } from './client';
export type ReviewAppeal = {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
  resolution: string | null;
  resolvedAt: string | null;
};
export type ReviewDetail = {
  attemptId: string;
  examId: string;
  title: string;
  number: number;
  scoreCents: number | null;
  deadlineAt: string | null;
  canApply: boolean;
  blockedReason: string;
  serverTime: string;
  appeal: ReviewAppeal | null;
  revisions: {
    items: { id: string; oldScoreCents: number; newScoreCents: number; reason: string; createdAt: string }[];
    total: number;
    page: number;
    pageSize: number;
  };
};
export type ReviewList = {
  items: (ReviewAppeal & { attemptId: string; title: string; courseId: string; scoreCents: number | null })[];
  total: number;
  page: number;
  pageSize: number;
  serverTime: string;
};
export function reviewReason(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 5) throw new Error('请至少填写 5 个字的复核理由');
  if (value.length > 4000) throw new Error('复核理由过长，请控制在 4000 字以内');
  return trimmed;
}
export const reviewApi = {
  load: (client: MobileClient, id: string, page = 1) =>
    client.request<ReviewDetail>(
      '/mobile/exam-attempts/' + encodeURIComponent(id) + '/review?pageSize=10&page=' + page,
    ),
  apply: (client: MobileClient, id: string, reason: string) =>
    client.request<ReviewDetail>(
      '/mobile/exam-attempts/' + encodeURIComponent(id) + '/appeals',
      { reason: reviewReason(reason) },
      'POST',
    ),
};

export function definitiveReviewFailure(error: unknown) {
  return error instanceof MobileApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
}
