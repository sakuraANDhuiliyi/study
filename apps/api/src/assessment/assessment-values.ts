import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { type QuestionData, shuffled } from './scoring';

export type Tx = Prisma.TransactionClient;
export const json = (value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull =>
  value === undefined || value === null
    ? Prisma.JsonNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
export const content = (value: unknown) => value as QuestionData;
export const questionInclude = { versions: { orderBy: { version: 'desc' as const }, take: 1 } };
export const itemInclude = { questionVersion: true };
export const secureShuffle = <T>(values: T[]) =>
  shuffled(values, () => randomInt(0, 1000000000) / 1000000000);
export const unique = <T>(values: T[]) => [...new Set(values)];
