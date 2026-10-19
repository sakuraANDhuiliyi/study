import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createLiveFixture, liveWait } from './live.fixture';
import { attachLogin } from './live-browser.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import { inboxApi, type InboxList } from '../apps/mobile/src/inbox-model';
const { MobileInboxController } = require('../apps/api/dist/mobile/mobile-inbox.controller.js');
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
test(
  'native inbox: own snapshots, explicit idempotent read, current authorization and website synchronization',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string) => {
      let raw: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => raw,
          set: async (s) => {
            raw = s;
          },
          remove: async () => {
            raw = null;
          },
        },
        () => {},
      );
      await c.login(username, f.password);
      return c;
    };
    let sequence = 0;
    const notify = (
      type = 'exam',
      link = '/exams/missing',
      userId = f.users.student.id,
      organizationId = f.organization.id,
    ) =>
      f.db.notification.create({
        data: {
          userId,
          organizationId,
          type,
          link,
          title: 'private-title-' + sequence,
          body: 'hidden-score-999999-and-private-message',
          eventKey: 'inbox-fixture-' + ++sequence,
        },
      });
    const list = (c: MobileClient, q = '') => c.request<InboxList>('/mobile/notifications' + q);
    const denied = async (work: Promise<unknown>, status: number) =>
      assert.rejects(work, (e) => (e as { status: number }).status === status);
    try {
      const student = await mobile(f.users.student.username),
        other = await mobile(f.users.student2.username),
        foreign = await mobile(f.users.outsider.username),
        teacher = await mobile(f.users.teacher.username);
      const own = await notify(),
        another = await notify('grade', '/attempts/missing', f.users.student2.id),
        cross = await notify('exam', '/exams/missing', f.users.student.id, f.foreign.id);
      await t.test(
        'scope rejects foreign users, cross-organization ids, generic notification routes and non-student clients',
        async () => {
          assert.equal((await fetch(f.origin + '/api/mobile/notifications')).status, 401);
          assert.equal((await list(student)).total, 1);
          assert.equal((await list(other)).total, 1);
          assert.equal((await list(foreign)).total, 0);
          await denied(list(teacher), 403);
          await f.call(f.clients.student, '/mobile/notifications', 'GET', undefined, 403);
          await denied(student.request('/notifications'), 403);
          for (const n of [another, cross]) {
            await denied(inboxApi.read(student, [n.id]), 404);
            await denied(inboxApi.target(student, n.id), 404);
          }
          assert.equal(
            (await f.db.notification.findUniqueOrThrow({ where: { id: another.id } })).readAt,
            null,
          );
        },
      );
      await t.test('safe DTOs, typed filters, stable tied-time ordering and strict bounds', async () => {
        const when = new Date();
        for (let i = 0; i < 12; i++) {
          const n = await notify(i % 2 ? 'PRIVATE_MESSAGE' : 'grade');
          await f.db.notification.update({ where: { id: n.id }, data: { createdAt: when } });
        }
        const first = await list(student),
          second = await list(student, '?page=2');
        assert.equal(first.total, 13);
        assert.equal(first.items.length, 10);
        assert.equal(second.items.length, 3);
        assert.equal(new Set([...first.items, ...second.items].map((n) => n.id)).size, 13);
        const payload = JSON.stringify(first);
        for (const secret of [
          'private-title',
          'hidden-score',
          'eventKey',
          'userId',
          'organizationId',
          'link',
          'body',
        ])
          assert.ok(!payload.includes(secret));
        assert.equal((await list(student, '?kind=other')).total, 6);
        assert.equal((await list(student, '?kind=grade')).total, 6);
        for (const q of ['?page=0', '?pageSize=21', '?unread=1', '?kind=PRIVATE_MESSAGE', '?userId=x'])
          await denied(list(student, q), 400);
        for (const body of [
          { ids: [] },
          { ids: Array(21).fill(own.id) },
          { ids: [own.id], userId: f.users.student2.id },
        ])
          await denied(student.request('/mobile/notifications/read', body, 'POST'), 400);
      });
      await t.test(
        'selected-page read preserves new arrivals, is atomic for mixed ownership and retries never change readAt',
        async () => {
          const snapshot = await list(student),
            selected = snapshot.items.map((n) => n.id),
            fresh = await notify();
          await denied(inboxApi.read(student, [own.id, another.id]), 404);
          assert.equal((await f.db.notification.findUniqueOrThrow({ where: { id: own.id } })).readAt, null);
          const results = await Promise.all([
            inboxApi.read(student, selected),
            inboxApi.read(student, selected),
          ]);
          assert.equal(
            results.reduce((n, r) => n + r.updated, 0),
            selected.length,
          );
          const read = await f.db.notification.findUniqueOrThrow({ where: { id: selected[0] } });
          await inboxApi.read(student, [selected[0], selected[0]]);
          assert.deepEqual(
            (await f.db.notification.findUniqueOrThrow({ where: { id: selected[0] } })).readAt,
            read.readAt,
          );
          assert.equal((await f.db.notification.findUniqueOrThrow({ where: { id: fresh.id } })).readAt, null);
          assert.equal((await list(student, '?unread=true')).total, 4);
        },
      );
      await t.test(
        'target admission rechecks audience, enrollment, ownership, publication and unknown links',
        async () => {
          const courseNote = await notify('MEMBERSHIP', '/courses/' + f.course.id);
          assert.deepEqual(await inboxApi.target(student, courseNote.id), {
            name: 'course',
            id: f.course.id,
          });
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
            data: { active: false },
          });
          await denied(inboxApi.target(student, courseNote.id), 403);
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
            data: { active: true },
          });
          const assignment = await f.db.assignment.create({
            data: {
              organizationId: f.organization.id,
              courseId: f.course.id,
              title: 'Inbox assignment',
              creatorId: f.users.teacher.id,
              totalCents: 100,
              attachmentIds: [],
              status: 'published',
              opensAt: new Date(Date.now() - 1000),
              dueAt: new Date(Date.now() + 3600000),
            },
          });
          const note = await notify('assignment', '/assignments/' + assignment.id);
          await denied(inboxApi.target(student, note.id), 404);
          await f.db.assignmentAudience.create({
            data: { assignmentId: assignment.id, userId: f.users.student.id },
          });
          assert.equal((await inboxApi.target(student, note.id)).name, 'assignment');
          await f.db.assignment.update({
            where: { id: assignment.id },
            data: { opensAt: new Date(Date.now() + 60000) },
          });
          await denied(inboxApi.target(student, note.id), 404);
          for (const [type, link] of [
            ['exam', 'https://evil.test'],
            ['PRIVATE_MESSAGE', '/exams/x'],
            ['grade', '/attempts/missing'],
          ]) {
            const n = await notify(type, link);
            await denied(inboxApi.target(student, n.id), 404);
          }
        },
      );
      await t.test(
        'website browser reads the same receipt and mobile read state is synchronized both ways',
        async () => {
          const n = await notify('PRIVATE_MESSAGE', '/notifications');
          const browser = await chromium.launch({
            headless: true,
            channel: 'chrome',
            args: ['--no-sandbox'],
          });
          try {
            const context = await browser.newContext();
            await attachLogin(context, f.clients.student, f.origin);
            const page = await context.newPage();
            await page.goto(f.origin + '/notifications');
            const row = page
              .locator('.notification')
              .filter({ has: page.getByText(n.title, { exact: true }) });
            await expect(row).toBeVisible();
            await row.getByRole('button', { name: '标为已读', exact: true }).click();
            await expect(row).toHaveClass(/read/);
            assert.ok((await list(student, '?pageSize=20')).items.find((x) => x.id === n.id)?.readAt);
            const next = await notify();
            await inboxApi.read(student, [next.id]);
            await page.reload();
            await expect(
              page.locator('.notification').filter({ has: page.getByText(next.title, { exact: true }) }),
            ).toHaveClass(/read/);
          } finally {
            await browser.close();
          }
        },
      );
      await t.test(
        'one-connection transaction resolves authentication without nested pool acquisition',
        async () => {
          const url = new URL(f.env.DATABASE_URL);
          url.searchParams.set('connection_limit', '1');
          const db = new PrismaService({ datasources: { db: { url: url.href } } });
          try {
            const session = await f.db.session.findFirstOrThrow({
              where: { userId: f.users.student.id, clientType: 'MOBILE' },
              orderBy: { createdAt: 'desc' },
            });
            const actor = await new AuthService(db).resolveMobileSessionId(session.id);
            assert.ok(actor);
            const controller = new MobileInboxController(db);
            assert.ok((await controller.list(actor, {})).total > 0);
            await controller.read(actor, { ids: [own.id] });
          } finally {
            await db.$disconnect();
          }
        },
      );
      await t.test(
        'queued read after device-session revocation cannot change notification state',
        async () => {
          const n = await notify();
          let release!: () => void, ready!: () => void;
          const gate = new Promise<void>((r) => {
              release = r;
            }),
            acquired = new Promise<void>((r) => {
              ready = r;
            });
          const lock = f.db.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'mobile-inbox:' + f.organization.id + ':' + f.users.student.id}))`;
              ready();
              await gate;
            },
            { timeout: 20000 },
          );
          await acquired;
          const pending = inboxApi.read(student, [n.id]);
          const outcome = denied(pending, 401);
          try {
            let waited = false;
            for (let i = 0; i < 100; i++) {
              const rows = await f.db.$queryRaw<
                { n: bigint }[]
              >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`;
              if (Number(rows[0].n)) {
                waited = true;
                break;
              }
              await liveWait(25);
            }
            assert.ok(waited);
            await f.db.session.deleteMany({ where: { userId: f.users.student.id, clientType: 'MOBILE' } });
          } finally {
            release();
            await lock;
          }
          await outcome;
          assert.equal((await f.db.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt, null);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
