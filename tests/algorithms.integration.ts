import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { algorithmProblems, getAlgorithmProblem } from '../apps/api/src/algorithms/algorithms.catalog';

const db = new PrismaClient();
const origin = 'http://127.0.0.1:3034';
const secret = 'ALGORITHM_LOCAL_FIXTURE_ONLY';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const code = 'a, b = map(int, input().split())\nprint(a + b)';
const source = { language: 'python', code };
const submission = { ...source, mode: 'submit' };
const base = '/algorithms/problems/sum-of-two';
const encode = (value: string) => Buffer.from(value).toString('base64');

test(
  'student algorithms: real PostgreSQL, isolated Judge0 and DeepSeek HTTP, ownership and durable operations',
  { timeout: 90000 },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.includes('review'),
      'Use an isolated review database',
    );
    const suffix = randomUUID().slice(0, 8);
    const directory = resolve(`.data/algorithms-test-${suffix}`);
    await mkdir(directory, { recursive: true });
    let judgeMode: 'success' | 'hold' | 'fail' = 'success';
    let aiMode: 'success' | 'hold' | 'fail' | 'invalid' = 'success';
    let judgeCalls = 0,
      aiCalls = 0;
    let aiRequest: any;
    let judgeHold: Promise<void> | undefined, aiHold: Promise<void> | undefined;
    let releaseJudge: (() => void) | undefined, releaseAi: (() => void) | undefined;
    let seenJudge: (() => void) | undefined, seenAi: (() => void) | undefined;
    const jobs = new Map<string, { code: string; input: string }>();
    const provider = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost');
      response.setHeader('content-type', 'application/json');
      if (request.method === 'POST' && url.pathname === '/judge/submissions') {
        judgeCalls++;
        const chunks = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(body.enable_network, false);
        assert.equal(body.expected_output, undefined);
        assert.equal(request.headers['x-auth-token'], secret);
        const token = randomUUID();
        jobs.set(token, {
          code: Buffer.from(body.source_code, 'base64').toString(),
          input: Buffer.from(body.stdin, 'base64').toString(),
        });
        response.end(JSON.stringify({ token }));
        return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/judge/submissions/')) {
        const job = jobs.get(url.pathname.split('/').pop()!);
        if (!job) {
          response.writeHead(404).end();
          return;
        }
        const current = judgeMode;
        if (current === 'hold') {
          seenJudge?.();
          await judgeHold;
        }
        if (current === 'fail') {
          response.writeHead(500).end(JSON.stringify({ secret }));
          return;
        }
        const value = job.input
          .trim()
          .split(/\s+/)
          .map(Number)
          .reduce((a, b) => a + b, 0);
        const compile = job.code.includes('COMPILE_ERROR');
        const runtime = job.code.includes('RUNTIME_ERROR');
        const output = job.code.includes('WRONG_ANSWER') ? '-999999999\n' : `${value}\n`;
        response.end(
          JSON.stringify({
            status: { id: compile ? 6 : runtime ? 7 : 3 },
            stdout: encode(output),
            // A hostile provider echoes input in diagnostics; hidden results must still stay private.
            stderr: encode(`diagnostic:${job.input}`),
            compile_output: encode(compile ? `SyntaxError:${job.input}` : ''),
            time: '0.012',
            memory: 8192,
            exit_code: runtime ? 1 : 0,
            exit_signal: 0,
          }),
        );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/deepseek/chat/completions') {
        aiCalls++;
        const chunks = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        aiRequest = JSON.parse(body.messages.find((m: any) => m.role === 'user').content);
        assert.equal(body.model, 'deepseek-flash');
        const current = aiMode;
        if (current === 'hold') {
          seenAi?.();
          await aiHold;
        }
        if (current === 'fail') {
          response.writeHead(429).end(JSON.stringify({ secret }));
          return;
        }
        response.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content:
                    current === 'invalid'
                      ? '{bad json'
                      : JSON.stringify({
                          summary: '两个整数相加，注意读取输入与输出格式。',
                          approach: ['解析输入中的两个整数', '计算并输出整数和'],
                          complexity: '时间 O(1)，额外空间 O(1)。',
                          pitfalls: ['检查负数和零'],
                          suggestedCode: code,
                        }),
                },
              },
            ],
          }),
        );
        return;
      }
      response.writeHead(404).end();
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const providerPort = (provider.address() as { port: number }).port;
    const configPath = resolve(directory, 'config.yaml');
    const config = (dailyRequests = 100, apiKey = secret) =>
      writeFile(
        configPath,
        JSON.stringify({
          ai: {
            apiStyle: 'deepseek',
            structuredOutput: 'json_object',
            baseUrl: `http://127.0.0.1:${providerPort}/deepseek`,
            apiKey,
            model: 'deepseek-flash',
            timeoutMs: 10000,
          },
          webSearch: { enabled: false },
          limits: { dailyRequests },
        }),
      );
    await config();
    let logs = '';
    const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: {
        ...process.env,
        AI_CONFIG_PATH: configPath,
        ALGORITHM_JUDGE_URL: `http://127.0.0.1:${providerPort}/judge`,
        ALGORITHM_JUDGE_TOKEN: secret,
        ALGORITHM_JUDGE_POLL_MS: '10',
        ALGORITHM_JUDGE_TIMEOUT_MS: '10000',
        PORT: '3034',
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
    async function login(username: string) {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      const payload = await response.json();
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
          status: number | number[] = method === 'POST' ? 201 : 200,
          withoutCsrf = false,
        ) {
          const response = await fetch(`${origin}/api${path}`, {
            method,
            headers: {
              cookie,
              origin,
              'content-type': 'application/json',
              ...(!withoutCsrf ? { 'x-csrf-token': payload.csrfToken } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const text = await response.text();
          if (Array.isArray(status))
            assert.ok(status.includes(response.status), `${method} ${path}: ${text.slice(0, 1000)}`);
          else assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 1000)}`);
          return response.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text;
        },
      };
    }
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (api.exitCode !== null) throw new Error(`Isolated API stopped before ready: ${logs}`);
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
      assert.ok(ready, `Build API and ensure port 3034 is available: ${logs}`);
      const seed = await db.user.findUniqueOrThrow({ where: { username: 'student' } });
      const organization = await db.organization.create({ data: { name: `算法验收-${suffix}` } });
      const foreignOrg = await db.organization.create({ data: { name: `异机构算法验收-${suffix}` } });
      const users = [];
      for (const [tag, roleId, organizationId] of [
        ['student', 'STUDENT', organization.id],
        ['other', 'STUDENT', organization.id],
        ['teacher', 'TEACHER', organization.id],
        ['foreign', 'STUDENT', foreignOrg.id],
      ])
        users.push(
          await db.user.create({
            data: {
              organizationId,
              username: `algorithm-${tag}-${suffix}`,
              name: `算法验收${tag}`,
              passwordHash: seed.passwordHash,
              roles: { create: { roleId } },
            },
          }),
        );
      const clients = await Promise.all(users.map((user) => login(user.username)));
      let student = clients[0];
      const [other, teacher, foreign] = clients.slice(1);
      const owner = { organizationId: organization.id, userId: student.user.id };
      const cooldown = () =>
        db.algorithmOperation.updateMany({
          where: { ...owner, status: { not: 'pending' } },
          data: { createdAt: new Date(Date.now() - 61000) },
        });
      let submitted: any;

      await t.test('catalog, filters, student role and strict input validation', async () => {
        const status = await student.call('/algorithms/status');
        assert.equal(status.judge.available, true);
        assert.equal(status.ai.available, true);
        assert.equal(status.judge.languages.length, 4);
        assert.ok(!JSON.stringify(status).includes(secret));
        await teacher.call('/algorithms/status', 'GET', undefined, 403);
        const list = await student.call('/algorithms/problems?page=1&pageSize=2');
        assert.equal(list.items.length, 2);
        assert.equal(list.total, algorithmProblems.length);
        assert.equal(list.stats.solved, 0);
        assert.ok(list.items.every((p: any) => p.status === 'todo'));
        assert.equal((await student.call('/algorithms/problems?q=两数相加&difficulty=easy')).total, 1);
        const detail = await student.call(base);
        for (const key of ['testCases', 'hints', 'solution']) assert.equal(detail[key], undefined);
        assert.equal(detail.draft, null);
        await student.call('/algorithms/problems/missing', 'GET', undefined, 404);
        await student.call('/algorithms/problems?pageSize=200', 'GET', undefined, 400);
        const before = judgeCalls;
        for (const body of [
          { ...submission, userId: other.user.id },
          { ...submission, language: 'bash' },
          { ...submission, code: '' },
          { ...submission, stdin: '1 2' },
          { ...submission, code: 'x'.repeat(16001) },
        ])
          await student.call(`${base}/submissions`, 'POST', body, 400);
        await student.call(`${base}/submissions`, 'POST', submission, 403, true);
        assert.equal(judgeCalls, before);
      });
      await t.test('private drafts persist and sample/custom runs do not solve a problem', async () => {
        await student.call(`${base}/draft`, 'PUT', source);
        assert.equal((await student.call(base)).draft.code, code);
        assert.equal((await other.call(base)).draft, null);
        assert.equal((await foreign.call(base)).draft, null);
        const run = await student.call(`${base}/submissions`, 'POST', { ...source, mode: 'run' });
        assert.equal(run.status, 'accepted');
        assert.equal(
          run.total,
          getAlgorithmProblem('sum-of-two')!.testCases.filter((item) => !item.hidden).length,
        );
        assert.ok(run.results.every((r: any) => !r.hidden));
        assert.equal((await student.call('/algorithms/problems?status=solved')).total, 0);
        const custom = await student.call(`${base}/submissions`, 'POST', {
          ...source,
          mode: 'run',
          stdin: '20 22\n',
        });
        assert.equal(custom.customInput, true);
        assert.equal(custom.results[0].stdout, '42\n');
        assert.equal(custom.results[0].expectedOutput, undefined);
        assert.equal((await student.call('/algorithms/problems?status=solved')).total, 0);
      });
      await t.test(
        'formal submissions solve only on full acceptance and hidden data never reaches history',
        async () => {
          const expectedCases = getAlgorithmProblem('sum-of-two')!.testCases.length;
          const callsBefore = judgeCalls;
          submitted = await student.call(`${base}/submissions`, 'POST', submission);
          assert.equal(submitted.status, 'accepted');
          assert.equal(submitted.total, expectedCases);
          assert.equal(submitted.passed, expectedCases);
          assert.equal(submitted.results.length, expectedCases);
          assert.equal(judgeCalls - callsBefore, expectedCases);
          assert.equal(submitted.compileOutput, '');
          for (const item of submitted.results.filter((r: any) => r.hidden))
            for (const key of ['input', 'expectedOutput', 'stdout', 'stderr'])
              assert.equal(item[key], undefined);
          assert.ok(!JSON.stringify(submitted.results).includes('1000000000 1000000000'));
          assert.equal((await student.call('/algorithms/problems?status=solved')).total, 1);
          const history = await student.call(`${base}/submissions?pageSize=1`);
          assert.equal(history.total, 3);
          assert.equal(history.items[0].id, submitted.id);
          await other.call(`/algorithms/submissions/${submitted.id}`, 'GET', undefined, 404);
          await foreign.call(`/algorithms/submissions/${submitted.id}`, 'GET', undefined, 404);
          await teacher.call(`/algorithms/submissions/${submitted.id}`, 'GET', undefined, 403);
          assert.equal((await other.call(`${base}/submissions`)).total, 0);
          const wrong = await other.call(`${base}/submissions`, 'POST', {
            ...submission,
            code: '# WRONG_ANSWER\nprint(0)',
          });
          assert.equal(wrong.status, 'wrong_answer');
          assert.equal((await other.call('/algorithms/problems?status=attempted')).total, 1);
          const compilation = await student.call(`${base}/submissions`, 'POST', {
            ...source,
            code: 'COMPILE_ERROR',
            mode: 'run',
          });
          assert.equal(compilation.status, 'compile_error');
          assert.match(compilation.compileOutput, /SyntaxError/);
        },
      );
      await t.test(
        'learning notes, favorites and review flags are private, versioned and preserve omitted fields',
        async () => {
          const empty = await student.call(`${base}/learning`);
          assert.deepEqual(empty, {
            favorite: false,
            reviewStatus: 'none',
            note: '',
            revision: 0,
            updatedAt: null,
          });
          assert.equal((await student.call(base)).navigation.previousProblemId, null);
          assert.equal((await student.call(base)).navigation.nextProblemId, algorithmProblems[1].id);
          const note = '<vector> 是代码笔记纯文本\n边界：负数、零。';
          const saved = await student.call(`${base}/learning`, 'PATCH', {
            revision: 0,
            favorite: true,
            note,
          });
          assert.equal(saved.revision, 1);
          assert.equal(saved.note, note);
          assert.equal(saved.favorite, true);
          const revised = await student.call(`${base}/learning`, 'PATCH', {
            revision: 1,
            reviewStatus: 'review',
          });
          assert.equal(revised.revision, 2);
          assert.equal(revised.note, note);
          assert.equal(revised.favorite, true);
          const detail = await student.call(base);
          assert.deepEqual(detail.learningState, revised);
          assert.equal(
            (await student.call('/algorithms/problems?favorite=true&review=review')).items[0].id,
            'sum-of-two',
          );
          assert.equal(
            (await student.call('/algorithms/problems?favorite=false')).total,
            algorithmProblems.length - 1,
          );
          for (const client of [other, foreign]) {
            assert.deepEqual(await client.call(`${base}/learning`), empty);
            assert.equal((await client.call('/algorithms/problems?favorite=true')).total, 0);
          }
          await teacher.call(`${base}/learning`, 'GET', undefined, 403);
          await teacher.call(`${base}/learning`, 'PATCH', { revision: 0, note: 'unauthorized' }, 403);
          await student.call(`${base}/learning`, 'PATCH', { revision: 0, note: 'stale overwrite' }, 409);
          for (const patch of [
            { revision: 2 },
            { revision: 2, userId: other.user.id, note: '' },
            { revision: 2, note: '学'.repeat(12001) },
          ])
            await student.call(`${base}/learning`, 'PATCH', patch, 400);
          await student.call(`${base}/learning`, 'PATCH', { revision: 2, favorite: false }, 403, true);
          await student.call('/algorithms/problems/missing/learning', 'GET', undefined, 404);
          const concurrent = await Promise.all([
            student.call(`${base}/learning`, 'PATCH', { revision: 2, note: 'first writer' }, [200, 409]),
            student.call(`${base}/learning`, 'PATCH', { revision: 2, note: 'second writer' }, [200, 409]),
          ]);
          assert.equal(concurrent.filter((value) => value.revision === 3).length, 1);
          const after = await student.call(`${base}/learning`);
          assert.equal(after.revision, 3);
          assert.ok(['first writer', 'second writer'].includes(after.note));
          const cleared = await student.call(`${base}/learning`, 'PATCH', {
            revision: 3,
            note: '',
            favorite: false,
            reviewStatus: 'mastered',
          });
          assert.equal(cleared.note, '');
          assert.equal(cleared.favorite, false);
          assert.equal(
            (await student.call('/algorithms/problems?review=mastered')).items[0].id,
            'sum-of-two',
          );
          const firstCreation = await Promise.all([
            student.call(
              '/algorithms/problems/array-maximum/learning',
              'PATCH',
              { revision: 0, note: 'left' },
              [200, 409],
            ),
            student.call(
              '/algorithms/problems/array-maximum/learning',
              'PATCH',
              { revision: 0, note: 'right' },
              [200, 409],
            ),
          ]);
          assert.equal(firstCreation.filter((value) => value.revision === 1).length, 1);
          assert.equal(
            await db.algorithmLearningState.count({ where: { ...owner, problemId: 'array-maximum' } }),
            1,
          );
        },
      );
      await t.test(
        'editorials expose structured teaching content and related public summaries only',
        async () => {
          const result = await student.call(`${base}/editorial`);
          assert.equal(result.editorial.problemId, 'sum-of-two');
          assert.equal(result.editorial.hints.length, 3);
          assert.ok(result.editorial.approaches.length > 0);
          assert.deepEqual(Object.keys(result.editorial.referenceCode).sort(), [
            'cpp',
            'java',
            'javascript',
            'python',
          ]);
          assert.equal(result.editorial.testCases, undefined);
          for (const related of result.relatedProblems) {
            assert.ok(getAlgorithmProblem(related.id));
            assert.notEqual(related.id, 'sum-of-two');
            assert.equal(related.note, undefined);
            assert.equal(related.testCases, undefined);
            assert.equal(typeof related.favorite, 'boolean');
          }
          await teacher.call(`${base}/editorial`, 'GET', undefined, 403);
          await student.call('/algorithms/problems/missing/editorial', 'GET', undefined, 404);
        },
      );
      await t.test(
        'overview derives Beijing activity and plan progress solely from own formal submissions',
        async () => {
          const empty = await foreign.call('/algorithms/overview');
          assert.deepEqual(empty.stats, { submitted: 0, accepted: 0, solved: 0, streak: 0 });
          assert.equal(empty.activity.length, 28);
          assert.ok(empty.activity.every((day: any) => day.submissions === 0 && day.solved === 0));
          assert.ok(empty.plans.length > 0);
          const events = [
            ['sum-of-two', 'accepted', -1, 'submit'],
            ['array-maximum', 'accepted', -1, 'submit'],
            ['sum-of-two', 'accepted', 0, 'submit'],
            ['sum-of-two', 'accepted', 0, 'submit'],
            ['palindrome-word', 'wrong_answer', 0, 'submit'],
            ['palindrome-word', 'wrong_answer', -2, 'submit'],
            ['palindrome-word', 'accepted', 0, 'run'],
          ] as const;
          await db.algorithmSubmission.createMany({
            data: events.map(([problemId, status, offset, mode]) => ({
              organizationId: foreignOrg.id,
              userId: foreign.user.id,
              problemId,
              language: 'python',
              code,
              mode,
              status,
              total: 1,
              passed: status === 'accepted' ? 1 : 0,
              results: [],
              createdAt: new Date(Date.now() + offset * 86400000),
            })),
          });
          const overview = await foreign.call('/algorithms/overview');
          assert.deepEqual(overview.stats, { submitted: 6, accepted: 4, solved: 2, streak: 3 });
          assert.equal(overview.activity.at(-1).submissions, 3);
          assert.equal(overview.activity.at(-1).solved, 1);
          assert.equal(overview.activity.at(-2).solved, 2);
          assert.equal(overview.dailyProblem.id, empty.dailyProblem.id);
          assert.equal(overview.recommendation.id, 'palindrome-word');
          assert.equal(
            (await foreign.call('/algorithms/overview')).dailyProblem.id,
            overview.dailyProblem.id,
          );
          for (const plan of overview.plans) {
            const ids = [...new Set(plan.chapters.flatMap((chapter: any) => chapter.problemIds))] as string[];
            assert.equal(plan.total, ids.length);
            assert.equal(
              plan.solved,
              ids.filter((id) => ['sum-of-two', 'array-maximum'].includes(id)).length,
            );
            assert.equal(
              plan.nextProblemId,
              ids.find((id) => !['sum-of-two', 'array-maximum'].includes(id)) ?? null,
            );
          }
          await foreign.call(`${base}/learning`, 'PATCH', { revision: 0, reviewStatus: 'review' });
          assert.equal((await foreign.call('/algorithms/overview')).recommendation.id, 'sum-of-two');
          await teacher.call('/algorithms/overview', 'GET', undefined, 403);
        },
      );
      await t.test(
        'AI hint/explain/debug are persisted and use only owned matching code and public execution evidence',
        async () => {
          const hint = await student.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' });
          assert.equal(hint.status, 'ready');
          assert.equal(hint.content.suggestedCode, '');
          assert.equal(aiRequest.problem.solution, undefined);
          const analysis = await student.call(`${base}/analysis`, 'POST', {
            ...source,
            mode: 'debug',
            submissionId: submitted.id,
          });
          assert.equal(analysis.content.suggestedCode, code);
          assert.equal(aiRequest.execution.status, 'accepted');
          assert.equal(aiRequest.problem.testCases, undefined);
          for (const id of [student.user.id, organization.id, submitted.id])
            assert.ok(!JSON.stringify(aiRequest).includes(id));
          assert.ok(!JSON.stringify(aiRequest).includes('diagnostic:1000000000'));
          await student.call(
            `${base}/analysis`,
            'POST',
            { ...source, mode: 'explain', submissionId: submitted.id, code: 'print(1)' },
            400,
          );
          await other.call(
            `${base}/analysis`,
            'POST',
            { ...source, mode: 'debug', submissionId: submitted.id },
            404,
          );
          await foreign.call(
            `${base}/analysis`,
            'POST',
            { ...source, mode: 'debug', submissionId: submitted.id },
            404,
          );
          assert.equal((await student.call(`${base}/analyses`)).items.length, 2);
          assert.equal((await other.call(`${base}/analyses`)).items.length, 0);
          const before = aiCalls;
          await config(100, '');
          try {
            assert.equal((await student.call('/algorithms/status')).ai.available, false);
            await student.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' }, 503);
          } finally {
            await config();
          }
          assert.equal(aiCalls, before);
        },
      );
      await t.test(
        'one pending request per kind prevents duplicate judge and AI jobs under concurrency',
        async () => {
          await cooldown();
          judgeMode = 'hold';
          judgeHold = new Promise<void>((resolve) => {
            releaseJudge = resolve;
          });
          const reached = new Promise<void>((resolve) => {
            seenJudge = resolve;
          });
          const pending = student.call(`${base}/submissions`, 'POST', submission);
          await reached;
          const before = judgeCalls;
          await student.call(`${base}/submissions`, 'POST', submission, 409);
          assert.equal(judgeCalls, before);
          assert.equal(
            (await student.call(`${base}/submissions`)).items.filter((s: any) => s.status === 'running')
              .length,
            1,
          );
          judgeMode = 'success';
          releaseJudge?.();
          assert.equal((await pending).status, 'accepted');
          aiMode = 'hold';
          aiHold = new Promise<void>((resolve) => {
            releaseAi = resolve;
          });
          const aiReached = new Promise<void>((resolve) => {
            seenAi = resolve;
          });
          const pendingAi = student.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' });
          await aiReached;
          const aiBefore = aiCalls;
          await student.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' }, 409);
          assert.equal(aiCalls, aiBefore);
          aiMode = 'success';
          releaseAi?.();
          assert.equal((await pendingAi).status, 'ready');
        },
      );
      await t.test(
        'expired leases recover and late provider responses cannot overwrite terminal records',
        async () => {
          await cooldown();
          judgeMode = 'hold';
          judgeHold = new Promise<void>((resolve) => {
            releaseJudge = resolve;
          });
          const reached = new Promise<void>((resolve) => {
            seenJudge = resolve;
          });
          const pending = student.call(`${base}/submissions`, 'POST', submission);
          await reached;
          const operation = await db.algorithmOperation.findFirstOrThrow({
            where: { ...owner, kind: 'judge', status: 'pending' },
          });
          await db.algorithmOperation.update({
            where: { id: operation.id },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
          });
          const recovered = await student.call(`/algorithms/submissions/${operation.submissionId}`);
          assert.equal(recovered.status, 'system_error');
          assert.match(recovered.error, /超时/);
          judgeMode = 'success';
          releaseJudge?.();
          assert.equal((await pending).status, 'system_error');
          aiMode = 'hold';
          aiHold = new Promise<void>((resolve) => {
            releaseAi = resolve;
          });
          const aiReached = new Promise<void>((resolve) => {
            seenAi = resolve;
          });
          const pendingAi = student.call(`${base}/analysis`, 'POST', { ...source, mode: 'explain' });
          await aiReached;
          const aiOperation = await db.algorithmOperation.findFirstOrThrow({
            where: { ...owner, kind: 'analysis', status: 'pending' },
          });
          await db.algorithmOperation.update({
            where: { id: aiOperation.id },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
          });
          const reports = await student.call(`${base}/analyses`);
          assert.equal(
            reports.items.find((item: any) => item.id === aiOperation.analysisId).status,
            'failed',
          );
          aiMode = 'success';
          releaseAi?.();
          const late = await pendingAi;
          assert.equal(late.status, 'failed');
          assert.equal(late.content, null);
        },
      );
      await t.test(
        'feature disable and invalidated session block access, including an in-flight completion',
        async () => {
          await db.systemSetting.create({
            data: { organizationId: organization.id, key: 'features', value: { practice: false } },
          });
          try {
            await student.call('/algorithms/status', 'GET', undefined, 403);
            await student.call(base, 'GET', undefined, 403);
            await student.call('/algorithms/overview', 'GET', undefined, 403);
            await student.call(`${base}/editorial`, 'GET', undefined, 403);
            await student.call(`${base}/learning`, 'GET', undefined, 403);
            await student.call(`${base}/learning`, 'PATCH', { revision: 4, note: 'blocked' }, 403);
            await student.call(`${base}/submissions`, 'POST', submission, 403);
            await student.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' }, 403);
          } finally {
            await db.systemSetting.delete({
              where: { organizationId_key: { organizationId: organization.id, key: 'features' } },
            });
          }
          await cooldown();
          judgeMode = 'hold';
          judgeHold = new Promise<void>((resolve) => {
            releaseJudge = resolve;
          });
          const reached = new Promise<void>((resolve) => {
            seenJudge = resolve;
          });
          const pending = student.call(`${base}/submissions`, 'POST', submission, 403);
          await reached;
          await db.user.update({ where: { id: student.user.id }, data: { authVersion: { increment: 1 } } });
          judgeMode = 'success';
          releaseJudge?.();
          await pending;
          await student.call(base, 'GET', undefined, 401);
          student = await login(users[0].username);
          assert.equal(await db.algorithmOperation.count({ where: { ...owner, status: 'pending' } }), 0);
          assert.equal((await student.call(base)).draft.code, code);
        },
      );
      await t.test(
        'provider failures are safe persistent failures and do not expose provider messages',
        async () => {
          await cooldown();
          judgeMode = 'fail';
          const failedRun = await student.call(`${base}/submissions`, 'POST', submission);
          judgeMode = 'success';
          assert.equal(failedRun.status, 'system_error');
          assert.ok(!JSON.stringify(failedRun).includes(secret));
          for (const failure of ['fail', 'invalid'] as const) {
            aiMode = failure;
            const failed = await student.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' });
            assert.equal(failed.status, 'failed');
            assert.equal(failed.content, null);
            assert.ok(!JSON.stringify(failed).includes(secret));
          }
          aiMode = 'success';
        },
      );
      await t.test(
        'daily AI quota includes failed attempts and rejects requests before provider access',
        async () => {
          await config(2);
          try {
            const first = await other.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' });
            assert.equal(first.status, 'ready');
            aiMode = 'fail';
            assert.equal(
              (await other.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' })).status,
              'failed',
            );
            aiMode = 'success';
            const before = aiCalls;
            await other.call(`${base}/analysis`, 'POST', { ...source, mode: 'hint' }, 429);
            assert.equal(aiCalls, before);
            assert.equal(
              await db.algorithmOperation.count({ where: { userId: other.user.id, kind: 'analysis' } }),
              2,
            );
          } finally {
            aiMode = 'success';
            await config();
          }
        },
      );
      await t.test('database reservations enforce per-minute and daily judge limits', async () => {
        const scoped = { organizationId: foreignOrg.id, userId: foreign.user.id };
        await db.algorithmOperation.createMany({
          data: Array.from({ length: 10 }, () => ({
            ...scoped,
            kind: 'judge',
            status: 'completed',
            leaseExpiresAt: new Date(),
            completedAt: new Date(),
          })),
        });
        const before = judgeCalls;
        await foreign.call(`${base}/submissions`, 'POST', submission, 429);
        await db.algorithmOperation.updateMany({
          where: scoped,
          data: { createdAt: new Date(Date.now() - 61000) },
        });
        await db.algorithmOperation.createMany({
          data: Array.from({ length: 190 }, () => ({
            ...scoped,
            kind: 'judge',
            status: 'completed',
            leaseExpiresAt: new Date(),
            completedAt: new Date(),
            createdAt: new Date(Date.now() - 61000),
          })),
        });
        await foreign.call(`${base}/submissions`, 'POST', submission, 429);
        assert.equal(judgeCalls, before);
      });
      assert.ok(!logs.includes(secret));
    } finally {
      releaseJudge?.();
      releaseAi?.();
      api.kill('SIGTERM');
      if (api.exitCode === null) await Promise.race([once(api, 'exit'), sleep(3000)]);
      if (api.exitCode === null) api.kill('SIGKILL');
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await writeFile('.data/algorithms-api.log', logs);
      await db.$disconnect();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
