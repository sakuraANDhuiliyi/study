import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createLiveFixture, liveWait } from './live.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import {
  type AuthoringDraft,
  editAuthoringQuestion,
  commitAuthoringQuestions,
} from '../apps/mobile/src/ai-authoring-model';
import type { LearningAnalyticsData, AnalyticsFilters } from '../apps/mobile/src/learning-analytics-model';

test(
  'native teacher authoring, shared learning statistics, sensitive exports and course announcements',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    let providerCalls = 0;
    const provider = createServer(async (request, response) => {
      providerCalls++;
      const chunks: Buffer[] = [];
      for await (const part of request) chunks.push(Buffer.from(part));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const input = JSON.parse(body.messages.find((m: { role: string }) => m.role === 'user').content);
      assert.ok(
        !('courseId' in input),
        'provider receives teaching material, not private course identifiers',
      );
      const content = {
        title: input.title,
        questions: input.blueprint.flatMap((item: { count: number }) =>
          Array.from({ length: item.count }, (_, i) => ({
            type: 'single',
            stem: `${i + 2} + 2 的结果是？`,
            options: [
              { id: 'A', text: String(i + 4) },
              { id: 'B', text: String(i + 5) },
            ],
            answer: ['A'],
            explanation: '按整数加法逐项计算。',
            knowledgePoints: ['整数加法'],
          })),
        ),
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } },
          ],
        }),
      );
    });
    const login = async (username: string) => {
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
      await c.login(username, f.password);
      return c;
    };
    let teacher = await login(f.users.teacher.username);
    const student = await login(f.users.student.username),
      otherStudent = await login(f.users.student2.username),
      otherTeacher = await login(f.users.otherTeacher.username),
      admin = await login(f.users.admin.username),
      outsider = await login(f.users.outsider.username);
    const denied = (promise: Promise<unknown>, status: number) =>
      assert.rejects(promise, (e) => (e as { status: number }).status === status);
    const authoring = '/mobile/ai-authoring',
      input = {
        mode: 'paper',
        courseId: f.course.id,
        title: '原生数学备课',
        knowledgePoints: ['整数加法'],
        requirements: '考查整数加法',
        material: '两组物体的数量合并。',
        blueprint: [{ type: 'single', count: 1, scoreCents: 200, difficulty: 2 }],
      };
    let draft: AuthoringDraft;
    try {
      provider.listen(0, '127.0.0.1');
      await once(provider, 'listening');
      const port = (provider.address() as { port: number }).port;
      const question = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: 'single',
          stem: '学习统计练习题',
          options: [
            { id: 'A', text: '正确选项' },
            { id: 'B', text: '错误选项' },
          ],
          answer: 'A',
          explanation: '课堂分析',
          scoreCents: 1000,
          practiceEnabled: true,
          knowledgePoints: ['原生统计'],
        })
      ).body;
      for (const [client, answer] of [
        [f.clients.student, 'A'],
        [f.clients.student2, 'B'],
      ] as const) {
        const practice = (
          await f.call(client, '/practice', 'POST', {
            courseId: f.course.id,
            questionIds: [question.id],
            count: 1,
          })
        ).body;
        await f.call(client, '/practice/' + practice.id + '/answer', 'POST', {
          questionVersionId: practice.items[0].id,
          value: answer,
        });
      }
      const chapter = await f.db.chapter.create({
          data: { courseId: f.course.id, title: '统计验收章节', sortOrder: 0 },
        }),
        lesson = await f.db.lesson.create({
          data: { courseId: f.course.id, chapterId: chapter.id, title: '统计验收课时', type: 'TEXT' },
        });
      await f.db.learningProgress.create({
        data: { courseId: f.course.id, lessonId: lesson.id, userId: f.users.student.id, completed: true },
      });
      await t.test(
        'student, teacher and default administrator statistics retain their different authorized scope',
        async () => {
          const own = await student.request<LearningAnalyticsData>('/mobile/analytics'),
            teaching = await teacher.request<LearningAnalyticsData>('/mobile/analytics'),
            operations = await admin.request<LearningAnalyticsData>('/mobile/analytics');
          assert.equal(own.metrics.find((m) => m.label === '练习正确率')!.value, '100%');
          assert.equal(own.metrics.find((m) => m.label === '平均成绩')!.value, '数据不足');
          assert.equal(own.students.length, 0);
          assert.equal(own.courseProgress[0].completed, 1);
          assert.equal(own.courseProgress[0].total, 1);
          assert.equal(teaching.metrics.find((m) => m.label === '练习正确率')!.value, '50%');
          assert.equal(teaching.students.length, 3);
          assert.equal(teaching.courseProgress[0].total, 3);
          assert.equal(operations.students.length, 0);
          assert.equal(operations.hasExportData, false);
          assert.equal(
            (await otherStudent.request<LearningAnalyticsData>('/mobile/analytics')).metrics.find(
              (m) => m.label === '练习正确率',
            )!.value,
            '0%',
          );
          assert.equal(
            (await outsider.request<AnalyticsFilters>('/mobile/analytics/filters')).courses.length,
            0,
          );
          await denied(outsider.request('/mobile/analytics?courseId=' + f.course.id), 404);
          await denied(student.request('/mobile/analytics?userId=' + f.users.student2.id), 400);
          await denied(student.request('/mobile/analytics?courseId=a&courseId=b'), 400);
          await f.call(f.clients.student, '/mobile/analytics', 'GET', undefined, 403);
        },
      );
      await t.test(
        'actual CSV bytes follow student privacy and independent sensitive export grants',
        async () => {
          const own = await student.download('/mobile/analytics/export?format=report');
          assert.deepEqual([...own.bytes.slice(0, 3)], [239, 187, 191]);
          const text = new TextDecoder().decode(own.bytes);
          assert.ok(text.includes('原生统计'));
          assert.ok(!text.includes(f.users.student2.id));
          assert.ok(!text.includes(f.users.student2.name));
          await denied(teacher.download('/mobile/analytics/export?format=report'), 403);
          await denied(admin.download('/mobile/analytics/export?format=report'), 403);
          assert.equal(
            (await teacher.request<AnalyticsFilters>('/mobile/analytics/filters')).canExport,
            false,
          );
          for (const [userId, permissions] of [
            [f.users.teacher.id, ['data.export']],
            [f.users.admin.id, ['data.export', 'analysis.sensitive']],
          ] as const)
            for (const permissionId of permissions)
              await f.db.sensitiveGrant.create({
                data: {
                  userId,
                  organizationId: f.organization.id,
                  permissionId,
                  grantedBy: f.users.admin.id,
                  reason: '隔离验收限时授权',
                  expiresAt: new Date(Date.now() + 60000),
                },
              });
          assert.equal(
            (await teacher.request<AnalyticsFilters>('/mobile/analytics/filters')).canExport,
            true,
          );
          const taught = await teacher.download('/mobile/analytics/export?format=report');
          assert.match(new TextDecoder().decode(taught.bytes), /"练习正确率","50%"/);
          assert.match(new TextDecoder().decode(taught.bytes), /"知识点掌握度","原生统计","50%"/);
          assert.equal((await admin.request<LearningAnalyticsData>('/mobile/analytics')).students.length, 3);
          const all = await admin.download('/mobile/analytics/export?format=report');
          assert.ok(all.bytes.length > 0);
          await f.db.sensitiveGrant.deleteMany({ where: { userId: f.users.admin.id } });
          await denied(admin.download('/mobile/analytics/export?format=report'), 403);
        },
      );
      await t.test(
        'teacher announcements sanitize content and enqueue notifications only for current course members',
        async () => {
          await denied(
            student.request(
              '/mobile/teaching-announcements',
              { courseId: f.course.id, title: '冒充公告', content: '不可发布' },
              'POST',
            ),
            403,
          );
          await denied(
            otherTeacher.request(
              '/mobile/teaching-announcements',
              { courseId: f.course.id, title: '未授权公告', content: '不可发布' },
              'POST',
            ),
            403,
          );
          await denied(
            teacher.request(
              '/mobile/teaching-announcements',
              { title: '机构公告', content: '不可越权' },
              'POST',
            ),
            400,
          );
          const posted = await teacher.request<{ id: string; content: string }>(
            '/mobile/teaching-announcements',
            {
              courseId: f.course.id,
              title: '原生课堂提醒',
              content: '<p>明天复习整数加法。</p><script>bad()</script>',
            },
            'POST',
          );
          assert.ok(!posted.content.includes('<script'));
          const list = await teacher.request<{ items: { id: string; content: string }[] }>(
            '/mobile/teaching-announcements?courseId=' + f.course.id,
          );
          assert.equal(list.items[0].id, posted.id);
          assert.ok(list.items[0].content.includes('整数加法'));
          assert.equal(
            (await student.request<{ title: string }>('/mobile/announcements/' + posted.id)).title,
            '原生课堂提醒',
          );
          const job = await f.db.backgroundJob.findUniqueOrThrow({
            where: { eventKey: 'notify:announcement:' + posted.id },
          });
          const payload = job.payload as { userIds: string[] };
          assert.deepEqual(
            [...payload.userIds].sort(),
            [f.users.student.id, f.users.student2.id, f.users.student3.id].sort(),
          );
        },
      );
      await t.test(
        'teacher AI provider stays disabled until only this fixture points to a local provider',
        async () => {
          await denied(teacher.request(authoring + '/drafts', input, 'POST'), 503);
          assert.equal(providerCalls, 0);
          await denied(student.request(authoring + '/status'), 403);
          await denied(admin.request(authoring + '/status'), 403);
          await f.call(f.clients.teacher, authoring + '/status', 'GET', undefined, 403);
          await writeFile(
            f.env.AI_CONFIG_PATH,
            `judge0: {enabled: false}\nai: {enabled: true, baseUrl: 'http://127.0.0.1:${port}', apiKey: LOCAL_FAKE_ONLY, model: deepseek-flash, timeoutMs: 5000}\nwebSearch: {enabled: false}\n`,
            { mode: 0o600 },
          );
          draft = await teacher.request<AuthoringDraft>(authoring + '/drafts', input, 'POST');
          assert.equal(draft.status, 'ready');
          assert.equal(draft.questions.length, 1);
          assert.equal(draft.questions[0].answer[0], 'A');
          await denied(otherTeacher.request(authoring + '/drafts/' + draft.id), 404);
        },
      );
      await t.test(
        'explicit reviewed commits create private unopened questions and a draft paper, with CAS and retry safety',
        async () => {
          const questions = draft.questions.map(editAuthoringQuestion);
          questions[0].explanation = '由教师核对：合并两组2个物体共有4个。';
          questions[0].scoreText = '2.5';
          const reviewed = commitAuthoringQuestions(questions),
            body = { revision: draft.revision, title: '教师审阅后的草稿卷', questions: reviewed };
          await denied(
            teacher.request(
              authoring + '/drafts/' + draft.id + '/commit',
              { ...body, revision: draft.revision + 1 },
              'POST',
            ),
            409,
          );
          const saved = await teacher.request<AuthoringDraft>(
            authoring + '/drafts/' + draft.id + '/commit',
            body,
            'POST',
          );
          assert.equal(saved.status, 'saved');
          assert.equal(saved.savedQuestionIds.length, 1);
          assert.ok(saved.savedPaperId);
          const q = await f.db.question.findUniqueOrThrow({
            where: { id: saved.savedQuestionIds[0] },
            include: { versions: true },
          });
          assert.equal(q.scope, 'private');
          assert.equal(q.practiceEnabled, false);
          assert.equal(q.versions[0].scoreCents, 250);
          assert.equal(q.versions[0].explanation, reviewed[0].explanation);
          const paper = await f.db.paper.findUniqueOrThrow({ where: { id: saved.savedPaperId! } });
          assert.equal(paper.totalCents, 250);
          assert.equal(paper.creatorId, f.users.teacher.id);
          const repeated = await teacher.request<AuthoringDraft>(
            authoring + '/drafts/' + draft.id + '/commit',
            body,
            'POST',
          );
          assert.deepEqual(repeated.savedQuestionIds, saved.savedQuestionIds);
          assert.equal(await f.db.exam.count(), 0);
          assert.equal(await f.db.assignment.count(), 0);
        },
      );
      await t.test(
        'withdrawn teaching relation revokes statistics, draft access and course publication',
        async () => {
          await f.db.teachingAssignment.updateMany({
            where: { userId: f.users.teacher.id, courseId: f.course.id },
            data: { active: false },
          });
          try {
            assert.equal(
              (await teacher.request<AnalyticsFilters>('/mobile/analytics/filters')).courses.length,
              0,
            );
            await denied(teacher.request(authoring + '/drafts/' + draft.id), 403);
            await denied(
              teacher.request(
                '/mobile/teaching-announcements',
                { courseId: f.course.id, title: '已撤销授权', content: '不能发布' },
                'POST',
              ),
              403,
            );
          } finally {
            await f.db.teachingAssignment.updateMany({
              where: { userId: f.users.teacher.id, courseId: f.course.id },
              data: { active: true },
            });
          }
        },
      );
      await t.test(
        'queued teacher generation revalidates a removed mobile credential before calling any provider',
        async () => {
          teacher = await login(f.users.teacher.username);
          const session = await f.db.session.findFirstOrThrow({
            where: { userId: f.users.teacher.id, clientType: 'MOBILE' },
            orderBy: { createdAt: 'desc' },
          });
          let release!: () => void, ready!: () => void;
          const gate = new Promise<void>((r) => {
              release = r;
            }),
            acquired = new Promise<void>((r) => {
              ready = r;
            });
          const hold = f.db.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`ai-study:${f.organization.id}:${f.users.teacher.id}`}))`;
              ready();
              await gate;
              await tx.mobileCredential.delete({ where: { sessionId: session.id } });
            },
            { timeout: 15000 },
          );
          await acquired;
          const before = providerCalls;
          const pending = teacher.request(authoring + '/drafts', input, 'POST');
          await liveWait(120);
          release();
          await hold;
          await assert.rejects(pending);
          assert.equal(providerCalls, before);
        },
      );
    } finally {
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await f.cleanup();
    }
  },
);
