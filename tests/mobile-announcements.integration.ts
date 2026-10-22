import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture, runFixtureJobs } from './live.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import { inboxApi } from '../apps/mobile/src/inbox-model';
test(
  'mobile teaching announcements: scoped snapshots, detail and safe notification navigation',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (name: string) => {
      let raw: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => raw,
          set: async (v) => {
            raw = v;
          },
          remove: async () => {
            raw = null;
          },
        },
        () => {},
      );
      await c.login(name, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number) =>
      assert.rejects(p, (e) => (e as { status: number }).status === status);
    try {
      const student = await mobile(f.users.student.username),
        teacher = await mobile(f.users.teacher.username),
        outsider = await mobile(f.users.outsider.username);
      const rows: any[] = [];
      for (let i = 0; i < 12; i++)
        rows.push(
          (
            await f.call(f.clients.teacher, '/announcements', 'POST', {
              courseId: f.course.id,
              title: 'Native-course-' + i,
              content: '<p>Shared teaching body ' + i + '</p>',
            })
          ).body,
        );
      const org = (
        await f.call(f.clients.admin, '/announcements', 'POST', {
          title: 'Notice 100%_\\ exact',
          content: '<p>Institution message</p>',
        })
      ).body;
      runFixtureJobs(f.env);
      const foreign = await f.db.announcement.create({
        data: {
          organizationId: f.foreign.id,
          authorId: f.users.outsider.id,
          title: 'FOREIGN-ANNOUNCEMENT',
          content: 'FOREIGN-PRIVATE',
        },
      });
      const list = (q = '') => student.request<any>('/mobile/announcements' + q);
      const read = (id: string) => student.request<any>('/mobile/announcements/' + id);
      await t.test(
        'student mobile-only reads with strict query and no publishing or generic web routes',
        async () => {
          assert.equal((await fetch(f.origin + '/api/mobile/announcements')).status, 401);
          await f.call(f.clients.student, '/mobile/announcements', 'GET', undefined, 403);
          await denied(teacher.request('/mobile/announcements'), 403);
          await denied(student.request('/announcements'), 403);
          await denied(student.request('/mobile/announcements', {}, 'POST'), 404);
          await denied(student.request('/mobile/announcements/' + rows[0].id, {}, 'PUT'), 404);
          for (const q of [
            '?page=0',
            '?pageSize=21',
            '?scope=invalid',
            '?authorId=x',
            '?search=' + 'x'.repeat(101),
            '?scope=organization&courseId=' + f.course.id,
          ])
            await denied(list(q), 400);
        },
      );
      await t.test('private stable paging, institution/course scopes and literal title search', async () => {
        const a = await list(),
          b = await list('?page=2');
        assert.equal(a.total, 13);
        assert.equal(a.items.length, 10);
        assert.equal(b.items.length, 3);
        assert.equal(new Set([...a.items, ...b.items].map((x) => x.id)).size, 13);
        assert.equal((await list('?scope=organization')).total, 1);
        assert.equal((await list('?scope=courses')).total, 12);
        assert.equal((await list('?courseId=' + f.course.id)).total, 12);
        assert.equal((await list('?search=%25')).total, 1);
        assert.equal((await list('?search=' + encodeURIComponent('100%_\\'))).total, 1);
        assert.equal((await list('?search=NATIVE-course-')).total, 12);
        const payload = JSON.stringify(a);
        for (const s of [
          'authorId',
          'organizationId',
          'content',
          'Shared teaching body',
          'FOREIGN-ANNOUNCEMENT',
        ])
          assert.ok(!payload.includes(s));
        const web = (await f.call(f.clients.student, '/announcements?courseId=' + f.course.id)).body;
        assert.equal(web.total, 12);
        assert.equal((await read(rows[0].id)).content, rows[0].content);
      });
      await t.test(
        'detail forbids cross-organization, missing, unenrolled and unpublished courses; archived matches website policy',
        async () => {
          await denied(read(foreign.id), 404);
          await denied(read('missing'), 404);
          await denied(outsider.request('/mobile/announcements/' + rows[0].id), 404);
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
            data: { active: false },
          });
          assert.equal((await list()).total, 1);
          await denied(read(rows[0].id), 403);
          await denied(list('?courseId=' + f.course.id), 403);
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
            data: { active: true },
          });
          await f.db.course.update({ where: { id: f.course.id }, data: { status: 'UNPUBLISHED' } });
          assert.equal((await list()).total, 1);
          await denied(read(rows[0].id), 403);
          await f.db.course.update({ where: { id: f.course.id }, data: { status: 'ARCHIVED' } });
          assert.equal((await list('?scope=courses')).total, 12);
          await f.db.course.update({ where: { id: f.course.id }, data: { status: 'PUBLISHED' } });
        },
      );
      await t.test(
        'native detail sanitizes stored HTML without remote images/scripts or author identifiers',
        async () => {
          await f.db.announcement.update({
            where: { id: rows[0].id },
            data: {
              content:
                '<p>Native safe body</p><script>HIDDEN_SCRIPT</script><img src="https://tracker.invalid/pixel"><a href="javascript:bad()">link</a>',
            },
          });
          const value = await read(rows[0].id),
            raw = JSON.stringify(value);
          assert.ok(value.content.includes('Native safe body'));
          for (const s of [
            'HIDDEN_SCRIPT',
            'tracker.invalid',
            'javascript:',
            '<img',
            'authorId',
            'organizationId',
          ])
            assert.ok(!raw.includes(s));
        },
      );
      await t.test(
        'exact course/institution announcement targets revalidate records without marking read',
        async () => {
          const n = await f.db.notification.findFirstOrThrow({
            where: { userId: f.users.student.id, eventKey: 'announcement:' + rows[0].id },
          });
          assert.deepEqual(await student.request('/mobile/notifications/' + n.id + '/target'), {
            name: 'course',
            id: f.course.id,
          });
          assert.deepEqual(await inboxApi.target(student, n.id), { name: 'announcement', id: rows[0].id });
          assert.equal((await f.db.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt, null);
          const global = await f.db.notification.findFirstOrThrow({
            where: { userId: f.users.student.id, eventKey: 'announcement:' + org.id },
          });
          const oldList = await student.request<any>('/mobile/notifications');
          assert.equal(oldList.items.find((x: any) => x.id === global.id)?.canOpen, false);
          const newList = await student.request<any>('/mobile/notifications?announcements=true');
          assert.equal(newList.items.find((x: any) => x.id === global.id)?.canOpen, true);
          assert.deepEqual(await inboxApi.target(student, global.id), { name: 'announcement', id: org.id });
          await f.db.notification.update({ where: { id: n.id }, data: { link: '/notifications' } });
          await denied(inboxApi.target(student, n.id), 404);
          await f.db.notification.update({ where: { id: n.id }, data: { link: '/courses/' + f.course.id } });
          await f.db.announcement.delete({ where: { id: rows[0].id } });
          await denied(read(rows[0].id), 404);
          await denied(inboxApi.target(student, n.id), 404);
        },
      );
      await t.test(
        'announcements follow website feature policy even with discussion/practice disabled',
        async () => {
          await f.db.systemSetting.upsert({
            where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
            create: {
              organizationId: f.organization.id,
              key: 'features',
              value: { communication: false, practice: false },
            },
            update: { value: { communication: false, practice: false } },
          });
          assert.equal((await list()).total, 12);
          assert.equal((await read(org.id)).title, org.title);
          await f.db.systemSetting.deleteMany({
            where: { organizationId: f.organization.id, key: 'features' },
          });
        },
      );
      await t.test(
        'queued list/detail recheck enrollment, account and device session before returning content',
        async () => {
          for (const kind of ['enrollment', 'account', 'session']) {
            const c = await mobile(f.users.student.username);
            let release!: () => void, ready!: () => void;
            const gate = new Promise<void>((r) => {
                release = r;
              }),
              acquired = new Promise<void>((r) => {
                ready = r;
              });
            const hold = f.db.$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'mobile-announcements:' + f.users.student.id}))`;
                ready();
                await gate;
              },
              { timeout: 20000 },
            );
            await acquired;
            const pending = denied(
              c.request('/mobile/announcements/' + rows[1].id),
              kind === 'enrollment' ? 403 : 401,
            );
            try {
              let waited = false;
              for (let i = 0; i < 120; i++) {
                const r = await f.db.$queryRaw<
                  { n: bigint }[]
                >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`;
                if (Number(r[0].n)) {
                  waited = true;
                  break;
                }
                await new Promise((r) => setTimeout(r, 25));
              }
              assert.ok(waited);
              if (kind === 'enrollment')
                await f.db.enrollment.update({
                  where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
                  data: { active: false },
                });
              if (kind === 'account')
                await f.db.user.update({ where: { id: f.users.student.id }, data: { active: false } });
              if (kind === 'session')
                await f.db.session.deleteMany({
                  where: { userId: f.users.student.id, clientType: 'MOBILE' },
                });
            } finally {
              release();
              await hold;
            }
            await pending;
            if (kind === 'enrollment')
              await f.db.enrollment.update({
                where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
                data: { active: true },
              });
            if (kind === 'account')
              await f.db.user.update({ where: { id: f.users.student.id }, data: { active: true } });
          }
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
