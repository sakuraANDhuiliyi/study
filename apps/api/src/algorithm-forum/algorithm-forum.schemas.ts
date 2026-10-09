import { z } from 'zod';
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\0'), '内容不能包含空字符');
const revision = z.number().int().min(0).max(2147483646);
const problemId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const forumScope = z.enum(['public', 'organization']);
export const forumKind = z.enum(['question', 'solution', 'discussion']);
export const forumLimits = {
  maxPosts: 100,
  maxReplies: 2000,
  maxBodyLength: 15000,
  writesPerMinute: 10,
  writesPerDay: 200,
} as const;
export const forumPageQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const forumListQuery = forumPageQuery
  .extend({
    scope: forumScope.default('public'),
    kind: forumKind.optional(),
    problemId: problemId.optional(),
    q: z.string().trim().max(200).optional(),
    solved: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const forumPostInput = z
  .object({
    scope: forumScope,
    kind: forumKind,
    problemId: problemId.optional(),
    title: text(160),
    body: text(forumLimits.maxBodyLength),
  })
  .strict();
export const forumPostUpdateInput = z
  .object({ revision, title: text(160), body: text(forumLimits.maxBodyLength) })
  .strict();
export const forumRevisionInput = z.object({ revision }).strict();
export const forumModerationInput = z
  .object({
    revision,
    pinned: z.boolean().optional(),
    closed: z.boolean().optional(),
    solved: z.boolean().optional(),
  })
  .strict()
  .refine((value) => ['pinned', 'closed', 'solved'].some((key) => key in value), '至少指定一种管理操作');
export const forumReplyInput = z
  .object({ postRevision: revision, body: text(forumLimits.maxBodyLength) })
  .strict();
export type ForumListQuery = z.infer<typeof forumListQuery>;
export type ForumPostInput = z.infer<typeof forumPostInput>;
export type ForumPostUpdateInput = z.infer<typeof forumPostUpdateInput>;
export type ForumModerationInput = z.infer<typeof forumModerationInput>;
export type ForumPageQuery = z.infer<typeof forumPageQuery>;
