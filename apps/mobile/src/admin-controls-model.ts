import type { MobileClient } from './client';
export const adminControlsRoot = '/mobile/admin-controls';
export type AdminReport = {
  id: string;
  targetType: string;
  reason: string;
  status: string;
  createdAt: string;
  reporterName?: string;
  privateContentRestricted: boolean;
  resolution?: string | null;
  target?: { title?: string; body: string; authorName?: string; hidden: boolean } | null;
};
export type AdminAudit = {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId?: string | null;
};
export type AdminSetting = { key: string; value: unknown; updatedAt: string };
export type AdminSettingInput =
  | { key: 'platformName'; value: string; reason: string }
  | { key: 'notificationEnabled'; value: boolean; reason: string }
  | { key: 'features'; value: { practice: boolean; communication: boolean; live: boolean }; reason: string }
  | { key: 'maxUploadMB'; value: number; reason: string }
  | { key: 'loginPolicy'; value: { sessionHours: number }; reason: string };
export const adminControlsApi = {
  resolve: (c: MobileClient, id: string, action: 'hide' | 'dismiss', reason: string) =>
    c.request(
      adminControlsRoot + '/reports/' + encodeURIComponent(id) + '/resolve',
      { action, reason: reason.trim() },
      'POST',
    ),
  setting: (c: MobileClient, input: AdminSettingInput) =>
    c.request<AdminSetting>(adminControlsRoot + '/settings', input, 'PATCH'),
};
