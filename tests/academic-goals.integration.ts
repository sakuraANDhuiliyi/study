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
import type { StudyResult } from '../apps/api/src/academics/academics.types';

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

test('专业学习目标：独立PostgreSQL与真实HTTP验收', { timeout: 180_000 }, async (t) => {
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
  const name = `academic_goals_it_${suffix}`;
  assert.match(name, /^academic_goals_it_[a-f0-9]{16}$/);
  const isolatedUrl = new URL(adminUrl);
  isolatedUrl.pathname = `/${name}`;
  const password = `Fixture-${randomBytes(20).toString('hex')}!`;
  const safe = (text: string) =>
    [password, configured, isolatedUrl.href, decodeURIComponent(adminUrl.password)]
      .filter(Boolean)
      .reduce((value, secret) => value.split(secret).join('[redacted]'), text)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]');
  const port = await freePort();
  const directory = mkdtempSync(join(tmpdir(), 'academics-http-'));
  const configPath = join(directory, 'config.yaml');
  writeFileSync(configPath, 'judge0: {enabled: false}\nai: {enabled: false}\nwebSearch: {enabled: false}\n', {
    mode: 0o600,
  });
  const owner = new PrismaClient({ datasourceUrl: adminUrl.href });
  let db: PrismaClient | undefined;
  let api: ChildProcess | undefined;
  let created = false;
  let logs = '';
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DATABASE_URL: isolatedUrl.href,
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
  async function evaluate(
    client: Client,
    moduleId: string,
    overrides: Record<string, unknown> = {},
    title?: string,
  ) {
    const module = (await call(client, `/academics/modules/${moduleId}`)).body;
    return (
      await call(client, `/academics/modules/${moduleId}/evaluate`, 'POST', {
        values: { ...module.defaultValues, ...overrides },
        ...(title ? { title } : {}),
      })
    ).body as { record: any; result: StudyResult };
  }
  try {
    try {
      await owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created = true;
    } catch {
      throw new Error(
        '无法创建隔离测试库；请确认本机数据库运行且测试账号具有CREATEDB权限。未修改现有数据库。',
      );
    }
    const migration = spawn(
      process.execPath,
      [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma'],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let migrationLog = '';
    for (const stream of [migration.stdout, migration.stderr])
      stream.on('data', (chunk: Buffer) => {
        migrationLog = (migrationLog + chunk.toString()).slice(-20_000);
      });
    const migrationTimeout = setTimeout(() => migration.kill('SIGKILL'), 60_000);
    const [migrationCode] = await once(migration, 'exit');
    clearTimeout(migrationTimeout);
    assert.equal(migrationCode, 0, `隔离测试库迁移失败：${safe(migrationLog)}`);
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
    const institution = await db.organization.create({ data: { name: '专业验收机构甲' } });
    const foreign = await db.organization.create({ data: { name: '专业验收机构乙' } });
    const hash = await hashPasswordAsync(password);
    const makeUser = async (tag: string, roleId: string, organizationId = institution.id) =>
      db!.user.create({
        data: {
          username: `academics_${suffix}_${tag}`,
          name: tag,
          organizationId,
          passwordHash: hash,
          roles: { create: { roleId } },
        },
      });
    const fixtureUsers = await Promise.all([
      makeUser('admin', 'ADMIN'),
      makeUser('foreign_admin', 'ADMIN', foreign.id),
      makeUser('student', 'STUDENT'),
      makeUser('peer', 'STUDENT'),
      makeUser('foreign_student', 'STUDENT', foreign.id),
      makeUser('teacher', 'TEACHER'),
    ]);
    api = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-80_000);
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
        /* Waiting for our child API to bind. */
      }
      await wait(100);
    }
    assert.ok(ready, `请先构建API；独立测试服务未就绪：${safe(logs)}`);
    const [admin, foreignAdmin, student, peer, foreignStudent, teacher] = await Promise.all(
      fixtureUsers.map((user) => login(user.username)),
    );
    let personal = await register('personal');
    const anotherPersonal = await register('other_personal');
    const originalSpace = personal.user.organizationId;

    const createGoal = async (client: Client, overrides: Record<string, unknown> = {}) =>
      (
        await call(client, '/academics/goals', 'POST', {
          moduleId: 'matrix-lab',
          title: '完成矩阵练习',
          targetCount: 2,
          ...overrides,
        })
      ).body;
    const goals = async (client = personal, status = 'all') =>
      (await call(client, `/academics/goals?status=${status}`)).body.items as any[];
    const goal = async (id: string, client = personal) =>
      (await goals(client)).find((item) => item.id === id);
    let matrixGoal: any, algorithmGoal: any;

    await t.test('目标接口仅学生可用，严格输入并且创建目标不自动生成完成记录或任务', async () => {
      await call(null, '/academics/goals', 'GET', undefined, 401);
      for (const client of [teacher, admin, foreignAdmin]) {
        await call(client, '/academics/goals', 'GET', undefined, 403);
        await call(
          client,
          '/academics/goals',
          'POST',
          { moduleId: 'matrix-lab', title: '越权', targetCount: 1 },
          403,
        );
      }
      const input = { moduleId: 'matrix-lab', title: '目标', targetCount: 2 };
      for (const extra of [
        { targetCount: 0 },
        { targetCount: 1001 },
        { title: '' },
        { dueDate: '2100-02-29' },
        { dueDate: '2026-04-31' },
        { organizationId: institution.id },
        { userId: peer.user.id },
        { progressCount: 1 },
        { completed: true },
      ])
        await call(personal, '/academics/goals', 'POST', { ...input, ...extra }, 400);
      await call(personal, '/academics/goals', 'POST', { ...input, moduleId: 'not-a-module' }, 404);
      await call(personal, '/academics/goals?status=completed', 'GET', undefined, 400);
      await call(personal, '/academics/goals?userId=other', 'GET', undefined, 400);
      const before = await Promise.all([
        db!.academicsRecord.count(),
        db!.algorithmSubmission.count(),
        db!.personalTask.count(),
      ]);
      matrixGoal = await createGoal(personal, { dueDate: '2000-02-29' });
      assert.equal(matrixGoal.progressCount, 0);
      assert.equal(matrixGoal.completed, false);
      assert.equal(matrixGoal.overdue, true);
      assert.equal(matrixGoal.unit, '次');
      assert.equal(matrixGoal.revision, 0);
      assert.equal(matrixGoal.dueDate, '2000-02-29');
      assert.equal(matrixGoal.organizationId, undefined);
      assert.equal(matrixGoal.userId, undefined);
      assert.deepEqual(
        await Promise.all([
          db!.academicsRecord.count(),
          db!.algorithmSubmission.count(),
          db!.personalTask.count(),
        ]),
        before,
      );
    });

    await t.test('进度只计创建时间起当前空间本模块已完成记录，删除或改草稿会降低进度', async () => {
      const boundary = new Date(matrixGoal.createdAt);
      const base = {
        organizationId: originalSpace,
        userId: personal.user.id,
        moduleId: 'matrix-lab',
        title: '边界记录',
        values: {},
        result: {},
        status: 'COMPLETED',
      };
      await db!.academicsRecord.create({ data: { ...base, createdAt: new Date(boundary.getTime() - 1) } });
      const exact = await db!.academicsRecord.create({ data: { ...base, createdAt: boundary } });
      await db!.academicsRecord.create({ data: { ...base, status: 'DRAFT' } });
      await db!.academicsRecord.create({ data: { ...base, moduleId: 'genetics-lab' } });
      await db!.academicsRecord.create({ data: { ...base, organizationId: institution.id } });
      await db!.academicsRecord.create({ data: { ...base, userId: anotherPersonal.user.id } });
      assert.equal((await goal(matrixGoal.id)).progressCount, 1);
      const live = (await evaluate(personal, 'matrix-lab')).record;
      const finished = await goal(matrixGoal.id);
      assert.equal(finished.progressCount, 2);
      assert.equal(finished.completed, true);
      assert.equal(finished.overdue, false);
      await call(personal, `/academics/records/${live.id}`, 'PATCH', { revision: 0, status: 'DRAFT' });
      assert.equal((await goal(matrixGoal.id)).progressCount, 1);
      await call(personal, `/academics/records/${live.id}`, 'PATCH', { revision: 1, status: 'COMPLETED' });
      assert.equal((await goal(matrixGoal.id)).progressCount, 2);
      await call(personal, `/academics/records/${exact.id}`, 'DELETE');
      assert.equal((await goal(matrixGoal.id)).progressCount, 1);
      assert.equal((await goal(matrixGoal.id)).completed, false);
      assert.equal((await goal(matrixGoal.id)).overdue, true);
    });

    await t.test('算法目标只计正式通过且创建后去重题目，运行、失败、他人和异空间不计入', async () => {
      algorithmGoal = await createGoal(personal, {
        moduleId: 'algorithms',
        title: '通过两道题',
        targetCount: 2,
      });
      const boundary = new Date(algorithmGoal.createdAt);
      const base = {
        organizationId: originalSpace,
        userId: personal.user.id,
        language: 'python',
        code: 'print(3)',
        mode: 'submit',
        status: 'accepted',
        results: [],
      };
      await db!.algorithmSubmission.create({
        data: { ...base, problemId: 'old-only', createdAt: new Date(boundary.getTime() - 1) },
      });
      await db!.algorithmSubmission.create({
        data: { ...base, problemId: 'sum-of-two', createdAt: boundary },
      });
      await db!.algorithmSubmission.create({ data: { ...base, problemId: 'sum-of-two' } });
      await db!.algorithmSubmission.create({ data: { ...base, problemId: 'sample-only', mode: 'run' } });
      await db!.algorithmSubmission.create({
        data: { ...base, problemId: 'custom-only', customInput: true },
      });
      await db!.algorithmSubmission.create({
        data: { ...base, problemId: 'wrong-only', status: 'wrong_answer' },
      });
      await db!.algorithmSubmission.create({
        data: { ...base, problemId: 'running-only', status: 'running' },
      });
      await db!.algorithmSubmission.create({
        data: { ...base, problemId: 'foreign-only', organizationId: institution.id },
      });
      await db!.algorithmSubmission.create({
        data: { ...base, problemId: 'peer-only', userId: anotherPersonal.user.id },
      });
      assert.equal((await goal(algorithmGoal.id)).progressCount, 1);
      assert.equal((await goal(algorithmGoal.id)).unit, '题');
      const accepted = await db!.algorithmSubmission.create({ data: { ...base, problemId: 'range-sum' } });
      assert.equal((await goal(algorithmGoal.id)).progressCount, 2);
      assert.equal((await goal(algorithmGoal.id)).completed, true);
      await db!.algorithmSubmission.delete({ where: { id: accepted.id } });
      assert.equal((await goal(algorithmGoal.id)).progressCount, 1);
      assert.equal((await goal(algorithmGoal.id)).completed, false);
    });

    await t.test('更新及删除CAS，归档筛选，其他账号和其他机构返回隐私404', async () => {
      for (const client of [anotherPersonal, student, peer, foreignStudent]) {
        assert.ok(!(await goals(client)).some((item) => item.id === matrixGoal.id));
        await call(client, `/academics/goals/${matrixGoal.id}`, 'PATCH', { revision: 0, title: '越权' }, 404);
        await call(client, `/academics/goals/${matrixGoal.id}`, 'DELETE', { revision: 0 }, 404);
      }
      await call(
        personal,
        `/academics/goals/${matrixGoal.id}`,
        'PATCH',
        { revision: 0, moduleId: 'algorithms' },
        400,
      );
      await call(personal, `/academics/goals/${matrixGoal.id}`, 'DELETE', undefined, 400);
      await call(
        personal,
        `/academics/goals/${matrixGoal.id}`,
        'PATCH',
        { revision: 0, title: '无CSRF' },
        403,
        false,
      );
      const results = await Promise.all(
        ['并发一', '并发二'].map((title) =>
          call(personal, `/academics/goals/${matrixGoal.id}`, 'PATCH', { revision: 0, title }, [200, 409]),
        ),
      );
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      matrixGoal = await goal(matrixGoal.id);
      assert.equal(matrixGoal.revision, 1);
      await call(personal, `/academics/goals/${matrixGoal.id}`, 'DELETE', { revision: 0 }, 409);
      matrixGoal = (
        await call(personal, `/academics/goals/${matrixGoal.id}`, 'PATCH', {
          revision: 1,
          archived: true,
          dueDate: null,
        })
      ).body;
      assert.equal(matrixGoal.archived, true);
      assert.equal(matrixGoal.overdue, false);
      assert.equal(matrixGoal.dueDate, null);
      assert.ok(!(await goals(personal, 'active')).some((item) => item.id === matrixGoal.id));
      assert.deepEqual(
        (await goals(personal, 'archived')).map((item) => item.id),
        [matrixGoal.id],
      );
      matrixGoal = (
        await call(personal, `/academics/goals/${matrixGoal.id}`, 'PATCH', {
          revision: 2,
          archived: false,
          targetCount: 1,
        })
      ).body;
      assert.equal(matrixGoal.completed, true);
      const listed = await goals();
      assert.equal(listed.at(-1).id, matrixGoal.id);
      const disposable = await createGoal(personal, { title: '待删除' });
      await call(personal, `/academics/goals/${disposable.id}`, 'DELETE', { revision: 0 });
      await call(personal, `/academics/goals/${disposable.id}`, 'DELETE', { revision: 0 }, 404);
      assert.equal(await db!.academicGoal.findUnique({ where: { id: disposable.id } }), null);
    });

    await t.test('创建目标等待用户锁时，以获得锁后的实际创建时间排除已提交练习', async () => {
      let pending: ReturnType<typeof createGoal> | undefined;
      let earlierRecord: any;
      await db!.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${student.user.id} FOR UPDATE`;
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pending = createGoal(student, { title: '等待锁后建立的目标' });
          let blocked = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const [state] = await owner.$queryRaw<{ blocked: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked
          `;
            if (state.blocked) {
              blocked = true;
              break;
            }
            await wait(20);
          }
          assert.ok(blocked, '目标创建请求应确实等待已有用户锁');
          const [{ createdAt }] = await tx.$queryRaw<
            { createdAt: Date }[]
          >`SELECT clock_timestamp()::timestamptz(3) AS "createdAt"`;
          earlierRecord = await tx.academicsRecord.create({
            data: {
              organizationId: institution.id,
              userId: student.user.id,
              moduleId: 'matrix-lab',
              title: '目标真正建立前已完成',
              values: {},
              result: {},
              createdAt,
            },
          });
          await wait(10);
        },
        { timeout: 10000 },
      );
      const created = await pending!;
      assert.ok(new Date(created.createdAt).getTime() > earlierRecord.createdAt.getTime());
      assert.equal(created.progressCount, 0);
      assert.equal((await goal(created.id, student)).progressCount, 0);
    });

    await t.test('每空间100个目标包含归档，并发创建不能越过上限', async () => {
      await db!.academicGoal.createMany({
        data: Array.from({ length: 99 }, (_, i) => ({
          organizationId: institution.id,
          userId: peer.user.id,
          moduleId: 'matrix-lab',
          title: `上限测试${i}`,
          targetCount: 1,
          archived: i % 2 === 0,
        })),
      });
      const input = { moduleId: 'matrix-lab', title: '竞争最后名额', targetCount: 1 };
      const responses = await Promise.all(
        [0, 1].map(() => call(peer, '/academics/goals', 'POST', input, [201, 409])),
      );
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal((await goals(peer)).length, 100);
      assert.equal(
        await db!.academicGoal.count({ where: { organizationId: institution.id, userId: peer.user.id } }),
        100,
      );
      await createGoal(foreignStudent);
    });

    await t.test('practice关闭和旧会话失效阻断目标读写，不影响其他空间', async () => {
      await db!.systemSetting.create({
        data: { organizationId: institution.id, key: 'features', value: { practice: false } },
      });
      try {
        await call(student, '/academics/goals', 'GET', undefined, 403);
        await call(
          student,
          '/academics/goals',
          'POST',
          { moduleId: 'matrix-lab', title: '禁止', targetCount: 1 },
          403,
        );
        await call(personal, '/academics/goals');
      } finally {
        await db!.systemSetting.delete({
          where: { organizationId_key: { organizationId: institution.id, key: 'features' } },
        });
      }
      await db!.user.update({
        where: { id: anotherPersonal.user.id },
        data: { authVersion: { increment: 1 } },
      });
      await call(anotherPersonal, '/academics/goals', 'GET', undefined, 401);
      await call(
        anotherPersonal,
        '/academics/goals',
        'POST',
        { moduleId: 'matrix-lab', title: '失效', targetCount: 1 },
        401,
      );
    });

    await t.test('个人加入机构与离开保留两空间各自目标和真实进度', async () => {
      const before = await goals();
      await call(admin, '/admin/join-settings', 'PATCH', { joinEnabled: true });
      const invitation = (await call(admin, '/admin/join-settings/rotate-code', 'POST', {})).body.inviteCode;
      const application = (await call(personal, '/account/join-requests', 'POST', { inviteCode: invitation }))
        .body;
      await call(admin, `/admin/join-requests/${application.id}`, 'PATCH', { status: 'APPROVED' });
      await call(personal, '/academics/goals', 'GET', undefined, 401);
      personal = await login(personal.user.username);
      assert.equal(personal.user.organizationId, institution.id);
      assert.equal((await goals()).length, 0);
      await call(
        personal,
        `/academics/goals/${matrixGoal.id}`,
        'PATCH',
        { revision: matrixGoal.revision, title: '旧空间' },
        404,
      );
      const institutionalGoal = await createGoal(personal);
      await evaluate(personal, 'matrix-lab');
      assert.equal((await goal(institutionalGoal.id)).progressCount, 1);
      await call(personal, '/account/leave-organization', 'POST', {});
      personal = await login(personal.user.username);
      assert.equal(personal.user.organizationId, originalSpace);
      const restored = await goals();
      assert.deepEqual(
        restored.map((item) => [item.id, item.progressCount]),
        before.map((item) => [item.id, item.progressCount]),
      );
      await call(personal, `/academics/goals/${institutionalGoal.id}`, 'DELETE', { revision: 0 }, 404);
      assert.equal(
        (await db!.academicGoal.findUniqueOrThrow({ where: { id: institutionalGoal.id } })).organizationId,
        institution.id,
      );
    });
    assert.ok(!logs.includes(password), 'API日志不能包含测试密码');
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : '集成验收失败'));
  } finally {
    if (api && api.exitCode === null) {
      const exit = once(api, 'exit');
      api.kill('SIGTERM');
      await Promise.race([exit, wait(3000)]);
      if (api.exitCode === null) {
        api.kill('SIGKILL');
        await Promise.race([exit, wait(1000)]);
      }
    }
    await db?.$disconnect();
    if (created) {
      assert.match(name, /^academic_goals_it_[a-f0-9]{16}$/);
      try {
        await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      } catch {
        t.diagnostic(
          '本次随机测试库清理失败；仅需管理员检查academic_goals_it_前缀的遗留测试库。未触碰现有业务库。',
        );
      }
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
