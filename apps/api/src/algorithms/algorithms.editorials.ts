import { coreAlgorithmEditorials } from './algorithms.editorials-core';
import { extraAlgorithmEditorials } from './algorithms.editorials-extra';
export type {
  AlgorithmEditorial,
  AlgorithmEditorialApproach,
  AlgorithmEditorialWalkthrough,
  AlgorithmEditorialLanguage,
} from './algorithms.editorials.types';

export const algorithmEditorials = [...coreAlgorithmEditorials, ...extraAlgorithmEditorials];

export function getAlgorithmEditorial(problemId: string) {
  return algorithmEditorials.find((editorial) => editorial.problemId === problemId);
}
