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

// Only the random database created by this suite is migrated, seeded or dropped. The
// explicitly selected local review database supplies CREATEDB access, never fixture data.
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const endpoint = '/admin/jobs';
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

test('后台任务只读筛选：独立数据库真实HTTP、机构范围与精确状态统计', { timeout: 180_000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production', '集成测试禁止在production模式运行');
  const configured =
    process.env.ADMIN_JOBS_TEST_ADMIN_DATABASE_URL ||
    process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL ||
    (process.env.DOTENV_CONFIG_PATH && process.env.DATABASE_URL);
  assert.ok(
    configured,
    '需要显式本机review/test数据库：ADMIN_JOBS_TEST_ADMIN_DATABASE_URL、ACADEMICS_TEST_ADMIN_DATABASE_URL或DOTENV_CONFIG_PATH',
  );
  let adminUrl: URL;
  try {
    adminUrl = new URL(configured);
  } catch {
    throw new Error('测试管理员数据库URL格式无效');
  }
  assert.ok(['postgres:', 'postgresql:'].includes(adminUrl.protocol), '只允许PostgreSQL连接');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname), '只连接本机PostgreSQL');
  assert.match(
    adminUrl.pathname,
    /review|test|clean/i,
    '管理员连接也必须显式选择本机review/test/clean数据库',
  );
  const suffix = randomBytes(8).toString('hex');
  const databaseName = `admin_jobs_it_${suffix}`;
  assert.match(databaseName, /^admin_jobs_it_[a-f0-9]{16}$/);
  const isolatedUrl = new URL(adminUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  const apiUrl = new URL(isolatedUrl);
  apiUrl.searchParams.set('connection_limit', '3');
  const password = `Fixture-${randomBytes(20).toString('hex')}!`;
  const safe = (value: string) =>
    [password, configured, isolatedUrl.href, apiUrl.href, decodeURIComponent(adminUrl.password)]
      .filter(Boolean)
      .reduce((text, secret) => text.split(secret).join('[redacted]'), value)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
      .replace(/https?:\/\/[^\s/]+:[^\s@]+@[^\s"']+/gi, '[credential URL redacted]')
      .replace(
        /("(?:csrf[-_]?token|session[-_]?token|token|password|authorization|cookie|set-cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
        '$1"[redacted]"',
      )
      .replace(/lms_session=[^;\s"]+/gi, 'lms_session=[redacted]');
  const port = await freePort();
  const directory = mkdtempSync(join(tmpdir(), 'admin-jobs-http-'));
  const configPath = join(directory, 'config.yaml');
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
    ALGORITHM_JUDGE_URL: '',
    ALGORITHM_JUDGE_TOKEN: '',
    PROGRAMMING_PREVIEW_ENABLED: 'false',
    UPLOAD_DIR: join(directory, 'uploads'),
    ADMIN_JOBS_FIXTURE_TIME: '2028-12-31T10:15:00.000Z',
  };
  const owner = new PrismaClient({ datasourceUrl: adminUrl.href });
  let db: PrismaClient | undefined;
  let api: ChildProcess | undefined;
  let migration: ChildProcess | undefined;
  let created = false;
  let logs = '';
  async function call(
    client: Client | null,
    path: string,
    method = 'GET',
    body?: unknown,
    expected: number | number[] = method === 'POST' ? 201 : 200,
    csrf = true,
    requestOrigin = origin,
  ) {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        origin: requestOrigin,
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
  async function stop(child: ChildProcess | undefined) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, wait(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([exited, wait(1000)]);
    }
  }
  async function deploy() {
    migration = spawn(
      process.execPath,
      [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma')],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    for (const stream of [migration.stdout, migration.stderr])
      stream?.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-20000);
      });
    const timeout = setTimeout(() => migration?.kill('SIGKILL'), 60_000);
    try {
      const [code] = await once(migration, 'exit');
      assert.equal(code, 0, `隔离测试库迁移失败：${safe(output)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  try {
    writeFileSync(
      configPath,
      'judge0: {enabled: false}\nai: {enabled: false}\nwebSearch: {enabled: false}\n',
      {
        mode: 0o600,
      },
    );
    try {
      await owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
      created = true;
    } catch {
      throw new Error('无法创建随机测试库；请检查本机PostgreSQL及CREATEDB权限。未修改现有数据库。');
    }
    await deploy();
    db = new PrismaClient({ datasourceUrl: isolatedUrl.href });
    await db.permission.createMany({
      data: permissionDefinitions.map(([id, name, sensitive]) => ({ id, name, sensitive })),
      skipDuplicates: true,
    });
    for (const [id, role] of Object.entries(roleDefinitions)) {
      await db.role.create({ data: { id, name: role.name, description: role.description } });
      await db.rolePermission.createMany({
        data: role.permissions.map((permissionId) => ({ roleId: id, permissionId })),
      });
    }
    const organization = await db.organization.create({ data: { name: '后台任务验收机构甲' } });
    const foreign = await db.organization.create({ data: { name: '后台任务验收机构乙', active: false } });
    const personal = await db.organization.create({
      data: { name: '后台任务验收个人空间', kind: 'PERSONAL' },
    });
    for (const [id, permissions] of [
      ['JOBS_READ', ['audit.read']],
      ['JOBS_PLATFORM', ['audit.read', 'org.platform']],
      ['JOBS_EMPTY', []],
    ] as const) {
      await db.role.create({ data: { id, name: id, description: '仅隔离随机测试库角色' } });
      if (permissions.length)
        await db.rolePermission.createMany({
          data: permissions.map((permissionId) => ({ roleId: id, permissionId })),
        });
    }
    const hash = await hashPasswordAsync(password);
    const makeUser = async (tag: string, roleId = 'STUDENT', organizationId = organization.id) =>
      db!.user.create({
        data: {
          username: `jobs_${suffix}_${tag}`,
          name: tag,
          organizationId,
          passwordHash: hash,
          roles: { create: { roleId } },
        },
      });
    const fixtures = await Promise.all([
      makeUser('ordinary', 'JOBS_READ'),
      makeUser('platform', 'JOBS_PLATFORM'),
      makeUser('no-read', 'JOBS_EMPTY'),
    ]);
    // DISABLE_JOBS currently disables only AssessmentService's timer. Disable
    // this suite-owned child's common JobsService too, without production hooks.
    const workerPath = join(directory, 'fixture-worker.cjs');
    writeFileSync(
      workerPath,
      'const {JobsService}=require(' +
        JSON.stringify(resolve('apps/api/dist/common/jobs.service.js')) +
        ');' +
        'if(typeof JobsService?.prototype?.onModuleInit!=="function")throw new Error("Fixture worker module missing");' +
        'JobsService.prototype.onModuleInit=function(){};',
      { mode: 0o600 },
    );
    api = spawn(process.execPath, ['--require', workerPath, 'apps/api/dist/main.js'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-80000);
      });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (api.exitCode !== null || api.signalCode !== null)
        throw new Error(`独立测试API启动失败：${safe(logs)}`);
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
    assert.ok(ready, `请先构建API；独立测试服务未就绪：${safe(logs)}`);
    const [ordinary, platform, denied] = await Promise.all(fixtures.map((user) => login(user.username)));
    const stamp = new Date(env.ADMIN_JOBS_FIXTURE_TIME);
    const list = async (client: Client | null, query: Record<string, string> = {}, expected = 200) =>
      call(client, `${endpoint}?${new URLSearchParams(query)}`, 'GET', undefined, expected);
    const makeJob = (
      kind: string,
      status = 'PENDING',
      organizationId = organization.id,
      overrides: Record<string, any> = {},
    ) =>
      db!.backgroundJob.create({
        data: {
          organizationId,
          kind,
          status,
          eventKey: `PRIVATE_EVENT_${suffix}_${randomBytes(8).toString('hex')}`,
          payload: {
            secret: 'PRIVATE_PAYLOAD',
            body: 'PRIVATE_NOTIFICATION_BODY',
            userIds: [fixtures[0].id],
          },
          attempts: status === 'PENDING' ? 2 : 3,
          runAt: stamp,
          createdAt: stamp,
          lastError: null,
          ...overrides,
        },
      });
    const sum = (data: any) =>
      data.stateCounts.pending +
      data.stateCounts.running +
      data.stateCounts.succeeded +
      data.stateCounts.failed +
      data.stateCounts.other;
    function contract(data: any, platformScope = false) {
      assert.equal(data.scope, platformScope ? 'platform_institutions' : 'current_organization');
      assert.ok(Number.isFinite(Date.parse(data.serverTime)));
      assert.equal(data.stateCounts.all, sum(data));
      assert.equal(data.page, Math.floor(data.page));
      assert.ok(data.pageSize >= 1 && data.pageSize <= 100);
      for (const item of data.items) {
        assert.deepEqual(
          Object.keys(item).sort(),
          [
            'id',
            'kind',
            'status',
            'attempts',
            'runAt',
            'lastError',
            'createdAt',
            'organizationId',
            'organizationName',
          ].sort(),
        );
        assert.match(item.runAt, /Z$/);
        assert.match(item.createdAt, /Z$/);
      }
      assert.ok(
        !/PRIVATE_PAYLOAD|PRIVATE_NOTIFICATION_BODY|PRIVATE_EVENT|passwordHash|csrfToken/.test(
          JSON.stringify(data),
        ),
      );
      if (!platformScope) assert.deepEqual(data.examDeadlineRuns, []);
    }
    const zero = { pending: 0, running: 0, succeeded: 0, failed: 0, other: 0, all: 0 };

    await t.test('未登录和缺audit权限拒绝；空结果是明确零且scope不能由query伪造', async () => {
      for (const [client, expected] of [
        [null, 401],
        [denied, 403],
      ] as const) {
        const response = await list(client, {}, expected);
        for (const field of ['items', 'total', 'stateCounts', 'examDeadlineRuns', 'scope'])
          assert.equal(field in response.body, false);
      }
      const empty = (await list(ordinary)).body;
      contract(empty);
      assert.deepEqual(empty.items, []);
      assert.equal(empty.total, 0);
      assert.deepEqual(empty.stateCounts, zero);
      for (const query of [
        'action=x&action=y',
        'status=PENDING&status=FAILED',
        'status=OTHER',
        'status=pending',
        'page=1&page=2',
        'pageSize=20&pageSize=21',
        `action=${'x'.repeat(201)}`,
        'action=%00',
        `organizationId=${foreign.id}`,
        'role=SUPER_ADMIN',
        'permissions=org.platform',
        'scope=platform_institutions',
        'userId=other',
        'sessionId=other',
        'csrfToken=other',
      ])
        await call(ordinary, `${endpoint}?${query}`, 'GET', undefined, 400);
    });

    await t.test('普通当前机构 vs 平台全部INSTITUTION含inactive，机构归属真实且个人空间排除', async () => {
      await makeJob('SCOPE_FIXTURE_A', 'PENDING');
      await makeJob('SCOPE_FIXTURE_B', 'FAILED', foreign.id);
      await makeJob('SCOPE_FIXTURE_PERSONAL', 'RUNNING', personal.id);
      const local = (await list(ordinary, { action: 'SCOPE_FIXTURE' })).body;
      contract(local);
      assert.equal(local.total, 1);
      assert.equal(local.stateCounts.all, 1);
      assert.equal(local.items[0].organizationId, organization.id);
      assert.equal(local.items[0].organizationName, organization.name);
      const global = (await list(platform, { action: 'SCOPE_FIXTURE' })).body;
      contract(global, true);
      assert.equal(global.total, 2);
      assert.equal(global.stateCounts.all, 2);
      assert.deepEqual(
        new Set(global.items.map((job: any) => job.organizationId)),
        new Set([organization.id, foreign.id]),
      );
      assert.equal(
        global.items.find((job: any) => job.organizationId === foreign.id).organizationName,
        foreign.name,
      );
      assert.ok(!global.items.some((job: any) => job.organizationId === personal.id));
      const physical = await db!.$queryRaw<{ deleteAction: string; validated: boolean }[]>`
        SELECT confdeltype::text AS "deleteAction", convalidated AS validated FROM pg_constraint
        WHERE conname = 'BackgroundJob_organizationId_fkey' AND conrelid = '"BackgroundJob"'::regclass
      `;
      assert.deepEqual(physical, [{ deleteAction: 'r', validated: true }]);
    });

    await t.test('action实际筛kind，不区分大小写字面包含；百分号/下划线/反斜杠与空白不成通配符', async () => {
      const a = await makeJob('literal-NOTIFICATION', 'PENDING');
      await makeJob('literal-ASSIGNMENT_EXPORT', 'SUCCEEDED');
      const wildcard = await makeJob('literal-weird%_\\kind', 'FAILED');
      await makeJob('literal-weirdXYkind', 'FAILED');
      const spacing = await makeJob('literal-spaced  kind', 'RUNNING');
      for (const [action, id] of [
        ['nOtIfIcAtIoN', a.id],
        ['%_\\', wildcard.id],
        ['  ', spacing.id],
      ]) {
        const data = (await list(ordinary, { action })).body;
        contract(data);
        assert.equal(data.total, 1);
        assert.equal(data.items[0].id, id);
      }
      const match = (await list(ordinary, { action: 'literal', status: 'FAILED' })).body;
      assert.equal(match.total, 2);
      assert.deepEqual(match.stateCounts, {
        pending: 1,
        running: 1,
        succeeded: 1,
        failed: 2,
        other: 0,
        all: 5,
      });
      const literalInjection = (await list(ordinary, { action: "' OR 1=1 --" })).body;
      assert.deepEqual(literalInjection.stateCounts, zero);
      assert.equal(literalInjection.total, 0);
      assert.ok(
        !(await list(ordinary, { action: 'PRIVATE_PAYLOAD' })).body.items.length,
        'payload不参与搜索',
      );
      const empty = (await list(ordinary, { action: 'never-match', status: 'SUCCEEDED' })).body;
      assert.deepEqual(empty.stateCounts, zero);
      assert.deepEqual(empty.items, []);
      assert.equal(empty.total, 0);
    });

    await t.test('501×5状态精确facets不依赖take100/页20，稳定createdAt DESC/id ASC分页', async () => {
      const states = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'LEGACY_UNKNOWN'];
      const rows = states.flatMap((status, stateIndex) =>
        Array.from({ length: 501 }, (_, index) => ({
          id: `jobs-many-${suffix}-${stateIndex}-${String(index).padStart(3, '0')}`,
          organizationId: organization.id,
          kind: 'COUNT_FIXTURE',
          status,
          attempts: stateIndex,
          eventKey: `PRIVATE_EVENT_MANY_${suffix}-${stateIndex}-${index}`,
          payload: { secret: 'PRIVATE_PAYLOAD' },
          runAt: stamp,
          createdAt: stamp,
          updatedAt: stamp,
        })),
      );
      await db!.backgroundJob.createMany({ data: rows });
      const expected = { pending: 501, running: 501, succeeded: 501, failed: 501, other: 501, all: 2505 };
      const first = (await list(ordinary, { action: 'COUNT_FIXTURE', pageSize: '100' })).body;
      contract(first);
      assert.deepEqual(first.stateCounts, expected);
      assert.equal(first.total, 2505);
      assert.equal(first.items.length, 100);
      const ids: string[] = [];
      for (let page = 1; page <= 26; page++) {
        const data = (await list(ordinary, { action: 'COUNT_FIXTURE', page: String(page), pageSize: '100' }))
          .body;
        assert.equal(data.total, 2505);
        assert.deepEqual(data.stateCounts, expected);
        ids.push(...data.items.map((row: any) => row.id));
      }
      assert.deepEqual(ids, rows.map((row) => row.id).sort());
      assert.equal(new Set(ids).size, 2505);
      for (const status of states.slice(0, 4)) {
        const filtered = (await list(ordinary, { action: 'COUNT_FIXTURE', status, pageSize: '20' })).body;
        assert.equal(filtered.total, 501);
        assert.deepEqual(filtered.stateCounts, expected);
        assert.ok(filtered.items.every((row: any) => row.status === status));
      }
      const beyond = (await list(ordinary, { action: 'COUNT_FIXTURE', page: '100000' })).body;
      assert.deepEqual(beyond.items, []);
      assert.equal(beyond.total, 2505);
      assert.deepEqual(beyond.stateCounts, expected);
    });

    await t.test('旧分页默认、截断与clamp兼容；其他类型/状态文本和最近失败无需假details', async () => {
      const selected = await makeJob('DISPLAY_FIXTURE_UNKNOWN', 'PENDING', organization.id, {
        lastError: '<img src=x onerror="alert(1)">最近暂时失败',
        attempts: 7,
      });
      const data = (await list(ordinary, { action: 'DISPLAY_FIXTURE', page: '2.9', pageSize: '0' })).body;
      assert.equal(data.page, 2);
      assert.equal(data.pageSize, 20);
      assert.equal(data.total, 1);
      const displayed = (await list(ordinary, { action: 'DISPLAY_FIXTURE', page: '-2', pageSize: '500' }))
        .body;
      contract(displayed);
      assert.equal(displayed.page, 1);
      assert.equal(displayed.pageSize, 100);
      assert.equal(displayed.items[0].id, selected.id);
      assert.equal(displayed.items[0].lastError, selected.lastError);
      assert.equal(displayed.items[0].status, 'PENDING', '最近错误不等于终态FAILED');
      for (const key of ['details', 'metadata', 'payload', 'eventKey', 'completedAt', 'startedAt'])
        assert.equal(key in displayed.items[0], false);
    });

    await t.test('平台考试清算运行仍为全局最近20，独立于后台关键词/status/counts', async () => {
      const runs = Array.from({ length: 25 }, (_, index) => ({
        id: `jobs-run-${suffix}-${String(index).padStart(2, '0')}`,
        type: 'deadline',
        status: 'SUCCEEDED',
        processed: index,
        startedAt: stamp,
        completedAt: stamp,
        error: index === 24 ? 'GLOBAL_RUN_ERROR' : null,
      }));
      await db!.assessmentJobRun.createMany({ data: runs });
      const data = (await list(platform, { action: 'never-match', status: 'FAILED' })).body;
      contract(data, true);
      assert.equal(data.total, 0);
      assert.deepEqual(data.stateCounts, zero);
      assert.deepEqual(
        data.examDeadlineRuns.map((run: any) => run.id),
        runs
          .map((run) => run.id)
          .sort()
          .reverse()
          .slice(0, 20),
      );
      assert.equal(data.examDeadlineRuns[0].error, 'GLOBAL_RUN_ERROR');
      assert.match(data.examDeadlineRuns[0].completedAt, /Z$/);
      assert.match(data.examDeadlineRuns[0].startedAt, /Z$/);
      const local = (await list(ordinary, { action: 'never-match', status: 'FAILED' })).body;
      assert.deepEqual(local.examDeadlineRuns, []);
      assert.ok(!JSON.stringify(local).includes('GLOBAL_RUN_ERROR'));
    });

    async function delayedRead(
      client: Client,
      query: Record<string, string>,
      expected: number,
      mutate: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>,
      onMutated?: () => void,
    ) {
      let pending: Promise<{ response?: Awaited<ReturnType<typeof call>>; error?: unknown }> | undefined;
      try {
        await db!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('LOCK TABLE "BackgroundJob" IN ACCESS EXCLUSIVE MODE');
            const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            pending = list(client, query, expected).then(
              (response) => ({ response }),
              (error: unknown) => ({ error }),
            );
            let blocked = false;
            for (let probe = 0; probe < 200; probe++) {
              const [state] = await owner.$queryRaw<{ blocked: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity s
              WHERE s.datname = ${databaseName} AND ${pid} = ANY(pg_blocking_pids(s.pid))
                AND s.query LIKE '%admin-jobs-list%' AND s.query LIKE '%base AS MATERIALIZED%') AS blocked
          `;
              if (state.blocked) {
                blocked = true;
                break;
              }
              await wait(20);
            }
            assert.ok(blocked, '必须观测actual jobs SQL等待随机库fixture锁，不能靠sleep推断');
            await mutate(tx);
            onMutated?.();
          },
          { timeout: 12000 },
        );
        assert.ok(pending);
        const result = await pending;
        if (result.error) throw result.error;
        assert.ok(result.response);
        return result.response;
      } finally {
        // The transaction has released its lock, including on an observer error.
        // Settled wrappers cannot replace that original error with a late HTTP failure.
        if (pending) await pending;
      }
    }

    await t.test('并发写在实际SELECT阻塞后提交，items/total/facets始终同一快照', async () => {
      const pending = await makeJob('SNAPSHOT_FIXTURE', 'PENDING');
      await makeJob('SNAPSHOT_FIXTURE', 'RUNNING');
      const response = await delayedRead(
        ordinary,
        { action: 'SNAPSHOT_FIXTURE', pageSize: '100' },
        200,
        async (tx) => {
          await tx.backgroundJob.update({ where: { id: pending.id }, data: { status: 'SUCCEEDED' } });
          return tx.backgroundJob.create({
            data: {
              organizationId: organization.id,
              kind: 'SNAPSHOT_FIXTURE',
              status: 'FAILED',
              eventKey: `snap_${suffix}`,
              payload: {},
              runAt: stamp,
              createdAt: stamp,
            },
          });
        },
      );
      const data = response.body;
      contract(data);
      assert.equal(data.total, data.items.length);
      assert.equal(data.stateCounts.all, data.total);
      for (const [status, key] of [
        ['PENDING', 'pending'],
        ['RUNNING', 'running'],
        ['SUCCEEDED', 'succeeded'],
        ['FAILED', 'failed'],
      ])
        assert.equal(data.stateCounts[key], data.items.filter((row: any) => row.status === status).length);
      assert.ok(data.total === 2 || data.total === 3);
      if (data.total === 2) assert.equal(data.stateCounts.pending, 1);
      else
        assert.deepEqual(data.stateCounts, {
          pending: 0,
          running: 1,
          succeeded: 1,
          failed: 1,
          other: 0,
          all: 3,
        });
    });

    await t.test('实际SQL等待期间仅移除org.platform但保留audit，末端拒绝旧跨机构结果', async () => {
      let mutated = false;
      let originalFailure: unknown;
      try {
        const response = await delayedRead(
          platform,
          {},
          403,
          (tx) =>
            tx.rolePermission.delete({
              where: { roleId_permissionId: { roleId: 'JOBS_PLATFORM', permissionId: 'org.platform' } },
            }),
          () => {
            mutated = true;
          },
        );
        for (const field of ['items', 'total', 'stateCounts', 'examDeadlineRuns'])
          assert.equal(field in response.body, false);
      } catch (error) {
        originalFailure = error;
        throw error;
      } finally {
        try {
          if (mutated)
            await db!.rolePermission.upsert({
              where: { roleId_permissionId: { roleId: 'JOBS_PLATFORM', permissionId: 'org.platform' } },
              create: { roleId: 'JOBS_PLATFORM', permissionId: 'org.platform' },
              update: {},
            });
        } catch (restoreFailure) {
          if (originalFailure)
            throw new AggregateError(
              [originalFailure, restoreFailure],
              '原始jobs验收失败且owned权限恢复失败',
            );
          throw restoreFailure;
        }
      }
      contract((await list(platform)).body, true);
    });

    await t.test('全部私有查询后检查session/role/空间/机构/actual audit权限，不退回旧payload', async () => {
      let current = ordinary;
      for (const kind of ['audit', 'role', 'space', 'organization', 'nonce', 'session']) {
        let mutated = false;
        let originalFailure: unknown;
        try {
          const response = await delayedRead(
            current,
            {},
            kind === 'audit' ? 403 : 401,
            async (tx) => {
              if (kind === 'audit')
                return tx.rolePermission.delete({
                  where: { roleId_permissionId: { roleId: 'JOBS_READ', permissionId: 'audit.read' } },
                });
              if (kind === 'role')
                return tx.userRole.delete({
                  where: { userId_roleId: { userId: fixtures[0].id, roleId: 'JOBS_READ' } },
                });
              if (kind === 'space')
                return tx.user.update({
                  where: { id: fixtures[0].id },
                  data: {
                    organizationId: personal.id,
                    accountMode: 'PERSONAL',
                    personalOrganizationId: personal.id,
                  },
                });
              if (kind === 'organization')
                return tx.organization.update({ where: { id: organization.id }, data: { active: false } });
              if (kind === 'nonce')
                return tx.session.updateMany({
                  where: { userId: fixtures[0].id },
                  data: { csrfToken: `changed-${suffix}` },
                });
              return tx.session.deleteMany({ where: { userId: fixtures[0].id } });
            },
            () => {
              mutated = true;
            },
          );
          for (const field of ['items', 'total', 'stateCounts', 'examDeadlineRuns'])
            assert.equal(field in response.body, false);
        } catch (error) {
          originalFailure = error;
          throw error;
        } finally {
          try {
            if (mutated) {
              if (kind === 'audit')
                await db!.rolePermission.upsert({
                  where: { roleId_permissionId: { roleId: 'JOBS_READ', permissionId: 'audit.read' } },
                  create: { roleId: 'JOBS_READ', permissionId: 'audit.read' },
                  update: {},
                });
              if (kind === 'role')
                await db!.userRole.upsert({
                  where: { userId_roleId: { userId: fixtures[0].id, roleId: 'JOBS_READ' } },
                  create: { userId: fixtures[0].id, roleId: 'JOBS_READ' },
                  update: {},
                });
              if (kind === 'space')
                await db!.user.update({
                  where: { id: fixtures[0].id },
                  data: {
                    organizationId: organization.id,
                    accountMode: 'ORGANIZATION',
                    personalOrganizationId: null,
                  },
                });
              if (kind === 'organization')
                await db!.organization.update({ where: { id: organization.id }, data: { active: true } });
              if (kind === 'session' || kind === 'nonce') current = await login(fixtures[0].username);
            }
          } catch (restoreFailure) {
            if (originalFailure)
              throw new AggregateError(
                [originalFailure, restoreFailure],
                '原始jobs验收失败且owned身份恢复失败',
              );
            throw restoreFailure;
          }
        }
      }
    });

    await t.test('普通分支不读取全局AssessmentJobRun表；平台历史查询后仍执行fresh', async () => {
      let blocked: Promise<{ response?: Awaited<ReturnType<typeof call>>; error?: unknown }> | undefined;
      try {
        await db!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('LOCK TABLE "AssessmentJobRun" IN ACCESS EXCLUSIVE MODE');
            const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            // The ordinary query must complete while the independent global table is locked.
            const local = (await list(await login(fixtures[0].username))).body;
            contract(local);
            blocked = list(platform, {}, 401).then(
              (response) => ({ response }),
              (error: unknown) => ({ error }),
            );
            let seen = false;
            for (let probe = 0; probe < 200; probe++) {
              const [state] = await owner.$queryRaw<{ waiting: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity s WHERE s.datname = ${databaseName}
              AND ${pid} = ANY(pg_blocking_pids(s.pid)) AND s.query LIKE '%admin-jobs-list%'
              AND s.query LIKE '%base AS MATERIALIZED%') AS waiting
          `;
              if (state.waiting) {
                seen = true;
                break;
              }
              await wait(20);
            }
            assert.ok(seen);
            await tx.session.deleteMany({ where: { userId: fixtures[1].id } });
          },
          { timeout: 12000 },
        );
        assert.ok(blocked);
        const result = await blocked;
        if (result.error) throw result.error;
        assert.equal('examDeadlineRuns' in result.response!.body, false);
      } finally {
        if (blocked) await blocked;
      }
    });

    await t.test('三连接API池六并发只读任务请求都返回一致完整计数', async () => {
      const client = await login(fixtures[0].username);
      const expected = (await list(client, { action: 'COUNT_FIXTURE', status: 'FAILED', pageSize: '20' }))
        .body;
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          list(client, { action: 'COUNT_FIXTURE', status: 'FAILED', pageSize: '20' }),
        ),
      );
      for (const response of responses) {
        contract(response.body);
        assert.deepEqual(response.body.items, expected.items);
        assert.equal(response.body.total, expected.total);
        assert.deepEqual(response.body.stateCounts, expected.stateCounts);
      }
    });
    assert.ok(!logs.includes(password), 'API日志不能包含测试密码');
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : '后台任务集成验收失败'));
  } finally {
    let cleanupFailed = false;
    const resources = await Promise.allSettled([stop(api), stop(migration)]);
    if (resources.some((result) => result.status === 'rejected')) cleanupFailed = true;
    try {
      try {
        await db?.$disconnect();
      } catch {
        cleanupFailed = true;
      }
      if (created) {
        assert.match(databaseName, /^admin_jobs_it_[a-f0-9]{16}$/);
        try {
          await owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
        } catch {
          cleanupFailed = true;
        }
      }
    } finally {
      try {
        await owner.$disconnect();
      } catch {
        cleanupFailed = true;
      }
      rmSync(directory, { recursive: true, force: true });
    }
    if (cleanupFailed) throw new Error('独立Jobs测试资源清理未完成；仅检查admin_jobs_it_前缀随机库。');
  }
});
