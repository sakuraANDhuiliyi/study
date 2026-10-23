import type { MobileClient } from './client';
export type DiscussionSummary = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  authorName: string;
  pinned: boolean;
  featured: boolean;
  solved: boolean;
  closed: boolean;
  createdAt: string;
  replyCount: number;
};
export type DiscussionPage = { items: DiscussionSummary[]; total: number; page: number; pageSize: number };
export type DiscussionReply = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  own: boolean;
  attachmentCount: number;
  quote: { id: string; authorName: string; body: string } | null;
};
export type DiscussionDetail = Omit<DiscussionSummary, 'replyCount'> & {
  body: string;
  attachmentCount: number;
  canReply: boolean;
  replies: DiscussionReply[];
  replyPage: { total: number; page: number; pageSize: number };
};
export type DiscussionReceipt = { id: string; postId: string; createdAt: string };
export type DiscussionWrite =
  | { kind: 'post'; input: { courseId: string; title: string; body: string; key: string } }
  | { kind: 'reply'; postId: string; input: { body: string; quoteReplyId?: string; key: string } };
export function discussionText(value: string, max = 10000) {
  const text = value.trim();
  if (!text || text.length > max || text.includes('\0'))
    throw new Error(`请填写 1–${max} 个字符，不能包含空字符。`);
  return text;
}
export const discussionsApi = {
  publish: (c: MobileClient, p: DiscussionWrite) =>
    c.request<DiscussionReceipt>(
      p.kind === 'post'
        ? '/mobile/discussions'
        : '/mobile/discussions/' + encodeURIComponent(p.postId) + '/replies',
      p.input,
      'POST',
    ),
  receipt: (c: MobileClient, p: DiscussionWrite) =>
    c.request<({ found: true } & DiscussionReceipt) | { found: false }>(
      '/mobile/discussions/receipts?' + new URLSearchParams({ kind: p.kind, key: p.input.key }),
    ),
};
