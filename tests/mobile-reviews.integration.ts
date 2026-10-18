import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createLiveFixture, liveWait } from './live.fixture';
import { attachLogin } from './live-browser.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import { reviewApi } from '../apps/mobile/src/review-model';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { assessmentServices } from './assessment-test-helpers';
test(
  'native grade review: authentic admission, immutable receipts, locked authorization and published history',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string) => {
      let raw: string | null = null;
      const client = new MobileClient(
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
      await client.login(username, f.password);
      return client;
    };
    const request = async (c: MobileClient, path: string, method = 'GET', body?: unknown, status = 200) => {
      try {
        const value = await c.request(path, body, method);
        assert.ok(status < 300);
        return value;
      } catch (e) {
        assert.equal((e as { status: number }).status, status);
        return null;
      }
    };
    let n = 0;
    const make = async (release = true) => {
      const q = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: 'single',
          stem: 'Review fixture ' + ++n,
          scoreCents: 100,
          options: [
            { id: 'A', text: 'Alpha' },
            { id: 'B', text: 'Beta' },
          ],
          answer: 'A',
        })
      ).body;
      const e = (
        await f.call(f.clients.teacher, '/exams', 'POST', {
          courseId: f.course.id,
          title: 'Native-review-' + n,
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString(),
          entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
          durationMinutes: 20,
          passCents: 100,
          graderIds: [f.users.teacher.id],
          questionVersionIds: [q.versions[0].id],
          audienceIds: [f.users.student.id],
        })
      ).body;
      await f.call(f.clients.teacher, '/exams/' + e.id + '/publish', 'POST');
      const a = (await f.call(f.clients.student, '/exams/' + e.id + '/start', 'POST', {})).body;
      await f.call(f.clients.student, '/attempts/' + a.id + '/submit', 'POST', {
        idempotencyKey: 'review-fixture-' + n,
      });
      await f.db.exam.update({
        where: { id: e.id },
        data: {
          endsAt: new Date(Date.now() - 1000),
          entryClosesAt: new Date(Date.now() - 2000),
          scoreReleaseAt: new Date(Date.now() - 1000),
          appealDeadline: new Date(Date.now() + 3600000),
        },
      });
      if (release) await f.call(f.clients.teacher, '/exams/' + e.id + '/release', 'POST');
      return { exam: e, attempt: a };
    };
    const waiting = async () => {
      for (let i = 0; i < 150; i++) {
        const rows = await f.db.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%ExamAttempt%'`;
        if (Number(rows[0].n) > 0) return;
        await liveWait(25);
      }
      throw new Error('Request did not reach real row lock');
    };
    const held = async (id: string) => {
      let release!: () => void, ready!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        acquired = new Promise<void>((r) => (ready = r));
      const work = f.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id=${id} FOR UPDATE`;
          ready();
          await gate;
        },
        { timeout: 20000 },
      );
      await acquired;
      return { release, work };
    };
    try {
      const student = await mobile(f.users.student.username),
        other = await mobile(f.users.student2.username),
        teacher = await mobile(f.users.teacher.username),
        foreign = await mobile(f.users.outsider.username);
      await f.db.sensitiveGrant.create({
        data: {
          organizationId: f.organization.id,
          userId: f.users.teacher.id,
          permissionId: 'grade.revise',
          grantedBy: f.users.admin.id,
          reason: 'isolated grade review fixture',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const x = await make();
      let appealId: string;
      const path = (id: string) => '/mobile/exam-attempts/' + id;
      await t.test(
        'student mobile scope and strict DTOs deny other accounts, generic grading and website credentials',
        async () => {
          assert.equal((await fetch(f.origin + '/api' + path(x.attempt.id) + '/review')).status, 401);
          for (const c of [other, foreign])
            await request(c, path(x.attempt.id) + '/review', 'GET', undefined, 404);
          await request(teacher, '/mobile/appeals', 'GET', undefined, 403);
          await f.call(f.clients.student, '/mobile/appeals', 'GET', undefined, 403);
          await request(student, '/appeals', 'GET', undefined, 403);
          await request(student, '/mobile/appeals?status=anything', 'GET', undefined, 400);
          const r = await reviewApi.load(student, x.attempt.id);
          assert.equal(r.canApply, true);
          assert.equal(r.scoreCents, 0);
          assert.equal(r.appeal, null);
          assert.ok(!JSON.stringify(r).includes('actorId'));
          await request(
            student,
            path(x.attempt.id) + '/appeals',
            'POST',
            { reason: '有效复核申请说明', scoreCents: 100 },
            400,
          );
        },
      );
      await t.test(
        'unpublished, pending grading, removed eligibility and closed deadlines cannot create applications',
        async () => {
          const hidden = await make(false);
          await request(
            student,
            path(hidden.attempt.id) + '/appeals',
            'POST',
            { reason: '成绩未发布前尝试申请' },
            409,
          );
          const states = [
            { exam: { scoreReleaseAt: new Date(Date.now() + 60000) } },
            { attempt: { gradingStatus: 'pending' } },
            { exam: { appealDeadline: new Date(Date.now() - 1) } },
          ];
          for (const state of states) {
            const sample = await make();
            if (state.exam) await f.db.exam.update({ where: { id: sample.exam.id }, data: state.exam });
            if (state.attempt)
              await f.db.examAttempt.update({ where: { id: sample.attempt.id }, data: state.attempt });
            await request(
              student,
              path(sample.attempt.id) + '/appeals',
              'POST',
              { reason: '申请核对本题评分依据' },
              409,
            );
            assert.equal(await f.db.gradeAppeal.count({ where: { attemptId: sample.attempt.id } }), 0);
          }
          const noDeadline = await make();
          await f.db.exam.update({ where: { id: noDeadline.exam.id }, data: { appealDeadline: null } });
          assert.equal((await reviewApi.load(student, noDeadline.attempt.id)).canApply, true);
          await request(student, path(noDeadline.attempt.id) + '/appeals', 'POST', { reason: '     ' }, 400);
        },
      );
      await t.test(
        'simultaneous native/web retries create one first-reason receipt and one audit; retry survives deadline',
        async () => {
          const r = await Promise.all([
            reviewApi.apply(student, x.attempt.id, '原生首份复核申请理由'),
            f.call(f.clients.student, '/attempts/' + x.attempt.id + '/appeals', 'POST', {
              reason: '网站竞争复核申请理由',
            }),
          ]);
          const stored = await f.db.gradeAppeal.findUniqueOrThrow({
            where: { attemptId_userId: { attemptId: x.attempt.id, userId: f.users.student.id } },
          });
          appealId = stored.id;
          assert.ok(['原生首份复核申请理由', '网站竞争复核申请理由'].includes(stored.reason));
          assert.equal(r[0].appeal!.id, stored.id);
          assert.equal(r[1].body.id, stored.id);
          assert.equal(await f.db.gradeAppeal.count({ where: { attemptId: x.attempt.id } }), 1);
          assert.equal(
            await f.db.auditLog.count({ where: { action: 'grade.appeal', resourceId: stored.id } }),
            1,
          );
          await f.db.exam.update({
            where: { id: x.exam.id },
            data: { appealDeadline: new Date(Date.now() - 1000) },
          });
          const retry = await reviewApi.apply(student, x.attempt.id, '不同理由不会覆盖首份理由');
          assert.equal(retry.appeal!.id, stored.id);
          assert.equal(retry.appeal!.reason, stored.reason);
        },
      );
      await t.test(
        'website handles the actual native receipt and native history exposes only public grade changes',
        async () => {
          const browser = await chromium.launch({ headless: true, channel: 'chrome' });
          try {
            const ctx = await browser.newContext();
            await attachLogin(ctx, f.clients.teacher, f.origin);
            const page = await ctx.newPage();
            await page.goto(f.origin + '/appeals');
            await expect(page.getByText(x.exam.title, { exact: true })).toBeVisible();
            await page.getByRole('button', { name: '处理复核', exact: true }).click();
            await page.getByLabel('处理意见及原因').fill('已复核评分依据并修正成绩');
            await page.getByLabel('修订后总分（留空则保持原成绩）').fill('0.5');
            const dialog = page.getByRole('dialog');
            await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
            await expect(dialog).not.toBeVisible();
            await expect(
              page.getByRole('cell', { name: '已复核评分依据并修正成绩', exact: true }),
            ).toBeVisible();
          } finally {
            await browser.close();
          }
          const result = await reviewApi.load(student, x.attempt.id);
          assert.equal(result.scoreCents, 50);
          assert.equal(result.appeal!.status, 'resolved');
          assert.equal(result.revisions.total, 1);
          assert.equal(result.revisions.items[0].oldScoreCents, 0);
          assert.equal(result.revisions.items[0].newScoreCents, 50);
          assert.ok(!JSON.stringify(result).includes('resolvedBy'));
          assert.ok(!JSON.stringify(result).includes('actorId'));
          const listed = await student.request<any>('/mobile/appeals?status=resolved');
          assert.equal(listed.items[0].id, appealId);
          assert.equal(listed.items[0].scoreCents, 50);
        },
      );
      await t.test(
        'withdrawn publication hides scores, resolution and history in native and website list endpoints',
        async () => {
          await f.db.examAttempt.update({ where: { id: x.attempt.id }, data: { releaseStatus: 'pending' } });
          const r = await reviewApi.load(student, x.attempt.id);
          assert.equal(r.scoreCents, null);
          assert.equal(r.appeal!.resolution, null);
          assert.deepEqual(r.revisions.items, []);
          assert.equal(r.revisions.total, 0);
          const native = await student.request<any>('/mobile/appeals');
          assert.equal(native.items.find((a: any) => a.id === appealId).scoreCents, null);
          assert.equal(native.items.find((a: any) => a.id === appealId).resolution, null);
          const web = (await f.call(f.clients.student, '/appeals')).body.items.find(
            (a: any) => a.id === appealId,
          );
          assert.equal(web.attempt.scoreCents, null);
          assert.equal(web.resolution, null);
          await f.db.examAttempt.update({ where: { id: x.attempt.id }, data: { releaseStatus: 'released' } });
          for (let i = 0; i < 12; i++)
            await f.db.gradeRevision.create({
              data: {
                attemptId: x.attempt.id,
                actorId: f.users.teacher.id,
                oldScoreCents: 50,
                newScoreCents: 50,
                reason: 'pagination fixture',
              },
            });
          const page2 = await reviewApi.load(student, x.attempt.id, 2);
          assert.equal(page2.revisions.total, 13);
          assert.equal(page2.revisions.items.length, 3);
        },
      );
      await t.test(
        'single-connection transaction can read review and create an application without nested pool acquisition',
        async () => {
          const z = await make();
          const url = new URL(f.env.DATABASE_URL);
          url.searchParams.set('connection_limit', '1');
          const db = new PrismaService({ datasources: { db: { url: url.toString() } } });
          try {
            const session = await f.db.session.findFirstOrThrow({
              where: { userId: f.users.student.id, clientType: 'MOBILE' },
              orderBy: { createdAt: 'desc' },
            });
            const auth = new AuthService(db),
              actor = await auth.resolveMobileSessionId(session.id);
            assert.ok(actor);
            const service = assessmentServices(db, auth, { record: async () => {} }).appeals;
            await service.appeal(actor, z.attempt.id, '单连接池复核申请说明');
            const read = await service.studentReview(actor, z.attempt.id, { page: 1, pageSize: 10 });
            assert.ok(read.appeal);
          } finally {
            await db.$disconnect();
          }
        },
      );
      await t.test(
        'lost native response after real commit recovers one immutable receipt without replaying a new reason',
        async () => {
          const z = await make();
          let raw: string | null = null,
            drop = true;
          const c = new MobileClient(
            f.origin,
            {
              get: async () => raw,
              set: async (x) => {
                raw = x;
              },
              remove: async () => {
                raw = null;
              },
            },
            () => {},
            async (input, init) => {
              const r = await fetch(input, init);
              if (drop && String(input).endsWith('/appeals') && init?.method === 'POST') {
                drop = false;
                await r.body?.cancel();
                throw new TypeError('simulated response loss after committed request');
              }
              return r;
            },
          );
          await c.login(f.users.student.username, f.password);
          await assert.rejects(
            reviewApi.apply(c, z.attempt.id, '网络中断前已提交的复核理由'),
            (e: any) => e.status === 0,
          );
          const received = await reviewApi.load(c, z.attempt.id);
          assert.ok(received.appeal);
          const retry = await reviewApi.apply(c, z.attempt.id, '网络中断前已提交的复核理由');
          assert.equal(retry.appeal!.id, received.appeal.id);
          assert.equal(await f.db.gradeAppeal.count({ where: { attemptId: z.attempt.id } }), 1);
          assert.equal(
            await f.db.auditLog.count({ where: { action: 'grade.appeal', resourceId: received.appeal.id } }),
            1,
          );
        },
      );
      await t.test(
        'queued creation rechecks eligibility, enrollment and session after real row locking',
        async () => {
          for (const mode of ['eligibility', 'enrollment', 'session']) {
            const z = await make(),
              client = await mobile(f.users.student.username);
            const lock = await held(z.attempt.id);
            const pending = request(
              client,
              path(z.attempt.id) + '/appeals',
              'POST',
              { reason: '排队期间撤销权限测试' },
              mode === 'session' ? 401 : mode === 'enrollment' ? 403 : 409,
            );
            try {
              await waiting();
              if (mode === 'eligibility')
                await f.db.examAudience.update({
                  where: { examId_userId: { examId: z.exam.id, userId: f.users.student.id } },
                  data: { eligible: false },
                });
              else if (mode === 'enrollment')
                await f.db.enrollment.updateMany({
                  where: { courseId: f.course.id, userId: f.users.student.id },
                  data: { active: false },
                });
              else
                await f.db.session.deleteMany({
                  where: { userId: f.users.student.id, clientType: 'MOBILE' },
                });
            } finally {
              lock.release();
              await lock.work;
            }
            await pending;
            assert.equal(await f.db.gradeAppeal.count({ where: { attemptId: z.attempt.id } }), 0);
            await f.db.enrollment.updateMany({
              where: { courseId: f.course.id, userId: f.users.student.id },
              data: { active: true },
            });
          }
        },
      );
      await t.test(
        'teacher sensitive grade grant withdrawn while resolving cannot create a grade revision',
        async () => {
          const z = await make();
          const a = (
            await f.call(f.clients.student, '/attempts/' + z.attempt.id + '/appeals', 'POST', {
              reason: '请教师核对评分依据',
            })
          ).body;
          const lock = await held(z.attempt.id);
          const pending = f.call(
            f.clients.teacher,
            '/appeals/' + a.id + '/resolve',
            'POST',
            { resolution: '排队处理尝试修改成绩', scoreCents: 100 },
            403,
          );
          try {
            await waiting();
            await f.db.sensitiveGrant.deleteMany({
              where: { userId: f.users.teacher.id, permissionId: 'grade.revise' },
            });
          } finally {
            lock.release();
            await lock.work;
          }
          await pending;
          assert.equal((await f.db.gradeAppeal.findUniqueOrThrow({ where: { id: a.id } })).status, 'pending');
          assert.equal(await f.db.gradeRevision.count({ where: { attemptId: z.attempt.id } }), 0);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
