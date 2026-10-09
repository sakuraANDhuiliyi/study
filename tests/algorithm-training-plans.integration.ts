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
import { PrismaClient, type Prisma } from '@prisma/client';
import { hashPasswordAsync } from '../apps/api/src/auth/password';
import { permissionDefinitions, roleDefinitions } from '../apps/api/src/auth/permissions';

// Only the random database created by this suite is migrated, seeded or dropped. The
// explicitly selected local review database supplies CREATEDB access, never fixture data.
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const endpoint = '/algorithms/training-plans';
type Client = { cookie: string; csrf: string; user: any };
type ProblemSummary = {
  id: string;
  number: number;
  title: string;
  difficulty: string;
  tags: string[];
};
type Plan = {
  id: string;
  title: string;
  description: string;
  problemIds: string[];
  archived: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  problems: (ProblemSummary & { status: 'todo' | 'attempted' | 'solved' })[];
  total: number;
  solved: number;
  nextProblemId: string | null;
};
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

test('算法训练计划：独立数据库真实HTTP、进度、配额和锁后权限复核', { timeout: 180_000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production', '集成测试禁止在production模式运行');
  const configured =
    process.env.ALGORITHM_TRAINING_TEST_ADMIN_DATABASE_URL ||
    process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL ||
    (process.env.DOTENV_CONFIG_PATH && process.env.DATABASE_URL);
  assert.ok(
    configured,
    '需要显式本机review/test数据库：ALGORITHM_TRAINING_TEST_ADMIN_DATABASE_URL、ACADEMICS_TEST_ADMIN_DATABASE_URL或DOTENV_CONFIG_PATH',
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
  const databaseName = `algorithm_training_it_${suffix}`;
  assert.match(databaseName, /^algorithm_training_it_[a-f0-9]{16}$/);
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
  const directory = mkdtempSync(join(tmpdir(), 'algorithm-training-http-'));
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
    UPLOAD_DIR: join(directory, 'uploads'),
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
    const organization = await db.organization.create({ data: { name: '训练计划验收机构甲' } });
    const foreign = await db.organization.create({ data: { name: '训练计划验收机构乙' } });
    const hash = await hashPasswordAsync(password);
    const makeUser = async (tag: string, roleId = 'STUDENT', organizationId = organization.id) =>
      db!.user.create({
        data: {
          username: `training_${suffix}_${tag}`,
          name: tag,
          organizationId,
          passwordHash: hash,
          roles: { create: { roleId } },
        },
      });
    const fixtures = await Promise.all([
      makeUser('student'),
      makeUser('peer'),
      makeUser('foreign', 'STUDENT', foreign.id),
      makeUser('quota'),
      makeUser('queued'),
      makeUser('admin', 'ADMIN'),
      makeUser('teacher', 'TEACHER'),
    ]);
    api = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
        /* Waiting for the suite's own child API. */
      }
      await wait(100);
    }
    assert.ok(ready, `请先构建API；独立测试服务未就绪：${safe(logs)}`);
    const [student, peer, foreignStudent, quotaStudent, initialQueuedStudent, admin, teacher] =
      await Promise.all(fixtures.map((user) => login(user.username)));
    let queuedStudent = initialQueuedStudent;
    const list = async (client = student) =>
      (await call(client, endpoint)).body as {
        items: Plan[];
        catalog: ProblemSummary[];
        limits: { maxPlans: number; maxProblems: number };
      };
    const findPlan = async (id: string, client = student) => {
      const row = (await list(client)).items.find((item) => item.id === id);
      assert.ok(row, '当前账号应能读取刚保存的计划');
      return row;
    };
    const createPlan = async (client = student, overrides: Record<string, unknown> = {}) =>
      (await call(client, endpoint, 'POST', { title: '每周训练', problemIds: ['sum-of-two'], ...overrides }))
        .body as Plan;
    const scope = (client: Client) => ({
      organizationId: client.user.organizationId,
      userId: client.user.id,
    });
    let plan: Plan;
    let catalog: ProblemSummary[];

    await t.test('学生权限、CSRF、公开题目摘要和严格输入', async () => {
      await call(null, endpoint, 'GET', undefined, 401);
      await call(null, endpoint, 'POST', { title: '未登录', problemIds: ['sum-of-two'] }, 401);
      for (const client of [admin, teacher]) {
        await call(client, endpoint, 'GET', undefined, 403);
        await call(client, endpoint, 'POST', { title: '越权', problemIds: ['sum-of-two'] }, 403);
        await call(client, `${endpoint}/unknown`, 'PATCH', { revision: 0, title: '越权' }, 403);
        await call(client, `${endpoint}/unknown`, 'DELETE', { revision: 0 }, 403);
      }
      const empty = await list();
      assert.deepEqual(Object.keys(empty).sort(), ['catalog', 'items', 'limits']);
      assert.deepEqual(empty.items, []);
      assert.deepEqual(empty.limits, { maxPlans: 20, maxProblems: 50 });
      catalog = empty.catalog;
      assert.ok(catalog.length >= 51, '公开题库应提供足够题目验证50题边界');
      assert.equal(new Set(catalog.map((problem) => problem.id)).size, catalog.length);
      for (const problem of catalog) {
        assert.deepEqual(Object.keys(problem).sort(), ['difficulty', 'id', 'number', 'tags', 'title']);
        assert.ok(['easy', 'medium', 'hard'].includes(problem.difficulty));
        assert.ok(Number.isInteger(problem.number) && problem.number > 0);
        assert.ok(Array.isArray(problem.tags));
      }
      const input = { title: '有效训练', problemIds: ['sum-of-two'] };
      for (const extra of [
        { title: '' },
        { title: '   ' },
        { title: 'x'.repeat(121) },
        { title: 'a\0b' },
        { description: null },
        { description: 'x'.repeat(801) },
        { description: 'a\0b' },
        { problemIds: [] },
        { problemIds: 'sum-of-two' },
        { problemIds: ['unknown-problem'] },
        { problemIds: ['sum-of-two', 'sum-of-two'] },
        { problemIds: [null] },
        { problemIds: catalog.slice(0, 51).map((problem) => problem.id) },
        { organizationId: foreign.id },
        { userId: peer.user.id },
        { solved: 1 },
        { archived: true },
        { revision: 0 },
        { status: 'solved' },
      ])
        await call(student, endpoint, 'POST', { ...input, ...extra }, 400);
      await call(student, endpoint, 'POST', input, 403, false);
      await call({ ...student, csrf: 'wrong-csrf' }, endpoint, 'POST', input, 403);
      await call(student, endpoint, 'POST', input, 403, true, 'https://foreign.invalid');
      assert.equal(await db!.algorithmTrainingPlan.count(), 0);
      const maximal = await createPlan(peer, {
        title: '五十题训练',
        problemIds: catalog
          .slice(0, 50)
          .map((problem) => problem.id)
          .reverse(),
      });
      assert.equal(maximal.total, 50);
      assert.deepEqual(
        maximal.problems.map((problem) => problem.id),
        maximal.problemIds,
      );
      await call(peer, `${endpoint}/${maximal.id}`, 'DELETE', { revision: 0 });
      const before = await Promise.all([
        db!.algorithmSubmission.count(),
        db!.algorithmDraft.count(),
        db!.algorithmLearningState.count(),
        db!.personalTask.count(),
      ]);
      plan = await createPlan(student, {
        title: '  每周训练  ',
        problemIds: ['palindrome-word', 'sum-of-two'],
      });
      assert.equal(plan.title, '每周训练');
      assert.equal(plan.description, '');
      assert.equal(plan.archived, false);
      assert.equal(plan.revision, 0);
      assert.equal(plan.total, 2);
      assert.equal(plan.solved, 0);
      assert.equal(plan.nextProblemId, 'palindrome-word');
      assert.ok(Number.isFinite(Date.parse(plan.createdAt)));
      assert.ok(Number.isFinite(Date.parse(plan.updatedAt)));
      assert.deepEqual(
        Object.keys(plan).sort(),
        [
          'archived',
          'createdAt',
          'description',
          'id',
          'nextProblemId',
          'problemIds',
          'problems',
          'revision',
          'solved',
          'title',
          'total',
          'updatedAt',
        ].sort(),
      );
      for (const problem of plan.problems) {
        assert.deepEqual(Object.keys(problem).sort(), [
          'difficulty',
          'id',
          'number',
          'status',
          'tags',
          'title',
        ]);
        assert.equal(problem.status, 'todo');
      }
      assert.deepEqual(
        await Promise.all([
          db!.algorithmSubmission.count(),
          db!.algorithmDraft.count(),
          db!.algorithmLearningState.count(),
          db!.personalTask.count(),
        ]),
        before,
        '建立计划不创建提交、草稿、复习状态或个人任务',
      );
    });

    await t.test('保留题目顺序，正式通过含创建前记录，运行和mastered不冒充进度', async () => {
      const ids = [
        'balanced-brackets',
        'sum-of-two',
        'array-maximum',
        'palindrome-word',
        'first-position',
        'maximum-subarray',
        'longest-unique-window',
        'grid-paths',
        'minimum-coins',
      ];
      const base = {
        ...scope(student),
        language: 'python',
        code: 'PRIVATE_SOURCE',
        mode: 'submit',
        status: 'accepted',
        results: [{ input: 'PRIVATE_INPUT', output: 'PRIVATE_OUTPUT' }],
      };
      const old = await db!.algorithmSubmission.create({
        data: {
          ...base,
          problemId: 'sum-of-two',
          createdAt: new Date('2000-01-01T00:00:00.000Z'),
        },
      });
      await db!.algorithmSubmission.createMany({
        data: [
          { ...base, problemId: 'sum-of-two', status: 'wrong_answer' },
          { ...base, problemId: 'sum-of-two' },
          { ...base, problemId: 'array-maximum', status: 'wrong_answer' },
          { ...base, problemId: 'palindrome-word', mode: 'run' },
          { ...base, problemId: 'first-position', mode: 'run', customInput: true },
          { ...base, problemId: 'maximum-subarray', customInput: true },
          { ...base, problemId: 'grid-paths', organizationId: foreign.id },
          { ...base, problemId: 'minimum-coins', userId: peer.user.id },
        ],
      });
      await db!.algorithmLearningState.create({
        data: {
          ...scope(student),
          problemId: 'longest-unique-window',
          reviewStatus: 'mastered',
          note: 'PRIVATE_NOTE',
          favorite: true,
        },
      });
      plan = await createPlan(student, {
        title: '依据正式提交的进度',
        description: '按自选顺序练习',
        problemIds: ids,
      });
      assert.ok(new Date(plan.createdAt).getTime() > old.createdAt.getTime());
      assert.deepEqual(plan.problemIds, ids);
      assert.deepEqual(
        plan.problems.map((problem) => [problem.id, problem.status]),
        [
          ['balanced-brackets', 'todo'],
          ['sum-of-two', 'solved'],
          ['array-maximum', 'attempted'],
          ['palindrome-word', 'todo'],
          ['first-position', 'todo'],
          ['maximum-subarray', 'todo'],
          ['longest-unique-window', 'todo'],
          ['grid-paths', 'todo'],
          ['minimum-coins', 'todo'],
        ],
      );
      assert.equal(plan.solved, 1);
      assert.equal(plan.total, ids.length);
      assert.equal(plan.nextProblemId, 'balanced-brackets');
      const visible = JSON.stringify(await list());
      for (const secret of [
        'PRIVATE_SOURCE',
        'PRIVATE_INPUT',
        'PRIVATE_OUTPUT',
        'PRIVATE_NOTE',
        student.user.id,
        organization.id,
      ])
        assert.ok(!visible.includes(secret), '计划读取仅返回私人计划与公开题目摘要');
      const completed = await db!.algorithmSubmission.createMany({
        data: ids.filter((id) => id !== 'sum-of-two').map((problemId) => ({ ...base, problemId })),
      });
      assert.equal(completed.count, ids.length - 1);
      const solved = await findPlan(plan.id);
      assert.equal(solved.solved, ids.length);
      assert.equal(solved.nextProblemId, null);
      assert.ok(solved.problems.every((problem) => problem.status === 'solved'));
      await db!.algorithmSubmission.deleteMany({
        where: { ...scope(student), problemId: 'balanced-brackets' },
      });
      assert.equal((await findPlan(plan.id)).nextProblemId, 'balanced-brackets');
      assert.equal((await findPlan(plan.id)).solved, ids.length - 1);
      assert.ok((await list(peer)).items.every((item) => item.id !== plan.id));
      assert.deepEqual((await list(foreignStudent)).items, []);
    });

    await t.test('私有机构与用户隔离、严格PATCH/DELETE、CAS和稳定列表顺序', async () => {
      for (const client of [peer, foreignStudent]) {
        await call(client, `${endpoint}/${plan.id}`, 'PATCH', { revision: 0, title: '越权' }, 404);
        await call(client, `${endpoint}/${plan.id}`, 'DELETE', { revision: 0 }, 404);
      }
      const formerSpacePlan = await db!.algorithmTrainingPlan.create({
        data: {
          organizationId: foreign.id,
          userId: student.user.id,
          title: '同一用户的另一空间',
          problemIds: ['sum-of-two'],
        },
      });
      assert.ok((await list()).items.every((item) => item.id !== formerSpacePlan.id));
      await call(
        student,
        `${endpoint}/${formerSpacePlan.id}`,
        'PATCH',
        { revision: 0, title: '空间越权' },
        404,
      );
      await call(student, `${endpoint}/${formerSpacePlan.id}`, 'DELETE', { revision: 0 }, 404);
      assert.equal(
        (await db!.algorithmTrainingPlan.findUniqueOrThrow({ where: { id: formerSpacePlan.id } })).revision,
        0,
      );
      await call(student, `${endpoint}/unknown`, 'PATCH', { revision: 0, archived: true }, 404);
      await call(student, `${endpoint}/unknown`, 'DELETE', { revision: 0 }, 404);
      for (const body of [
        {},
        { revision: 0 },
        { revision: -1, title: '错误' },
        { revision: 0.5, title: '错误' },
        { revision: '0', title: '错误' },
        { revision: 2147483647, title: '错误' },
        { revision: 0, title: '' },
        { revision: 0, archived: 'true' },
        { revision: 0, problemIds: [] },
        { revision: 0, problemIds: ['sum-of-two', 'sum-of-two'] },
        { revision: 0, problemIds: ['unknown-problem'] },
        { revision: 0, problemIds: catalog.slice(0, 51).map((problem) => problem.id) },
        { revision: 0, organizationId: foreign.id },
        { revision: 0, userId: peer.user.id },
        { revision: 0, solved: 50 },
        { revision: 0, description: null },
      ])
        await call(student, `${endpoint}/${plan.id}`, 'PATCH', body, 400);
      for (const body of [
        undefined,
        {},
        { revision: -1 },
        { revision: 0.5 },
        { revision: '0' },
        { revision: 0, userId: student.user.id },
        { revision: 0, title: '额外字段' },
      ])
        await call(student, `${endpoint}/${plan.id}`, 'DELETE', body, 400);
      await call(student, `${endpoint}/${plan.id}`, 'PATCH', { revision: 0, title: '无CSRF' }, 403, false);
      await call(student, `${endpoint}/${plan.id}`, 'DELETE', { revision: 0 }, 403, false);
      const parallel = await Promise.all(
        ['并发一', '并发二'].map((title) =>
          call(student, `${endpoint}/${plan.id}`, 'PATCH', { revision: 0, title }, [200, 409]),
        ),
      );
      assert.deepEqual(parallel.map((result) => result.status).sort(), [200, 409]);
      plan = await findPlan(plan.id);
      assert.equal(plan.revision, 1);
      assert.equal(plan.description, '按自选顺序练习');
      await call(student, `${endpoint}/${plan.id}`, 'DELETE', { revision: 0 }, 409);
      const originalCreatedAt = plan.createdAt;
      plan = (
        await call(student, `${endpoint}/${plan.id}`, 'PATCH', {
          revision: 1,
          archived: true,
          description: '',
          problemIds: ['array-maximum', 'sum-of-two'],
        })
      ).body;
      assert.equal(plan.revision, 2);
      assert.equal(plan.archived, true);
      assert.equal(plan.description, '');
      assert.equal(plan.createdAt, originalCreatedAt);
      assert.deepEqual(
        plan.problems.map((problem) => problem.id),
        ['array-maximum', 'sum-of-two'],
      );
      assert.equal((await list()).items.at(-1)?.id, plan.id);
      plan = (await call(student, `${endpoint}/${plan.id}`, 'PATCH', { revision: 2, archived: false })).body;
      assert.equal(plan.revision, 3);
      const equalDate = new Date('2001-01-01T00:00:00.000Z');
      const prefix = `order_${suffix}`;
      await db!.algorithmTrainingPlan.createMany({
        data: [
          {
            ...scope(peer),
            id: `${prefix}_b`,
            title: '同时间后',
            problemIds: ['sum-of-two'],
            createdAt: equalDate,
          },
          {
            ...scope(peer),
            id: `${prefix}_a`,
            title: '同时间先',
            problemIds: ['sum-of-two'],
            createdAt: equalDate,
          },
          {
            ...scope(peer),
            id: `${prefix}_archived`,
            title: '归档最后',
            problemIds: ['sum-of-two'],
            archived: true,
            createdAt: new Date(0),
          },
        ],
      });
      assert.deepEqual(
        (await list(peer)).items.map((item) => item.id),
        [`${prefix}_a`, `${prefix}_b`, `${prefix}_archived`],
      );
      const disposable = await createPlan(student, { title: '并发删除' });
      const deletion = await Promise.all(
        [0, 1].map(() =>
          call(student, `${endpoint}/${disposable.id}`, 'DELETE', { revision: 0 }, [200, 404]),
        ),
      );
      assert.deepEqual(deletion.map((result) => result.status).sort(), [200, 404]);
      assert.deepEqual(deletion.find((result) => result.status === 200)?.body, { ok: true });
      assert.equal(await db!.algorithmTrainingPlan.findUnique({ where: { id: disposable.id } }), null);
      const mixedPlan = await createPlan(student, { title: '修改与删除竞争' });
      const mixed = await Promise.all([
        call(student, `${endpoint}/${mixedPlan.id}`, 'PATCH', { revision: 0, title: '竞争成功' }, [200, 404]),
        call(student, `${endpoint}/${mixedPlan.id}`, 'DELETE', { revision: 0 }, [200, 409]),
      ]);
      assert.equal(mixed.filter((result) => result.status === 200).length, 1);
      const remaining = await db!.algorithmTrainingPlan.findUnique({ where: { id: mixedPlan.id } });
      if (mixed[0].status === 200) {
        assert.equal(mixed[1].status, 409);
        assert.equal(remaining?.revision, 1);
        assert.equal(remaining?.title, '竞争成功');
      } else assert.equal(remaining, null);
    });

    await t.test('归档也计入20份配额，并发创建只占用最后一个名额', async () => {
      await db!.algorithmTrainingPlan.createMany({
        data: Array.from({ length: 19 }, (_, i) => ({
          ...scope(quotaStudent),
          title: `配额${i}`,
          problemIds: ['sum-of-two'],
          archived: i % 2 === 0,
        })),
      });
      const responses = await Promise.all(
        [0, 1, 2].map(() =>
          call(
            quotaStudent,
            endpoint,
            'POST',
            { title: '争抢最后名额', problemIds: ['sum-of-two'] },
            [201, 409],
          ),
        ),
      );
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409, 409]);
      assert.equal((await list(quotaStudent)).items.length, 20);
      assert.equal(await db!.algorithmTrainingPlan.count({ where: scope(quotaStudent) }), 20);
      assert.ok((await list(quotaStudent)).items.some((item) => item.archived));
      const removed = responses.find((response) => response.status === 201)!.body as Plan;
      await call(quotaStudent, `${endpoint}/${removed.id}`, 'DELETE', { revision: 0 });
      await createPlan(quotaStudent, { title: '删除后可再创建' });
      await createPlan(foreignStudent, { title: '其他空间配额独立' });
    });

    await t.test('practice和learning.use关闭阻断读写，旧会话失效', async () => {
      await db!.systemSetting.create({
        data: { organizationId: organization.id, key: 'features', value: { practice: false } },
      });
      try {
        await call(student, endpoint, 'GET', undefined, 403);
        await call(student, endpoint, 'POST', { title: '禁止', problemIds: ['sum-of-two'] }, 403);
        await call(
          student,
          `${endpoint}/${plan.id}`,
          'PATCH',
          { revision: plan.revision, title: '禁止' },
          403,
        );
        await call(student, `${endpoint}/${plan.id}`, 'DELETE', { revision: plan.revision }, 403);
        await list(foreignStudent);
      } finally {
        await db!.systemSetting.delete({
          where: { organizationId_key: { organizationId: organization.id, key: 'features' } },
        });
      }
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
      });
      try {
        await call(student, endpoint, 'GET', undefined, 403);
        await call(student, endpoint, 'POST', { title: '禁止', problemIds: ['sum-of-two'] }, 403);
        await call(
          student,
          `${endpoint}/${plan.id}`,
          'PATCH',
          { revision: plan.revision, title: '禁止' },
          403,
        );
        await call(student, `${endpoint}/${plan.id}`, 'DELETE', { revision: plan.revision }, 403);
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'learning.use' } });
      }
      await db!.user.update({ where: { id: peer.user.id }, data: { authVersion: { increment: 1 } } });
      await call(peer, endpoint, 'GET', undefined, 401);
      await call(peer, endpoint, 'POST', { title: '旧会话', problemIds: ['sum-of-two'] }, 401);
    });

    // Observe pg_blocking_pids rather than relying on elapsed time: each request has
    // already passed AuthGuard and is waiting for the exact held User row lock.
    async function queuedWrite(
      action: () => Promise<unknown>,
      revoke: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) {
      let pending: Promise<{ value?: unknown; error?: unknown }> | undefined;
      await db!.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${queuedStudent.user.id} FOR UPDATE`;
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pending = action().then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
          let blocked = false;
          for (let attempt = 0; attempt < 150; attempt++) {
            const [state] = await owner.$queryRaw<{ blocked: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked
          `;
            if (state.blocked) {
              blocked = true;
              break;
            }
            await wait(20);
          }
          assert.ok(blocked, '训练计划写请求应确实等待该用户锁');
          await revoke(tx);
        },
        { timeout: 10000 },
      );
      assert.ok(pending);
      const outcome = await pending;
      if (outcome.error) throw outcome.error;
    }
    await t.test('等待User锁期间撤销会话，创建在锁释放后401且没有写入', async () => {
      const before = await db!.algorithmTrainingPlan.count({ where: scope(queuedStudent) });
      await queuedWrite(
        () =>
          call(queuedStudent, endpoint, 'POST', { title: '排队撤销会话', problemIds: ['sum-of-two'] }, 401),
        (tx) => tx.session.deleteMany({ where: { userId: queuedStudent.user.id } }),
      );
      assert.equal(await db!.algorithmTrainingPlan.count({ where: scope(queuedStudent) }), before);
      queuedStudent = await login(queuedStudent.user.username);
    });
    await t.test('等待User锁期间关闭practice，PATCH在锁释放后403且内容不变', async () => {
      const queuedPlan = await createPlan(queuedStudent, { title: '锁后功能复核' });
      const before = await db!.algorithmTrainingPlan.findUniqueOrThrow({ where: { id: queuedPlan.id } });
      try {
        await queuedWrite(
          () =>
            call(
              queuedStudent,
              `${endpoint}/${queuedPlan.id}`,
              'PATCH',
              { revision: 0, title: '不应保存' },
              403,
            ),
          (tx) =>
            tx.systemSetting.create({
              data: { organizationId: organization.id, key: 'features', value: { practice: false } },
            }),
        );
        assert.deepEqual(
          await db!.algorithmTrainingPlan.findUniqueOrThrow({ where: { id: queuedPlan.id } }),
          before,
        );
      } finally {
        await db!.systemSetting.deleteMany({ where: { organizationId: organization.id, key: 'features' } });
      }
    });
    await t.test('等待User锁期间撤销learning.use，DELETE在锁释放后403且计划保留', async () => {
      const queuedPlan = await createPlan(queuedStudent, { title: '锁后权限复核' });
      const before = await db!.algorithmTrainingPlan.findUniqueOrThrow({ where: { id: queuedPlan.id } });
      try {
        await queuedWrite(
          () => call(queuedStudent, `${endpoint}/${queuedPlan.id}`, 'DELETE', { revision: 0 }, 403),
          (tx) =>
            tx.rolePermission.delete({
              where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
            }),
        );
        assert.deepEqual(
          await db!.algorithmTrainingPlan.findUniqueOrThrow({ where: { id: queuedPlan.id } }),
          before,
        );
      } finally {
        await db!.rolePermission.createMany({
          data: [{ roleId: 'STUDENT', permissionId: 'learning.use' }],
          skipDuplicates: true,
        });
      }
    });
    assert.ok(!logs.includes(password), 'API日志不能包含测试密码');
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : '训练计划集成验收失败'));
  } finally {
    await stop(api);
    await stop(migration);
    await db?.$disconnect();
    if (created) {
      assert.match(databaseName, /^algorithm_training_it_[a-f0-9]{16}$/);
      try {
        await owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      } catch {
        t.diagnostic('随机测试库清理失败；请仅检查algorithm_training_it_前缀的遗留测试库。未触碰业务库。');
      }
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
