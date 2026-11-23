import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mobileAdminControlsRouteAllowed,
  mobileAdminSettingInput,
  mobileAdminAuditQuery,
  mobileAdminReportQuery,
  mobileAdminReportResolution,
} from '../apps/api/src/mobile/mobile-admin-controls.policy';
import { adminControlsApi } from '../apps/mobile/src/admin-controls-model';
import type { MobileClient } from '../apps/mobile/src/client';

test('native admin allowlist is restricted to metadata, controlled settings and explicit report decisions', () => {
  for (const path of ['reports', 'audit', 'settings'])
    assert.equal(mobileAdminControlsRouteAllowed('/api/mobile/admin-controls/' + path, 'GET'), true);
  assert.equal(mobileAdminControlsRouteAllowed('/api/mobile/admin-controls/settings', 'PATCH'), true);
  assert.equal(
    mobileAdminControlsRouteAllowed('/api/mobile/admin-controls/reports/report_1/resolve', 'POST'),
    true,
  );
  for (const [path, method] of [
    ['audit/export', 'POST'],
    ['roles/ADMIN', 'PATCH'],
    ['grants', 'POST'],
    ['reports/id/resolve', 'GET'],
    ['settings', 'DELETE'],
    ['reports/id/other/resolve', 'POST'],
  ])
    assert.equal(mobileAdminControlsRouteAllowed('/api/mobile/admin-controls/' + path, method), false);
});
test('native settings use strict per-key types, bounded limits, reasons and no organization override', () => {
  const reason = '机构教学安排调整';
  for (const input of [
    { key: 'platformName', value: ' 新平台 ', reason },
    { key: 'notificationEnabled', value: false, reason },
    { key: 'features', value: { practice: true, communication: false, live: true }, reason },
    { key: 'maxUploadMB', value: 50, reason },
    { key: 'loginPolicy', value: { sessionHours: 72 }, reason },
  ])
    assert.equal(mobileAdminSettingInput.safeParse(input).success, true);
  for (const input of [
    { key: 'password', value: 'secret', reason },
    { key: 'features', value: { practice: true, communication: true, roles: ['ADMIN'] }, reason },
    { key: 'notificationEnabled', value: 'false', reason },
    { key: 'maxUploadMB', value: 51, reason },
    { key: 'loginPolicy', value: { sessionHours: 0 }, reason },
    { key: 'platformName', value: 'x', reason: '短' },
    { key: 'platformName', value: 'x', reason, organizationId: 'foreign' },
  ])
    assert.equal(mobileAdminSettingInput.safeParse(input).success, false);
});
test('audit and moderation queries reject duplicate/authority fields and impossible date ranges', () => {
  assert.equal(mobileAdminReportQuery.safeParse({ status: 'ALL', page: '2' }).success, true);
  for (const query of [
    { page: ['1', '2'] },
    { page: true },
    { pageSize: 51 },
    { organizationId: 'foreign' },
    { from: '2026-11-25T00:00:00Z', to: '2026-11-23T00:00:00Z' },
  ])
    assert.equal(mobileAdminAuditQuery.safeParse(query).success, false);
  assert.equal(mobileAdminReportResolution.safeParse({ action: 'hide', reason: '原因清楚' }).success, true);
  assert.equal(
    mobileAdminReportResolution.safeParse({ action: 'hide', reason: '原因清楚', targetId: 'other' }).success,
    false,
  );
});
test('native admin protocol sends only explicit chosen setting and report identifiers', async () => {
  const seen: unknown[] = [];
  const client = {
    request: (...args: unknown[]) => {
      seen.push(args);
      return Promise.resolve({});
    },
  } as unknown as MobileClient;
  await adminControlsApi.resolve(client, 'report/other', 'dismiss', '  保留公开讨论  ');
  await adminControlsApi.setting(client, {
    key: 'notificationEnabled',
    value: false,
    reason: '调整通知策略',
  });
  assert.deepEqual(seen, [
    [
      '/mobile/admin-controls/reports/report%2Fother/resolve',
      { action: 'dismiss', reason: '保留公开讨论' },
      'POST',
    ],
    [
      '/mobile/admin-controls/settings',
      { key: 'notificationEnabled', value: false, reason: '调整通知策略' },
      'PATCH',
    ],
  ]);
});
