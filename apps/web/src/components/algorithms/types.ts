export type Language = 'cpp' | 'python' | 'javascript' | 'java';
export type ReviewStatus = 'none' | 'review' | 'mastered';
export type LearningState = {
  favorite: boolean;
  reviewStatus: ReviewStatus;
  note: string;
  revision: number;
  updatedAt: string | null;
};
export type ProblemCard = {
  id: string;
  number: number;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  status: 'todo' | 'attempted' | 'solved';
  favorite?: boolean;
  reviewStatus?: ReviewStatus;
};
export type Editorial = {
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
  relatedProblemIds: string[];
  referenceCode: Partial<Record<Language, string>>;
};
export const languageOptions = [
  { value: 'cpp' as const, label: 'C++ 17' },
  { value: 'python' as const, label: 'Python 3' },
  { value: 'javascript' as const, label: 'JavaScript' },
  { value: 'java' as const, label: 'Java' },
];
