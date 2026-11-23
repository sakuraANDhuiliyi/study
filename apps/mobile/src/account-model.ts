import type { MobileClient } from './client';
export type DeviceSession = {
  id: string;
  clientType: 'WEB' | 'MOBILE';
  deviceName: string;
  role: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
};
export type DeviceSessions = { total: number; items: DeviceSession[] };
export type RecoveryStatus = { configured: boolean; requiresOrganizationApproval: boolean };
export const accountApi = {
  recovery: (client: MobileClient) => client.request<RecoveryStatus>('/mobile/auth/recovery'),
  recoveryCode: (client: MobileClient, oldPassword: string) =>
    client.request<{ code: string }>('/mobile/auth/recovery-code', { oldPassword }, 'POST'),
  sessions: (client: MobileClient) => client.request<DeviceSessions>('/mobile/auth/sessions'),
  revoke: (client: MobileClient, id: string) =>
    client.request<{ ok: true; loginRequired: boolean }>(
      '/mobile/auth/sessions/' + encodeURIComponent(id),
      undefined,
      'DELETE',
    ),
};
export const accountRoles: Record<string, string> = {
  STUDENT: '学生',
  TEACHER: '教师',
  ADMIN: '机构管理员',
  SUPER_ADMIN: '平台管理员',
};
export function accountPasswordError(password: string, confirmation: string) {
  if (password.length < 12 || password.length > 128) return '密码需为12至128位。';
  return password !== confirmation ? '两次输入的密码不一致。' : '';
}
