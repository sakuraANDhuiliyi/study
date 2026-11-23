import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createLiveFixture } from './live.fixture';
import { MobileClient, MobileApiError } from '../apps/mobile/src/client';
import { remotePushApi } from '../apps/mobile/src/remote-push-model';
import { MobilePushService } from '../apps/api/src/mobile/mobile-push.service';
import { JobsService } from '../apps/api/src/common/jobs.service';
import type { MobilePushGateway, PushOutcome } from '../apps/api/src/mobile/mobile-push.gateway';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
const project = '12345678-1234-4234-9234-123456789012';
class FakePushGateway {
  calls: { token: string; bindingId: string }[] = [];
  receipts: string[] = [];
  sends: PushOutcome[] = [];
  checks: PushOutcome[] = [];
  status() {
    return { available: true, projectId: project, reason: '' };
  }
  async send(token: string, bindingId: string): Promise<PushOutcome> {
    this.calls.push({ token, bindingId });
    return this.sends.shift() || { kind: 'ticket', id: 'ticket_' + this.calls.length };
  }
  async receipt(id: string): Promise<PushOutcome> {
    this.receipts.push(id);
    return this.checks.shift() || { kind: 'delivered' };
  }
}
test(
  'optional remote push uses real private inbox events, encrypted session-bound devices and a durable deduplicated outbox',
  { timeout: 180000 },
  async (t) => {
    const keys = ['MOBILE_PUSH_ENABLED', 'MOBILE_PUSH_EXPO_PROJECT_ID', 'MOBILE_PUSH_TOKEN_KEY'],
      before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.MOBILE_PUSH_ENABLED = 'true';
    process.env.MOBILE_PUSH_EXPO_PROJECT_ID = project;
    process.env.MOBILE_PUSH_TOKEN_KEY = randomBytes(32).toString('base64');
    let f: Awaited<ReturnType<typeof createLiveFixture>> | undefined;
    try {
      f = await createLiveFixture();
      const fixture = f;
      const mobile = async (username: string) => {
        let saved: string | null = null;
        const c = new MobileClient(
          fixture.origin,
          {
            get: async () => saved,
            set: async (v) => {
              saved = v;
            },
            remove: async () => {
              saved = null;
            },
          },
          () => {},
        );
        await c.login(username, fixture.password);
        return c;
      };
      const student = await mobile(f.users.student.username),
        student2 = await mobile(f.users.student2.username),
        teacher = await mobile(f.users.teacher.username);
      const denied = (p: Promise<unknown>, status: number) =>
        assert.rejects(p, (e) => e instanceof MobileApiError && e.status === status);
      const gateway = new FakePushGateway(),
        worker = new MobilePushService(
          f.db as unknown as PrismaService,
          gateway as unknown as MobilePushGateway,
        );
      const jobs = new JobsService(
        f.db as unknown as PrismaService,
        {} as never,
        { cleanup: async () => {} } as never,
      );
      const token = 'ExpoPushToken[fixture_only_' + randomBytes(10).toString('hex') + ']';
      const notification = async (label: string, userId = fixture.users.student.id) =>
        fixture.db.notification.create({
          data: {
            userId,
            organizationId: fixture.organization.id,
            eventKey: 'push-test:' + label,
            type: 'OTHER',
            title: 'PRIVATE TITLE ' + label,
            body: 'PRIVATE BODY ' + label,
            link: '/notifications',
          },
        });
      const due = () =>
        fixture.db.mobilePushDelivery.updateMany({
          where: { status: { in: ['PENDING', 'TICKET'] } },
          data: { nextAttemptAt: new Date(0) },
        });
      let bindingId = '';
      await t.test(
        'registration is exact, student-mobile only and contains no token or private session fields in status',
        async () => {
          assert.equal((await fetch(fixture.origin + '/api/mobile/push/status')).status, 401);
          await fixture.call(fixture.clients.student, '/mobile/push/status', 'GET', undefined, 403);
          await denied(remotePushApi.status(teacher), 403);
          await denied(
            student.request(
              '/mobile/push/device',
              { token, projectId: project, userId: fixture.users.student2.id },
              'POST',
            ),
            400,
          );
          await denied(remotePushApi.bind(student, 'https://attacker.invalid', project), 400);
          await denied(remotePushApi.bind(student, token, '23456789-1234-4234-9234-123456789012'), 503);
          const old = await notification('before-opt-in');
          const bound = await remotePushApi.bind(student, token, project);
          bindingId = bound.bindingId;
          assert.equal((await remotePushApi.bind(student, token, project)).bindingId, bindingId);
          const status = await remotePushApi.status(student);
          assert.equal(status.enabled, true);
          assert.equal(status.bindingId, bindingId);
          assert.deepEqual(
            Object.keys(status).sort(),
            ['available', 'reason', 'projectId', 'enabled', 'bindingId'].sort(),
          );
          const device = await fixture.db.mobilePushDevice.findUniqueOrThrow({ where: { id: bindingId } });
          assert.ok(!device.tokenCiphertext.includes(token));
          assert.equal(device.tokenHash.length, 64);
          await worker.run();
          assert.equal(await fixture.db.mobilePushDelivery.count({ where: { notificationId: old.id } }), 0);
          assert.equal(gateway.calls.length, 0);
        },
      );
      await t.test(
        'a real course announcement reaches the existing inbox first then produces one generic push ticket and receipt',
        async () => {
          const created = (
            await fixture.call(fixture.clients.teacher, '/announcements', 'POST', {
              courseId: fixture.course.id,
              title: 'PRIVATE COURSE TITLE',
              content: 'PRIVATE LEARNING DETAILS',
            })
          ).body;
          await jobs.run();
          const row = await fixture.db.notification.findFirstOrThrow({
            where: { userId: fixture.users.student.id, eventKey: 'announcement:' + created.id },
          });
          const inbox = await student.request<{ items: { id: string }[] }>(
            '/mobile/notifications?announcements=true',
          );
          assert.ok(inbox.items.some((n) => n.id === row.id));
          await Promise.all([worker.run(), worker.run()]);
          assert.equal(gateway.calls.length, 1);
          assert.deepEqual(gateway.calls[0], { token, bindingId });
          let delivery = await fixture.db.mobilePushDelivery.findUniqueOrThrow({
            where: { deviceId_notificationId: { deviceId: bindingId, notificationId: row.id } },
          });
          assert.equal(delivery.status, 'TICKET');
          await worker.run();
          assert.equal(gateway.calls.length, 1);
          await due();
          await worker.run();
          delivery = await fixture.db.mobilePushDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
          assert.equal(delivery.status, 'DELIVERED');
          assert.equal(gateway.receipts.length, 1);
          await due();
          await worker.run();
          assert.equal(gateway.calls.length, 1);
          assert.equal(
            (await fixture.db.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt,
            null,
          );
        },
      );
      await t.test(
        'known rejection and receipt failures back off with bounded retries; terminal delivery never sends twice',
        async () => {
          const row = await notification('retry');
          gateway.sends.push({ kind: 'retry', code: 'RATE_LIMITED' }, { kind: 'ticket', id: 'retry_ticket' });
          await worker.run();
          let d = await fixture.db.mobilePushDelivery.findUniqueOrThrow({
            where: { deviceId_notificationId: { deviceId: bindingId, notificationId: row.id } },
          });
          assert.equal(d.status, 'PENDING');
          assert.equal(d.attempts, 1);
          assert.ok(d.nextAttemptAt > new Date());
          const count = gateway.calls.length;
          await worker.run();
          assert.equal(gateway.calls.length, count);
          await due();
          await worker.run();
          gateway.checks.push({ kind: 'retry', code: 'RECEIPT_PENDING' }, { kind: 'delivered' });
          await due();
          await worker.run();
          d = await fixture.db.mobilePushDelivery.findUniqueOrThrow({ where: { id: d.id } });
          assert.equal(d.status, 'TICKET');
          assert.equal(d.receiptAttempts, 1);
          await due();
          await worker.run();
          d = await fixture.db.mobilePushDelivery.findUniqueOrThrow({ where: { id: d.id } });
          assert.equal(d.status, 'DELIVERED');
          assert.equal(d.attempts, 2);
          const final = gateway.calls.length;
          await due();
          await worker.run();
          assert.equal(gateway.calls.length, final);
        },
      );
      await t.test(
        'two worker instances cannot reclaim a stale retry generation after send or receipt returns to the same status',
        async () => {
          const row = await notification('worker-aba');
          const delivery = await fixture.db.mobilePushDelivery.create({
            data: {
              deviceId: bindingId,
              notificationId: row.id,
              organizationId: fixture.organization.id,
              userId: fixture.users.student.id,
            },
          });
          const stale = await fixture.db.mobilePushDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
          const second = new MobilePushService(
            fixture.db as unknown as PrismaService,
            gateway as unknown as MobilePushGateway,
          );
          const processFirst = Reflect.get(worker, 'process').bind(worker) as (
            row: typeof stale,
          ) => Promise<void>;
          const processSecond = Reflect.get(second, 'process').bind(second) as (
            row: typeof stale,
          ) => Promise<void>;
          gateway.sends.push({ kind: 'retry', code: 'RATE_LIMITED' });
          const count = gateway.calls.length;
          await processFirst(stale);
          const scheduled = await fixture.db.mobilePushDelivery.findUniqueOrThrow({
            where: { id: delivery.id },
          });
          assert.equal(scheduled.status, 'PENDING');
          assert.equal(scheduled.attempts, 1);
          assert.ok(scheduled.nextAttemptAt > stale.nextAttemptAt);
          await processSecond(stale);
          assert.equal(gateway.calls.length, count + 1);
          assert.deepEqual(
            await fixture.db.mobilePushDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
            scheduled,
          );
          await fixture.db.mobilePushDelivery.update({
            where: { id: delivery.id },
            data: { status: 'TICKET', ticketId: 'aba_ticket', nextAttemptAt: new Date(0) },
          });
          const receipt = await fixture.db.mobilePushDelivery.findUniqueOrThrow({
              where: { id: delivery.id },
            }),
            checks = gateway.receipts.length;
          gateway.checks.push({ kind: 'retry', code: 'RECEIPT_PENDING' });
          await processFirst(receipt);
          const nextReceipt = await fixture.db.mobilePushDelivery.findUniqueOrThrow({
            where: { id: delivery.id },
          });
          await processSecond(receipt);
          assert.equal(gateway.receipts.length, checks + 1);
          assert.equal(nextReceipt.receiptAttempts, 1);
          assert.deepEqual(
            await fixture.db.mobilePushDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
            nextReceipt,
          );
          await fixture.db.mobilePushDelivery.update({
            where: { id: delivery.id },
            data: { nextAttemptAt: new Date(0) },
          });
          await worker.run();
          assert.equal(
            (await fixture.db.mobilePushDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status,
            'DELIVERED',
          );
        },
      );
      await t.test(
        'unknown send acknowledgement and abandoned send lease become terminal without automatic replay',
        async () => {
          const row = await notification('unknown');
          gateway.sends.push({ kind: 'unknown', code: 'TRANSPORT_UNCERTAIN' });
          await worker.run();
          let d = await fixture.db.mobilePushDelivery.findUniqueOrThrow({
            where: { deviceId_notificationId: { deviceId: bindingId, notificationId: row.id } },
          });
          assert.equal(d.status, 'UNKNOWN');
          const count = gateway.calls.length;
          await worker.run();
          assert.equal(gateway.calls.length, count);
          await fixture.db.mobilePushDelivery.update({
            where: { id: d.id },
            data: { status: 'SENDING', claimId: 'crashed', leaseExpiresAt: new Date(0) },
          });
          await worker.run();
          d = await fixture.db.mobilePushDelivery.findUniqueOrThrow({ where: { id: d.id } });
          assert.equal(d.status, 'UNKNOWN');
          assert.equal(gateway.calls.length, count);
          const exhausted = await notification('exhausted');
          await fixture.db.mobilePushDelivery.create({
            data: {
              deviceId: bindingId,
              notificationId: exhausted.id,
              organizationId: fixture.organization.id,
              userId: fixture.users.student.id,
              attempts: 5,
            },
          });
          await worker.run();
          assert.equal(
            (
              await fixture.db.mobilePushDelivery.findFirstOrThrow({
                where: { notificationId: exhausted.id },
              })
            ).status,
            'FAILED',
          );
          assert.equal(gateway.calls.length, count);
        },
      );
      await t.test(
        'the same device token cannot carry an old identity into another account; logout removes its binding and deliveries',
        async () => {
          const old = await notification('old-owner-queued');
          await fixture.db.mobilePushDelivery.create({
            data: {
              deviceId: bindingId,
              notificationId: old.id,
              organizationId: fixture.organization.id,
              userId: fixture.users.student.id,
            },
          });
          const changed = await remotePushApi.bind(student2, token, project);
          assert.notEqual(changed.bindingId, bindingId);
          assert.equal((await remotePushApi.status(student)).enabled, false);
          assert.equal(await fixture.db.mobilePushDelivery.count({ where: { deviceId: bindingId } }), 0);
          const beforeCount = gateway.calls.length;
          await worker.run();
          assert.equal(gateway.calls.length, beforeCount);
          const own = await notification('second-owner', fixture.users.student2.id);
          await worker.run();
          const queued = await fixture.db.mobilePushDelivery.findUniqueOrThrow({
            where: { deviceId_notificationId: { deviceId: changed.bindingId, notificationId: own.id } },
          });
          assert.equal(queued.userId, fixture.users.student2.id);
          assert.equal(queued.organizationId, fixture.organization.id);
          // A PostgreSQL TIMESTAMPTZ(3) default can round up beyond the current JavaScript
          // millisecond. Advance only this initial queued delivery, then verify a complete tick;
          // the last historical gateway call is not evidence that this notification was sent.
          await fixture.db.mobilePushDelivery.updateMany({
            where: { id: queued.id, status: 'PENDING', attempts: 0 },
            data: { nextAttemptAt: new Date(0) },
          });
          await worker.run();
          assert.deepEqual(gateway.calls.slice(beforeCount), [{ token, bindingId: changed.bindingId }]);
          const delivered = await fixture.db.mobilePushDelivery.findUniqueOrThrow({
            where: { deviceId_notificationId: { deviceId: changed.bindingId, notificationId: own.id } },
          });
          assert.equal(delivered.status, 'TICKET');
          assert.equal(delivered.attempts, 1);
          assert.equal(await fixture.db.mobilePushDelivery.count({ where: { deviceId: bindingId } }), 0);
          await student2.logout();
          assert.equal(await fixture.db.mobilePushDevice.count({ where: { id: changed.bindingId } }), 0);
          assert.equal(
            await fixture.db.mobilePushDelivery.count({ where: { deviceId: changed.bindingId } }),
            0,
          );
        },
      );
      await t.test(
        'revoked session, permission and disabled organization never dispatch; ordinary inbox records remain readable',
        async () => {
          bindingId = (await remotePushApi.bind(student, token, project)).bindingId;
          const row = await notification('revoked');
          await fixture.db.mobilePushDelivery.create({
            data: {
              deviceId: bindingId,
              notificationId: row.id,
              organizationId: fixture.organization.id,
              userId: fixture.users.student.id,
            },
          });
          await fixture.db.user.update({
            where: { id: fixture.users.student.id },
            data: { authVersion: { increment: 1 } },
          });
          const count = gateway.calls.length;
          await worker.run();
          assert.equal(gateway.calls.length, count);
          assert.equal(
            (await fixture.db.mobilePushDevice.findUniqueOrThrow({ where: { id: bindingId } })).active,
            false,
          );
          assert.equal(
            (await fixture.db.mobilePushDelivery.findFirstOrThrow({ where: { notificationId: row.id } }))
              .status,
            'SKIPPED',
          );
          const fresh = await mobile(fixture.users.student.username);
          const inbox = await fresh.request<{ items: { id: string }[] }>('/mobile/notifications');
          assert.ok(inbox.items.some((n) => n.id === row.id));
          bindingId = (await remotePushApi.bind(fresh, token, project)).bindingId;
          const role = await fixture.db.role.findUniqueOrThrow({ where: { id: 'STUDENT' } }),
            permission = await fixture.db.permission.findUniqueOrThrow({ where: { id: 'learning.use' } });
          await fixture.db.rolePermission.delete({
            where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          });
          try {
            await notification('permission-revoked');
            await worker.run();
            assert.equal(gateway.calls.length, count);
            await denied(remotePushApi.status(fresh), 403);
          } finally {
            await fixture.db.rolePermission.create({
              data: { roleId: role.id, permissionId: permission.id },
            });
          }
          bindingId = (await remotePushApi.bind(fresh, token, project)).bindingId;
          await fixture.db.systemSetting.upsert({
            where: {
              organizationId_key: { organizationId: fixture.organization.id, key: 'notificationEnabled' },
            },
            create: { organizationId: fixture.organization.id, key: 'notificationEnabled', value: false },
            update: { value: false },
          });
          await notification('setting-disabled');
          await worker.run();
          assert.equal(gateway.calls.length, count);
          assert.equal((await remotePushApi.status(fresh)).enabled, false);
          await remotePushApi.remove(fresh);
          assert.equal(await fixture.db.mobilePushDevice.count({ where: { id: bindingId } }), 0);
        },
      );
    } finally {
      if (f) await f.cleanup();
      for (const key of keys) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  },
);
