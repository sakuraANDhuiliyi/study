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
const endpoint = '/planner/actions';
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

test('学习行动清单：独立数据库真实HTTP、有效截止、分页和权限', { timeout: 180_000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production', '集成测试禁止在production模式运行');
  const configured =
    process.env.LEARNING_ACTIONS_TEST_ADMIN_DATABASE_URL ||
    process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL ||
    (process.env.DOTENV_CONFIG_PATH && process.env.DATABASE_URL);
  assert.ok(
    configured,
    '需要显式本机review/test数据库：LEARNING_ACTIONS_TEST_ADMIN_DATABASE_URL、ACADEMICS_TEST_ADMIN_DATABASE_URL或DOTENV_CONFIG_PATH',
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
  const databaseName = `learning_actions_it_${suffix}`;
  assert.match(databaseName, /^learning_actions_it_[a-f0-9]{16}$/);
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
  const directory = mkdtempSync(join(tmpdir(), 'learning-actions-http-'));
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
    LEARNING_ACTIONS_FIXTURE_TIME: '2028-12-31T10:15:00.000Z',
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
    const organization = await db.organization.create({ data: { name: '行动清单验收机构甲' } });
    const foreign = await db.organization.create({ data: { name: '行动清单验收机构乙' } });
    const hash = await hashPasswordAsync(password);
    const makeUser = async (tag: string, roleId = 'STUDENT', organizationId = organization.id) =>
      db!.user.create({
        data: {
          username: `actions_${suffix}_${tag}`,
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
      makeUser('admin', 'ADMIN'),
      makeUser('teacher', 'TEACHER'),
      makeUser('queued'),
    ]);
    // The production API has no clock override. Only this suite's own child process
    // receives a preload so midnight/right-edge tests are repeatable on any date.
    const clockPath = join(directory, 'fixture-clock.cjs');
    writeFileSync(
      clockPath,
      'const NativeDate=Date;const stamp=NativeDate.parse(process.env.LEARNING_ACTIONS_FIXTURE_TIME);' +
        'global.Date=class extends NativeDate{constructor(...args){if(args.length)super(...args);else super(stamp);}static now(){return stamp;}};',
      { mode: 0o600 },
    );
    api = spawn(process.execPath, ['--require', clockPath, 'apps/api/dist/main.js'], {
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
    const [student, peer, foreignStudent, admin, teacher, initialQueued] = await Promise.all(
      fixtures.map((user) => login(user.username)),
    );
    let queued = initialQueued;
    const list = async (client = student, bucket = 'today', page = 1, pageSize = 20) =>
      (
        await call(
          client,
          `${endpoint}?${new URLSearchParams({ bucket, page: String(page), pageSize: String(pageSize) })}`,
        )
      ).body;
    const course = await db.course.create({
      data: {
        organizationId: organization.id,
        teacherId: teacher.user.id,
        title: '行动验收课程',
        status: 'PUBLISHED',
      },
    });
    await db.enrollment.createMany({
      data: [student, peer].map((client) => ({ courseId: course.id, userId: client.user.id })),
    });
    const makeAssignment = (tag: string, overrides: Record<string, any> = {}) =>
      db!.assignment.create({
        data: {
          organizationId: organization.id,
          courseId: course.id,
          creatorId: teacher.user.id,
          title: tag,
          status: 'published',
          opensAt: new Date('2028-12-01T00:00:00Z'),
          dueAt: new Date('2028-12-31T12:00:00Z'),
          totalCents: 100,
          attachmentIds: [],
          maxAttempts: 3,
          audience: { create: { userId: student.user.id } },
          ...overrides,
        },
      });
    const makeExam = (tag: string, overrides: Record<string, any> = {}) =>
      db!.exam.create({
        data: {
          organizationId: organization.id,
          courseId: course.id,
          creatorId: teacher.user.id,
          title: tag,
          status: 'published',
          startsAt: new Date('2028-12-31T10:00:00Z'),
          endsAt: new Date('2028-12-31T14:00:00Z'),
          entryClosesAt: new Date('2028-12-31T13:00:00Z'),
          durationMinutes: 60,
          passCents: 60,
          totalCents: 100,
          graderIds: [],
          audience: { create: { userId: student.user.id } },
          ...overrides,
        },
      });
    const submission = (userId: string, version: number, status: string) => ({
      userId,
      version,
      status,
      idempotencyKey: `${suffix}-${userId}-${version}-${status}`,
      answers: { secret: 'PRIVATE_FORMAL_ANSWER' },
      attachmentIds: [],
      late: false,
    });
    const attempt = (
      userId: string,
      number: number,
      status: string,
      deadlineAt = '2028-12-31T12:30:00Z',
    ) => ({
      userId,
      number,
      status,
      deadlineAt: new Date(deadlineAt),
      questionOrder: ['PRIVATE_QUESTION'],
      optionOrder: { private: 'PRIVATE_OPTION_ORDER' },
      flags: [],
    });

    await t.test('学生入口、严格输入、摘要与时间契约', async () => {
      await call(null, endpoint, 'GET', undefined, 401);
      for (const client of [admin, teacher]) await call(client, endpoint, 'GET', undefined, 403);
      const empty = await list();
      assert.deepEqual(empty.items, []);
      assert.deepEqual(empty.counts, { today: 0, upcoming: 0, overdue: 0 });
      assert.equal(empty.timezone, 'Asia/Shanghai');
      assert.equal(empty.serverTime, env.LEARNING_ACTIONS_FIXTURE_TIME);
      assert.deepEqual(empty.range, {
        todayStart: '2028-12-30T16:00:00.000Z',
        tomorrowStart: '2028-12-31T16:00:00.000Z',
        upcomingEnd: '2029-01-07T16:00:00.000Z',
      });
      for (const query of [
        'bucket=all',
        'page=0',
        'page=1.1',
        'page=10001',
        'pageSize=21',
        'userId=peer',
        'organizationId=foreign',
        'now=2000-01-01',
        'bucket=today&bucket=overdue',
      ])
        await call(student, `${endpoint}?${query}`, 'GET', undefined, 400);
      await db!.systemSetting.create({
        data: { organizationId: organization.id, key: 'features', value: { practice: false } },
      });
      try {
        await list();
      } finally {
        await db!.systemSetting.delete({
          where: {
            organizationId_key: { organizationId: organization.id, key: 'features' },
          },
        });
      }
    });

    await t.test('最新正式提交优先：草稿不等于提交，returned重新进入行动清单', async () => {
      const withDraft = await makeAssignment('只有草稿', {
        drafts: {
          create: { userId: student.user.id, answers: { secret: 'PRIVATE_DRAFT_ANSWER' }, attachmentIds: [] },
        },
      });
      const submitted = await makeAssignment('正式提交后仍存草稿', {
        submissions: { create: submission(student.user.id, 1, 'submitted') },
        drafts: { create: { userId: student.user.id, answers: { secret: 'OLD_DRAFT' }, attachmentIds: [] } },
      });
      const returned = await makeAssignment('正式退回等待重交', {
        submissions: {
          create: [submission(student.user.id, 1, 'submitted'), submission(student.user.id, 2, 'returned')],
        },
      });
      const resubmitted = await makeAssignment('最新正式提交完成', {
        submissions: {
          create: [submission(student.user.id, 1, 'returned'), submission(student.user.id, 2, 'submitted')],
        },
      });
      const strangerSubmitted = await makeAssignment('同学提交不影响本人', {
        submissions: { create: submission(peer.user.id, 1, 'submitted') },
      });
      const response = await list();
      assert.equal(response.items.find((item: any) => item.id === withDraft.id).status, 'not_submitted');
      assert.equal(response.items.find((item: any) => item.id === returned.id).action, 'resubmit');
      assert.ok(response.items.some((item: any) => item.id === strangerSubmitted.id));
      assert.ok(!response.items.some((item: any) => [submitted.id, resubmitted.id].includes(item.id)));
      assert.ok(
        !/PRIVATE|answers|optionOrder|snapshot|scoreCents|userId|organizationId|csrfToken/.test(
          JSON.stringify(response),
        ),
      );
    });

    await t.test('补交、豁免、迟交和次数上限使用本人的真实规则', async () => {
      const extension = await makeAssignment('原截止已过但本人可补交', {
        dueAt: new Date('2028-12-29T12:00:00Z'),
        exceptions: {
          create: {
            userId: student.user.id,
            approvedBy: teacher.user.id,
            reason: '本人补交验收',
            allowUntil: new Date('2028-12-31T12:00:00Z'),
          },
        },
      });
      const closed = await makeAssignment('过期不允许补交', { dueAt: new Date('2028-12-31T10:00:00Z') });
      const late = await makeAssignment('允许迟交', {
        dueAt: new Date('2028-12-31T10:00:00Z'),
        allowLate: true,
      });
      const peerExtension = await makeAssignment('同学补交不影响本人', {
        dueAt: new Date('2028-12-29T12:00:00Z'),
        exceptions: {
          create: {
            userId: peer.user.id,
            approvedBy: teacher.user.id,
            reason: '只批准同学补交',
            allowUntil: new Date('2028-12-31T12:00:00Z'),
          },
        },
      });
      const notInAudience = await makeAssignment('未分配给本人', {
        audience: { create: { userId: peer.user.id } },
      });
      const exhausted = await makeAssignment('已达重交次数', {
        maxAttempts: 1,
        submissions: { create: submission(student.user.id, 1, 'returned') },
      });
      const allowed = await makeAssignment('本人获准额外重交', {
        maxAttempts: 1,
        submissions: { create: submission(student.user.id, 1, 'returned') },
        exceptions: {
          create: {
            userId: student.user.id,
            approvedBy: teacher.user.id,
            reason: '允许重交',
            extraAttempts: 1,
          },
        },
      });
      const exempt = await makeAssignment('本人已豁免', {
        exceptions: {
          create: { userId: student.user.id, approvedBy: teacher.user.id, reason: '已豁免', exempt: true },
        },
      });
      const future = await makeAssignment('未开放不显示', { opensAt: new Date('2028-12-31T11:00:00Z') });
      const today = await list();
      const overdue = await list(student, 'overdue');
      const extended = today.items.find((item: any) => item.id === extension.id);
      assert.equal(extended.dueAt, '2028-12-31T12:00:00.000Z');
      assert.equal(extended.originalDueAt, '2028-12-29T12:00:00.000Z');
      assert.equal(extended.overdue, false);
      assert.equal(extended.action, 'submit');
      assert.equal(overdue.items.find((item: any) => item.id === closed.id).reason, 'deadline_passed');
      assert.equal(overdue.items.find((item: any) => item.id === closed.id).action, 'view');
      assert.equal(overdue.items.find((item: any) => item.id === late.id).actionLabel, '补交作业');
      assert.equal(overdue.items.find((item: any) => item.id === peerExtension.id).reason, 'deadline_passed');
      assert.equal(today.items.find((item: any) => item.id === exhausted.id).reason, 'attempt_limit');
      assert.equal(today.items.find((item: any) => item.id === allowed.id).action, 'resubmit');
      assert.ok(!today.items.some((item: any) => [exempt.id, future.id, notInAudience.id].includes(item.id)));
      assert.deepEqual(
        (await list(peer)).items.map((item: any) => item.id),
        [notInAudience.id],
      );
    });

    await t.test('考试按本人答卷或延期窗口行动，并且尊重允许重试次数', async () => {
      const active = await makeExam('全班已结束但答卷仍有效', {
        startsAt: new Date('2028-12-30T01:00:00Z'),
        endsAt: new Date('2028-12-30T03:00:00Z'),
        entryClosesAt: new Date('2028-12-30T02:00:00Z'),
        attempts: { create: attempt(student.user.id, 1, 'in_progress') },
      });
      const extended = await makeExam('个人延期可进入', {
        endsAt: new Date('2028-12-31T10:01:00Z'),
        entryClosesAt: new Date('2028-12-31T10:00:00Z'),
        extensions: {
          create: {
            userId: student.user.id,
            approvedBy: teacher.user.id,
            reason: '延期验证',
            deadlineAt: new Date('2028-12-31T12:00:00Z'),
          },
        },
      });
      const repeated = await makeExam('正式交卷后仍可重试', {
        maxAttempts: 2,
        attempts: { create: attempt(student.user.id, 1, 'submitted') },
      });
      const used = await makeExam('正式交卷次数用完', {
        attempts: { create: attempt(student.user.id, 1, 'submitted') },
      });
      const timeoutUsed = await makeExam('超时答卷次数用完', {
        attempts: { create: attempt(student.user.id, 1, 'timed_out') },
      });
      const expired = await makeExam('答卷截止不可继续', {
        attempts: { create: attempt(student.user.id, 1, 'in_progress', '2028-12-31T10:15:00Z') },
      });
      const cancelled = await makeExam('取消考试', { status: 'cancelled' });
      const ineligible = await makeExam('无参考资格', {
        audience: { create: { userId: student.user.id, eligible: false } },
      });
      const entryClosed = await makeExam('入场已关闭', { entryClosesAt: new Date('2028-12-31T10:15:00Z') });
      const released = await makeExam('成绩已发布不可再开始', {
        gradesReleasedAt: new Date('2028-12-31T10:00:00Z'),
      });
      const response = await list();
      const ongoing = response.items.find((item: any) => item.id === active.id);
      const ownedAttempt = await db!.examAttempt.findFirstOrThrow({
        where: { examId: active.id, userId: student.user.id },
      });
      assert.equal(ongoing.action, 'continue_exam');
      assert.equal(ongoing.path, `/exam-attempts/${ownedAttempt.id}`);
      assert.equal(ongoing.dueAt, '2028-12-31T12:30:00.000Z');
      assert.equal(response.items.find((item: any) => item.id === extended.id).action, 'start_exam');
      assert.equal(response.items.find((item: any) => item.id === repeated.id).actionLabel, '再次考试');
      for (const hidden of [used, timeoutUsed, expired, cancelled, ineligible, entryClosed, released])
        assert.ok(!response.items.some((item: any) => item.id === hidden.id), hidden.title);
    });

    await t.test('上海午夜、未来7日右边界和今天已逾期互不双算', async () => {
      const tasks = await Promise.all(
        [
          ['exact-now', '2028-12-31T10:15:00Z'],
          ['today-overdue', '2028-12-31T10:14:59.999Z'],
          ['today-end', '2028-12-31T15:59:59.999Z'],
          ['tomorrow-start', '2028-12-31T16:00:00Z'],
          ['future-last', '2029-01-07T15:59:59.999Z'],
          ['future-excluded', '2029-01-07T16:00:00Z'],
        ].map(([title, dueAt]) =>
          db!.personalTask.create({
            data: { organizationId: organization.id, userId: student.user.id, title, dueAt: new Date(dueAt) },
          }),
        ),
      );
      const today = await list();
      const future = await list(student, 'upcoming');
      const overdue = await list(student, 'overdue');
      for (const index of [0, 2]) assert.ok(today.items.some((item: any) => item.id === tasks[index].id));
      assert.ok(overdue.items.some((item: any) => item.id === tasks[1].id));
      for (const index of [3, 4]) assert.ok(future.items.some((item: any) => item.id === tasks[index].id));
      for (const data of [today, future, overdue])
        assert.ok(!data.items.some((item: any) => item.id === tasks[5].id));
      const ids = [...today.items, ...future.items, ...overdue.items].map(
        (item: any) => `${item.type}:${item.id}`,
      );
      assert.equal(new Set(ids).size, ids.length);
    });

    await t.test('501条逾期行独立分页，不能挤掉未来任务，计数不是采样值', async () => {
      const before = await list(student, 'overdue');
      await db!.personalTask.createMany({
        data: Array.from({ length: 501 }, (_, index) => ({
          id: `actions-page-${suffix}-${String(index).padStart(3, '0')}`,
          organizationId: organization.id,
          userId: student.user.id,
          title: `历史逾期${index}`,
          dueAt: new Date('2028-12-28T12:00:00Z'),
        })),
      });
      const first = await list(student, 'overdue', 1, 20);
      assert.equal(first.total, before.total + 501);
      assert.equal(first.counts.overdue, first.total);
      assert.equal(first.items.length, 20);
      const second = await list(student, 'overdue', 2, 20);
      assert.equal(new Set([...first.items, ...second.items].map((item: any) => item.id)).size, 40);
      const final = await list(student, 'overdue', Math.ceil(first.total / 20), 20);
      assert.equal(final.items.length, first.total % 20 || 20);
      const beyond = await list(student, 'overdue', Math.ceil(first.total / 20) + 1, 20);
      assert.deepEqual(beyond.items, []);
      assert.equal(beyond.total, first.total);
      const future = await list(student, 'upcoming');
      assert.equal(future.items.length, future.total);
      assert.ok(future.items.some((item: any) => item.title === 'tomorrow-start'));
    });

    await t.test('个人待办CAS与外人隔离，完成移除、重开恢复', async () => {
      const created = (
        await call(student, '/planner/tasks', 'POST', {
          title: '接口创建待办',
          dueAt: '2028-12-31T14:00:00Z',
        })
      ).body;
      for (const client of [peer, foreignStudent, teacher, admin]) {
        await call(client, `/planner/tasks/${created.id}`, 'GET', undefined, 404);
        if (client.user.role === 'STUDENT')
          assert.ok(!(await list(client)).items.some((item: any) => item.id === created.id));
      }
      const updated = (
        await call(student, `/planner/tasks/${created.id}`, 'PATCH', { revision: 0, completed: true })
      ).body;
      assert.equal(updated.revision, 1);
      assert.ok(!(await list()).items.some((item: any) => item.id === created.id));
      await call(student, `/planner/tasks/${created.id}`, 'PATCH', { revision: 0, completed: false }, 409);
      const reopened = (
        await call(student, `/planner/tasks/${created.id}`, 'PATCH', { revision: 1, completed: false })
      ).body;
      assert.equal(reopened.revision, 2);
      assert.equal((await list()).items.find((item: any) => item.id === created.id).revision, 2);
    });

    await t.test('三个连接的API池支持六个并发清单读取并保持匹配结果一致', async () => {
      const expected = await list();
      const replies = await Promise.all(Array.from({ length: 6 }, () => list()));
      for (const reply of replies) {
        assert.deepEqual(reply.items, expected.items);
        assert.deepEqual(reply.counts, expected.counts);
        assert.equal(reply.total, expected.total);
        assert.equal(reply.page, expected.page);
        assert.equal(reply.pageSize, expected.pageSize);
      }
    });

    async function delayedRead(
      expected: number,
      revoke: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>,
    ) {
      let pending: Promise<{ error?: unknown }> | undefined;
      await db!.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('LOCK TABLE "PersonalTask" IN ACCESS EXCLUSIVE MODE');
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pending = call(queued, endpoint, 'GET', undefined, expected).then(
            () => ({}),
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
          assert.ok(blocked, '学习行动读取应已通过AuthGuard并等待本测试持有的PersonalTask表锁');
          await revoke(tx);
        },
        { timeout: 10000 },
      );
      assert.ok(pending);
      const outcome = await pending;
      if (outcome.error) throw outcome.error;
    }
    await t.test('SELECT等待期间注销，读取完成后重新验证会话并拒绝旧私有结果', async () => {
      await delayedRead(401, (tx) => tx.session.deleteMany({ where: { userId: queued.user.id } }));
      queued = await login(fixtures[5].username);
    });
    await t.test('SELECT等待期间撤销学习权限，返回前403且不泄露结果', async () => {
      try {
        await delayedRead(403, (tx) =>
          tx.rolePermission.delete({
            where: {
              roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' },
            },
          }),
        );
      } finally {
        await db!.rolePermission.createMany({
          data: [{ roleId: 'STUDENT', permissionId: 'learning.use' }],
          skipDuplicates: true,
        });
      }
    });
    await t.test('SELECT等待期间变更学习空间，返回前拒绝旧机构结果', async () => {
      try {
        await delayedRead(401, (tx) =>
          tx.user.update({ where: { id: queued.user.id }, data: { organizationId: foreign.id } }),
        );
      } finally {
        await db!.user.update({ where: { id: queued.user.id }, data: { organizationId: organization.id } });
      }
    });
    await t.test('SELECT等待期间撤销Enrollment或任务受众，不返回旧课程行或计数', async () => {
      await db!.enrollment.create({ data: { userId: queued.user.id, courseId: course.id } });
      const assigned = await makeAssignment('等待读取课程授权复核', {
        audience: { create: { userId: queued.user.id } },
      });
      assert.equal((await list(queued)).total, 1);
      for (const source of ['enrollment', 'audience']) {
        let response: Awaited<ReturnType<typeof call>> | undefined;
        let pending: Promise<{ error?: unknown }> | undefined;
        await db!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('LOCK TABLE "PersonalTask" IN ACCESS EXCLUSIVE MODE');
            const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            pending = call(queued, endpoint, 'GET', undefined, [200, 403]).then(
              (value) => {
                response = value;
                return {};
              },
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
            assert.ok(blocked, '行动SELECT确实等待测试表锁后才能撤销课程授权');
            if (source === 'enrollment')
              await tx.enrollment.update({
                where: { courseId_userId: { courseId: course.id, userId: queued.user.id } },
                data: { active: false },
              });
            else
              await tx.assignmentAudience.delete({
                where: {
                  assignmentId_userId: { assignmentId: assigned.id, userId: queued.user.id },
                },
              });
          },
          { timeout: 10000 },
        );
        assert.ok(pending);
        const outcome = await pending;
        if (outcome.error) throw outcome.error;
        assert.ok(response);
        // A new statement snapshot may already exclude revoked data. Otherwise,
        // a stale snapshot must be rejected by the fresh ACL check, never returned.
        if (response.status === 200) {
          assert.deepEqual(response.body.items, []);
          assert.deepEqual(response.body.counts, { today: 0, upcoming: 0, overdue: 0 });
          assert.equal(response.body.total, 0);
        } else assert.equal(response.status, 403);
        if (source === 'enrollment')
          await db!.enrollment.update({
            where: { courseId_userId: { courseId: course.id, userId: queued.user.id } },
            data: { active: true },
          });
        else
          await db!.assignmentAudience.create({
            data: { assignmentId: assigned.id, userId: queued.user.id },
          });
        assert.equal((await list(queued)).total, 1);
      }
    });

    await t.test('有效课程、受众、身份和机构过滤；learning.use必需，course.read仅控制课程来源', async () => {
      const foreignCourse = await db!.course.create({
        data: {
          organizationId: foreign.id,
          teacherId: teacher.user.id,
          title: '外机构课程',
          status: 'PUBLISHED',
        },
      });
      await db!.enrollment.create({ data: { userId: student.user.id, courseId: foreignCourse.id } });
      await makeAssignment('跨机构ID伪关联', { courseId: foreignCourse.id });
      assert.ok(!(await list()).items.some((item: any) => item.title === '跨机构ID伪关联'));
      await db!.enrollment.update({
        where: { courseId_userId: { courseId: course.id, userId: student.user.id } },
        data: { active: false },
      });
      assert.ok((await list()).items.every((item: any) => item.type === 'personal'));
      await db!.enrollment.update({
        where: { courseId_userId: { courseId: course.id, userId: student.user.id } },
        data: { active: true },
      });
      await db!.course.update({ where: { id: course.id }, data: { status: 'DRAFT' } });
      assert.ok((await list()).items.every((item: any) => item.type === 'personal'));
      await db!.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });
      assert.ok((await list()).items.some((item: any) => item.type === 'assignment'));
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
      });
      try {
        await call(student, endpoint, 'GET', undefined, 403);
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'learning.use' } });
      }
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'course.read' } },
      });
      try {
        assert.ok((await list()).items.every((item: any) => item.type === 'personal'));
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'course.read' } });
      }
      assert.deepEqual((await list(foreignStudent)).items, []);
      await db!.user.update({ where: { id: peer.user.id }, data: { authVersion: { increment: 1 } } });
      await call(peer, endpoint, 'GET', undefined, 401);
      await db!.organization.update({ where: { id: foreign.id }, data: { active: false } });
      await call(foreignStudent, endpoint, 'GET', undefined, 401);
    });
    assert.ok(!logs.includes(password), 'API日志不能包含测试密码');
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : '学习行动集成验收失败'));
  } finally {
    await stop(api);
    await stop(migration);
    await db?.$disconnect();
    if (created) {
      assert.match(databaseName, /^learning_actions_it_[a-f0-9]{16}$/);
      try {
        await owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      } catch {
        t.diagnostic('随机测试库清理失败；仅检查learning_actions_it_前缀的遗留测试库。未触碰业务库。');
      }
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
