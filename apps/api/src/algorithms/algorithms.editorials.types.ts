import type { AlgorithmLanguage } from './algorithms.catalog';

export type AlgorithmEditorialLanguage = AlgorithmLanguage;
export interface AlgorithmEditorialApproach {
  name: string;
  intuition: string;
  steps: string[];
  correctness: string;
  timeComplexity: string;
  spaceComplexity: string;
  tradeoff: string;
}
export interface AlgorithmEditorialWalkthrough {
  input: string;
  steps: { step: number; state: string; explanation: string }[];
  result: string;
}
export interface AlgorithmEditorial {
  problemId: string;
  introduction: string;
  prerequisites: string[];
  readingGuide: string[];
  hints: string[];
  approaches: AlgorithmEditorialApproach[];
  walkthrough: AlgorithmEditorialWalkthrough;
  edgeCases: { case: string; why: string }[];
  mistakes: { mistake: string; fix: string }[];
  followUp: string[];
  relatedProblemIds: string[];
  referenceCode: Record<AlgorithmEditorialLanguage, string>;
}
