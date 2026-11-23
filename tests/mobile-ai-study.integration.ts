import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { createLiveFixture, liveWait } from './live.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import { aiStudyRoot as root, type AiReport, type AiStudyStatus } from '../apps/mobile/src/ai-study-model';

test(
  'native AI study uses owned fixed mistakes, local providers, safe downloads and fresh session checks',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    let calls = 0,
      fail = false;
    const provider = createServer(async (request, response) => {
      calls++;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (fail) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'PRIVATE_LOCAL_PROVIDER_FAILURE' }));
        return;
      }
      const search = request.url === '/tavily/search';
      const input = search
        ? null
        : JSON.parse(body.messages.find((m: { role: string }) => m.role === 'user').content);
      const result = search
        ? {
            query: body.query,
            results: [
              {
                title: '课堂定义资料',
                url: 'https://example.org/lesson',
                content: '核对原文中的定义与适用条件。',
                score: 0.9,
              },
            ],
          }
        : {
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    summary: '根据本人固定错题版本进行复盘。',
                    patterns: [
                      {
                        label: '条件辨析',
                        evidence: '选择了干扰选项。',
                        advice: '逐项核对条件。',
                        mistakeIds: input.mistakes.map((m: { mistakeId: string }) => m.mistakeId),
                      },
                    ],
                    items: input.mistakes.map((m: { mistakeId: string }) => ({
                      mistakeId: m.mistakeId,
                      diagnosis: '对条件理解不够完整。',
                      reasoning: '先明确题目给出的条件。',
                      correction: '根据定义重新推导。',
                      knowledgePoints: ['概念辨析'],
                      confidence: 'low',
                    })),
                    reviewPlan: ['复习定义并独立重做。'],
                    searchQueries: ['定义与适用条件'],
                  }),
                },
              },
            ],
          };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
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
    const denied = (promise: Promise<unknown>, status: number) =>
      assert.rejects(promise, (e) => (e as { status: number }).status === status);
    let student = await login(f.users.student.username);
    const teacher = await login(f.users.teacher.username),
      other = await login(f.users.student2.username),
      foreign = await login(f.users.outsider.username);
    let report: AiReport;
    try {
      provider.listen(0, '127.0.0.1');
      await once(provider, 'listening');
      const port = (provider.address() as { port: number }).port;
      const question = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: 'single',
          stem: '原生AI固定题干',
          options: [
            { id: 'A', text: '符合条件' },
            { id: 'B', text: '遗漏条件' },
          ],
          answer: 'A',
          explanation: '必须核对全部条件。',
          scoreCents: 1000,
          practiceEnabled: true,
        })
      ).body;
      const practice = (
        await f.call(f.clients.student, '/practice', 'POST', {
          courseId: f.course.id,
          questionIds: [question.id],
          count: 1,
        })
      ).body;
      await f.call(f.clients.student, '/practice/' + practice.id + '/answer', 'POST', {
        questionVersionId: practice.items[0].id,
        value: 'B',
      });
      const mistake = await f.db.mistakeRecord.findUniqueOrThrow({
        where: { userId_questionId: { userId: f.users.student.id, questionId: question.id } },
      });
      const create = () =>
        student.request<AiReport>(
          root + '/reports',
          { mistakeIds: [mistake.id], reflection: 'PRIVATE_NATIVE_REFLECTION' },
          'POST',
        );
      await t.test(
        'disabled providers stay disabled and exact native student ownership is enforced',
        async () => {
          const status = await student.request<AiStudyStatus>(root + '/status');
          assert.equal(status.analysis.available, false);
          assert.equal(status.search.available, false);
          await denied(create(), 503);
          assert.equal(calls, 0);
          await denied(teacher.request(root + '/status'), 403);
          await f.call(f.clients.student, root + '/status', 'GET', undefined, 403);
          await denied(student.request('/ai-study/status'), 403);
          for (const query of ['?page=0', '?page=1&page=2', '?pageSize=21', '?userId=other'])
            await denied(student.request(root + '/reports' + query), 400);
        },
      );
      await writeFile(
        f.env.AI_CONFIG_PATH,
        `judge0: {enabled: false}\nai: {enabled: true, baseUrl: 'http://127.0.0.1:${port}/deepseek', apiKey: LOCAL_FAKE_ONLY, model: deepseek-flash, timeoutMs: 5000}\nwebSearch: {enabled: true, provider: tavily, tavily: {baseUrl: 'http://127.0.0.1:${port}/tavily', apiKey: LOCAL_FAKE_ONLY}}\nlimits: {dailyRequests: 30}\n`,
        { mode: 0o600 },
      );
      await t.test(
        'local provider produces a report from real owned practice and never grants another student access',
        async () => {
          await denied(other.request(root + '/reports', { mistakeIds: [mistake.id] }, 'POST'), 404);
          report = await create();
          assert.equal(report.status, 'ready');
          assert.equal(report.mistakes[0].stem, '原生AI固定题干');
          assert.equal(report.mistakes[0].studentAnswer, 'B');
          assert.equal(report.mistakes[0].correctAnswer, 'A');
          assert.equal(report.analysis?.items.length, 1);
          assert.equal(calls, 1);
          for (const c of [other, foreign]) {
            await denied(c.request(root + '/reports/' + report.id), 404);
            await denied(c.download(root + '/reports/' + report.id + '/export?format=md'), 404);
            assert.equal((await c.request<{ total: number }>(root + '/reports')).total, 0);
          }
          assert.equal(
            (await student.request<{ items: { id: string }[] }>(root + '/reports')).items[0].id,
            report.id,
          );
        },
      );
      await t.test(
        'search source mapping and MD/JSON exports contain actual report bytes and metadata',
        async () => {
          report = await student.request<AiReport>(
            root + '/reports/' + report.id + '/search',
            { query: '定义与适用条件' },
            'POST',
          );
          assert.equal(report.search?.sources.length, 1);
          assert.equal(report.search?.sources[0].url, 'https://example.org/lesson');
          const md = await student.download(root + '/reports/' + report.id + '/export?format=md');
          assert.equal(md.contentType, 'text/markdown');
          assert.ok(md.filename.endsWith('.md'));
          assert.ok(new TextDecoder().decode(md.bytes).includes(String.raw`PRIVATE\_NATIVE\_REFLECTION`));
          const json = await student.download(root + '/reports/' + report.id + '/export?format=json');
          assert.equal(json.contentType, 'application/json');
          const output = JSON.parse(new TextDecoder().decode(json.bytes));
          assert.equal(output.reflection, 'PRIVATE_NATIVE_REFLECTION');
          assert.equal(output.mistakes[0].studentAnswer, 'B');
          await denied(
            student.download(root + '/reports/' + report.id + '/sources/not-this-report/download', {
              method: 'POST',
              body: {},
            }),
            404,
          );
          const malicious = {
            ...report.search!,
            sources: [{ ...report.search!.sources[0], url: `http://127.0.0.1:${port}/private` }],
          };
          await f.db.aiStudyReport.update({
            where: { id: report.id },
            data: { search: malicious as unknown as Prisma.InputJsonValue },
          });
          const before = calls;
          await denied(
            student.download(
              root + '/reports/' + report.id + '/sources/' + malicious.sources[0].id + '/download',
              { method: 'POST', body: {} },
            ),
            503,
          );
          assert.equal(calls, before, 'unsafe loopback source must be rejected before network access');
          await f.db.aiStudyReport.update({
            where: { id: report.id },
            data: { search: report.search! as unknown as Prisma.InputJsonValue },
          });
        },
      );
      await t.test(
        'withdrawn enrollment immediately hides reports, exports and source downloads',
        async () => {
          await f.db.enrollment.updateMany({
            where: { userId: f.users.student.id, courseId: f.course.id },
            data: { active: false },
          });
          try {
            await denied(student.request(root + '/reports/' + report.id), 403);
            await denied(student.download(root + '/reports/' + report.id + '/export?format=md'), 403);
            assert.equal((await student.request<{ total: number }>(root + '/reports')).total, 0);
          } finally {
            await f.db.enrollment.updateMany({
              where: { userId: f.users.student.id, courseId: f.course.id },
              data: { active: true },
            });
          }
        },
      );
      await t.test('provider failures are persisted as failures without exposing raw secrets', async () => {
        fail = true;
        const failed = await create();
        fail = false;
        assert.equal(failed.status, 'failed');
        assert.equal(failed.analysis, null);
        assert.ok(!JSON.stringify(failed).includes('PRIVATE_LOCAL_PROVIDER_FAILURE'));
        await student.request(root + '/reports/' + failed.id, undefined, 'DELETE');
        await denied(student.request(root + '/reports/' + failed.id), 404);
      });
      await t.test(
        'a removed mobile credential during the shared AI lock prevents any provider call or report creation',
        async () => {
          student = await login(f.users.student.username);
          const session = await f.db.session.findFirstOrThrow({
            where: { userId: f.users.student.id, clientType: 'MOBILE' },
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
              await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`ai-study:${f.organization.id}:${f.users.student.id}`}))`;
              ready();
              await gate;
              await tx.mobileCredential.delete({ where: { sessionId: session.id } });
            },
            { timeout: 15000 },
          );
          await acquired;
          const count = await f.db.aiStudyReport.count(),
            before = calls;
          const pending = create();
          await liveWait(120);
          release();
          await hold;
          await assert.rejects(pending);
          assert.equal(calls, before);
          assert.equal(await f.db.aiStudyReport.count(), count);
        },
      );
    } finally {
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await f.cleanup();
    }
  },
);
