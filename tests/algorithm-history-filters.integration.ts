import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPasswordAsync } from '../apps/api/src/auth/password';
import { permissionDefinitions, roleDefinitions } from '../apps/api/src/auth/permissions';

const problemId = 'two-sum-indices';
const endpoint = `/algorithms/problems/${problemId}/submissions`;
const languages = ['cpp', 'python', 'javascript', 'java'] as const;
const statuses = [
  'running',
  'accepted',
  'wrong_answer',
  'compile_error',
  'runtime_error',
  'time_limit',
  'memory_limit',
  'system_error',
] as const;
const kinds = ['submit', 'examples', 'custom'] as const;
type Seed = {
  id: string;
  language: string;
  status: string;
  mode: string;
  customInput: boolean;
  createdAt: Date;
};
type Filter = { kind?: string; language?: string; status?: string };
// Semantic test oracle only: classify each known fixture as a user sees it. No production
// query builder/schema is imported, and expected ordering is computed from known rows.
function expected(rows: Seed[], filter: Filter = {}) {
  return rows
    .filter((row) => {
      const category = row.mode === 'submit' ? 'submit' : row.customInput ? 'custom' : 'examples';
      return (
        (!filter.kind || category === filter.kind) &&
        (!filter.language || row.language === filter.language) &&
        (!filter.status || row.status === filter.status)
      );
    })
    .sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
}

// This suite creates and drops ONLY its own random database. Never seeds, truncates or changes
// users in the developer's configured database, even when it is an existing review database.
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
type Client = { cookie: string; csrf: string; user: any };
async function freePort() {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test('提交历史筛选：独立数据库真实HTTP、稳定分页、隔离和一致快照', { timeout: 180_000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production', '集成测试禁止在production模式运行');
  const configured = process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(
    configured,
    '需要本机PostgreSQL的DATABASE_URL或ACADEMICS_TEST_ADMIN_DATABASE_URL，并具有CREATEDB权限',
  );
  const adminUrl = new URL(configured);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname), '本测试只连接本机PostgreSQL');
  assert.ok(['postgres:', 'postgresql:'].includes(adminUrl.protocol));
  const suffix = randomBytes(8).toString('hex');
  const name = `algorithm_history_it_${suffix}`;
  assert.match(name, /^algorithm_history_it_[a-f0-9]{16}$/);
  const isolatedUrl = new URL(adminUrl);
  isolatedUrl.pathname = `/${name}`;
  // Exercise the service with the same small connection pool used by CI fixtures.
  const apiUrl = new URL(isolatedUrl);
  apiUrl.searchParams.set('connection_limit', '3');
  const password = `Fixture-${randomBytes(20).toString('hex')}!`;
  const safe = (text: string) =>
    [password, configured, isolatedUrl.href, apiUrl.href, decodeURIComponent(adminUrl.password)]
      .filter(Boolean)
      .reduce((value, secret) => value.split(secret).join('[redacted]'), text)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
      .replace(/https?:\/\/[^\s/]+:[^\s@]+@[^\s"']+/gi, '[credential URL redacted]')
      .replace(
        /("(?:csrf[-_]?token|session[-_]?token|token|password|authorization|cookie|set-cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
        '$1"[redacted]"',
      )
      .replace(/lms_session=[^;\s"]+/gi, 'lms_session=[redacted]');
  const port = await freePort();
  const directory = mkdtempSync(join(tmpdir(), 'algorithm-history-http-'));
  const configPath = join(directory, 'config.yaml');
  const owner = new PrismaClient({ datasourceUrl: adminUrl.href });
  let db: PrismaClient | undefined;
  let api: ChildProcess | undefined;
  let migration: ChildProcess | undefined;
  let created = false;
  let logs = '';
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DATABASE_URL: apiUrl.href,
    NODE_ENV: 'test',
    PORT: String(port),
    BIND_HOST: '127.0.0.1',
    APP_ORIGIN: origin,
    COOKIE_SECURE: 'false',
    DISABLE_JOBS: 'true',
    AI_CONFIG_PATH: configPath,
    ALGORITHM_JUDGE_ENABLED: 'false',
    UPLOAD_DIR: join(directory, 'uploads'),
  };
  async function call(
    client: Client | null,
    path: string,
    method = 'GET',
    body?: unknown,
    expected: number | number[] = method === 'POST' ? 201 : 200,
    csrf = true,
  ) {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        origin,
        'content-type': 'application/json',
        ...(client ? { cookie: client.cookie, ...(csrf ? { 'x-csrf-token': client.csrf } : {}) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.ok(
      (Array.isArray(expected) ? expected : [expected]).includes(response.status),
      `${method} ${path}: ${response.status}; ${safe(text).slice(0, 1500)}`,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    };
  }
  async function login(username: string): Promise<Client> {
    const response = await call(null, '/auth/login', 'POST', { username, password });
    return { cookie: response.cookie, csrf: response.body.csrfToken, user: response.body.user };
  }
  async function register(tag: string): Promise<Client> {
    const response = await call(null, '/auth/register', 'POST', {
      username: `academics_${suffix}_${tag}`,
      name: `个人-${tag}`,
      password,
    });
    return { cookie: response.cookie, csrf: response.body.csrfToken, user: response.body.user };
  }
  async function deploy(schema: string) {
    migration = spawn(
      process.execPath,
      [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let migrationLog = '';
    for (const stream of [migration.stdout, migration.stderr])
      stream?.on('data', (chunk: Buffer) => {
        migrationLog = (migrationLog + chunk.toString()).slice(-20_000);
      });
    const migrationTimeout = setTimeout(() => migration?.kill('SIGKILL'), 60_000);
    try {
      const [migrationCode] = await once(migration, 'exit');
      assert.equal(migrationCode, 0, `隔离测试库迁移失败：${safe(migrationLog)}`);
    } finally {
      clearTimeout(migrationTimeout);
    }
  }
  try {
    writeFileSync(
      configPath,
      'judge0: {enabled: false}\nai: {enabled: false}\nwebSearch: {enabled: false}\n',
      { mode: 0o600 },
    );
    try {
      await owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created = true;
    } catch {
      throw new Error(
        '无法创建隔离测试库；请确认本机数据库运行且测试账号具有CREATEDB权限。未修改现有数据库。',
      );
    }
    await deploy(resolve('prisma'));
    db = new PrismaClient({ datasourceUrl: isolatedUrl.href });
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
    const institution = await db.organization.create({ data: { name: '提交历史隔离机构' } });
    const hash = await hashPasswordAsync(password);
    const fixtures = [];
    for (const roleId of ['ADMIN', 'TEACHER', 'STUDENT']) {
      fixtures.push(
        await db.user.create({
          data: {
            username: `history_${suffix}_${roleId.toLowerCase()}`,
            name: roleId,
            organizationId: institution.id,
            passwordHash: hash,
            roles: { create: { roleId } },
          },
        }),
      );
    }
    api = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-80000);
      });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (api.exitCode !== null) throw new Error(`测试API启动失败：${safe(logs)}`);
      try {
        if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) {
          ready = true;
          break;
        }
      } catch {
        /* Waiting only for this suite's child API. */
      }
      await wait(100);
    }
    assert.ok(ready, `独立测试服务未就绪，请先构建API：${safe(logs)}`);
    const [admin, teacher, other] = await Promise.all(fixtures.map((user) => login(user.username)));
    const personal = await register('history_personal');
    const scope = { userId: personal.user.id, organizationId: personal.user.organizationId };
    const rows: Seed[] = [];
    const code = '# OWN_HISTORY_FIXTURE\nprint(42)\n';
    const results = [
      {
        index: 1,
        hidden: false,
        status: 'accepted',
        input: '4 9\n2 7 3 5\n',
        expectedOutput: '0 1\n',
        stdout: '0 1\n',
      },
      { index: 2, hidden: true, status: 'accepted', runtimeMs: 1, memoryKb: 8192 },
    ];
    let ordinal = 0;
    for (const kind of kinds)
      for (const language of languages)
        for (const status of statuses) {
          if (kind === 'custom' && language === 'java' && status === 'memory_limit') continue;
          const row = await db!.algorithmSubmission.create({
            data: {
              ...scope,
              id: `history-${suffix}-${String(ordinal++).padStart(3, '0')}`,
              problemId,
              language,
              status,
              code,
              mode: kind === 'submit' ? 'submit' : 'run',
              customInput: kind === 'custom',
              passed: status === 'accepted' ? (kind === 'submit' ? 2 : 1) : 0,
              total: kind === 'submit' ? 2 : 1,
              results: kind === 'submit' ? results : results.slice(0, 1),
              compileOutput: '',
              createdAt: new Date('2020-01-01T00:00:00.000Z'),
            },
          });
          rows.push(row);
        }
    const query = async (filter: Filter = {}, page = 1, pageSize = 20, client = personal) => {
      const params = new URLSearchParams({ ...filter, page: String(page), pageSize: String(pageSize) });
      return (await call(client, `${endpoint}?${params}`)).body;
    };
    const check = (response: any, filter: Filter = {}, page = 1, pageSize = 20) => {
      const selected = expected(rows, filter);
      assert.equal(response.total, selected.length);
      assert.equal(response.page, page);
      assert.equal(response.pageSize, pageSize);
      assert.deepEqual(
        response.items.map((item: any) => item.id),
        selected.slice((page - 1) * pageSize, page * pageSize).map((item) => item.id),
      );
      for (const key of ['kind', 'language', 'status'] as const) {
        assert.equal(response[key], filter[key]);
        assert.equal(Object.hasOwn(response, key), filter[key] !== undefined);
      }
    };
    await t.test('默认响应维持旧shape，同时间戳多页按创建时间及ID稳定排序且无重复遗漏', async () => {
      const service = (await call(personal, '/algorithms/status')).body;
      assert.equal(service.judge.available, false);
      assert.equal(service.ai.available, false);
      const defaultResponse = (await call(personal, endpoint)).body;
      assert.deepEqual(Object.keys(defaultResponse).sort(), ['items', 'page', 'pageSize', 'total']);
      check(defaultResponse);
      const ids: string[] = [];
      for (let page = 1; page <= Math.ceil(rows.length / 20); page++) {
        const response = await query({}, page);
        check(response, {}, page);
        ids.push(...response.items.map((item: any) => item.id));
      }
      assert.deepEqual(
        ids,
        expected(rows).map((item) => item.id),
      );
      assert.equal(new Set(ids).size, rows.length);
      check(await query({}, 10000, 50), {}, 10000, 50);
    });
    await t.test('全部八种状态、四种语言和三种运行类型及96个组合按独立语义oracle过滤', async () => {
      for (const kind of kinds) check(await query({ kind }), { kind });
      for (const language of languages) check(await query({ language }), { language });
      for (const status of statuses) check(await query({ status }), { status });
      for (const kind of kinds)
        for (const language of languages)
          for (const status of statuses) {
            const filter = { kind, language, status };
            check(await query(filter), filter);
          }
    });
    await t.test('联合条件先筛选再分页，空集与超末页保留正确匹配总数', async () => {
      const filter = { kind: 'submit', language: 'cpp' };
      for (const page of [1, 2, 3, 4]) check(await query(filter, page, 3), filter, page, 3);
      const empty = { kind: 'custom', language: 'java', status: 'memory_limit' };
      const response = await query(empty, 1, 8);
      check(response, empty, 1, 8);
      assert.equal(response.total, 0);
      assert.deepEqual(response.items, []);
      check(await query({ status: 'accepted' }, 10000, 1), { status: 'accepted' }, 10000, 1);
      for (const spelling of ['2.0', '%2B2', '2e0']) {
        const valid = (await call(personal, `${endpoint}?page=${spelling}&pageSize=1`)).body;
        check(valid, {}, 2, 1);
      }
    });
    await t.test('未知键、空筛选、重复query、数组对象和非法分页不能被静默忽略', async () => {
      const before = await db!.algorithmSubmission.count();
      const invalid = [
        'kind=all',
        'kind=',
        'kind=%20',
        'kind=run',
        'language=all',
        'language=',
        'language=Python',
        'status=all',
        'status=',
        'status=passed',
        'unknown=1',
        'userId=other',
        'organizationId=other',
        'page=0',
        'page=10001',
        'page=1.5',
        'page=',
        'page=true',
        'pageSize=0',
        'pageSize=51',
        'pageSize=false',
        'pageSize=NaN',
      ];
      for (const key of ['kind', 'language', 'status', 'page', 'pageSize']) {
        const value = (
          { kind: 'submit', language: 'cpp', status: 'accepted', page: '1', pageSize: '20' } as Record<
            string,
            string
          >
        )[key];
        invalid.push(
          `${key}=${value}&${key}=${value}`,
          `${key}[]=${value}`,
          `${key}[0]=${value}`,
          `${key}[value]=${value}`,
        );
      }
      for (const query of invalid) await call(personal, `${endpoint}?${query}`, 'GET', undefined, 400);
      assert.equal(await db!.algorithmSubmission.count(), before);
    });
    await t.test('权限校验不被新筛选绕过，教师管理员匿名或已关闭练习均不可读取', async () => {
      for (const account of [admin, teacher])
        await call(account, `${endpoint}?kind=submit&status=accepted`, 'GET', undefined, 403);
      await call(null, endpoint, 'GET', undefined, 401);
      await db!.systemSetting.create({
        data: { organizationId: scope.organizationId, key: 'features', value: { practice: false } },
      });
      try {
        await call(personal, `${endpoint}?language=python`, 'GET', undefined, 403);
      } finally {
        await db!.systemSetting.deleteMany({
          where: { organizationId: scope.organizationId, key: 'features' },
        });
      }
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
      });
      try {
        await call(personal, `${endpoint}?status=accepted`, 'GET', undefined, 403);
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'learning.use' } });
      }
    });
    await t.test('相同筛选仍隔离他人/其他空间/其他题目，正式历史隐藏结果无内容字段', async () => {
      const foreign = [];
      for (const extra of [
        { userId: other.user.id, organizationId: other.user.organizationId },
        { organizationId: institution.id },
        { problemId: 'first-position' },
      ]) {
        foreign.push(
          await db!.algorithmSubmission.create({
            data: {
              ...scope,
              problemId,
              language: 'cpp',
              mode: 'submit',
              status: 'accepted',
              code: 'OTHER_SCOPE_SOURCE',
              results: [],
              ...extra,
            },
          }),
        );
      }
      check(await query({ kind: 'submit', language: 'cpp', status: 'accepted' }), {
        kind: 'submit',
        language: 'cpp',
        status: 'accepted',
      });
      const own = expected(rows, { kind: 'submit', language: 'cpp', status: 'accepted' })[0];
      await call(other, `/algorithms/submissions/${own.id}`, 'GET', undefined, 404);
      for (const item of foreign.slice(0, 2))
        await call(personal, `/algorithms/submissions/${item.id}`, 'GET', undefined, 404);
      assert.equal(
        (await call(personal, `/algorithms/submissions/${foreign[2].id}`)).body.problemId,
        'first-position',
      );
      assert.equal((await query({}, 1, 20, other)).total, 1);
      for (const record of (await query({ kind: 'submit' }, 1, 50)).items) {
        const hidden = record.results.filter((result: any) => result.hidden);
        assert.equal(hidden.length, 1);
        for (const key of ['input', 'expectedOutput', 'stdout', 'stderr', 'message', 'compileOutput'])
          assert.equal(hidden[0][key], undefined);
        assert.equal(record.compileOutput, '');
      }
    });
    await t.test('只读筛选不修改草稿/语言/学习笔记，不新增执行或提升已解决题目数', async () => {
      await db!.algorithmDraft.create({
        data: { ...scope, problemId, language: 'javascript', code: '// untouched private draft' },
      });
      await db!.algorithmLearningState.create({
        data: { ...scope, problemId, note: 'PRIVATE_NOTE', revision: 7, reviewStatus: 'review' },
      });
      const before = {
        draft: await db!.algorithmDraft.findMany({ where: scope }),
        notes: await db!.algorithmLearningState.findMany({ where: scope }),
        submissions: await db!.algorithmSubmission.count(),
        operations: await db!.algorithmOperation.count(),
        analyses: await db!.algorithmAnalysis.count(),
        solved: (await call(personal, '/algorithms/overview')).body.stats.solved,
      };
      for (const kind of kinds) await query({ kind, status: 'accepted' });
      assert.deepEqual(await db!.algorithmDraft.findMany({ where: scope }), before.draft);
      assert.deepEqual(await db!.algorithmLearningState.findMany({ where: scope }), before.notes);
      assert.equal(await db!.algorithmSubmission.count(), before.submissions);
      assert.equal(await db!.algorithmOperation.count(), before.operations);
      assert.equal(await db!.algorithmAnalysis.count(), before.analyses);
      assert.equal((await call(personal, '/algorithms/overview')).body.stats.solved, before.solved);
    });
    await t.test('过期running恢复后再过滤，未过期记录仍running且不新增操作', async () => {
      const recovery = await register('recovery');
      const recoveryScope = { organizationId: recovery.user.organizationId, userId: recovery.user.id };
      const createPending = async (tag: string, leaseExpiresAt: Date) => {
        const submission = await db!.algorithmSubmission.create({
          data: {
            ...recoveryScope,
            problemId,
            language: 'python',
            code: `# ${tag}`,
            mode: 'submit',
            status: 'running',
            results: [],
          },
        });
        const operation = await db!.algorithmOperation.create({
          data: {
            ...recoveryScope,
            kind: 'judge',
            submissionId: submission.id,
            status: 'pending',
            leaseExpiresAt,
          },
        });
        return { submission, operation };
      };
      const expired = await createPending('expired', new Date(Date.now() - 60000));
      // Recover the only pending operation before creating another for this owner:
      // the production gate correctly permits at most one pending judge operation.
      const recovered = await query({ status: 'system_error' }, 1, 50, recovery);
      assert.equal(recovered.total, 1);
      assert.equal(recovered.items[0].id, expired.submission.id);
      assert.ok(recovered.items[0].error.length > 0);
      assert.equal(
        (await db!.algorithmOperation.findUniqueOrThrow({ where: { id: expired.operation.id } })).status,
        'failed',
      );
      assert.equal(await db!.algorithmSubmission.count({ where: recoveryScope }), 1);
      assert.equal(await db!.algorithmOperation.count({ where: recoveryScope }), 1);
      const active = await createPending('active', new Date(Date.now() + 3600000));
      const running = await query({ status: 'running' }, 1, 50, recovery);
      assert.equal(running.total, 1);
      assert.equal(running.items[0].id, active.submission.id);
      const failed = await query({ status: 'system_error' }, 1, 50, recovery);
      assert.equal(failed.total, 1);
      assert.equal(failed.items[0].id, expired.submission.id);
      assert.ok(failed.items[0].error.length > 0);
      assert.equal(
        (await db!.algorithmOperation.findUniqueOrThrow({ where: { id: expired.operation.id } })).status,
        'failed',
      );
      assert.equal(
        (await db!.algorithmOperation.findUniqueOrThrow({ where: { id: active.operation.id } })).status,
        'pending',
      );
      assert.equal(await db!.algorithmSubmission.count({ where: recoveryScope }), 2);
      assert.equal(await db!.algorithmOperation.count({ where: recoveryScope }), 2);
      assert.equal((await call(recovery, '/algorithms/overview')).body.stats.solved, 0);
    });
    await t.test('并发整批状态改变时每个筛选响应items与total来自同一数据库快照', async () => {
      const concurrent = await register('concurrent');
      const concurrentScope = { organizationId: concurrent.user.organizationId, userId: concurrent.user.id };
      await db!.algorithmSubmission.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          ...concurrentScope,
          problemId,
          language: 'javascript',
          code: `// snapshot ${i}`,
          mode: 'run',
          customInput: true,
          status: 'wrong_answer',
          results: [],
        })),
      });
      let updates = 0;
      const observations: number[] = [];
      // Each read permits exactly two concurrent atomic batch updates, then both branches
      // must finish before the next round. Writes therefore cannot finish before all reads
      // begin. This exercises overlap without claiming a commit lands between specific SQLs.
      for (let round = 0; round < 20; round++) {
        const before = updates;
        const read = query(
          { kind: 'custom', language: 'javascript', status: 'accepted' },
          1,
          50,
          concurrent,
        ).then((response) => {
          observations.push(updates);
          return response;
        });
        const change = async () => {
          for (const status of ['accepted', 'wrong_answer']) {
            await db!.algorithmSubmission.updateMany({
              where: { ...concurrentScope, problemId },
              data: { status },
            });
            updates++;
          }
        };
        const [response] = await Promise.all([read, change()]);
        assert.equal(updates, before + 2, 'Two writes belong to each coordinated read window');
        assert.equal(
          response.total,
          response.items.length,
          'A bounded set fits one page; count and items must describe one snapshot',
        );
        assert.ok([0, 20].includes(response.total), 'Whole-batch update is atomic');
        assert.ok(
          response.items.every(
            (item: any) => item.status === 'accepted' && item.customInput && item.language === 'javascript',
          ),
        );
      }
      assert.equal(observations.length, 20);
      assert.ok(
        observations.filter((count) => count < 40).length >= 19,
        'Responses are observed while later writes remain scheduled',
      );
      assert.equal(updates, 40);
      assert.equal(await db!.algorithmOperation.count({ where: concurrentScope }), 0);
      assert.equal(
        (await call(concurrent, '/algorithms/overview')).body.stats.solved,
        0,
        'Accepted custom runs cannot solve a problem',
      );
    });
    assert.ok(!logs.includes(password), 'API日志不能包含测试密码');
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : '集成验收失败'));
  } finally {
    const cleanupErrors: string[] = [];
    for (const child of [api, migration]) {
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) continue;
      try {
        const exit = once(child, 'exit');
        child.kill('SIGTERM');
        await Promise.race([exit, wait(3000)]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await Promise.race([exit, wait(1000)]);
        }
        assert.ok(child.exitCode !== null || child.signalCode !== null);
      } catch {
        cleanupErrors.push('Owned child did not stop');
      }
    }
    try {
      await db?.$disconnect();
    } catch {
      cleanupErrors.push('Owned database client cleanup failed');
    }
    if (created)
      try {
        assert.match(name, /^algorithm_history_it_[a-f0-9]{16}$/);
        await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      } catch {
        cleanupErrors.push('Owned random database cleanup failed');
      }
    try {
      await owner.$disconnect();
    } catch {
      cleanupErrors.push('Owner database client cleanup failed');
    }
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      cleanupErrors.push('Owned temp directory cleanup failed');
    }
    assert.deepEqual(cleanupErrors, [], 'Only resources created by this suite are cleaned up');
  }
});
