import type { MobileClient } from './client';
export type RemotePushStatus = {
  available: boolean;
  reason: string;
  projectId: string | null;
  enabled: boolean;
  bindingId: string | null;
};
export function remoteInboxNotification(data: unknown, bindingId: string | null) {
  const d = data as { kind?: unknown; bindingId?: unknown } | null;
  return !!bindingId && d?.kind === 'study-inbox' && d.bindingId === bindingId;
}
export const remotePushApi = {
  status: (c: MobileClient) => c.request<RemotePushStatus>('/mobile/push/status'),
  bind: (c: MobileClient, token: string, projectId: string) =>
    c.request<{ enabled: true; bindingId: string }>('/mobile/push/device', { token, projectId }, 'POST'),
  remove: (c: MobileClient) =>
    c.request<{ enabled: false; bindingId: null }>('/mobile/push/device', {}, 'DELETE'),
};
