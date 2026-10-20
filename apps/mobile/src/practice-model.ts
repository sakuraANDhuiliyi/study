import { MobileApiError, type MobileClient } from './client';
import type { Question, AnswerValue } from './assignment-model';
export type PracticeQuestion = Question & { available: boolean };
export type PracticeDetail = {
  id: string;
  courseId: string;
  courseTitle: string;
  status: string;
  revision: number;
  flags: string[];
  currentPosition: number;
  items: PracticeQuestion[];
  answers: {
    questionVersionId: string;
    value: AnswerValue;
    scoreCents: number | null;
    correct: boolean | null;
    answeredAt: string;
  }[];
  report: {
    answered: number;
    total: number;
    objectivelyScored: number;
    correct: number;
    scoreCents: number;
    totalCents: number;
    note: string;
  };
};
export type PracticeList = {
  items: {
    id: string;
    courseId: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    _count: { answers: number };
  }[];
  total: number;
  page: number;
  pageSize: number;
};
export type PracticeInput = {
  courseId: string;
  count?: number;
  type?: string;
  difficulty?: number;
  knowledgePoint?: string;
  mode: 'random' | 'mistakes' | 'favorites';
};
export function practiceInput(
  courseId: string,
  count: string,
  type: string,
  difficulty: number,
  knowledgePoint: string,
  mode: PracticeInput['mode'],
): PracticeInput {
  if (!courseId) throw new Error('请先选择练习课程');
  if (count && (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 30))
    throw new Error('题目数量应为 1–30，留空按实际题库选择');
  if (type && !['single', 'multiple', 'boolean', 'blank', 'short', 'composite'].includes(type))
    throw new Error('题型无效');
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 5 || knowledgePoint.trim().length > 100)
    throw new Error('难度或知识点无效');
  return {
    courseId,
    mode,
    ...(count ? { count: Number(count) } : {}),
    ...(type ? { type } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(knowledgePoint.trim() ? { knowledgePoint: knowledgePoint.trim() } : {}),
  };
}
export function practiceRate(report: PracticeDetail['report']) {
  return report.objectivelyScored
    ? Math.round((report.correct / report.objectivelyScored) * 100) + '%'
    : '数据不足';
}
export function definitivePracticeFailure(e: unknown) {
  return e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status);
}
const path = (id: string) => '/mobile/practice/' + encodeURIComponent(id);
export const practiceApi = {
  create: (c: MobileClient, input: PracticeInput, requestKey: string) =>
    c.request<PracticeDetail>('/mobile/practice', { ...input, requestKey }, 'POST'),
  read: (c: MobileClient, id: string) => c.request<PracticeDetail>(path(id)),
  answer: (c: MobileClient, id: string, questionVersionId: string, value: AnswerValue) =>
    c.request<PracticeDetail>(path(id) + '/answer', { questionVersionId, value }, 'POST'),
  progress: (c: MobileClient, id: string, revision: number, flags: string[], currentPosition: number) =>
    c.request<{ revision: number; flags: string[]; currentPosition: number }>(
      path(id) + '/progress',
      { revision, flags, currentPosition },
      'PUT',
    ),
};
