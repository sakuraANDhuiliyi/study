import { MobileApiError, type MobileClient } from './client';
export type MessageFile = { id: string; name: string; mime: string; size: number };
export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  body: string;
  createdAt: string;
  retractedAt: string | null;
  clientId: string;
  attachments: MessageFile[];
};
export type MessagePage = {
  items: Message[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};
export type Conversation = {
  id: string;
  title: string;
  kind: string;
  unreadCount?: number;
  lastMessage?: { body: string; createdAt: string } | null;
};
export type MessageReceipt = { id: string; conversationId: string; clientId: string; createdAt: string };
export type MessageAttempt = {
  conversationId: string;
  body: string;
  clientId: string;
  attachmentIds?: readonly string[];
};
export type ReportTarget = { targetType: 'post' | 'reply' | 'message'; targetId: string };
export const messageRoot = '/mobile/messages';
const conversationPath = (id: string) => messageRoot + '/conversations/' + encodeURIComponent(id);
export function prepareMessage(
  conversationId: string,
  body: string,
  clientId: string,
  attachmentIds: string[] = [],
): MessageAttempt {
  const text = body.trim();
  if (!text || text.length > 10000 || text.includes('\0'))
    throw new Error('请填写1–10000个字符，不能包含空字符。');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clientId)) throw new Error('消息标识无效，请重新进入会话。');
  if (
    attachmentIds.length > 10 ||
    new Set(attachmentIds).size !== attachmentIds.length ||
    attachmentIds.some((id) => !/^[A-Za-z0-9_-]{1,100}$/.test(id))
  )
    throw new Error('附件标识或数量无效');
  return Object.freeze({
    conversationId,
    body: text,
    clientId,
    ...(attachmentIds.length ? { attachmentIds: Object.freeze([...attachmentIds]) } : {}),
  });
}
export const messageDefinitelyRefused = (error: unknown) =>
  error instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(error.status);
export const messagesApi = {
  direct: (c: MobileClient, userId: string) =>
    c.request<Conversation>(messageRoot + '/conversations', { userId }, 'POST'),
  classroom: (c: MobileClient, id: string) =>
    c.request<Conversation>(messageRoot + '/classes/' + encodeURIComponent(id) + '/conversation', {}, 'POST'),
  send: (c: MobileClient, attempt: MessageAttempt) =>
    c.request<MessageReceipt>(
      conversationPath(attempt.conversationId) + '/messages',
      {
        body: attempt.body,
        clientId: attempt.clientId,
        ...(attempt.attachmentIds?.length ? { attachmentIds: attempt.attachmentIds } : {}),
      },
      'POST',
    ),
  read: (c: MobileClient, id: string, messageId: string) =>
    c.request<{ success: boolean }>(conversationPath(id) + '/read', { messageId }, 'POST'),
  retract: (c: MobileClient, id: string) =>
    c.request<{ success: boolean }>(messageRoot + '/messages/' + encodeURIComponent(id), undefined, 'DELETE'),
  report: (c: MobileClient, target: ReportTarget, reason: string) =>
    c.request<{ id: string; status: string }>(
      messageRoot + '/reports',
      { ...target, reason: reason.trim() },
      'POST',
    ),
  file: (c: MobileClient, id: string, fileId: string) =>
    c.request<Uint8Array>(conversationPath(id) + '/files/' + encodeURIComponent(fileId), undefined, 'GET', {
      binary: true,
    }),
};
