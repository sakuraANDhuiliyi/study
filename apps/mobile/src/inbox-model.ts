import type { MobileClient } from './client';
export type InboxTarget = { name: 'course' | 'assignment' | 'exam' | 'review' | 'announcement'; id: string };
export type InboxList = {
  items: {
    id: string;
    kind: string;
    title: string;
    createdAt: string;
    readAt: string | null;
    canOpen: boolean;
  }[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
};
export function nativeInboxTarget(value: unknown): InboxTarget {
  const t = value as Partial<InboxTarget> | null;
  if (
    !t ||
    !['course', 'assignment', 'exam', 'review', 'announcement'].includes(t.name || '') ||
    typeof t.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(t.id)
  )
    throw new Error('通知目标无效，请刷新或在网站查看');
  return { name: t.name!, id: t.id };
}
export const inboxApi = {
  read: (client: MobileClient, ids: string[]) =>
    client.request<{ success: true; updated: number }>('/mobile/notifications/read', { ids }, 'POST'),
  target: async (client: MobileClient, id: string) =>
    nativeInboxTarget(
      await client.request('/mobile/notifications/' + encodeURIComponent(id) + '/target?announcements=true'),
    ),
};
