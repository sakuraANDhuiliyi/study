import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture } from './live.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import { collectionsApi, type CollectionList } from '../apps/mobile/src/collections-model';
test(
  'mobile collections: private safe snapshots and guarded shared state writes',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const login = async (name: string, fetcher: typeof fetch = fetch) => {
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
        fetcher,
      );
      await c.login(name, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number) =>
      assert.rejects(p, (e) => (e as { status: number }).status === status);
    try {
      const c = await login(f.users.student.username),
        other = await login(f.users.student2.username),
        teacher = await login(f.users.teacher.username);
      const qs: any[] = [];
      for (let i = 0; i < 12; i++) {
        const q = (
          await f.call(f.clients.teacher, '/questions', 'POST', {
            courseId: f.course.id,
            type: 'single',
            stem: 'Collections-' + i,
            scoreCents: 100,
            practiceEnabled: true,
            options: [
              { id: 'A', text: 'Alpha' },
              { id: 'B', text: 'Beta' },
            ],
            answer: 'A',
            explanation: 'PRIVATE-COLLECTION-REFERENCE',
          })
        ).body;
        qs.push(q);
        await f.db.mistakeRecord.create({
          data: { userId: f.users.student.id, courseId: f.course.id, questionId: q.id },
        });
      }
      const list = (kind = 'mistakes', query = '') =>
        c.request<CollectionList>('/mobile/collections/' + kind + query);
      await t.test('mobile student-only and strict bounded query/body validation', async () => {
        assert.equal((await fetch(f.origin + '/api/mobile/collections/mistakes')).status, 401);
        await f.call(f.clients.student, '/mobile/collections/mistakes', 'GET', undefined, 403);
        await denied(teacher.request('/mobile/collections/mistakes'), 403);
        await denied(c.request('/mistakes'), 403);
        for (const q of ['?userId=x', '?page=0', '?pageSize=21', '?mastered=no'])
          await denied(list('mistakes', q), 400);
        await denied(list('favorites', '?mastered=false'), 400);
        await denied(
          c.request('/mobile/collections/mistakes/' + qs[0].id, { mastered: true, expected: false }, 'PUT'),
          400,
        );
      });
      await t.test(
        'personal paging and snapshots contain no answer, explanation or author identifiers',
        async () => {
          const first = await list();
          assert.equal(first.total, 12);
          assert.equal(first.items.length, 10);
          assert.equal((await list('mistakes', '?page=2')).items.length, 2);
          assert.equal((await other.request<CollectionList>('/mobile/collections/mistakes')).total, 0);
          const raw = JSON.stringify(first);
          assert.ok(!raw.includes('PRIVATE-COLLECTION-REFERENCE'));
          assert.ok(!raw.includes('userId'));
          assert.ok(!raw.includes('"answer"'));
          assert.equal(first.items[0].token?.length, 64);
        },
      );
      await t.test(
        'mastery shares website state and rejects stale flags or newly answered records',
        async () => {
          const row = (await list()).items[0];
          await collectionsApi.master(c, row);
          assert.equal(
            (await f.call(f.clients.student, '/mistakes')).body.items.find((x: any) => x.id === row.id)
              .mastered,
            true,
          );
          await denied(collectionsApi.master(c, row), 409);
          const updated = (await list('mistakes', '?mastered=true')).items[0];
          await f.db.mistakeRecord.update({
            where: { id: row.id },
            data: {
              wrongCount: { increment: 1 },
              mastered: false,
              lastAnsweredAt: new Date(Date.now() + 10),
            },
          });
          await denied(collectionsApi.master(c, updated), 409);
          await denied(collectionsApi.master(other, row), 404);
        },
      );
      await t.test(
        'concurrent favorite adds create one row and old records cannot remove a recreated favorite',
        async () => {
          const row = (await list()).items[0];
          const results = await Promise.allSettled([
            collectionsApi.favorite(c, row),
            collectionsApi.favorite(c, row),
          ]);
          assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
          assert.equal(
            await f.db.questionFavorite.count({
              where: { userId: f.users.student.id, questionId: row.questionId },
            }),
            1,
          );
          const favorite = (await list('favorites')).items[0];
          await f.call(f.clients.student, '/questions/' + row.questionId + '/favorite', 'PUT', {
            favorite: false,
          });
          await f.call(f.clients.student, '/questions/' + row.questionId + '/favorite', 'PUT', {
            favorite: true,
          });
          await denied(collectionsApi.favorite(c, favorite), 409);
          assert.equal((await list('favorites')).total, 1);
        },
      );
      await t.test('closed questions hide content while own old favorite can be removed', async () => {
        const row = (await list('favorites')).items[0];
        await f.db.question.update({ where: { id: row.questionId }, data: { practiceEnabled: false } });
        const closed = (await list('favorites')).items[0];
        assert.equal(closed.question, null);
        assert.equal(closed.available, false);
        await collectionsApi.favorite(c, closed);
        assert.equal((await list('favorites')).total, 0);
        await denied(
          c.request(
            '/mobile/collections/favorites/' + row.questionId,
            { favorite: true, expected: null },
            'PUT',
          ),
          404,
        );
      });
      await t.test('response loss is reconciled by read without replaying a stale write', async () => {
        let dropped = false;
        const losing = await login(f.users.student.username, async (url, init) => {
          const r = await fetch(url, init);
          if (!dropped && init?.method === 'PUT' && String(url).includes('/collections/')) {
            dropped = true;
            await r.arrayBuffer();
            throw new TypeError('Lost response');
          }
          return r;
        });
        const row = (await list()).items.find((r) => r.available)!;
        await assert.rejects(collectionsApi.favorite(losing, row));
        const recovered = (await list('favorites')).items[0];
        assert.equal(recovered.questionId, row.questionId);
        await denied(collectionsApi.favorite(c, row), 409);
      });
      await t.test('course withdrawal and institution feature switch deny reads/writes', async () => {
        const row = (await list()).items[0];
        await f.db.enrollment.update({
          where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
          data: { active: false },
        });
        assert.equal((await list()).total, 0);
        await denied(list('mistakes', '?courseId=' + f.course.id), 403);
        await denied(collectionsApi.master(c, row), 403);
        await f.db.enrollment.update({
          where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
          data: { active: true },
        });
        await f.db.systemSetting.upsert({
          where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
          create: { organizationId: f.organization.id, key: 'features', value: { practice: false } },
          update: { value: { practice: false } },
        });
        await denied(list(), 403);
        await denied(collectionsApi.master(c, row), 403);
      });
      await f.db.systemSetting.deleteMany({ where: { organizationId: f.organization.id, key: 'features' } });
      await t.test(
        'queued writes refresh course, institution and session authority after the lock',
        async () => {
          for (const kind of ['enrollment', 'feature', 'session']) {
            const device = await login(f.users.student.username);
            const row = (await device.request<CollectionList>('/mobile/collections/mistakes')).items[0];
            let release!: () => void, ready!: () => void;
            const gate = new Promise<void>((r) => {
                release = r;
              }),
              acquired = new Promise<void>((r) => {
                ready = r;
              });
            const lock = f.db.$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'collection:' + f.users.student.id}))`;
                ready();
                await gate;
              },
              { timeout: 20000 },
            );
            await acquired;
            const pending = denied(collectionsApi.master(device, row), kind === 'session' ? 401 : 403);
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
                await new Promise((r) => setTimeout(r, 25));
              }
              assert.ok(waited);
              if (kind === 'enrollment')
                await f.db.enrollment.update({
                  where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
                  data: { active: false },
                });
              if (kind === 'feature')
                await f.db.systemSetting.upsert({
                  where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
                  create: { organizationId: f.organization.id, key: 'features', value: { practice: false } },
                  update: { value: { practice: false } },
                });
              if (kind === 'session')
                await f.db.session.deleteMany({
                  where: { userId: f.users.student.id, clientType: 'MOBILE' },
                });
            } finally {
              release();
              await lock;
            }
            await pending;
            assert.equal(
              (await f.db.mistakeRecord.findUniqueOrThrow({ where: { id: row.id } })).mastered,
              row.mastered,
            );
            if (kind === 'enrollment')
              await f.db.enrollment.update({
                where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
                data: { active: true },
              });
            if (kind === 'feature')
              await f.db.systemSetting.deleteMany({
                where: { organizationId: f.organization.id, key: 'features' },
              });
          }
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
