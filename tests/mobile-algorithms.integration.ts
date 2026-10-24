import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture, liveWait } from './live.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import {
  algorithmsApi,
  reconcileAlgorithmEdit,
  type AlgorithmDetail,
  type AlgorithmList,
  type AlgorithmEditorial,
} from '../apps/mobile/src/algorithms-model';
import { algorithmProblems } from '../apps/api/src/algorithms/algorithms.catalog';
test(
  'native algorithm learning: real shared records, private state, version conflicts and queued revocation',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string, fetcher: typeof fetch = fetch) => {
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
        fetcher,
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number) =>
      assert.rejects(p, (e) => (e as { status: number }).status === status);
    const root = '/mobile/algorithms/problems',
      pid = 'sum-of-two',
      base = root + '/' + pid;
    const where = { organizationId: f.organization.id, userId: f.users.student.id, problemId: pid };
    try {
      let student = await mobile(f.users.student.username);
      const teacher = await mobile(f.users.teacher.username),
        other = await mobile(f.users.student2.username),
        foreign = await mobile(f.users.outsider.username);
      await t.test(
        'only native student sessions can access strict learning routes, never execution or AI',
        async () => {
          assert.equal((await fetch(f.origin + '/api' + root)).status, 401);
          await f.call(f.clients.student, root, 'GET', undefined, 403);
          await denied(teacher.request(root), 403);
          await denied(student.request('/algorithms/problems'), 403);
          for (const q of [
            '?page=0',
            '?pageSize=21',
            '?q=' + 'x'.repeat(101),
            '?userId=other',
            '?favorite=yes',
            '?tag=' + 'x'.repeat(61),
          ])
            await denied(student.request(root + q), 400);
          for (const endpoint of ['submissions', 'analysis', 'draft'])
            await denied(student.request(base + '/' + endpoint, {}, 'POST'), 404);
          await denied(
            student.request(base + '/learning', { revision: 0, note: 'x', userId: 'other' }, 'PATCH'),
            400,
          );
          await denied(
            student.request(base + '/learning', { revision: 0, note: 'x', favorite: 'true' }, 'PATCH'),
            400,
          );
          await denied(student.request(root + '/missing-problem'), 404);
        },
      );
      await t.test(
        'stable catalog pagination, compound filters and safe projections follow website semantics',
        async () => {
          const first = await student.request<AlgorithmList>(root),
            second = await student.request<AlgorithmList>(root + '?page=2');
          const web = (await f.call(f.clients.student, '/algorithms/problems?pageSize=10')).body;
          assert.deepEqual(first, web);
          assert.equal(first.total, algorithmProblems.length);
          assert.equal(first.items.length, 10);
          assert.equal(new Set([...first.items, ...second.items].map((p) => p.id)).size, 20);
          assert.equal(
            (await student.request<AlgorithmList>(root + '?q=' + encodeURIComponent('两数相加'))).items[0].id,
            pid,
          );
          assert.equal(
            (await student.request<AlgorithmList>(root + '?q=' + encodeURIComponent('100%_\\'))).total,
            0,
          );
          for (const level of ['easy', 'medium', 'hard'])
            assert.ok(
              (await student.request<AlgorithmList>(root + '?difficulty=' + level)).items.every(
                (p) => p.difficulty === level,
              ),
            );
          assert.ok(
            (await student.request<AlgorithmList>(root + '?tag=' + encodeURIComponent('数学'))).items.every(
              (p) => p.tags.includes('数学'),
            ),
          );
          const d = await student.request<AlgorithmDetail>(base),
            e = await student.request<AlgorithmEditorial>(base + '/editorial');
          assert.equal(d.description, algorithmProblems[0].description);
          assert.equal(e.editorial.problemId, pid);
          assert.ok(e.editorial.referenceCode.cpp);
          for (const text of [JSON.stringify(first), JSON.stringify(d), JSON.stringify(e)])
            for (const key of [
              'testCases',
              'hiddenCases',
              'organizationId',
              'userId',
              'passwordHash',
              'starterCode',
              '"draft"',
              '"solution"',
            ])
              assert.ok(!text.includes(key), key);
        },
      );
      await t.test(
        'personal favorite, review and Unicode notes synchronize with website without changing solved status',
        async () => {
          const initial = await algorithmsApi.learning(student, pid);
          const saved = await algorithmsApi.save(student, pid, initial, {
            favorite: true,
            reviewStatus: 'review',
            note: '<vector>\n私人学习😀',
          });
          assert.equal(saved.revision, 1);
          const web = (await f.call(f.clients.student, '/algorithms/problems/' + pid + '/learning')).body;
          assert.deepEqual(saved, web);
          const own = await student.request<AlgorithmList>(root + '?favorite=true&review=review');
          assert.equal(own.total, 1);
          assert.equal(own.items[0].status, 'todo');
          assert.equal(own.stats.solved, 0);
          assert.equal((await algorithmsApi.learning(other, pid)).note, '');
          assert.equal((await algorithmsApi.learning(foreign, pid)).note, '');
          await f.call(f.clients.student, '/algorithms/problems/' + pid + '/learning', 'PATCH', {
            revision: saved.revision,
            note: 'Website-note',
            reviewStatus: 'mastered',
          });
          const updated = await algorithmsApi.learning(student, pid);
          assert.equal(updated.favorite, true);
          assert.equal(updated.reviewStatus, 'mastered');
          assert.equal(updated.note, 'Website-note');
          await denied(
            algorithmsApi.save(student, pid, saved, { favorite: false, reviewStatus: 'none', note: 'stale' }),
            409,
          );
          const cleared = await algorithmsApi.save(student, pid, updated, {
            favorite: false,
            reviewStatus: 'none',
            note: '',
          });
          assert.equal(cleared.note, '');
        },
      );
      await t.test(
        'web/native concurrent revisions accept only one update and preserve the winning contents',
        async () => {
          const current = await algorithmsApi.learning(student, pid);
          const results = await Promise.allSettled([
            algorithmsApi.save(student, pid, current, {
              favorite: true,
              reviewStatus: 'review',
              note: 'Native-race',
            }),
            f.call(
              f.clients.student,
              '/algorithms/problems/' + pid + '/learning',
              'PATCH',
              { revision: current.revision, note: 'Web-race' },
              [200, 409],
            ),
          ]);
          // Accept either HTTP outcome, then require exactly one winning revision.
          const native = results[0],
            web = results[1];
          assert.equal(web.status, 'fulfilled');
          if (web.status !== 'fulfilled') throw new Error('Web request failed');
          assert.equal(Number(native.status === 'fulfilled') + Number(web.value.status === 200), 1);
          if (native.status === 'rejected') assert.equal(native.reason.status, 409);
          else assert.equal(web.value.status, 409);
          const latest = await algorithmsApi.learning(student, pid);
          assert.equal(latest.revision, current.revision + 1);
          assert.ok(['Native-race', 'Web-race'].includes(latest.note));
        },
      );
      await t.test(
        'actual response loss after commit is recovered with a read and never duplicates a revision',
        async () => {
          let drop = true;
          const c = await mobile(f.users.student.username, async (url, init) => {
            const r = await fetch(url, init);
            if (drop && init?.method === 'PATCH' && String(url).endsWith('/learning')) {
              drop = false;
              await r.arrayBuffer();
              throw new Error('Lost actual committed response');
            }
            return r;
          });
          const current = await algorithmsApi.learning(c, pid),
            intent = { favorite: true, reviewStatus: 'review' as const, note: 'Recovered-record' };
          await denied(algorithmsApi.save(c, pid, current, intent), 0);
          const actual = await algorithmsApi.learning(c, pid);
          assert.equal(reconcileAlgorithmEdit(current, intent, actual), 'applied');
          assert.equal(actual.revision, current.revision + 1);
          await denied(algorithmsApi.save(c, pid, current, intent), 409);
          assert.equal((await algorithmsApi.learning(c, pid)).revision, actual.revision);
        },
      );
      await t.test(
        'catalog status derives from owned formal non-custom submissions only; reading never expires operations',
        async () => {
          const make = (
            userId: string,
            mode: string,
            customInput: boolean,
            status: string,
            problemId: string,
          ) =>
            f.db.algorithmSubmission.create({
              data: {
                organizationId: f.organization.id,
                userId,
                problemId,
                language: 'python',
                code: 'private-code',
                mode,
                customInput,
                status,
                results: [],
              },
            });
          await make(f.users.student.id, 'run', false, 'accepted', pid);
          await make(f.users.student.id, 'submit', true, 'accepted', pid);
          await make(f.users.student2.id, 'submit', false, 'accepted', pid);
          assert.equal((await student.request<AlgorithmList>(root + '?status=solved')).total, 0);
          await make(f.users.student.id, 'submit', false, 'wrong_answer', pid);
          assert.equal((await student.request<AlgorithmList>(root + '?status=attempted')).items[0].id, pid);
          await make(f.users.student.id, 'submit', false, 'accepted', pid);
          assert.equal((await student.request<AlgorithmList>(root + '?status=solved')).items[0].id, pid);
          const pending = await f.db.algorithmOperation.create({
            data: {
              organizationId: f.organization.id,
              userId: f.users.student.id,
              kind: 'judge',
              leaseExpiresAt: new Date(0),
            },
          });
          await student.request(root);
          assert.equal(
            (await f.db.algorithmOperation.findUniqueOrThrow({ where: { id: pending.id } })).status,
            'pending',
          );
        },
      );
      await t.test(
        'queued native reads and writes refresh feature, permission, account, role and device session under the shared website lock',
        async () => {
          for (const method of ['GET', 'PATCH', 'WEB'])
            for (const kind of method === 'WEB'
              ? ['feature', 'permission']
              : ['feature', 'permission', 'account', 'role', 'session']) {
              student = await mobile(f.users.student.username);
              const current = await algorithmsApi.learning(student, pid);
              let release!: () => void, ready!: () => void;
              const gate = new Promise<void>((r) => {
                  release = r;
                }),
                acquired = new Promise<void>((r) => {
                  ready = r;
                });
              const hold = f.db.$transaction(
                async (tx) => {
                  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`algorithms:${f.organization.id}:${f.users.student.id}`}))`;
                  ready();
                  await gate;
                },
                { timeout: 20000 },
              );
              await acquired;
              const expected = ['feature', 'permission'].includes(kind) ? 403 : 401;
              const pending =
                method === 'WEB'
                  ? f.call(
                      f.clients.student,
                      '/algorithms/problems/' + pid + '/learning',
                      'PATCH',
                      { revision: current.revision, note: 'Denied-web-queued' },
                      403,
                    )
                  : denied(
                      method === 'GET'
                        ? student.request(base)
                        : algorithmsApi.save(student, pid, current, {
                            favorite: false,
                            reviewStatus: 'none',
                            note: 'Denied-queued',
                          }),
                      expected,
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
                  await liveWait(25);
                }
                assert.ok(waited, 'Actual HTTP transaction must wait on the common algorithm lock');
                if (kind === 'feature')
                  await f.db.systemSetting.create({
                    data: { organizationId: f.organization.id, key: 'features', value: { practice: false } },
                  });
                if (kind === 'permission')
                  await f.db.rolePermission.delete({
                    where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
                  });
                if (kind === 'account')
                  await f.db.user.update({ where: { id: f.users.student.id }, data: { active: false } });
                if (kind === 'role')
                  await f.db.userRole.delete({
                    where: { userId_roleId: { userId: f.users.student.id, roleId: 'STUDENT' } },
                  });
                if (kind === 'session')
                  await f.db.session.deleteMany({
                    where: { userId: f.users.student.id, clientType: 'MOBILE' },
                  });
              } finally {
                release();
                await hold;
              }
              await pending;
              if (kind === 'feature')
                await f.db.systemSetting.deleteMany({
                  where: { organizationId: f.organization.id, key: 'features' },
                });
              if (kind === 'permission')
                await f.db.rolePermission.create({
                  data: { roleId: 'STUDENT', permissionId: 'learning.use' },
                });
              if (kind === 'account')
                await f.db.user.update({ where: { id: f.users.student.id }, data: { active: true } });
              if (kind === 'role')
                await f.db.userRole.create({ data: { userId: f.users.student.id, roleId: 'STUDENT' } });
              assert.equal(
                (await f.db.algorithmLearningState.findFirstOrThrow({ where })).revision,
                current.revision,
              );
            }
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
