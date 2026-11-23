import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveFixture, liveWait } from './live.fixture';
import { MobileApiError, MobileClient } from '../apps/mobile/src/client';
import { codeWorkspaceApi as api, type CodeSubmission } from '../apps/mobile/src/algorithm-workspace-model';
import { algorithmLearningApi as learning } from '../apps/mobile/src/algorithm-learning-model';

test(
  'native algorithm workspace uses real HTTP/session/CAS and isolated Judge0 protocol',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture(),
      directory = await mkdtemp(join(tmpdir(), 'native-judge-'));
    let child: ChildProcess | undefined,
      logs = '',
      hold: Promise<void> | null = null,
      release: (() => void) | undefined,
      arrived: (() => void) | undefined;
    const token = randomUUID(),
      jobs = new Map<string, { code: string; input: string }>();
    const aiRequests: any[] = [];
    const provider = createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && url.pathname === '/deepseek/chat/completions') {
        assert.equal(req.headers.authorization, 'Bearer ' + token);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = JSON.parse(Buffer.concat(chunks).toString());
        aiRequests.push(JSON.parse(request.messages.find((message: any) => message.role === 'user').content));
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    summary: '读取两个整数并计算其和。',
                    approach: ['检查输入和负数边界', '输出整数和'],
                    complexity: '时间 O(1)，额外空间 O(1)。',
                    pitfalls: ['保持标准输出格式'],
                    suggestedCode: 'print(sum(map(int,input().split())))',
                  }),
                },
              },
            ],
          }),
        );
        return;
      }
      if (req.headers['x-auth-token'] !== token) {
        res.writeHead(403).end('{}');
        return;
      }
      if (req.method === 'POST' && url.pathname === '/submissions') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(body.enable_network, false);
        assert.equal(body.expected_output, undefined);
        const id = randomUUID();
        jobs.set(id, {
          code: Buffer.from(body.source_code, 'base64').toString(),
          input: Buffer.from(body.stdin, 'base64').toString(),
        });
        res.end(JSON.stringify({ token: id }));
        return;
      }
      const job = jobs.get(url.pathname.split('/').pop()!);
      if (req.method !== 'GET' || !job) {
        res.writeHead(404).end('{}');
        return;
      }
      if (hold) {
        arrived?.();
        await hold;
      }
      // Protocol fixture does not execute source. Sum-of-two output is independently derived from input.
      const output = job.code.includes('WRONG')
        ? 'wrong\n'
        : String(
            job.input
              .trim()
              .split(/\s+/)
              .map(Number)
              .reduce((a, b) => a + b, 0),
          ) + '\n';
      res.end(
        JSON.stringify({
          status: { id: 3 },
          stdout: Buffer.from(output).toString('base64'),
          stderr: Buffer.from('diagnostic:' + job.input).toString('base64'),
          compile_output: '',
          time: '0.001',
          memory: 4096,
          exit_code: 0,
          exit_signal: 0,
        }),
      );
    });
    const denied = (request: Promise<unknown>, status: number) =>
      assert.rejects(request, (e) => e instanceof MobileApiError && e.status === status);
    try {
      await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
      const providerPort = (provider.address() as { port: number }).port;
      const portProbe = createServer();
      await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
      const port = (portProbe.address() as { port: number }).port;
      await new Promise<void>((resolve) => portProbe.close(() => resolve()));
      const config = join(directory, 'providers.yaml');
      await writeFile(
        config,
        JSON.stringify({
          judge0: { enabled: true },
          ai: {
            enabled: true,
            apiStyle: 'deepseek',
            structuredOutput: 'json_object',
            baseUrl: `http://127.0.0.1:${providerPort}/deepseek`,
            apiKey: token,
            model: 'deepseek-flash',
            timeoutMs: 10000,
          },
          webSearch: { enabled: false },
          limits: { dailyRequests: 100 },
        }),
        { mode: 0o600 },
      );
      child = spawn(process.execPath, ['apps/api/dist/main.js'], {
        env: {
          ...f.env,
          PORT: String(port),
          AI_CONFIG_PATH: config,
          ALGORITHM_JUDGE_ENABLED: 'true',
          ALGORITHM_JUDGE_URL: `http://127.0.0.1:${providerPort}`,
          ALGORITHM_JUDGE_TOKEN: token,
          ALGORITHM_JUDGE_POLL_MS: '10',
          ALGORITHM_JUDGE_TIMEOUT_MS: '10000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (chunk) => {
        logs = (logs + String(chunk)).slice(-10000);
      });
      child.stderr?.on('data', (chunk) => {
        logs = (logs + String(chunk)).slice(-10000);
      });
      const origin = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) {
            ready = true;
            break;
          }
        } catch {
          /*only own API*/
        }
        await liveWait(100);
      }
      assert.ok(ready, 'Native fixture not ready: ' + f.safe(logs).split(token).join('[redacted]'));
      const mobile = async (username: string, fetcher: typeof fetch = fetch) => {
        let raw: string | null = null;
        const client = new MobileClient(
          origin,
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
          fetcher,
        );
        await client.login(username, f.password);
        return client;
      };
      const student = await mobile(f.users.student.username),
        other = await mobile(f.users.student2.username),
        foreign = await mobile(f.users.outsider.username),
        teacher = await mobile(f.users.teacher.username);
      const pid = 'sum-of-two',
        base = '/mobile/algorithms/problems/' + pid,
        own = { organizationId: f.organization.id, userId: f.users.student.id, problemId: pid };
      await t.test('mobile-only exact endpoints protect role, scope and hidden catalog', async () => {
        assert.equal((await api.status(student)).judge.available, true);
        const workspace = await api.load(student, pid);
        assert.equal(workspace.draft, null);
        assert.deepEqual(Object.keys(workspace.starterCode).sort(), ['cpp', 'java', 'javascript', 'python']);
        for (const field of ['testCases', 'solution', 'organizationId', 'userId'])
          assert.ok(!Object.hasOwn(workspace, field));
        await denied(api.load(teacher, pid), 403);
        await f.call(f.clients.student, base + '/workspace', 'GET', undefined, 403);
        await denied(student.request(base + '/submissions?pageSize=21'), 400);
        await denied(student.request(base + '/submissions?status=accepted&status=running'), 400);
        await denied(
          student.request(
            base + '/submissions',
            { language: 'python', code: 'print(3)', mode: 'submit', stdin: '1 2' },
            'POST',
          ),
          400,
        );
        await denied(
          student.request(
            base + '/draft',
            { language: 'python', code: 'x', revision: 0, userId: 'other' },
            'PUT',
          ),
          400,
        );
      });
      await t.test(
        'private draft is shared with web and optimistic conflicts cannot overwrite either device',
        async () => {
          const first = await api.save(student, pid, null, { language: 'python', code: 'print("私有😀")\n' });
          assert.equal(first.revision, 1);
          assert.equal((await api.load(other, pid)).draft, null);
          assert.equal((await api.load(foreign, pid)).draft, null);
          const web = (await f.call(f.clients.student, '/algorithms/problems/' + pid)).body;
          assert.deepEqual(first, web.draft);
          const changed = (
            await f.call(f.clients.student, '/algorithms/problems/' + pid + '/draft', 'PUT', {
              revision: 1,
              language: 'cpp',
              code: '// web private',
            })
          ).body;
          await denied(api.save(student, pid, first, { language: 'python', code: 'stale' }), 409);
          assert.deepEqual((await api.load(student, pid)).draft, changed);
        },
      );
      let submitted: CodeSubmission;
      await t.test(
        'examples/custom run do not solve, formal submit does and hidden diagnostics never leak',
        async () => {
          const run = await api.execute(student, pid, { language: 'python', code: 'sum fixture' }, 'run');
          assert.equal(run.status, 'accepted');
          assert.equal(run.customInput, false);
          assert.equal(
            await f.db.algorithmSubmission.count({ where: { ...own, mode: 'submit', status: 'accepted' } }),
            0,
          );
          const custom = await api.execute(
            student,
            pid,
            { language: 'javascript', code: 'sum fixture' },
            'run',
            '7 9',
          );
          assert.equal(custom.results[0].stdout, '16\n');
          assert.equal(custom.results[0].expectedOutput, undefined);
          assert.equal(custom.customInput, true);
          submitted = await api.execute(student, pid, { language: 'python', code: 'sum fixture' }, 'submit');
          assert.equal(submitted.status, 'accepted');
          assert.ok(submitted.results.some((row) => row.hidden));
          for (const row of submitted.results.filter((row) => row.hidden))
            for (const key of ['input', 'expectedOutput', 'stdout', 'stderr'])
              assert.equal(Object.hasOwn(row, key), false);
          assert.equal(submitted.compileOutput, '');
          assert.equal((await api.history(student, pid)).total, 3);
          await denied(api.submission(other, submitted.id), 404);
          await denied(api.submission(foreign, submitted.id), 404);
          assert.equal((await api.history(other, pid)).total, 0);
          assert.equal(
            (
              await student.request<{ items: CodeSubmission[] }>(
                base + '/submissions?kind=custom&language=javascript&status=accepted',
              )
            ).items[0].id,
            custom.id,
          );
          const wrong = await api.execute(student, pid, { language: 'python', code: 'WRONG' }, 'submit');
          assert.equal(wrong.status, 'wrong_answer');
          assert.equal(
            await f.db.algorithmSubmission.count({ where: { ...own, mode: 'submit', status: 'accepted' } }),
            1,
          );
        },
      );
      await t.test(
        'lost response is not replayed; read-only history recovers exactly one persisted execution',
        async () => {
          let lost = true;
          const flaky = await mobile(f.users.student.username, async (input, init) => {
            const response = await fetch(input, init);
            if (lost && init?.method === 'POST' && String(input).endsWith('/submissions')) {
              lost = false;
              await response.text();
              throw new Error('simulated lost response');
            }
            return response;
          });
          const before = await f.db.algorithmSubmission.count({ where: own });
          await denied(
            api.execute(flaky, pid, { language: 'python', code: 'lost response fixture' }, 'run', '2 5'),
            0,
          );
          const history = await api.history(flaky, pid);
          assert.equal(history.total, before + 1);
          assert.equal(history.items[0].code, 'lost response fixture');
          assert.equal(history.items[0].results[0].stdout, '7\n');
          assert.equal(await f.db.algorithmSubmission.count({ where: own }), before + 1);
        },
      );
      await t.test(
        'AI hint/explanation/debug retain private history, shared quotas and exact submitted snapshot',
        async () => {
          assert.equal((await api.status(student)).ai?.available, true);
          const intent = { language: 'python' as const, code: 'sum fixture' };
          const hint = await learning.analyze(student, pid, intent, 'hint', null);
          assert.equal(hint.status, 'ready');
          assert.equal(hint.language, 'python');
          assert.equal(hint.content!.suggestedCode, '');
          const explanation = await learning.analyze(student, pid, intent, 'explain', null);
          assert.equal(explanation.status, 'ready');
          assert.match(explanation.content!.suggestedCode, /print/);
          const debug = await learning.analyze(student, pid, intent, 'debug', submitted!);
          assert.equal(debug.status, 'ready');
          assert.equal(aiRequests.at(-1).execution.status, 'accepted');
          for (const request of aiRequests) {
            assert.equal(request.problem.testCases, undefined);
            assert.equal(request.userId, undefined);
            assert.equal(request.organizationId, undefined);
            for (const row of request.execution?.results || [])
              if (row.hidden)
                for (const field of ['input', 'expectedOutput', 'stdout', 'stderr'])
                  assert.equal(Object.hasOwn(row, field), false);
          }
          assert.equal((await learning.analyses(student, pid)).items.length, 3);
          assert.equal((await learning.analyses(other, pid)).items.length, 0);
          assert.equal((await learning.analyses(foreign, pid)).items.length, 0);
          await denied(learning.analyze(student, pid, intent, 'hint', null), 429);
          assert.equal(aiRequests.length, 3);
          await denied(
            other.request(
              base + '/analysis',
              { ...intent, mode: 'debug', submissionId: submitted!.id },
              'POST',
            ),
            404,
          );
          await denied(
            student.request(
              base + '/analysis',
              { ...intent, code: 'changed snapshot', mode: 'debug', submissionId: submitted!.id },
              'POST',
            ),
            400,
          );
        },
      );
      await t.test(
        'private training plans reuse formal progress and CAS while forum publication has explicit scope and private aliases',
        async () => {
          const created = await learning.createPlan(student, '手机图与数组训练', '仅本人可见', [
            pid,
            'first-position',
          ]);
          assert.equal(created.total, 2);
          assert.equal(created.solved, 1);
          assert.equal((await learning.plans(student)).items[0].id, created.id);
          assert.equal((await learning.plans(other)).items.length, 0);
          const planPath = '/mobile/algorithms/training-plans/' + created.id;
          await denied(
            other.request(planPath, { revision: created.revision, title: 'not owner' }, 'PATCH'),
            404,
          );
          const changed = await student.request<any>(
            planPath,
            { revision: created.revision, title: '手机训练更新' },
            'PATCH',
          );
          assert.equal(changed.revision, created.revision + 1);
          await denied(
            student.request(planPath, { revision: created.revision, title: 'stale' }, 'PATCH'),
            409,
          );
          const publicPost = await learning.createPost(student, {
            scope: 'public',
            kind: 'question',
            title: '公开输入格式问题',
            body: '只公开这段讨论文字',
            problemId: pid,
          });
          assert.equal((await learning.post(foreign, publicPost.id)).body, '只公开这段讨论文字');
          assert.ok(publicPost.authorLabel);
          for (const field of ['authorId', 'organizationId', 'userId'])
            assert.equal(Object.hasOwn(publicPost, field), false);
          await learning.reply(other, publicPost, '同学回复');
          assert.equal((await learning.replies(student, publicPost.id)).items[0].body, '同学回复');
          const internal = await learning.createPost(student, {
            scope: 'organization',
            kind: 'discussion',
            title: '机构内部算法讨论',
            body: '机构内可见',
            problemId: pid,
          });
          await denied(learning.post(foreign, internal.id), 404);
          await denied(learning.replies(foreign, internal.id), 404);
          assert.equal((await learning.posts(other, 'organization', pid)).items[0].id, internal.id);
          await denied(
            learning.createPost(teacher, {
              scope: 'public',
              kind: 'question',
              title: '教师mobile',
              body: '不支持',
            }),
            403,
          );
          await denied(student.request('/mobile/algorithms/forum/posts?pageSize=21'), 400);
          await denied(student.request('/mobile/algorithms/forum/posts?page=1&page=2'), 400);
          await denied(
            student.request(
              '/mobile/algorithms/forum/posts',
              { scope: 'public', kind: 'question', title: 'bad', body: 'bad', authorId: 'other' },
              'POST',
            ),
            400,
          );
        },
      );
      await t.test(
        'mobile and website share the pending gate and revocation during judge prevents accepted credit',
        async () => {
          hold = new Promise<void>((resolve) => {
            release = resolve;
          });
          const seen = new Promise<void>((resolve) => {
            arrived = resolve;
          });
          const operation = api.execute(
            student,
            pid,
            { language: 'python', code: 'revoked fixture' },
            'submit',
          );
          const rejected = denied(operation, 403);
          await seen;
          const competing = await fetch(origin + '/api/algorithms/problems/' + pid + '/submissions', {
            method: 'POST',
            headers: {
              cookie: f.clients.student.cookie,
              'x-csrf-token': f.clients.student.csrf,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ language: 'python', code: 'duplicate', mode: 'submit' }),
          });
          assert.equal(competing.status, 409);
          await f.db.user.update({
            where: { id: f.users.student.id },
            data: { authVersion: { increment: 1 } },
          });
          release!();
          hold = null;
          await rejected;
          const row = await f.db.algorithmSubmission.findFirstOrThrow({
            where: { ...own, code: 'revoked fixture' },
          });
          assert.equal(row.status, 'system_error');
          assert.equal(
            await f.db.algorithmOperation.count({
              where: { organizationId: own.organizationId, userId: own.userId, status: 'pending' },
            }),
            0,
          );
        },
      );
      await t.test(
        'expired operation recovery and disabled feature affect only the current owner',
        async () => {
          const row = await f.db.algorithmSubmission.create({
            data: {
              organizationId: f.organization.id,
              userId: f.users.student2.id,
              problemId: pid,
              language: 'python',
              code: 'expired fixture',
              mode: 'submit',
              results: [],
            },
          });
          await f.db.algorithmOperation.create({
            data: {
              organizationId: f.organization.id,
              userId: f.users.student2.id,
              kind: 'judge',
              submissionId: row.id,
              leaseExpiresAt: new Date(Date.now() - 1000),
            },
          });
          assert.equal((await api.history(other, pid)).items[0].status, 'system_error');
          await f.db.systemSetting.upsert({
            where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
            create: { organizationId: f.organization.id, key: 'features', value: { practice: false } },
            update: { value: { practice: false } },
          });
          await denied(api.load(other, pid), 403);
          await denied(learning.plans(other), 403);
          await denied(learning.analyses(other, pid), 403);
          await denied(learning.posts(other, 'public'), 403);
          await denied(api.execute(other, pid, { language: 'python', code: 'blocked' }, 'run'), 403);
          assert.equal((await api.load(foreign, pid)).draft, null);
          assert.equal(
            await f.db.algorithmSubmission.count({
              where: { organizationId: f.organization.id, userId: f.users.student2.id },
            }),
            1,
          );
        },
      );
      // Retained responses contain neither auth credentials nor another owner's draft.
      assert.ok(!JSON.stringify(submitted!).includes('私有'));
      assert.equal((await f.db.algorithmDraft.findFirstOrThrow({ where: own })).code, '// web private');
    } finally {
      release?.();
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([
          new Promise<void>((resolve) => child!.once('exit', () => resolve())),
          liveWait(5000),
        ]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await new Promise<void>((resolve) => child!.once('exit', () => resolve()));
        }
      }
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await f.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
