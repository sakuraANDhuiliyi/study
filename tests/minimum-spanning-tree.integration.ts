import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createTcpServer } from 'node:net';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPasswordAsync } from '../apps/api/src/auth/password';
import { permissionDefinitions, roleDefinitions } from '../apps/api/src/auth/permissions';
import { getAlgorithmProblem } from '../apps/api/src/algorithms/algorithms.catalog';
import { solveMstInput } from './helpers/minimum-spanning-tree-oracle';

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const problemId = 'minimum-spanning-tree';
const base = `/algorithms/problems/${problemId}`;
type Client = { cookie: string; csrf: string; user: any };
async function freePort() {
  const server = createTcpServer();
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exit, wait(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exit, wait(1000)]);
  }
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'Owned API/migration must stop');
}

// The loopback Judge0 fixture exercises the HTTP protocol only. It never executes supplied
// source code. Real compilation of trusted built-in references is verified by a separate script.
test('最小生成树：独立数据库、Judge0协议、真实HTTP与学习进度', { timeout: 180000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  const configured = process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(configured, 'Local PostgreSQL owner connection with CREATEDB is required');
  const adminUrl = new URL(configured);
  assert.ok(['postgres:', 'postgresql:'].includes(adminUrl.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname));
  const suffix = randomBytes(8).toString('hex'),
    databaseName = `minimum_spanning_tree_it_${suffix}`;
  assert.match(databaseName, /^minimum_spanning_tree_it_[a-f0-9]{16}$/);
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set('connection_limit', '3');
  const password = `Mst-${randomBytes(24).toString('base64url')}!`,
    token = randomBytes(24).toString('hex');
  const secrets = new Set(
    [password, token, configured, adminUrl.href, url.href, decodeURIComponent(adminUrl.password)].filter(
      Boolean,
    ),
  );
  const safe = (text: string) =>
    [...secrets]
      .reduce((value, secret) => value.split(secret).join('[redacted]'), text)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
      .replace(/https?:\/\/[^\s/]+:[^\s@]+@[^\s"']+/gi, '[credential URL redacted]')
      .replace(
        /("(?:csrf[-_]?token|session[-_]?token|token|password|authorization|cookie|set-cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
        '$1"[redacted]"',
      )
      .replace(/lms_session=[^;\s"]+/gi, 'lms_session=[redacted]');
  const directory = mkdtempSync(join(tmpdir(), 'minimum-spanning-tree-http-'));
  const owner = new PrismaClient({ datasourceUrl: adminUrl.href });
  let db: PrismaClient | undefined, api: ChildProcess | undefined, migration: ChildProcess | undefined;
  let created = false,
    logs = '',
    calls = 0;
  const tokens = new Map<string, string>();
  const fixtureErrors: string[] = [];
  const protocol = createServer(async (request, response) => {
    try {
      assert.equal(request.headers['x-auth-token'], token, 'Fixture authentication required');
      const path = new URL(request.url || '/', 'http://127.0.0.1');
      assert.equal(path.searchParams.get('base64_encoded'), 'true');
      if (request.method === 'POST' && path.pathname === '/submissions') {
        let raw = '';
        for await (const chunk of request) {
          raw += chunk;
          assert.ok(raw.length <= 8 * 1048576);
        }
        const body = JSON.parse(raw);
        assert.equal(body.enable_network, false);
        assert.equal(body.expected_output, undefined);
        assert.equal(body.callback_url, undefined);
        assert.ok(body.cpu_time_limit > 0 && body.memory_limit > 0 && body.max_processes_and_or_threads > 0);
        assert.equal(body.language_id, 71);
        const code = Buffer.from(body.source_code, 'base64').toString('utf8');
        const input = Buffer.from(body.stdin, 'base64').toString('utf8');
        // Source marker selects fixture outcome, never a host subprocess or interpreter.
        const output = code.includes('FIXTURE_WRONG') ? '987654321012345\n' : `${solveMstInput(input)}\n`;
        const id = randomUUID();
        tokens.set(id, output);
        calls++;
        response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ token: id }));
      } else if (request.method === 'GET' && path.pathname.startsWith('/submissions/')) {
        const output = tokens.get(path.pathname.split('/').at(-1)!);
        assert.notEqual(output, undefined);
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            status: { id: 3, description: 'Accepted' },
            stdout: Buffer.from(output!).toString('base64'),
            stderr: null,
            compile_output: null,
            time: '0.012',
            memory: 8192,
            exit_code: 0,
            exit_signal: null,
          }),
        );
      } else response.writeHead(404).end();
    } catch (error) {
      fixtureErrors.push(safe(error instanceof Error ? error.message : 'Fixture assertion failed'));
      response.writeHead(500).end('{}');
    }
  });
  let origin = '';
  async function call(
    client: Client | null,
    path: string,
    method = 'GET',
    body?: unknown,
    status = method === 'POST' ? 201 : 200,
    csrf = true,
  ) {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      signal: AbortSignal.timeout(30000),
      headers: {
        origin,
        'content-type': 'application/json',
        ...(client ? { cookie: client.cookie, ...(csrf ? { 'x-csrf-token': client.csrf } : {}) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${safe(text).slice(0, 1000)}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = text ? JSON.parse(text) : null;
    const cookie = response.headers
      .getSetCookie()
      .map((item) => item.split(';')[0])
      .join('; ');
    if (cookie) secrets.add(cookie);
    if (result?.csrfToken) secrets.add(result.csrfToken);
    return { body: result, cookie };
  }
  async function register(tag: string): Promise<Client> {
    const response = await call(null, '/auth/register', 'POST', {
      username: `mst_${suffix}_${tag}`,
      password,
      name: `生成树-${tag}`,
    });
    return { cookie: response.cookie, csrf: response.body.csrfToken, user: response.body.user };
  }
  try {
    await new Promise<void>((done, reject) => {
      protocol.once('error', reject);
      protocol.listen(0, '127.0.0.1', done);
    });
    const judgeUrl = `http://127.0.0.1:${(protocol.address() as { port: number }).port}`;
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const configPath = join(directory, 'config.yaml');
    writeFileSync(
      configPath,
      `judge0:\n  enabled: true\n  baseUrl: '${judgeUrl}'\n  apiKey: '${token}'\n  timeoutMs: 45000\n  pollMs: 10\nai: {enabled: false}\nwebSearch: {enabled: false}\n`,
      { mode: 0o600 },
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: url.href,
      NODE_ENV: 'test',
      PORT: String(port),
      BIND_HOST: '127.0.0.1',
      APP_ORIGIN: origin,
      COOKIE_SECURE: 'false',
      DISABLE_JOBS: 'true',
      AI_CONFIG_PATH: configPath,
      UPLOAD_DIR: join(directory, 'uploads'),
    };
    // A real provider URL/token from the caller must never override the private YAML fixture.
    for (const key of Object.keys(env)) if (key.startsWith('ALGORITHM_JUDGE_')) delete env[key];
    try {
      await owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
      created = true;
    } catch {
      throw new Error('Unable to create the isolated local test database; existing data was not changed');
    }
    migration = spawn(
      process.execPath,
      [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma')],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let migrationLog = '';
    for (const stream of [migration.stdout, migration.stderr])
      stream?.on('data', (chunk: Buffer) => {
        migrationLog = (migrationLog + chunk.toString()).slice(-16000);
      });
    const timer = setTimeout(() => migration?.kill('SIGKILL'), 60000);
    try {
      const [code] = await once(migration, 'exit');
      assert.equal(code, 0, safe(migrationLog));
    } finally {
      clearTimeout(timer);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    await db.permission.createMany({
      data: permissionDefinitions.map(([id, name, sensitive]) => ({ id, name, sensitive })),
      skipDuplicates: true,
    });
    for (const [id, role] of Object.entries(roleDefinitions)) {
      await db.role.upsert({
        where: { id },
        create: { id, name: role.name, description: role.description },
        update: {},
      });
      await db.rolePermission.createMany({
        data: role.permissions.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true,
      });
    }
    const institution = await db.organization.create({ data: { name: '生成树隔离验收机构' } });
    const teacherUser = await db.user.create({
      data: {
        username: `mst_${suffix}_teacher`,
        name: '教师',
        organizationId: institution.id,
        passwordHash: await hashPasswordAsync(password),
        roles: { create: { roleId: 'TEACHER' } },
      },
    });
    api = spawn(process.execPath, [resolve('apps/api/dist/main.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-16000);
      });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (api.exitCode !== null) throw new Error(`Owned API stopped: ${safe(logs)}`);
      try {
        if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) {
          ready = true;
          break;
        }
      } catch {
        /* own API starting */
      }
      await wait(100);
    }
    assert.ok(ready, `Owned compiled API not ready: ${safe(logs)}`);
    const student = await register('student'),
      other = await register('other');
    const response = await call(null, '/auth/login', 'POST', { username: teacherUser.username, password });
    const teacher: Client = {
      cookie: response.cookie,
      csrf: response.body.csrfToken,
      user: response.body.user,
    };
    const scope = { organizationId: student.user.organizationId, userId: student.user.id };
    const canonical = getAlgorithmProblem(problemId)!;
    const source = {
      language: 'python',
      code: '# FIXTURE_PRIM_SUCCESS\n# Protocol fixture does not execute this program.\n',
    };
    const overview = async () => (await call(student, '/algorithms/overview')).body;
    const plan = async () => (await overview()).plans.find((item: any) => item.id === 'trees-graphs');
    const beforeIds = [
      'binary-tree-depth',
      'island-count',
      'connected-components',
      'course-order',
      'shortest-path',
    ];
    await db.algorithmSubmission.createMany({
      data: beforeIds.map((id) => ({
        ...scope,
        problemId: id,
        language: 'python',
        code: '# Previously accepted fixture',
        mode: 'submit',
        status: 'accepted',
        passed: 1,
        total: 1,
        results: [],
        createdAt: new Date('2020-01-01'),
      })),
    });
    let accepted: any;
    await t.test('公开元数据及第03章真实链接完整，隐藏用例和密钥不泄露', async () => {
      const status = (await call(student, '/algorithms/status')).body;
      assert.equal(status.judge.available, true);
      assert.equal(status.ai.available, false);
      assert.ok(!JSON.stringify(status).includes(token) && !JSON.stringify(status).includes(judgeUrl));
      const list = (await call(student, '/algorithms/problems?q=最小生成树&pageSize=50')).body;
      assert.equal(list.total, 1);
      assert.equal(list.items[0].id, problemId);
      assert.equal(list.items[0].number, 19);
      const detail = (await call(student, base)).body;
      assert.equal(detail.title, '最小生成树总权');
      for (const key of ['inputFormat', 'outputFormat', 'constraints']) assert.ok(detail[key].length > 10);
      assert.deepEqual(detail.examples, canonical.examples);
      for (const key of ['testCases', 'solution', 'hints']) assert.equal(detail[key], undefined);
      for (const item of canonical.testCases.filter((item) => item.hidden))
        assert.ok(!JSON.stringify(detail).includes(JSON.stringify(item.input)));
      const route = await plan();
      assert.equal(route.total, 6);
      assert.equal(route.solved, 5);
      assert.equal(route.estimatedDays, 16);
      assert.equal(route.chapters[2].title, '全图连接与贪心');
      assert.deepEqual(
        route.chapters[2].problems.map((item: any) => item.id),
        [problemId],
      );
      assert.equal(route.nextProblemId, problemId);
      for (const item of route.chapters.flatMap((chapter: any) => chapter.problems))
        assert.equal((await call(student, `/algorithms/problems/${item.id}`)).body.id, item.id);
    });
    await t.test('教师、缺少CSRF与非法提交字段不能触发判题或新增记录', async () => {
      const count = await db!.algorithmSubmission.count(),
        before = calls;
      await call(teacher, base, 'GET', undefined, 403);
      await call(teacher, `${base}/editorial`, 'GET', undefined, 403);
      await call(student, `${base}/submissions`, 'POST', { ...source, mode: 'submit' }, 403, false);
      for (const body of [
        { ...source, mode: 'submit', stdin: '1 0\n' },
        { ...source, mode: 'submit', userId: other.user.id },
        { ...source, language: 'shell', mode: 'run' },
      ])
        await call(student, `${base}/submissions`, 'POST', body, 400);
      assert.equal(calls, before);
      assert.equal(await db!.algorithmSubmission.count(), count);
    });
    await t.test('公开样例与自定义运行正常，但不改变五题已解决的学习计划', async () => {
      const sample = (await call(student, `${base}/submissions`, 'POST', { ...source, mode: 'run' })).body;
      assert.equal(sample.status, 'accepted');
      assert.equal(sample.total, 3);
      assert.deepEqual(
        sample.results.map((item: any) => item.stdout.trim()),
        ['8', 'IMPOSSIBLE', '-1'],
      );
      assert.ok(sample.results.every((item: any) => item.hidden === false));
      const custom = (
        await call(student, `${base}/submissions`, 'POST', {
          ...source,
          mode: 'run',
          stdin: '1 1\n1 1 -1000000000\n',
        })
      ).body;
      assert.equal(custom.status, 'accepted');
      assert.equal(custom.customInput, true);
      assert.equal(custom.results[0].stdout, '0\n');
      assert.equal(custom.results[0].expectedOutput, undefined);
      assert.equal((await plan()).solved, 5);
      assert.equal((await plan()).nextProblemId, problemId);
    });
    await t.test('正式错误不解决，正式全通过从5/6到6/6，重复通过不重复增加', async () => {
      const wrong = (
        await call(student, `${base}/submissions`, 'POST', {
          ...source,
          code: '# FIXTURE_WRONG',
          mode: 'submit',
        })
      ).body;
      assert.equal(wrong.status, 'wrong_answer');
      assert.equal(wrong.passed, 0);
      assert.equal((await plan()).solved, 5);
      const before = calls;
      accepted = (await call(student, `${base}/submissions`, 'POST', { ...source, mode: 'submit' })).body;
      assert.equal(accepted.status, 'accepted');
      assert.equal(accepted.passed, 10);
      assert.equal(accepted.total, 10);
      assert.equal(calls - before, 10);
      assert.equal(accepted.customInput, false);
      assert.equal(accepted.mode, 'submit');
      assert.equal((await plan()).solved, 6);
      assert.equal((await plan()).nextProblemId, null);
      assert.equal((await overview()).stats.solved, 6);
      await call(student, `${base}/submissions`, 'POST', { ...source, mode: 'submit' });
      assert.equal((await plan()).solved, 6);
      assert.equal((await overview()).stats.solved, 6);
    });
    await t.test('隐藏数据在即时响应、历史列表与详情中始终被剥离', async () => {
      const detail = (await call(student, `/algorithms/submissions/${accepted.id}`)).body;
      const history = (await call(student, `${base}/submissions`)).body;
      for (const record of [
        accepted,
        detail,
        ...history.items.filter((item: any) => item.mode === 'submit'),
      ]) {
        assert.equal(record.results.filter((item: any) => item.hidden).length, 7);
        for (const result of record.results.filter((item: any) => item.hidden)) {
          for (const key of ['input', 'expectedOutput', 'stdout', 'stderr', 'message', 'compileOutput'])
            assert.equal(result[key], undefined);
          assert.ok(['accepted', 'wrong_answer'].includes(result.status));
        }
        assert.equal(record.compileOutput, '');
      }
      assert.deepEqual(
        (await db!.algorithmSubmission.findUniqueOrThrow({ where: { id: accepted.id } })).results,
        accepted.results,
      );
    });
    await t.test('四语言完整题解真实返回，个人草稿/笔记CAS与跨账号跨空间隔离', async () => {
      const content = (await call(student, `${base}/editorial`)).body;
      assert.equal(content.editorial.problemId, problemId);
      assert.deepEqual(Object.keys(content.editorial.referenceCode).sort(), [
        'cpp',
        'java',
        'javascript',
        'python',
      ]);
      assert.ok(content.editorial.approaches.length >= 2 && content.editorial.hints.length === 3);
      for (const program of Object.values(content.editorial.referenceCode))
        assert.ok(typeof program === 'string' && program.length > 200);
      assert.deepEqual(content.relatedProblems.map((item: any) => item.id).sort(), [
        'connected-components',
        'shortest-path',
      ]);
      await call(student, `${base}/draft`, 'PUT', source);
      const note = '合法总权 -1；自环不能入树；边权总和使用64位。\n<script>literal</script>';
      const state = (
        await call(student, `${base}/learning`, 'PATCH', {
          revision: 0,
          note,
          favorite: true,
          reviewStatus: 'review',
        })
      ).body;
      assert.equal(state.note, note);
      assert.equal(state.revision, 1);
      await call(student, `${base}/learning`, 'PATCH', { revision: 0, note: 'stale' }, 409);
      assert.equal((await call(student, base)).body.draft.code, source.code);
      assert.equal((await call(student, `${base}/learning`)).body.note, note);
      assert.equal((await call(other, base)).body.draft, null);
      assert.equal((await call(other, `${base}/learning`)).body.note, '');
      assert.equal((await call(other, `${base}/submissions`)).body.total, 0);
      await call(other, `/algorithms/submissions/${accepted.id}`, 'GET', undefined, 404);
      const foreign = await db!.algorithmSubmission.create({
        data: {
          ...scope,
          organizationId: institution.id,
          problemId,
          ...source,
          mode: 'submit',
          status: 'accepted',
          results: [],
          total: 10,
          passed: 10,
        },
      });
      await db!.algorithmLearningState.create({
        data: { ...scope, organizationId: institution.id, problemId, note: 'OTHER_SPACE', favorite: false },
      });
      await call(student, `/algorithms/submissions/${foreign.id}`, 'GET', undefined, 404);
      assert.ok(
        !(await call(student, `${base}/submissions`)).body.items.some((item: any) => item.id === foreign.id),
      );
      assert.equal((await call(student, `${base}/learning`)).body.note, note);
    });
    await t.test('关闭练习功能会禁止新题与题解，且不会访问本地Judge协议服务', async () => {
      const before = calls;
      await db!.systemSetting.create({
        data: { organizationId: scope.organizationId, key: 'features', value: { practice: false } },
      });
      await call(student, base, 'GET', undefined, 403);
      await call(student, `${base}/editorial`, 'GET', undefined, 403);
      await call(student, `${base}/submissions`, 'POST', { ...source, mode: 'submit' }, 403);
      assert.equal(calls, before);
    });
    assert.deepEqual(fixtureErrors, []);
    assert.ok(!logs.includes(password) && !logs.includes(token));
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : 'MST integration failed'));
  } finally {
    const errors: string[] = [];
    for (const child of [api, migration])
      try {
        await stop(child);
      } catch {
        errors.push('Owned child cleanup failed');
      }
    try {
      await db?.$disconnect();
    } catch {
      errors.push('Owned database client cleanup failed');
    }
    if (created)
      try {
        assert.match(databaseName, /^minimum_spanning_tree_it_[a-f0-9]{16}$/);
        await owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      } catch {
        errors.push('Owned random database cleanup failed');
      }
    try {
      await owner.$disconnect();
    } catch {
      errors.push('Owner client cleanup failed');
    }
    try {
      protocol.closeAllConnections();
      if (protocol.listening)
        await new Promise<void>((done, reject) =>
          protocol.close((error) => (error ? reject(error) : done())),
        );
    } catch {
      errors.push('Owned protocol fixture cleanup failed');
    }
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      errors.push('Owned temp directory cleanup failed');
    }
    assert.deepEqual(errors, [], 'Only resources owned by this suite are cleaned up');
  }
});
