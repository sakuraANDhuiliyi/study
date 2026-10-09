import { bulkAlgorithmEditorials } from './algorithms.editorials-bulk';
import { coreAlgorithmEditorials } from './algorithms.editorials-core';
import { extraAlgorithmEditorials } from './algorithms.editorials-extra';
import { graphAlgorithmEditorials } from './algorithms.editorials-graphs';
export type {
  AlgorithmEditorial,
  AlgorithmEditorialApproach,
  AlgorithmEditorialWalkthrough,
  AlgorithmEditorialLanguage,
} from './algorithms.editorials.types';

export const algorithmEditorials = [
  ...coreAlgorithmEditorials,
  ...extraAlgorithmEditorials,
  ...graphAlgorithmEditorials,
  ...bulkAlgorithmEditorials,
];

export function getAlgorithmEditorial(problemId: string) {
  return algorithmEditorials.find((editorial) => editorial.problemId === problemId);
}
