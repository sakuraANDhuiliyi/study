import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';

const db = new PrismaClient();
const origin = 'http://127.0.0.1:3032';
const fakeSecret = 'FAKE_LOCAL_ONLY_DO_NOT_LOG';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'AI study real HTTP with isolated DeepSeek and Tavily providers: ownership, fixed snapshots, leases and quotas',
  { timeout: 90000 },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.includes('review'),
      'Use an isolated review database',
    );
    const suffix = randomUUID().slice(0, 8),
      directory = resolve(`.data/ai-study-test-${suffix}`);
    await mkdir(directory, { recursive: true });
    let mode: 'success' | 'fail' | 'hold' = 'success';
    let release: (() => void) | undefined;
    let observed: (() => void) | undefined;
    let input: any,
      analysisRequest: any,
      searchRequest: any,
      providerCalls = 0,
      failStatus = 500;
    const provider = createServer(async (request, response) => {
      providerCalls++;
      const isSearch = request.url === '/tavily/search';
      if (request.method !== 'POST' || (!isSearch && request.url !== '/deepseek/chat/completions')) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'Unknown local fixture route' }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (isSearch) searchRequest = body;
      else {
        analysisRequest = body;
        input = JSON.parse(body.messages.find((message: any) => message.role === 'user').content);
      }
      const currentMode = mode;
      if (currentMode === 'hold') {
        const wait = new Promise<void>((resolve) => {
          release = resolve;
        });
        observed?.();
        await wait;
      }
      if (currentMode === 'fail') {
        response.writeHead(failStatus, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: fakeSecret, url: 'https://private-provider.invalid/internal' }));
        return;
      }
      const sourceUrl = 'https://openstax.org/books/calculus-volume-1/pages/1-introduction';
      const result = isSearch
        ? {
            query: body.query,
            results: [
              {
                title: '公开微积分资料',
                url: sourceUrl,
                content: '公开微积分资料可用于复习。',
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
                    summary: '根据已判错作答进行复盘。',
                    patterns: [
                      {
                        label: '概念辨析',
                        evidence: '选择了干扰选项。',
                        advice: '比较条件后再选择。',
                        mistakeIds: input.mistakes.map((m: any) => m.mistakeId),
                      },
                    ],
                    items: input.mistakes.map((m: any) => ({
                      mistakeId: m.mistakeId,
                      diagnosis: '可能混淆条件，现有证据有限。',
                      reasoning: '先核对题目条件与定义。',
                      correction: '按定义重新推导。',
                      knowledgePoints: ['函数'],
                      confidence: 'low',
                    })),
                    reviewPlan: ['先复习定义，再独立完成两道同类题。'],
                    searchQueries: ['函数概念 练习题'],
                  }),
                },
              },
            ],
          };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const port = (provider.address() as { port: number }).port;
    const configPath = resolve(directory, 'config.yaml');
    const config = (dailyRequests = 30) =>
      writeFile(
        configPath,
        JSON.stringify({
          ai: {
            apiStyle: 'deepseek',
            structuredOutput: 'json_object',
            baseUrl: `http://127.0.0.1:${port}/deepseek`,
            apiKey: fakeSecret,
            model: 'deepseek-flash',
            timeoutMs: 10000,
          },
          webSearch: {
            provider: 'tavily',
            tavily: { baseUrl: `http://127.0.0.1:${port}/tavily`, apiKey: fakeSecret },
          },
          limits: { dailyRequests, downloadTimeoutMs: 1000 },
        }),
      );
    await config();
    let logs = '';
    const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: {
        ...process.env,
        AI_CONFIG_PATH: configPath,
        PORT: '3032',
        BIND_HOST: '127.0.0.1',
        APP_ORIGIN: origin,
        DISABLE_JOBS: 'true',
        COOKIE_SECURE: 'false',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-100000);
      });
    type Client = Awaited<ReturnType<typeof login>>;
    async function login(username: string) {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      const payload = await response.json();
      let csrf = payload.csrfToken;
      const cookie = response.headers
        .getSetCookie()
        .map((v) => v.split(';')[0])
        .join('; ');
      return {
        user: payload.user,
        async call(
          path: string,
          method = 'GET',
          body?: unknown,
          status = method === 'POST' ? 201 : 200,
          withoutCsrf = false,
        ) {
          const response = await fetch(`${origin}/api${path}`, {
            method,
            headers: {
              cookie,
              origin,
              ...(!withoutCsrf ? { 'x-csrf-token': csrf } : {}),
              'content-type': 'application/json',
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const text = await response.text();
          assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 600)}`);
          const data =
            response.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text;
          if (data?.csrfToken) csrf = data.csrfToken;
          return { data, response };
        },
      };
    }
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (api.exitCode !== null) throw new Error('Isolated API stopped before ready');
        try {
          if ((await fetch(`${origin}/api/health`)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* starting */
        }
        await sleep(100);
      }
      assert.ok(ready, 'Compile the API and ensure 3032 is available');
      const seed = await db.user.findUniqueOrThrow({ where: { username: 'student' } });
      const organization = await db.organization.create({ data: { name: `AI隔离验收-${suffix}` } });
      const users = [];
      for (const [tag, roleId] of [
        ['student', 'STUDENT'],
        ['other', 'STUDENT'],
        ['teacher', 'TEACHER'],
        ['admin', 'ADMIN'],
      ])
        users.push(
          await db.user.create({
            data: {
              organizationId: organization.id,
              username: `ai-${tag}-${suffix}`,
              name: `AI验收${tag}`,
              passwordHash: seed.passwordHash,
              roles: { create: { roleId } },
            },
          }),
        );
      const [student, other, teacher, admin] = await Promise.all(users.map((u) => login(u.username)));
      const course = await db.course.create({
        data: {
          organizationId: organization.id,
          teacherId: teacher.user.id,
          title: 'AI错题固定版本验收',
          status: 'PUBLISHED',
        },
      });
      await db.teachingAssignment.create({ data: { courseId: course.id, userId: teacher.user.id } });
      await db.enrollment.createMany({
        data: [student, other].map((c) => ({ courseId: course.id, userId: c.user.id })),
      });
      const q = (
        await teacher.call('/questions', 'POST', {
          courseId: course.id,
          type: 'single',
          stem: '固定旧题干',
          options: [
            { id: 'A', text: '正解' },
            { id: 'B', text: '干扰项' },
          ],
          answer: 'A',
          explanation: '固定旧解析',
          scoreCents: 1000,
          practiceEnabled: true,
        })
      ).data;
      async function makeWrong(client: Client, value = 'B') {
        const practice = (
          await client.call('/practice', 'POST', { courseId: course.id, questionIds: [q.id], count: 1 })
        ).data;
        await client.call(`/practice/${practice.id}/answer`, 'POST', {
          questionVersionId: practice.items[0].id,
          value,
        });
        return db.mistakeRecord.findUniqueOrThrow({
          where: { userId_questionId: { userId: client.user.id, questionId: q.id } },
        });
      }
      const mistake = await makeWrong(student),
        otherMistake = await makeWrong(other);
      const create = () =>
        student.call('/ai-study/reports', 'POST', {
          mistakeIds: [mistake.id],
          reflection: '我对条件理解不清楚',
        });
      let report: any;

      await t.test(
        'status exposes capability without credentials, only student context is allowed',
        async () => {
          const status = (await student.call('/ai-study/status')).data;
          assert.equal(status.analysis.available, true);
          assert.equal(status.model, 'deepseek-flash');
          assert.equal(status.search.available, true);
          assert.equal(status.searchProvider, 'tavily');
          assert.ok(!JSON.stringify(status).includes(fakeSecret));
          await teacher.call('/ai-study/status', 'GET', undefined, 403);
          await admin.call('/ai-study/reports', 'GET', undefined, 403);
        },
      );
      await t.test(
        'only own latest wrong practice snapshot is used, never the current bank answer',
        async () => {
          const original = await db.questionVersion.findUniqueOrThrow({ where: { id: q.versions[0].id } });
          const { id: _id, createdAt: _created, ...version } = original;
          await db.questionVersion.create({
            data: {
              ...version,
              version: 2,
              stem: '后续新版题干',
              answer: 'B',
              options: version.options as Prisma.InputJsonValue,
              rules: version.rules as Prisma.InputJsonValue,
              children: version.children as Prisma.InputJsonValue,
            },
          });
          await db.question.update({ where: { id: q.id }, data: { currentVersion: 2 } });
          report = (await create()).data;
          assert.equal(report.status, 'ready');
          assert.equal(report.mistakes[0].stem, '固定旧题干');
          assert.equal(report.mistakes[0].correctAnswer, 'A');
          assert.equal(input.mistakes[0].correctAnswer, 'A');
          assert.equal(analysisRequest.model, 'deepseek-flash');
          assert.deepEqual(analysisRequest.response_format, { type: 'json_object' });
          assert.equal(analysisRequest.max_tokens, 6000);
          assert.equal(analysisRequest.max_completion_tokens, undefined);
          assert.deepEqual(analysisRequest.thinking, { type: 'disabled' });
          assert.equal(analysisRequest.stream, false);
          assert.ok(!JSON.stringify(input).includes(student.user.id));
          await student.call('/ai-study/reports', 'POST', { mistakeIds: [otherMistake.id] }, 404);
          await other.call(`/ai-study/reports/${report.id}`, 'GET', undefined, 404);
          const newWrong = await makeWrong(student, 'A');
          const latest = (await student.call('/ai-study/reports', 'POST', { mistakeIds: [newWrong.id] }))
            .data;
          assert.equal(latest.mistakes[0].stem, '后续新版题干');
          assert.equal(latest.mistakes[0].correctAnswer, 'B');
          assert.equal(report.mistakes[0].stem, '固定旧题干');
        },
      );
      await t.test('invalid/missing wrong evidence and strict input cannot reach the provider', async () => {
        const calls = providerCalls;
        await student.call('/ai-study/reports', 'POST', { mistakeIds: [], apiKey: 'browser-key' }, 400);
        await student.call('/ai-study/reports', 'POST', { mistakeIds: [mistake.id, mistake.id] }, 400);
        const orphanQ = (
          await teacher.call('/questions', 'POST', {
            courseId: course.id,
            type: 'boolean',
            stem: '未作答题',
            answer: true,
            scoreCents: 100,
            practiceEnabled: true,
          })
        ).data;
        const missing = await db.mistakeRecord.create({
          data: { userId: student.user.id, courseId: course.id, questionId: orphanQ.id },
        });
        await student.call('/ai-study/reports', 'POST', { mistakeIds: [missing.id] }, 400);
        const wrong = await db.practiceAnswer.findFirstOrThrow({
          where: { questionId: q.id, correct: false, session: { userId: student.user.id } },
          include: { session: true },
          orderBy: [{ answeredAt: 'desc' }, { id: 'desc' }],
        });
        await db.practiceSession.update({ where: { id: wrong.sessionId }, data: { snapshot: [] } });
        try {
          await student.call('/ai-study/reports', 'POST', { mistakeIds: [mistake.id] }, 400);
        } finally {
          await db.practiceSession.update({
            where: { id: wrong.sessionId },
            data: { snapshot: wrong.session.snapshot as Prisma.InputJsonValue },
          });
        }
        assert.equal(providerCalls, calls);
      });
      await t.test(
        'Chinese reflection at the character limit persists correctly; foreign organizations cannot read reports',
        async () => {
          const reflection = '中'.repeat(2000);
          const created = (
            await student.call('/ai-study/reports', 'POST', { mistakeIds: [mistake.id], reflection })
          ).data;
          assert.equal(created.status, 'ready');
          assert.equal(created.reflection, reflection);
          await student.call(
            '/ai-study/reports',
            'POST',
            { mistakeIds: [mistake.id], reflection: reflection + '中' },
            400,
          );
          const foreignOrganization = await db.organization.create({
            data: { name: `其他AI机构-${suffix}` },
          });
          const user = await db.user.create({
            data: {
              organizationId: foreignOrganization.id,
              username: `ai-foreign-${suffix}`,
              name: '其他机构学生',
              passwordHash: seed.passwordHash,
              roles: { create: { roleId: 'STUDENT' } },
            },
          });
          const foreign = await login(user.username);
          assert.equal((await foreign.call('/ai-study/reports')).data.total, 0);
          await foreign.call(`/ai-study/reports/${report.id}`, 'GET', undefined, 404);
          await foreign.call('/ai-study/reports', 'POST', { mistakeIds: [mistake.id] }, 404);
        },
      );
      await t.test(
        'single active reservation prevents concurrent calls and reports pending state',
        async () => {
          mode = 'hold';
          const called = new Promise<void>((resolve) => {
            observed = resolve;
          });
          const pending = create();
          await called;
          await student.call('/ai-study/reports', 'POST', { mistakeIds: [mistake.id] }, 409);
          const list = (await student.call('/ai-study/reports?pageSize=1')).data;
          assert.equal(list.items[0].status, 'pending');
          assert.equal(list.items[0].mistakes, undefined);
          await student.call(`/ai-study/reports/${list.items[0].id}`, 'DELETE', undefined, 409);
          release!();
          mode = 'success';
          assert.equal((await pending).data.status, 'ready');
        },
      );
      await t.test('provider errors are safe and failed requests consume operations', async () => {
        mode = 'fail';
        const failed = (await create()).data;
        assert.equal(failed.status, 'failed');
        assert.ok(failed.error);
        assert.ok(!JSON.stringify(failed).includes(fakeSecret));
        const operation = await db.aiStudyOperation.findFirstOrThrow({ where: { reportId: failed.id } });
        assert.equal(operation.status, 'failed');
        assert.equal(operation.errorCode, 'PROVIDER_RESPONSE');
        mode = 'success';
      });
      await t.test(
        'search stores verified source records; exports are private and downloader rejects private networks',
        async () => {
          report = (
            await student.call(`/ai-study/reports/${report.id}/search`, 'POST', { query: '函数 同类练习题' })
          ).data;
          assert.equal(report.search.sources.length, 1);
          assert.equal(report.search.citations.length, 1);
          assert.equal(report.search.provider, 'tavily');
          assert.equal(searchRequest.query, '函数 同类练习题');
          assert.equal(searchRequest.search_depth, 'basic');
          assert.equal(searchRequest.include_answer, false);
          assert.equal(searchRequest.include_raw_content, false);
          const exported = await student.call(`/ai-study/reports/${report.id}/export?format=json`);
          assert.equal(exported.data.id, report.id);
          assert.ok(exported.response.headers.get('content-disposition')?.includes('attachment'));
          assert.ok(
            (await student.call(`/ai-study/reports/${report.id}/export?format=md`)).data.includes(
              '# AI 错题复盘',
            ),
          );
          await other.call(`/ai-study/reports/${report.id}/export`, 'GET', undefined, 404);
          await student.call(`/ai-study/reports/${report.id}/sources/missing/download`, 'POST', {}, 404);
          const result = structuredClone(report.search);
          result.sources[0].url = `http://127.0.0.1:${port}/private`;
          await db.aiStudyReport.update({ where: { id: report.id }, data: { search: result } });
          const calls = providerCalls;
          await student.call(
            `/ai-study/reports/${report.id}/sources/${result.sources[0].id}/download`,
            'POST',
            {},
            503,
          );
          assert.equal(providerCalls, calls);
        },
      );
      await t.test(
        'source downloads require POST and CSRF; GET and HEAD never consume an operation',
        async () => {
          const path = `/ai-study/reports/${report.id}/sources/${report.search.sources[0].id}/download`;
          const operations = await db.aiStudyOperation.count({ where: { userId: student.user.id } });
          const calls = providerCalls;
          await student.call(path, 'POST', {}, 403, true);
          assert.equal(await db.aiStudyOperation.count({ where: { userId: student.user.id } }), operations);
          await student.call(path, 'GET', undefined, 404);
          await student.call(path, 'HEAD', undefined, 404);
          assert.equal(await db.aiStudyOperation.count({ where: { userId: student.user.id } }), operations);
          assert.equal(providerCalls, calls);
        },
      );
      await t.test(
        'course revocation, stopped questions and unreleased exams hide list/read/export data',
        async () => {
          await db.enrollment.update({
            where: { courseId_userId: { courseId: course.id, userId: student.user.id } },
            data: { active: false },
          });
          assert.equal((await student.call('/ai-study/reports')).data.total, 0);
          await student.call(`/ai-study/reports/${report.id}`, 'GET', undefined, 403);
          await student.call(`/ai-study/reports/${report.id}/export`, 'GET', undefined, 403);
          await db.enrollment.update({
            where: { courseId_userId: { courseId: course.id, userId: student.user.id } },
            data: { active: true },
          });
          await db.question.update({ where: { id: q.id }, data: { practiceEnabled: false } });
          assert.equal((await student.call('/ai-study/reports')).data.total, 0);
          await student.call(`/ai-study/reports/${report.id}`, 'GET', undefined, 403);
          await db.question.update({ where: { id: q.id }, data: { practiceEnabled: true } });
          // A deliberately inconsistent fixture proves defense in depth despite normal exam publication blocking practice questions.
          const exam = await db.exam.create({
            data: {
              organizationId: organization.id,
              courseId: course.id,
              creatorId: teacher.user.id,
              title: '未公开保密边界',
              status: 'published',
              startsAt: new Date(),
              endsAt: new Date(Date.now() + 3600000),
              entryClosesAt: new Date(Date.now() + 3600000),
              durationMinutes: 30,
              totalCents: 1000,
              passCents: 500,
              snapshot: {
                create: {
                  items: {
                    create: {
                      questionId: q.id,
                      questionVersionId: q.versions[0].id,
                      position: 0,
                      content: {},
                    },
                  },
                },
              },
            },
          });
          assert.equal((await student.call('/ai-study/reports')).data.total, 0);
          await student.call(`/ai-study/reports/${report.id}/export`, 'GET', undefined, 403);
          await db.exam.update({
            where: { id: exam.id },
            data: { answerReleaseAt: new Date(Date.now() - 1000) },
          });
        },
      );
      await t.test(
        'permissions are rechecked after provider completion: enrollment, role switch and feature revoke',
        async () => {
          for (const change of ['enrollment', 'role', 'feature']) {
            mode = 'hold';
            const called = new Promise<void>((resolve) => {
              observed = resolve;
            });
            const pending = student.call('/ai-study/reports', 'POST', { mistakeIds: [mistake.id] }, 403);
            await called;
            if (change === 'enrollment')
              await db.enrollment.update({
                where: { courseId_userId: { courseId: course.id, userId: student.user.id } },
                data: { active: false },
              });
            if (change === 'role') {
              await db.userRole.create({ data: { userId: student.user.id, roleId: 'TEACHER' } });
              await student.call('/auth/role', 'POST', { role: 'TEACHER' });
            }
            if (change === 'feature')
              await db.systemSetting.create({
                data: { organizationId: organization.id, key: 'features', value: { practice: false } },
              });
            release!();
            mode = 'success';
            await pending;
            if (change === 'enrollment')
              await db.enrollment.update({
                where: { courseId_userId: { courseId: course.id, userId: student.user.id } },
                data: { active: true },
              });
            if (change === 'role') await student.call('/auth/role', 'POST', { role: 'STUDENT' });
            if (change === 'feature') {
              await student.call('/ai-study/status', 'GET', undefined, 403);
              await db.systemSetting.delete({
                where: { organizationId_key: { organizationId: organization.id, key: 'features' } },
              });
            }
          }
        },
      );
      await t.test(
        'expired pending lease recovers, and a late response cannot overwrite the terminal failure',
        async () => {
          mode = 'hold';
          const called = new Promise<void>((resolve) => {
            observed = resolve;
          });
          const pending = student.call('/ai-study/reports', 'POST', { mistakeIds: [mistake.id] }, 409);
          await called;
          const operation = await db.aiStudyOperation.findFirstOrThrow({
            where: { userId: student.user.id, status: 'pending' },
          });
          await db.aiStudyOperation.update({
            where: { id: operation.id },
            data: { leaseExpiresAt: new Date(Date.now() - 1) },
          });
          const expired = (await student.call(`/ai-study/reports/${operation.reportId}`)).data;
          assert.equal(expired.status, 'failed');
          const oldRelease = release!;
          mode = 'success';
          assert.equal((await create()).data.status, 'ready');
          oldRelease();
          await pending;
          assert.equal(
            (await db.aiStudyReport.findUniqueOrThrow({ where: { id: operation.reportId! } })).status,
            'failed',
          );
        },
      );
      await t.test(
        'daily quota counts analysis, searches and failures; deleting reports preserves operation accounting',
        async () => {
          await config(2);
          const first = (await other.call('/ai-study/reports', 'POST', { mistakeIds: [otherMistake.id] }))
            .data;
          mode = 'fail';
          failStatus = 429;
          const searched = (
            await other.call(`/ai-study/reports/${first.id}/search`, 'POST', { query: '函数练习' })
          ).data;
          assert.ok(searched.searchError);
          assert.ok(searched.searchError.includes('额度'));
          mode = 'success';
          failStatus = 500;
          await other.call(`/ai-study/reports/${first.id}`, 'DELETE');
          await other.call('/ai-study/reports', 'POST', { mistakeIds: [otherMistake.id] }, 429);
          const operations = await db.aiStudyOperation.findMany({ where: { userId: other.user.id } });
          assert.equal(operations.length, 2);
          assert.ok(operations.every((o) => o.reportId === null));
          await config();
        },
      );
      assert.ok(!logs.includes(fakeSecret), 'Server logs must not contain provider credentials');
      await writeFile(resolve('.data/ai-study-api.log'), logs);
    } finally {
      release?.();
      api.kill('SIGTERM');
      await Promise.race([once(api, 'exit'), sleep(3000)]);
      if (api.exitCode === null) api.kill('SIGKILL');
      provider.closeAllConnections();
      provider.close();
      await db.$disconnect();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
