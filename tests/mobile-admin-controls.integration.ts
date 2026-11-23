import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture } from './live.fixture';
import { MobileApiError, MobileClient } from '../apps/mobile/src/client';
import {
  adminControlsRoot as root,
  adminControlsApi,
  type AdminReport,
  type AdminAudit,
  type AdminSetting,
} from '../apps/mobile/src/admin-controls-model';

test(
  'native administration: current-role governance, scoped audit and permissioned settings',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string) => {
      let saved: string | null = null;
      const client = new MobileClient(
        f.origin,
        {
          get: async () => saved,
          set: async (value) => {
            saved = value;
          },
          remove: async () => {
            saved = null;
          },
        },
        () => {},
      );
      await client.login(username, f.password);
      return client;
    };
    const denied = (promise: Promise<unknown>, status: number) =>
      assert.rejects(promise, (e) => e instanceof MobileApiError && e.status === status);
    try {
      const admin = await mobile(f.users.admin.username),
        student = await mobile(f.users.student.username),
        teacher = await mobile(f.users.teacher.username),
        outsider = await mobile(f.users.outsider.username);
      const foreignAudit = await f.db.auditLog.create({
        data: {
          organizationId: f.foreign.id,
          userId: f.users.outsider.id,
          action: 'native.foreign-secret',
          resourceType: 'User',
          resourceId: f.users.outsider.id,
          details: { mustNotAppear: true },
        },
      });
      let report: { id: string }, privateReport: { id: string };
      await t.test(
        'only current institution administrators may enter; web CSRF and native path limits remain',
        async () => {
          assert.equal((await fetch(f.origin + '/api' + root + '/audit')).status, 401);
          for (const client of [student, teacher, outsider])
            for (const path of ['/reports', '/audit', '/settings'])
              await denied(client.request(root + path), 403);
          await f.call(f.clients.admin, root + '/audit', 'GET', undefined, 403);
          await denied(admin.request('/admin/audit'), 403);
          for (const query of ['?organizationId=' + f.foreign.id, '?page=1&page=2', '?pageSize=51'])
            await denied(admin.request(root + '/audit' + query), 400);
          await f.call(
            f.clients.admin,
            '/admin/settings',
            'PATCH',
            { key: 'platformName', value: 'Must not write', reason: '缺少CSRF的请求' },
            403,
            false,
          );
        },
      );
      await t.test(
        'moderation resolves visible public content once but never opens or hides private conversations',
        async () => {
          const post = (
            await f.call(f.clients.teacher, '/communication/posts', 'POST', {
              courseId: f.course.id,
              title: '待治理公开讨论',
              body: '测试内容',
            })
          ).body;
          report = (
            await f.call(f.clients.student, '/communication/reports', 'POST', {
              targetType: 'post',
              targetId: post.id,
              reason: '请复核公开内容',
            })
          ).body;
          const conversation = (
            await f.call(f.clients.student, '/communication/conversations', 'POST', {
              userId: f.users.teacher.id,
            })
          ).body;
          const message = (
            await f.call(
              f.clients.student,
              '/communication/conversations/' + conversation.id + '/messages',
              'POST',
              { body: 'private-native-admin-secret', clientId: 'native-admin-private' },
            )
          ).body;
          privateReport = (
            await f.call(f.clients.student, '/communication/reports', 'POST', {
              targetType: 'message',
              targetId: message.id,
              reason: '请记录私信问题',
            })
          ).body;
          const list = await admin.request<{ items: AdminReport[]; total: number }>(root + '/reports');
          assert.equal(list.total, 2);
          assert.equal(list.items.find((r) => r.id === report.id)?.target?.body, '测试内容');
          const restricted = list.items.find((r) => r.id === privateReport.id)!;
          assert.equal(restricted.privateContentRestricted, true);
          assert.equal(restricted.target, null);
          assert.equal(JSON.stringify(list).includes('private-native-admin-secret'), false);
          await denied(adminControlsApi.resolve(admin, privateReport.id, 'hide', '试图隐藏私信'), 403);
          await adminControlsApi.resolve(admin, privateReport.id, 'dismiss', '记录反馈并联系当事人');
          await adminControlsApi.resolve(admin, report.id, 'hide', '公开内容违反讨论规则');
          assert.equal(
            (await f.db.discussionPost.findUniqueOrThrow({ where: { id: post.id } })).hidden,
            true,
          );
          assert.equal((await f.db.message.findUniqueOrThrow({ where: { id: message.id } })).hidden, false);
          await denied(adminControlsApi.resolve(admin, report.id, 'dismiss', '不能重复处理'), 409);
          assert.equal((await admin.request<{ total: number }>(root + '/reports')).total, 0);
        },
      );
      await t.test('audit filters return only current-space metadata and omit details payload', async () => {
        const result = await admin.request<{ items: AdminAudit[]; total: number }>(
          root + '/audit?pageSize=50',
        );
        assert.ok(result.total > 0);
        assert.equal(
          result.items.some((r) => r.id === foreignAudit.id),
          false,
        );
        for (const row of result.items)
          assert.deepEqual(
            Object.keys(row).sort(),
            ['id', 'createdAt', 'actorName', 'action', 'resourceType', 'resourceId', 'requestId'].sort(),
          );
        const filtered = await admin.request<{ items: AdminAudit[]; total: number }>(
          root + '/audit?action=communication.moderate',
        );
        assert.equal(filtered.total, 2);
        assert.equal(filtered.items.length, 2);
        assert.ok(filtered.items.every((row) => row.action === 'communication.moderate'));
        assert.equal(
          (await admin.request<{ total: number }>(root + '/audit?search=native.foreign-secret')).total,
          0,
        );
      });
      await t.test(
        'ordinary settings remain organization-scoped; feature/security keys require platform permission',
        async () => {
          const foreign = await f.db.systemSetting.create({
            data: { organizationId: f.foreign.id, key: 'platformName', value: 'Foreign platform secret' },
          });
          await f.db.systemSetting.create({
            data: {
              organizationId: f.organization.id,
              key: 'private-test-key',
              value: 'must-never-reach-native',
            },
          });
          await adminControlsApi.setting(admin, {
            key: 'platformName',
            value: '原生治理验收',
            reason: '更新本机构展示名称',
          });
          await adminControlsApi.setting(admin, {
            key: 'notificationEnabled',
            value: false,
            reason: '临时关闭通知发送',
          });
          const settings = await admin.request<{ items: AdminSetting[] }>(root + '/settings');
          assert.equal(settings.items.find((row) => row.key === 'platformName')?.value, '原生治理验收');
          assert.equal(JSON.stringify(settings).includes('must-never-reach-native'), false);
          assert.equal(JSON.stringify(settings).includes('Foreign platform secret'), false);
          assert.equal(
            (await f.db.systemSetting.findUniqueOrThrow({ where: { id: foreign.id } })).value,
            'Foreign platform secret',
          );
          await denied(
            adminControlsApi.setting(admin, {
              key: 'features',
              value: { practice: true, communication: false, live: true },
              reason: '平台配置应拒绝普通管理员',
            }),
            403,
          );
          await denied(
            admin.request(
              root + '/settings',
              { key: 'platformName', value: 'hijack', reason: '越权机构变更', organizationId: f.foreign.id },
              'PATCH',
            ),
            400,
          );
          assert.equal(
            await f.db.systemSetting.count({ where: { organizationId: f.organization.id, key: 'features' } }),
            0,
          );
          const audit = await f.db.auditLog.findFirstOrThrow({
            where: { organizationId: f.organization.id, action: 'settings.change' },
            orderBy: { createdAt: 'desc' },
          });
          assert.equal((audit.details as { reason: string }).reason, '临时关闭通知发送');
        },
      );
      await t.test(
        'granted platform role changes bounded settings and revoked authorization blocks further mutation',
        async () => {
          await f.db.userRole.create({ data: { userId: f.users.admin.id, roleId: 'SUPER_ADMIN' } });
          await admin.switchRole('SUPER_ADMIN');
          await adminControlsApi.setting(admin, {
            key: 'maxUploadMB',
            value: 12,
            reason: '调整上传容量上限',
          });
          await adminControlsApi.setting(admin, {
            key: 'loginPolicy',
            value: { sessionHours: 8 },
            reason: '调整新会话有效时长',
          });
          await adminControlsApi.setting(admin, {
            key: 'features',
            value: { practice: true, communication: false, live: true },
            reason: '关闭当前机构师生交流',
          });
          await denied(admin.request(root + '/reports'), 403);
          assert.ok(
            (await admin.request<{ items: AdminSetting[] }>(root + '/settings')).items.some(
              (row) => row.key === 'features',
            ),
          );
          await denied(
            admin.request(
              root + '/settings',
              { key: 'maxUploadMB', value: 51, reason: '不合法超大上限' },
              'PATCH',
            ),
            400,
          );
          await f.db.rolePermission.delete({
            where: { roleId_permissionId: { roleId: 'SUPER_ADMIN', permissionId: 'settings.platform' } },
          });
          await denied(
            adminControlsApi.setting(admin, {
              key: 'maxUploadMB',
              value: 20,
              reason: '撤销权限后仍尝试修改',
            }),
            403,
          );
          assert.equal(
            (
              await f.db.systemSetting.findUniqueOrThrow({
                where: { organizationId_key: { organizationId: f.organization.id, key: 'maxUploadMB' } },
              })
            ).value,
            12,
          );
          await f.db.rolePermission.create({
            data: { roleId: 'SUPER_ADMIN', permissionId: 'settings.platform' },
          });
          await f.db.session.deleteMany({ where: { userId: f.users.admin.id, clientType: 'MOBILE' } });
          await denied(admin.request(root + '/audit'), 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
