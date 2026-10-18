import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createLiveFixture, liveWait } from './live.fixture';
import { attachLogin } from './live-browser.fixture';
import { assessmentServices } from './assessment-test-helpers';
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { MobileClient } from '../apps/mobile/src/client';
import { examApi } from '../apps/mobile/src/exam-model';
import { AuthService } from '../apps/api/src/auth/auth.service';
test(
  'native student exams: real database scope, timers, CAS, receipts and released review',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    const login = async (username: string) => {
      const r = await fetch(f.origin + '/api/mobile/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: f.password, deviceName: 'exam verification' }),
      });
      assert.equal(r.status, 201);
      return (await r.json()).accessToken as string;
    };
    const call = async (path: string, token?: string, method = 'GET', body?: unknown) => {
      const r = await fetch(f.origin + '/api/mobile/' + path, {
        method,
        headers: {
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      return { status: r.status, body: await r.json() };
    };
    const make = async (ids: string[], extra: Record<string, unknown> = {}) => {
      const e = (
        await f.call(f.clients.teacher, '/exams', 'POST', {
          courseId: f.course.id,
          title: 'Native-exam',
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString(),
          entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
          durationMinutes: 20,
          passCents: 100,
          maxAttempts: 2,
          graderIds: [f.users.teacher.id],
          questionVersionIds: ids,
          audienceIds: [f.users.student.id],
          ...extra,
        })
      ).body;
      await f.call(f.clients.teacher, '/exams/' + e.id + '/publish', 'POST');
      return e;
    };
    try {
      const native = await login(f.users.student.username),
        other = await login(f.users.student2.username),
        teacher = await login(f.users.teacher.username),
        foreign = await login(f.users.outsider.username);
      const ids: string[] = [];
      for (const type of ['single', 'multiple', 'boolean', 'blank', 'short', 'composite']) {
        const q = (
          await f.call(f.clients.teacher, '/questions', 'POST', {
            courseId: f.course.id,
            type,
            stem: '<p>Native-exam-' + type + '</p>',
            scoreCents: 100,
            options: ['single', 'multiple'].includes(type)
              ? [
                  { id: 'A', text: 'Alpha' },
                  { id: 'B', text: 'Beta' },
                ]
              : [],
            answer:
              type === 'multiple'
                ? ['A', 'B']
                : type === 'boolean'
                  ? false
                  : type === 'blank'
                    ? [['one']]
                    : 'A',
            children:
              type === 'composite'
                ? [{ id: 'child', type: 'short', stem: 'child', scoreCents: 100, answer: 'reference' }]
                : [],
            explanation: 'private-exam-explanation',
          })
        ).body;
        ids.push(q.versions[0].id);
      }
      const freshIds = async (count: number) => {
        const result: string[] = [];
        for (let i = 0; i < count; i++) {
          const q = (
            await f.call(f.clients.teacher, '/questions', 'POST', {
              courseId: f.course.id,
              type: 'single',
              stem: 'Independent exam ' + i + ' ' + Date.now(),
              scoreCents: 100,
              options: [
                { id: 'A', text: 'Alpha' },
                { id: 'B', text: 'Beta' },
              ],
              answer: 'A',
            })
          ).body;
          result.push(q.versions[0].id);
        }
        return result;
      };
      const e = await make(ids);
      let a: any;
      await t.test(
        'exact student session scopes and DTO whitelists hide drafts, audiences, answer keys and other students',
        async () => {
          assert.equal((await call('exams')).status, 401);
          assert.equal((await call('exams', teacher)).status, 403);
          assert.equal((await call('exams/' + e.id, other)).status, 404);
          assert.equal((await call('exams/' + e.id, foreign)).status, 404);
          const d = await call('exams/' + e.id, native);
          assert.equal(d.status, 200);
          for (const key of ['audience', 'snapshot', 'creatorId', 'graderIds', 'items'])
            assert.ok(!(key in d.body));
          assert.equal((await call('exams?status=draft', native)).status, 400);
          assert.equal((await f.call(f.clients.student, '/mobile/exams', 'GET', undefined, 403)).status, 403);
          const results = await Promise.all([
            call('exams/' + e.id + '/start', native, 'POST', {}),
            call('exams/' + e.id + '/start', native, 'POST', {}),
          ]);
          assert.deepEqual(
            results.map((x) => x.status),
            [201, 201],
          );
          assert.equal(results[0].body.id, results[1].body.id);
          a = results[0].body;
          assert.equal(a.items.length, 6);
          assert.ok(!JSON.stringify(a).includes('private-exam-explanation'));
          assert.equal(a.scoreCents, null);
          assert.equal((await call('exam-attempts/' + a.id, other)).status, 404);
        },
      );
      await t.test(
        'six answer formats, flags and positions persist; simultaneous website/native writes have one CAS winner',
        async () => {
          const answers = ids.map((questionVersionId, i) => ({
            questionVersionId,
            value: ['A', ['A', 'B'], false, ['one'], 'essay', { child: 'child-essay' }][i],
          }));
          const r = await call('exam-attempts/' + a.id + '/answers', native, 'PUT', {
            revision: a.revision,
            answers,
            flags: [ids[2]],
            currentPosition: 2,
          });
          assert.equal(r.status, 200);
          const s = (await call('exam-attempts/' + a.id, native)).body;
          assert.equal(s.answers.length, 6);
          assert.equal(s.answers.find((x: any) => x.questionVersionId === ids[2]).value, false);
          assert.equal(s.currentPosition, 2);
          assert.deepEqual(s.flags, [ids[2]]);
          const body = { revision: s.revision, answers: [{ questionVersionId: ids[4], value: 'winner' }] };
          const result = await Promise.all([
            call('exam-attempts/' + a.id + '/answers', native, 'PUT', body),
            f.call(f.clients.student, '/attempts/' + a.id + '/answers', 'PUT', body, [200, 409]),
          ]);
          assert.deepEqual(result.map((x) => x.status).sort(), [200, 409]);
          assert.equal(
            (await call('exam-attempts/' + a.id + '/answers', native, 'PUT', { ...body, grade: 100 })).status,
            400,
          );
        },
      );
      await t.test(
        'website resumes native answers and cannot overwrite a later native revision',
        async () => {
          const browser = await chromium.launch({ headless: true, channel: 'chrome' });
          try {
            const context = await browser.newContext();
            await attachLogin(context, f.clients.student, f.origin);
            const page = await context.newPage();
            await page.goto(f.origin + '/exam-attempts/' + a.id);
            await expect(page.getByText('Native-exam-boolean', { exact: true })).toBeVisible();
            const s = (await call('exam-attempts/' + a.id, native)).body;
            assert.equal(
              (
                await call('exam-attempts/' + a.id + '/answers', native, 'PUT', {
                  revision: s.revision,
                  answers: [{ questionVersionId: ids[2], value: true }],
                })
              ).status,
              200,
            );
            await page.getByText('正确', { exact: true }).click();
            await expect(
              page.getByText('版本冲突，保存已暂停', {
                exact: true,
              }),
            ).toBeVisible();
          } finally {
            await browser.close();
          }
        },
      );
      await t.test(
        'single transaction connection rechecks auth without nested pool acquisition',
        async () => {
          const url = new URL(f.env.DATABASE_URL);
          url.searchParams.set('connection_limit', '1');
          const single = new PrismaService({ datasources: { db: { url: url.toString() } } });
          try {
            const auth = new AuthService(single),
              actor = await auth.resolveMobileAccess(native);
            assert.ok(actor);
            const current = (await call('exam-attempts/' + a.id, native)).body;
            const svc = assessmentServices(single as never, auth as never).attempts;
            const r = await svc.saveAnswers(actor, a.id, { revision: current.revision, answers: [] });
            assert.equal(r.revision, current.revision + 1);
          } finally {
            await single.$disconnect();
          }
        },
      );
      await t.test(
        'manual retry returns one immutable receipt; unpublished keys, comments and scores remain hidden',
        async () => {
          const r = await Promise.all([
            call('exam-attempts/' + a.id + '/submit', native, 'POST', {
              idempotencyKey: 'native-fixed-receipt',
            }),
            call('exam-attempts/' + a.id + '/submit', native, 'POST', {
              idempotencyKey: 'native-fixed-receipt',
            }),
          ]);
          assert.deepEqual(
            r.map((x) => x.status),
            [201, 201],
          );
          assert.equal(r[0].body.status, 'submitted');
          assert.equal(r[0].body.scoreCents, null);
          assert.equal(r[0].body.releaseStatus, 'hidden');
          assert.ok(!JSON.stringify(r[0].body).includes('private-exam-explanation'));
          assert.equal(
            (await call('exam-attempts/' + a.id + '/answers', native, 'PUT', { revision: 0, answers: [] }))
              .status,
            409,
          );
          assert.equal(await f.db.auditLog.count({ where: { action: 'exam.submit', resourceId: a.id } }), 1);
          const past = new Date(Date.now() - 1000);
          await f.db.exam.update({
            where: { id: e.id },
            data: {
              scoreReleaseAt: past,
              answerReleaseAt: past,
              explanationReleaseAt: past,
              commentReleaseAt: past,
            },
          });
          await f.db.examAttempt.update({
            where: { id: a.id },
            data: {
              scoreCents: 450,
              gradingStatus: 'graded',
              releaseStatus: 'released',
              feedback: 'released-native-feedback',
            },
          });
          const d = (await call('exam-attempts/' + a.id, native)).body;
          assert.equal(d.scoreCents, 450);
          assert.equal(d.feedback, 'released-native-feedback');
          assert.ok(JSON.stringify(d).includes('private-exam-explanation'));
        },
      );
      await t.test(
        'sequential rules, individualized entry and deadline finalize are server enforced',
        async () => {
          const sequentialIds = await freshIds(2);
          const e2 = await make(sequentialIds, {
            allowBacktrack: false,
            entryClosesAt: new Date(Date.now() - 1000).toISOString(),
          });
          assert.equal((await call('exams/' + e2.id + '/start', native, 'POST', {})).status, 403);
          await f.db.examExtension.create({
            data: {
              examId: e2.id,
              userId: f.users.student.id,
              deadlineAt: new Date(Date.now() + 600000),
              extraAttempts: 1,
              reason: 'verification',
              approvedBy: f.users.teacher.id,
            },
          });
          const r = (await call('exams/' + e2.id + '/start', native, 'POST', {})).body;
          const prefix = 'exam-attempts/' + r.id;
          assert.equal(
            (await call(prefix + '/answers', native, 'PUT', { revision: 0, answers: [], currentPosition: 1 }))
              .status,
            200,
          );
          assert.equal(
            (
              await call(prefix + '/answers', native, 'PUT', {
                revision: 1,
                answers: [{ questionVersionId: sequentialIds[0], value: 'A' }],
                currentPosition: 0,
              })
            ).status,
            409,
          );
          await f.db.examAttempt.update({
            where: { id: r.id },
            data: { deadlineAt: new Date(Date.now() - 1000) },
          });
          assert.equal(
            (
              await call(prefix + '/answers', native, 'PUT', {
                revision: 1,
                answers: [{ questionVersionId: sequentialIds[1], value: 'B' }],
              })
            ).status,
            409,
          );
          const closed = (await call(prefix, native)).body;
          assert.equal(closed.status, 'timed_out');
          assert.equal(closed.answers.find((x: any) => x.questionVersionId === sequentialIds[1]).value, null);
        },
      );
      await t.test(
        'queued saves and manual submit recheck current eligibility and enrollment after row lock',
        async () => {
          const versions = await freshIds(1),
            e4 = await make(versions);
          const a4 = (await call('exams/' + e4.id + '/start', native, 'POST', {})).body;
          for (const mode of ['eligibility', 'enrollment']) {
            let release!: () => void, ready!: () => void;
            const gate = new Promise<void>((r) => (release = r)),
              acquired = new Promise<void>((r) => (ready = r));
            const hold = f.db.$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id=${a4.id} FOR UPDATE`;
                ready();
                await gate;
              },
              { timeout: 20000 },
            );
            await acquired;
            const pending =
              mode === 'eligibility'
                ? call('exam-attempts/' + a4.id + '/answers', native, 'PUT', {
                    revision: 0,
                    answers: [{ questionVersionId: versions[0], value: 'A' }],
                  })
                : call('exam-attempts/' + a4.id + '/submit', native, 'POST', {
                    idempotencyKey: 'queued-revoked-submit',
                  });
            try {
              const until = Date.now() + 5000;
              let waiting = false;
              while (Date.now() < until) {
                const rows = await f.db.$queryRaw<
                  { n: bigint }[]
                >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%ExamAttempt%'`;
                if (Number(rows[0].n) > 0) {
                  waiting = true;
                  break;
                }
                await liveWait(25);
              }
              assert.ok(waiting, 'request must actually wait at the database lock');
              if (mode === 'eligibility')
                await f.db.examAudience.update({
                  where: { examId_userId: { examId: e4.id, userId: f.users.student.id } },
                  data: { eligible: false },
                });
              else
                await f.db.enrollment.updateMany({
                  where: { courseId: f.course.id, userId: f.users.student.id },
                  data: { active: false },
                });
            } finally {
              release();
              await hold;
            }
            assert.equal((await pending).status, 403);
            assert.equal((await f.db.examAttempt.findUniqueOrThrow({ where: { id: a4.id } })).revision, 0);
            await f.db.examAudience.update({
              where: { examId_userId: { examId: e4.id, userId: f.users.student.id } },
              data: { eligible: true },
            });
            await f.db.enrollment.updateMany({
              where: { courseId: f.course.id, userId: f.users.student.id },
              data: { active: true },
            });
          }
        },
      );
      await t.test(
        'the actual shared native transport sends POST start/submit and PUT answers to real API',
        async () => {
          const versions = await freshIds(1),
            e5 = await make(versions);
          let raw: string | null = null;
          const client = new MobileClient(
            f.origin,
            {
              get: async () => raw,
              set: async (value) => {
                raw = value;
              },
              remove: async () => {
                raw = null;
              },
            },
            () => {},
          );
          await client.login(f.users.student.username, f.password);
          const record = await examApi.start(client, e5.id);
          const saved = await examApi.save(client, record.id, {
            revision: record.revision,
            answers: [{ questionVersionId: versions[0], value: 'A' }],
            flags: [],
            currentPosition: 0,
          });
          assert.equal(saved.revision, 1);
          const loaded = await examApi.load(client, record.id);
          assert.equal(loaded.answers[0].value, 'A');
          const submitted = await examApi.submit(client, record.id, 'native-transport-key');
          assert.equal(submitted.status, 'submitted');
          const retry = await examApi.submit(client, record.id, 'native-transport-key');
          assert.equal(retry.id, submitted.id);
          await client.logout();
        },
      );
      await t.test('session revoked while queued behind answer row lock cannot write or submit', async () => {
        const revokedIds = await freshIds(1);
        const e3 = await make(revokedIds);
        const r = (await call('exams/' + e3.id + '/start', native, 'POST', {})).body;
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>((r) => (release = r)),
          acquired = new Promise<void>((r) => (ready = r));
        const hold = f.db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id=${r.id} FOR UPDATE`;
            ready();
            await gate;
          },
          { timeout: 20000 },
        );
        await acquired;
        const write = call('exam-attempts/' + r.id + '/answers', native, 'PUT', {
          revision: 0,
          answers: [{ questionVersionId: revokedIds[0], value: 'A' }],
        });
        await liveWait(150);
        await f.db.session.deleteMany({ where: { userId: f.users.student.id, clientType: 'MOBILE' } });
        release();
        await hold;
        assert.equal((await write).status, 401);
        assert.equal((await f.db.examAttempt.findUniqueOrThrow({ where: { id: r.id } })).revision, 0);
        assert.equal(
          (
            await call('exam-attempts/' + r.id + '/submit', native, 'POST', {
              idempotencyKey: 'revoked-session',
            })
          ).status,
          401,
        );
      });
    } finally {
      await f.cleanup();
    }
  },
);
