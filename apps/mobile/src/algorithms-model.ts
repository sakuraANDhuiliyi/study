import type { MobileClient } from './client';
export type AlgorithmState = {
  favorite: boolean;
  reviewStatus: 'none' | 'review' | 'mastered';
  note: string;
  revision: number;
  updatedAt: string | null;
};
export type AlgorithmSummary = {
  id: string;
  number: number;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  status: 'todo' | 'attempted' | 'solved';
  favorite: boolean;
  reviewStatus: string;
};
export type AlgorithmList = {
  items: AlgorithmSummary[];
  total: number;
  page: number;
  pageSize: number;
  tags: string[];
  stats: { total: number; attempted: number; solved: number };
};
export type AlgorithmDetail = Pick<AlgorithmSummary, 'id' | 'number' | 'title' | 'difficulty' | 'tags'> & {
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  examples: { input: string; output: string; explanation: string }[];
  timeLimitMs: number;
  memoryLimitMb: number;
  learningState: AlgorithmState;
  editorialAvailable: boolean;
  navigation: { previousProblemId: string | null; nextProblemId: string | null };
};
export type AlgorithmEditorial = {
  editorial: {
    problemId: string;
    introduction: string;
    prerequisites: string[];
    readingGuide: string[];
    hints: string[];
    approaches: {
      name: string;
      intuition: string;
      steps: string[];
      correctness: string;
      timeComplexity: string;
      spaceComplexity: string;
      tradeoff: string;
    }[];
    walkthrough: {
      input: string;
      steps: { step: number; state: string; explanation: string }[];
      result: string;
    };
    edgeCases: { case: string; why: string }[];
    mistakes: { mistake: string; fix: string }[];
    followUp: string[];
    referenceCode: Partial<Record<'cpp' | 'python' | 'javascript' | 'java', string>>;
  };
  relatedProblems: AlgorithmSummary[];
};
export type AlgorithmEdit = Pick<AlgorithmState, 'favorite' | 'reviewStatus' | 'note'>;
export function algorithmNote(note: string) {
  if (note.length > 12000 || note.includes('\0'))
    throw new Error('笔记最多12000字符、36000字节，不能包含空字符');
  return note;
}
export function sameAlgorithmEdit(a: AlgorithmEdit, b: AlgorithmEdit) {
  return a.favorite === b.favorite && a.reviewStatus === b.reviewStatus && a.note === b.note;
}
export function reconcileAlgorithmEdit(
  base: AlgorithmState,
  intent: AlgorithmEdit,
  current: AlgorithmState,
): 'applied' | 'unchanged' | 'conflict' {
  if (current.revision === base.revision + 1 && sameAlgorithmEdit(intent, current)) return 'applied';
  if (current.revision === base.revision && sameAlgorithmEdit(base, current)) return 'unchanged';
  return 'conflict';
}
const path = (id: string) => '/mobile/algorithms/problems/' + encodeURIComponent(id);
export const algorithmsApi = {
  learning: (c: MobileClient, id: string) => c.request<AlgorithmState>(path(id) + '/learning'),
  save: (c: MobileClient, id: string, base: AlgorithmState, intent: AlgorithmEdit) =>
    c.request<AlgorithmState>(
      path(id) + '/learning',
      { revision: base.revision, ...intent, note: algorithmNote(intent.note) },
      'PATCH',
    ),
};
