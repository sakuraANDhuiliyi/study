import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { createLiveFixture, liveWait } from './live.fixture';
import { attachLogin } from './live-browser.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import { practiceApi, type PracticeDetail, type PracticeList } from '../apps/mobile/src/practice-model';
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { AuditService } from '../apps/api/src/common/audit.service';
import { AssessmentContext } from '../apps/api/src/assessment/assessment-context';
import { QuestionSelectionService } from '../apps/api/src/assessment/question-selection.service';
import { PracticeService } from '../apps/api/src/assessment/practice.service';
test(
  'native autonomous practice: immutable first answers, private scope, resumable progress and idempotent creation',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string, fetcher: typeof fetch = fetch) => {
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
      await c.login(username, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number) =>
      assert.rejects(p, (e) => (e as { status: number }).status === status);
    try {
      const student = await mobile(f.users.student.username),
        other = await mobile(f.users.student2.username),
        teacher = await mobile(f.users.teacher.username),
        foreign = await mobile(f.users.outsider.username);
      const bank: any[] = [];
      for (const type of ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'])
        bank.push(
          (
            await f.call(f.clients.teacher, '/questions', 'POST', {
              courseId: f.course.id,
              type,
              stem: '<p>Practice-' + type + '</p>',
              scoreCents: 100,
              practiceEnabled: true,
              difficulty: 2,
              knowledgePoints: ['Native-learning'],
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
                      : type === 'composite'
                        ? {}
                        : 'A',
              children:
                type === 'composite'
                  ? [
                      {
                        id: 'child',
                        type: 'short',
                        stem: 'Child',
                        answer: 'Child-secret-reference',
                        scoreCents: 100,
                      },
                    ]
                  : [],
              explanation: 'Secret-explanation-' + type,
            })
          ).body,
        );
      const input = { courseId: f.course.id, count: 6, mode: 'random' as const };
      let d: PracticeDetail;
      await t.test(
        'mobile student routes only and answers/references remain absent before each first submission',
        async () => {
          assert.equal((await fetch(f.origin + '/api/mobile/practice')).status, 401);
          await f.call(f.clients.student, '/mobile/practice', 'GET', undefined, 403);
          await denied(teacher.request('/mobile/practice'), 403);
          await denied(student.request('/practice'), 403);
          d = await practiceApi.create(student, input, randomUUID());
          assert.equal(d.items.length, 6);
          assert.equal(d.answers.length, 0);
          for (const q of d.items) {
            assert.ok(!Object.hasOwn(q, 'answer'));
            assert.ok(!Object.hasOwn(q, 'explanation'));
            for (const c of q.children) {
              assert.ok(!Object.hasOwn(c, 'answer'));
              assert.ok(!Object.hasOwn(c, 'explanation'));
            }
          }
          await denied(practiceApi.read(other, d.id), 404);
          await denied(practiceApi.read(foreign, d.id), 404);
          assert.ok(!JSON.stringify(d).includes('userId'));
          assert.ok(!JSON.stringify(d).includes('mobileCreate'));
          for (const body of [
            { ...input, requestKey: randomUUID(), userId: f.users.student2.id },
            { ...input, count: 31, requestKey: randomUUID() },
            { ...input, requestKey: 'invalid' },
          ])
            await denied(student.request('/mobile/practice', body, 'POST'), 400);
          for (const query of ['?page=0', '?pageSize=21', '?status=unknown', '?userId=x'])
            await denied(student.request('/mobile/practice' + query), 400);
        },
      );
      await t.test(
        'concurrent creation and lost create response reuse exactly one own request with frozen conditions',
        async () => {
          const key = randomUUID();
          const results = await Promise.all([
            practiceApi.create(student, input, key),
            practiceApi.create(student, input, key),
          ]);
          assert.equal(results[0].id, results[1].id);
          await denied(practiceApi.create(student, { ...input, count: 1 }, key), 409);
          let drop = true;
          const client = await mobile(f.users.student.username, async (url, init) => {
            const r = await fetch(url, init);
            if (drop && String(url).endsWith('/mobile/practice') && init?.method === 'POST') {
              drop = false;
              await r.arrayBuffer();
              throw new TypeError('Lost create response after commit');
            }
            return r;
          });
          const recoveryKey = randomUUID();
          await assert.rejects(practiceApi.create(client, input, recoveryKey));
          const recovered = await practiceApi.create(client, input, recoveryKey);
          assert.equal(
            await f.db.practiceSession.count({
              where: { userId: f.users.student.id, mobileCreateKey: recoveryKey },
            }),
            1,
          );
          assert.ok(recovered.id);
        },
      );
      await t.test(
        'six question types reveal only their answered snapshot; repeated/concurrent first answer never adds another mistake',
        async () => {
          for (const q of d!.items) {
            const value =
              q.type === 'multiple'
                ? ['A', 'B']
                : q.type === 'boolean'
                  ? false
                  : q.type === 'blank'
                    ? ['one']
                    : q.type === 'short'
                      ? 'Self-review'
                      : q.type === 'composite'
                        ? { child: 'My-child' }
                        : 'B';
            const results = await Promise.all([
              practiceApi.answer(student, d!.id, q.id, value),
              practiceApi.answer(student, d!.id, q.id, value),
            ]);
            d = results[0];
            const own = d.answers.find((a) => a.questionVersionId === q.id)!;
            assert.deepEqual(own.value, value);
            assert.ok(
              Object.hasOwn(
                d.items.find((x) => x.id === q.id)!,
                'answer',
              ),
            );
            assert.deepEqual(
              (await practiceApi.answer(student, d.id, q.id, q.type === 'single' ? 'A' : value)).answers.find(
                (a) => a.questionVersionId === q.id,
              )?.value,
              value,
            );
            for (const hidden of d.items.filter((x) => !d.answers.some((a) => a.questionVersionId === x.id)))
              assert.ok(!Object.hasOwn(hidden, 'answer'));
          }
          assert.equal(d!.status, 'completed');
          assert.equal(d!.report.answered, 6);
          assert.equal(d!.report.objectivelyScored, 4);
          assert.equal(d!.report.correct, 3);
          const single = bank.find((q) => q.versions[0].type === 'single');
          assert.equal(
            (
              await f.db.mistakeRecord.findUniqueOrThrow({
                where: { userId_questionId: { userId: f.users.student.id, questionId: single.id } },
              })
            ).wrongCount,
            1,
          );
        },
      );
      await t.test(
        'progress CAS shares website position/flags and real browser shows only previously submitted references',
        async () => {
          const first = d!.items[0].id;
          await practiceApi.progress(student, d!.id, 0, [first], 1);
          await f.call(f.clients.student, '/practice/' + d!.id + '/progress', 'PUT', {
            revision: 1,
            flags: [first],
            currentPosition: 2,
          });
          await denied(practiceApi.progress(student, d!.id, 1, [], 0), 409);
          const fresh = await practiceApi.read(student, d!.id);
          assert.equal(fresh.currentPosition, 2);
          assert.equal(fresh.revision, 2);
          const browser = await chromium.launch({
            headless: true,
            channel: 'chrome',
            args: ['--no-sandbox'],
          });
          try {
            const context = await browser.newContext();
            await attachLogin(context, f.clients.student, f.origin);
            const page = await context.newPage();
            await page.goto(f.origin + '/practice/' + d!.id);
            await expect(page.getByText('专注练习，稳步进阶', { exact: true })).toBeVisible();
            await expect(page.getByText('题目 3 / 6', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: '查看报告', exact: true }).click();
            await expect(page.getByText('本次练习报告', { exact: true })).toBeVisible();
          } finally {
            await browser.close();
          }
        },
      );
      await t.test(
        'lost answer response is recovered by read only, and closed question content/references are withdrawn',
        async () => {
          const session = await practiceApi.create(
            student,
            { ...input, count: 1, type: 'single' },
            randomUUID(),
          );
          let writes = 0;
          const c = await mobile(f.users.student.username, async (url, init) => {
            const r = await fetch(url, init);
            if (String(url).endsWith('/answer') && init?.method === 'POST') {
              writes++;
              await r.arrayBuffer();
              throw new TypeError('Lost answer response after commit');
            }
            return r;
          });
          await assert.rejects(practiceApi.answer(c, session.id, session.items[0].id, 'A'));
          assert.equal((await practiceApi.read(c, session.id)).answers.length, 1);
          assert.equal(writes, 1);
          const question = bank.find((q) => q.versions[0].type === 'single');
          await f.db.question.update({ where: { id: question.id }, data: { practiceEnabled: false } });
          const closed = await practiceApi.read(student, session.id);
          assert.equal(closed.items[0].available, false);
          assert.equal(closed.answers.length, 0);
          assert.ok(!JSON.stringify(closed).includes('Secret-explanation'));
          await denied(practiceApi.answer(student, session.id, session.items[0].id, 'A'), 403);
          await f.db.question.update({ where: { id: question.id }, data: { practiceEnabled: true } });
        },
      );
      await t.test(
        'filters, actual bank bounds, own mistake/favorite mode and stable pagination are enforced',
        async () => {
          const filtered = await practiceApi.create(
            student,
            { ...input, count: 1, type: 'boolean', difficulty: 2, knowledgePoint: 'Native-learning' },
            randomUUID(),
          );
          assert.equal(filtered.items[0].type, 'boolean');
          await denied(practiceApi.create(student, { ...input, count: 7 }, randomUUID()), 400);
          const mistakes = await practiceApi.create(
            student,
            { courseId: f.course.id, count: 1, mode: 'mistakes' },
            randomUUID(),
          );
          assert.equal(mistakes.items[0].type, 'single');
          await denied(
            practiceApi.create(other, { courseId: f.course.id, count: 1, mode: 'mistakes' }, randomUUID()),
            400,
          );
          const single = bank.find((q) => q.versions[0].type === 'single');
          await f.call(f.clients.student, '/questions/' + single.id + '/favorite', 'PUT', { favorite: true });
          const favorite = await practiceApi.create(
            student,
            { courseId: f.course.id, count: 1, mode: 'favorites' },
            randomUUID(),
          );
          assert.equal(favorite.items[0].type, 'single');
          const first = await student.request<PracticeList>('/mobile/practice?pageSize=2'),
            second = await student.request<PracticeList>('/mobile/practice?pageSize=2&page=2');
          assert.equal(new Set([...first.items, ...second.items].map((x) => x.id)).size, 4);
          assert.equal((await other.request<PracticeList>('/mobile/practice')).total, 0);
        },
      );
      await t.test(
        'single-connection authentication and progress use the same transaction without nested pool acquisition',
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
            const ctx = new AssessmentContext(db, new AuthService(db), new AuditService(db));
            const svc = new PracticeService(ctx, new QuestionSelectionService(ctx));
            assert.equal((await svc.mobileRead(actor, d!.id)).id, d!.id);
            await svc.practices(actor, { page: 1, pageSize: 10 });
          } finally {
            await db.$disconnect();
          }
        },
      );
      await t.test(
        'queued requests recheck current enrollment, feature flag and device session after acquiring the practice lock',
        async () => {
          for (const kind of ['enrollment', 'feature', 'session']) {
            const c = await mobile(f.users.student.username);
            const before = await practiceApi.read(c, d!.id);
            let release!: () => void, ready!: () => void;
            const gate = new Promise<void>((r) => {
                release = r;
              }),
              acquired = new Promise<void>((r) => {
                ready = r;
              });
            const lock = f.db.$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'practice:' + d!.id}))`;
                ready();
                await gate;
              },
              { timeout: 20000 },
            );
            await acquired;
            const result = denied(
              practiceApi.progress(c, d!.id, before.revision, [], 0),
              kind === 'session' ? 401 : 403,
            );
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
            await result;
            assert.equal(
              (await f.db.practiceSession.findUniqueOrThrow({ where: { id: d!.id } })).revision,
              before.revision,
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
