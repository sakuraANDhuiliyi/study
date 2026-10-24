import { ConflictException } from '@nestjs/common';
import type { AlgorithmLearningState, Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { algorithmProblems, type AlgorithmProblem } from './algorithms.catalog';
import type { AlgorithmLearningInput, algorithmProblemQuery } from './algorithms.schemas';
import type { z } from 'zod';
export type AlgorithmProblemSummary = {
  id: string;
  number: number;
  title: string;
  difficulty: AlgorithmProblem['difficulty'];
  tags: string[];
  status: 'todo' | 'attempted' | 'solved';
  favorite: boolean;
  reviewStatus: string;
};
export function algorithmLearningDto(state: AlgorithmLearningState | null) {
  return {
    favorite: state?.favorite ?? false,
    reviewStatus: state?.reviewStatus ?? 'none',
    note: state?.note ?? '',
    revision: state?.revision ?? 0,
    updatedAt: state?.updatedAt ?? null,
  };
}
export function algorithmSummaries(
  submitted: { problemId: string; status: string }[],
  learning: { problemId: string; favorite: boolean; reviewStatus: string }[],
): AlgorithmProblemSummary[] {
  const attempted = new Set(submitted.map((s) => s.problemId));
  const solved = new Set(submitted.filter((s) => s.status === 'accepted').map((s) => s.problemId));
  const states = new Map(learning.map((s) => [s.problemId, s]));
  return algorithmProblems.map((p) => ({
    id: p.id,
    number: p.number,
    title: p.title,
    difficulty: p.difficulty,
    tags: p.tags,
    status: solved.has(p.id) ? 'solved' : attempted.has(p.id) ? 'attempted' : 'todo',
    favorite: states.get(p.id)?.favorite ?? false,
    reviewStatus: states.get(p.id)?.reviewStatus ?? 'none',
  }));
}
export function algorithmPage(
  items: AlgorithmProblemSummary[],
  query: z.infer<typeof algorithmProblemQuery>,
) {
  const term = query.q.trim().toLocaleLowerCase();
  const filtered = items.filter(
    (p) =>
      (!term || `${p.number} ${p.title} ${p.tags.join(' ')}`.toLocaleLowerCase().includes(term)) &&
      (!query.difficulty || p.difficulty === query.difficulty) &&
      (!query.tag || p.tags.includes(query.tag)) &&
      (!query.status || p.status === query.status) &&
      (query.favorite === undefined || p.favorite === (query.favorite === 'true')) &&
      (!query.review || p.reviewStatus === query.review),
  );
  return {
    items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
    stats: {
      total: items.length,
      attempted: items.filter((p) => p.status !== 'todo').length,
      solved: items.filter((p) => p.status === 'solved').length,
    },
    tags: [...new Set(algorithmProblems.flatMap((p) => p.tags))].sort(),
  };
}
/** Caller holds the common per-student advisory lock and has refreshed current authority. */
export async function saveAlgorithmLearning(
  tx: Prisma.TransactionClient,
  actor: Actor,
  problemId: string,
  input: AlgorithmLearningInput,
) {
  const where = { organizationId: actor.organizationId, userId: actor.id, problemId };
  const current = await tx.algorithmLearningState.findFirst({ where });
  if ((current?.revision ?? 0) !== input.revision)
    throw new ConflictException('学习记录已在其他页面更新，请刷新记录后再保存');
  const patch = {
    ...(input.favorite === undefined ? {} : { favorite: input.favorite }),
    ...(input.reviewStatus === undefined ? {} : { reviewStatus: input.reviewStatus }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
  if (!current)
    return algorithmLearningDto(
      await tx.algorithmLearningState.create({ data: { ...where, ...patch, revision: 1 } }),
    );
  const changed = await tx.algorithmLearningState.updateMany({
    where: { ...where, revision: input.revision },
    data: { ...patch, revision: { increment: 1 } },
  });
  if (changed.count !== 1) throw new ConflictException('学习记录已更新，请刷新后再保存');
  return algorithmLearningDto(await tx.algorithmLearningState.findFirstOrThrow({ where }));
}
