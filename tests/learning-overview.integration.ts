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
const endpoint = '/dashboard';
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

test('学生学习概览：独立数据库真实HTTP、精确计数与实际提交考试窗口', { timeout: 180_000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production', '集成测试禁止在production模式运行');
  const configured =
    process.env.LEARNING_OVERVIEW_TEST_ADMIN_DATABASE_URL ||
    process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL ||
    (process.env.DOTENV_CONFIG_PATH && process.env.DATABASE_URL);
  assert.ok(
    configured,
    '需要显式本机review/test数据库：LEARNING_OVERVIEW_TEST_ADMIN_DATABASE_URL、ACADEMICS_TEST_ADMIN_DATABASE_URL或DOTENV_CONFIG_PATH',
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
  const databaseName = `learning_overview_it_${suffix}`;
  assert.match(databaseName, /^learning_overview_it_[a-f0-9]{16}$/);
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
  const directory = mkdtempSync(join(tmpdir(), 'learning-overview-http-'));
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
    LEARNING_OVERVIEW_FIXTURE_TIME: '2028-12-31T10:15:00.000Z',
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
    const organization = await db.organization.create({ data: { name: '学习概览验收机构甲' } });
    const foreign = await db.organization.create({ data: { name: '学习概览验收机构乙' } });
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
    ]);
    // The production API has no clock override. Only this suite's own child process
    // receives a preload so midnight/right-edge tests are repeatable on any date.
    const clockPath = join(directory, 'fixture-clock.cjs');
    writeFileSync(
      clockPath,
      'const NativeDate=Date;const stamp=NativeDate.parse(process.env.LEARNING_OVERVIEW_FIXTURE_TIME);' +
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
    const [student, peer, foreignStudent, admin, teacher] = await Promise.all(
      fixtures.map((user) => login(user.username)),
    );
    let activeStudent = student;
    const overview = async (client = activeStudent) => (await call(client, endpoint)).body;
    const list = async (client = activeStudent, bucket = 'today') =>
      (await call(client, `/planner/actions?bucket=${bucket}&pageSize=20`)).body;
    function counts(response: any) {
      assert.equal(response.learningOverview.serverTime, env.LEARNING_OVERVIEW_FIXTURE_TIME);
      assert.deepEqual(response.learningOverview, {
        serverTime: env.LEARNING_OVERVIEW_FIXTURE_TIME,
        timezone: 'Asia/Shanghai',
        scope: 'actionable_now',
      });
      assert.deepEqual(
        response.metrics.map((item: any) => item.label),
        ['在学课程', '当前待交作业', '当前可作答考试', '已完成课时'],
      );
      assert.equal(response.metrics[1].detail, '未交或退回且现在可提交，不限7天');
      assert.equal(response.metrics[2].detail, '现在可进入或继续作答，尚未开始不计入');
      assert.ok(
        !/PRIVATE|answers|optionOrder|snapshot|scoreCents|csrfToken|passwordHash/.test(
          JSON.stringify(response),
        ),
      );
      return [response.metrics[1].value, response.metrics[2].value];
    }
    const course = await db.course.create({
      data: {
        organizationId: organization.id,
        teacherId: teacher.user.id,
        title: '概览验收课程',
        status: 'PUBLISHED',
      },
    });
    await db.enrollment.createMany({
      data: [student, peer].map((client) => ({ courseId: course.id, userId: client.user.id })),
    });
    await db.teachingAssignment.create({ data: { courseId: course.id, userId: teacher.user.id } });
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
          audience: { create: { userId: activeStudent.user.id } },
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
          audience: { create: { userId: activeStudent.user.id } },
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

    const stamp = new Date(env.LEARNING_OVERVIEW_FIXTURE_TIME);
    const at = (delta: number) => new Date(stamp.getTime() + delta);
    let caseIndex = 0;
    const run = (name: string, fn: (learner: Client) => Promise<void>) =>
      t.test(name, async () => {
        const user = await makeUser(`case-${caseIndex++}`);
        const learner = await login(user.username);
        await db!.enrollment.create({ data: { courseId: course.id, userId: user.id } });
        activeStudent = learner;
        await fn(learner);
      });
    const question = async (tag: string) =>
      (
        await call(teacher, '/questions', 'POST', {
          courseId: course.id,
          type: 'single',
          stem: `${tag}-${suffix}`,
          options: [
            { id: 'A', text: '正确' },
            { id: 'B', text: '错误' },
          ],
          answer: 'A',
          explanation: 'PRIVATE_ANSWER_EXPLANATION',
          scoreCents: 100,
          practiceEnabled: false,
          scope: 'private',
        })
      ).body;
    const realExam = async (learner: Client, tag: string, maxAttempts = 2) => {
      const q = await question(`保密考试${tag}`);
      const exam = (
        await call(teacher, '/exams', 'POST', {
          courseId: course.id,
          title: tag,
          startsAt: at(-60_000).toISOString(),
          endsAt: at(4 * 3600_000).toISOString(),
          entryClosesAt: at(2 * 3600_000).toISOString(),
          durationMinutes: 60,
          questionVersionIds: [q.versions[0].id],
          audienceIds: [learner.user.id],
          maxAttempts,
          passCents: 60,
        })
      ).body;
      await call(teacher, `/exams/${exam.id}/publish`, 'POST', {});
      assert.ok(await db!.examPaperItem.count({ where: { snapshot: { examId: exam.id } } }));
      return exam;
    };

    await t.test('学生合同与空概览；教师和管理员保留原指标', async () => {
      await call(null, endpoint, 'GET', undefined, 401);
      assert.deepEqual(counts(await overview(student)), [0, 0]);
      assert.deepEqual(counts(await overview(foreignStudent)), [0, 0]);
      const teaching = await overview(teacher);
      assert.deepEqual(
        teaching.metrics.map((metric: any) => metric.label),
        ['授课课程', '待批改作业', '待阅卷答卷', '未读通知'],
      );
      assert.equal('learningOverview' in teaching, false);
      assert.deepEqual(
        teaching.metrics.map((metric: any) => metric.value),
        [1, 0, 0, 0],
      );
      const management = await overview(admin);
      assert.deepEqual(
        management.metrics.map((metric: any) => metric.label),
        ['启用账号', '行政班级', '课程总数', '待处理举报'],
      );
      assert.equal('learningOverview' in management, false);
      assert.deepEqual(
        management.metrics.map((metric: any) => metric.value),
        [4, 0, 1, 0],
      );
    });

    await run('最新正式版本决定待交状态，草稿和别人的提交都不覆盖本人', async (learner) => {
      await makeAssignment('仅有草稿仍待交', {
        drafts: {
          create: { userId: learner.user.id, answers: { secret: 'PRIVATE_DRAFT' }, attachmentIds: [] },
        },
      });
      await makeAssignment('旧submitted最新returned', {
        submissions: {
          create: [submission(learner.user.id, 1, 'submitted'), submission(learner.user.id, 2, 'returned')],
        },
      });
      await makeAssignment('旧returned最新submitted', {
        submissions: {
          create: [submission(learner.user.id, 1, 'returned'), submission(learner.user.id, 2, 'submitted')],
        },
        drafts: {
          create: { userId: learner.user.id, answers: { secret: 'PRIVATE_NEW_DRAFT' }, attachmentIds: [] },
        },
      });
      await makeAssignment('最新submitted尚可选重交却不待交', {
        submissions: { create: submission(learner.user.id, 1, 'submitted') },
      });
      await makeAssignment('同学已交不影响本人', {
        submissions: { create: submission(peer.user.id, 1, 'submitted') },
      });
      assert.deepEqual(counts(await overview(learner)), [3, 0]);
    });

    await run('作业有效截止含精确当前时刻；迟交与个别延期仍需开放、受众和次数', async (learner) => {
      await makeAssignment('原due等于现在可交', { dueAt: stamp });
      await makeAssignment('opens等于现在可交', { opensAt: stamp });
      await makeAssignment('本人旧延期不会缩短原due', {
        exceptions: {
          create: {
            userId: learner.user.id,
            approvedBy: teacher.user.id,
            reason: '仍按原due',
            allowUntil: at(-1),
          },
        },
      });
      await makeAssignment('比现在早1毫秒已关闭', { dueAt: at(-1) });
      await makeAssignment('opens晚1毫秒未开放', { opensAt: at(1) });
      const extended = await makeAssignment('本人allowUntil等于现在可交', {
        dueAt: at(-86400_000),
        exceptions: {
          create: {
            userId: learner.user.id,
            approvedBy: teacher.user.id,
            reason: '精确窗口',
            allowUntil: stamp,
          },
        },
      });
      await makeAssignment('allowUntil早1毫秒已关闭', {
        dueAt: at(-86400_000),
        exceptions: {
          create: {
            userId: learner.user.id,
            approvedBy: teacher.user.id,
            reason: '已关闭',
            allowUntil: at(-1),
          },
        },
      });
      await makeAssignment('迟交忽略到期的个人allowUntil', {
        dueAt: at(-86400_000),
        allowLate: true,
        exceptions: {
          create: {
            userId: learner.user.id,
            approvedBy: teacher.user.id,
            reason: '允许迟交',
            allowUntil: at(-1),
          },
        },
      });
      await makeAssignment('本人被豁免', {
        allowLate: true,
        exceptions: {
          create: {
            userId: learner.user.id,
            approvedBy: teacher.user.id,
            reason: '豁免验证',
            exempt: true,
          },
        },
      });
      await makeAssignment('退回但次数耗尽', {
        maxAttempts: 1,
        submissions: { create: submission(learner.user.id, 1, 'returned') },
      });
      await makeAssignment('退回且本人有额外一次', {
        maxAttempts: 1,
        submissions: { create: submission(learner.user.id, 1, 'returned') },
        exceptions: {
          create: {
            userId: learner.user.id,
            approvedBy: teacher.user.id,
            reason: '额外次数',
            extraAttempts: 1,
          },
        },
      });
      await makeAssignment('只有同学延期', {
        dueAt: at(-86400_000),
        exceptions: {
          create: {
            userId: peer.user.id,
            approvedBy: teacher.user.id,
            reason: '仅同学',
            allowUntil: at(1000),
            extraAttempts: 1,
          },
        },
      });
      await makeAssignment('只有同学受众', { audience: { create: { userId: peer.user.id } } });
      assert.deepEqual(counts(await overview(learner)), [6, 0]);
      await db!.assignmentException.update({
        where: { assignmentId_userId: { assignmentId: extended.id, userId: learner.user.id } },
        data: { allowUntil: at(-1) },
      });
      assert.deepEqual(counts(await overview(learner)), [5, 0]);
    });

    await run('不限7天：已开放远期作业计入，尚未开始考试只在行动清单等待', async (learner) => {
      const far = await makeAssignment('90天后到期已开放', { dueAt: at(90 * 86400_000) });
      const future = await makeExam('明天开始', {
        startsAt: at(86400_000),
        endsAt: at(3 * 86400_000),
        entryClosesAt: at(2 * 86400_000),
      });
      assert.deepEqual(counts(await overview(learner)), [1, 0]);
      const upcoming = await list(learner, 'upcoming');
      assert.ok(!upcoming.items.some((item: any) => item.id === far.id));
      assert.equal(upcoming.items.find((item: any) => item.id === future.id)?.action, 'wait_exam');
    });

    await run('考试个人截止严格大于现在；继续优先，不以全班窗口或新次数排除', async (learner) => {
      await makeExam('现在开考可进入', { startsAt: stamp });
      await makeExam('entry精确现在不可入场', { entryClosesAt: stamp });
      await makeExam('个人entry覆盖更早截止', {
        extensions: {
          create: {
            userId: learner.user.id,
            approvedBy: teacher.user.id,
            reason: '提前截止',
            deadlineAt: stamp,
          },
        },
      });
      await makeExam('全班已结束但个人延期允许进入', {
        startsAt: at(-3 * 3600_000),
        endsAt: at(-3600_000),
        entryClosesAt: at(-2 * 3600_000),
        extensions: {
          create: {
            userId: learner.user.id,
            approvedBy: teacher.user.id,
            reason: '个人延期',
            deadlineAt: at(1),
          },
        },
      });
      await makeExam('入场关闭且次数已用完仍可继续', {
        maxAttempts: 1,
        entryClosesAt: at(-1),
        endsAt: at(-1),
        attempts: { create: attempt(learner.user.id, 1, 'in_progress') },
      });
      await makeExam('inprogress个人deadline精确现在不可续也不可新入', {
        maxAttempts: 2,
        attempts: { create: attempt(learner.user.id, 1, 'in_progress', stamp.toISOString()) },
      });
      await makeExam('submitted余次可入', {
        maxAttempts: 2,
        attempts: { create: attempt(learner.user.id, 1, 'submitted') },
      });
      await makeExam('timedout余次可入', {
        maxAttempts: 2,
        attempts: { create: attempt(learner.user.id, 1, 'timed_out') },
      });
      await makeExam('cancelled历史仍有余次可入', {
        maxAttempts: 2,
        attempts: { create: attempt(learner.user.id, 1, 'cancelled') },
      });
      await makeExam('cancelled历史用完次数', {
        maxAttempts: 1,
        attempts: { create: attempt(learner.user.id, 1, 'cancelled') },
      });
      await makeExam('本体取消', { status: 'cancelled' });
      await makeExam('成绩已发布', { gradesReleasedAt: at(-1) });
      await makeExam('未获得参考资格', {
        audience: { create: { userId: learner.user.id, eligible: false } },
      });
      assert.deepEqual(counts(await overview(learner)), [0, 6]);
    });

    await run('真实作业提交→退回自动延期与额外次数→再次提交，精确截止仍允许', async (learner) => {
      const q = await question('可提交作业题');
      const assignment = (
        await call(teacher, '/assignments', 'POST', {
          courseId: course.id,
          title: '真实作业链',
          opensAt: at(-3600_000).toISOString(),
          dueAt: at(3600_000).toISOString(),
          questionVersionIds: [q.versions[0].id],
          audienceIds: [learner.user.id],
          maxAttempts: 1,
        })
      ).body;
      await call(teacher, `/assignments/${assignment.id}/publish`, 'POST', {});
      await db!.assignment.update({ where: { id: assignment.id }, data: { dueAt: stamp } });
      assert.deepEqual(counts(await overview(learner)), [1, 0]);
      const submit = (key: string, expected = 201) =>
        call(
          learner,
          `/assignments/${assignment.id}/submit`,
          'POST',
          {
            answers: [{ questionVersionId: q.versions[0].id, value: 'A' }],
            idempotencyKey: key,
          },
          expected,
        );
      const first = (await submit(`overview-first-${suffix}`)).body;
      assert.equal(first.version, 1);
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      await call(teacher, `/submissions/${first.id}/return`, 'POST', { reason: '请重做用于真实退回验收' });
      const exception = await db!.assignmentException.findUniqueOrThrow({
        where: { assignmentId_userId: { assignmentId: assignment.id, userId: learner.user.id } },
      });
      assert.equal(exception.extraAttempts, 1);
      assert.equal(exception.allowUntil?.toISOString(), at(7 * 86400_000).toISOString());
      assert.deepEqual(counts(await overview(learner)), [1, 0]);
      await db!.assignment.update({ where: { id: assignment.id }, data: { dueAt: at(-1) } });
      await db!.assignmentException.update({ where: { id: exception.id }, data: { allowUntil: stamp } });
      const second = (await submit(`overview-second-${suffix}`)).body;
      assert.equal(second.version, 2);
      assert.equal(second.late, true, '个人延期仍按原due记录late，但不影响此前可提交统计');
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      await submit(`overview-exhausted-${suffix}`, 409);
      await db!.assignmentSubmission.update({ where: { id: second.id }, data: { status: 'returned' } });
      await db!.assignmentException.update({
        where: { id: exception.id },
        data: { extraAttempts: 2, allowUntil: at(-1) },
      });
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      await submit(`overview-closed-${suffix}`, 409);
    });

    await run('最新已交且有余次可选再次提交：API成功，但当前待交作业仍为零', async (learner) => {
      const q = await question('可选重交作业题');
      const assignment = (
        await call(teacher, '/assignments', 'POST', {
          courseId: course.id,
          title: '可选再次提交',
          opensAt: at(-3600_000).toISOString(),
          dueAt: at(3600_000).toISOString(),
          questionVersionIds: [q.versions[0].id],
          audienceIds: [learner.user.id],
          maxAttempts: 2,
        })
      ).body;
      await call(teacher, `/assignments/${assignment.id}/publish`, 'POST', {});
      for (const number of [1, 2]) {
        const submitted = (
          await call(learner, `/assignments/${assignment.id}/submit`, 'POST', {
            answers: [{ questionVersionId: q.versions[0].id, value: 'A' }],
            idempotencyKey: `overview-optional-${suffix}-${number}`,
          })
        ).body;
        assert.equal(submitted.version, number);
        assert.deepEqual(counts(await overview(learner)), [0, 0]);
      }
    });

    await run('真实开考→撤资格取消→恢复资格→number2，历史取消不重置额度', async (learner) => {
      const exam = await realExam(learner, '真实资格恢复考试');
      assert.deepEqual(counts(await overview(learner)), [0, 1]);
      const first = (await call(learner, `/exams/${exam.id}/start`, 'POST', {})).body;
      assert.equal(first.number, 1);
      await call(teacher, `/exams/${exam.id}/eligibility`, 'PUT', {
        userId: learner.user.id,
        eligible: false,
        reason: '撤销资格用于完整链验收',
      });
      assert.equal(
        (await db!.examAttempt.findUniqueOrThrow({ where: { id: first.id } })).status,
        'cancelled',
      );
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      await call(learner, `/exams/${exam.id}/start`, 'POST', {}, 403);
      await call(teacher, `/exams/${exam.id}/eligibility`, 'PUT', {
        userId: learner.user.id,
        eligible: true,
        reason: '恢复资格但保留历史次数',
      });
      assert.deepEqual(counts(await overview(learner)), [0, 1]);
      const action = (await list(learner)).items.find((item: any) => item.id === exam.id);
      assert.equal(action?.action, 'start_exam');
      assert.equal(action?.actionLabel, '再次考试');
      const second = (await call(learner, `/exams/${exam.id}/start`, 'POST', {})).body;
      assert.equal(second.number, 2);
      assert.notEqual(second.id, first.id);
      assert.deepEqual(counts(await overview(learner)), [0, 1], '续答优先，每场只计一次');
      await call(teacher, `/exams/${exam.id}/eligibility`, 'PUT', {
        userId: learner.user.id,
        eligible: false,
        reason: '再次撤销使用最后次数',
      });
      await call(teacher, `/exams/${exam.id}/eligibility`, 'PUT', {
        userId: learner.user.id,
        eligible: true,
        reason: '恢复不重置已消耗次数',
      });
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      await call(learner, `/exams/${exam.id}/start`, 'POST', {}, 409);
      await call(teacher, `/exams/${exam.id}/cancel`, 'POST', { reason: '取消考试本体应继续排除' });
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
    });

    await run('真实考试个人入场截止严格大于现在，个人deadline覆盖普通窗口', async (learner) => {
      const exam = await realExam(learner, '个人精确入场截止');
      await db!.exam.update({ where: { id: exam.id }, data: { startsAt: stamp, entryClosesAt: stamp } });
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      await call(learner, `/exams/${exam.id}/start`, 'POST', {}, 403);
      const extension = await db!.examExtension.create({
        data: {
          examId: exam.id,
          userId: learner.user.id,
          approvedBy: teacher.user.id,
          reason: '个人精确截止覆盖普通窗口',
          deadlineAt: stamp,
        },
      });
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      await call(learner, `/exams/${exam.id}/start`, 'POST', {}, 403);
      await db!.examExtension.update({ where: { id: extension.id }, data: { deadlineAt: at(1) } });
      assert.deepEqual(counts(await overview(learner)), [0, 1]);
      const started = (await call(learner, `/exams/${exam.id}/start`, 'POST', {})).body;
      assert.equal(started.number, 1);
      assert.equal(started.deadlineAt, at(1).toISOString());
      assert.deepEqual(counts(await overview(learner)), [0, 1]);
    });

    await run('expired inprogress只读不清算；真实start只清算旧答卷，后续请求才新入场', async (learner) => {
      const exam = await realExam(learner, '精确答卷截止考试');
      const first = (await call(learner, `/exams/${exam.id}/start`, 'POST', {})).body;
      await db!.examAttempt.update({ where: { id: first.id }, data: { deadlineAt: stamp } });
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      assert.ok(!(await list(learner)).items.some((item: any) => item.id === exam.id));
      assert.equal(
        (await db!.examAttempt.findUniqueOrThrow({ where: { id: first.id } })).status,
        'in_progress',
      );
      const recovered = (await call(learner, `/exams/${exam.id}/start`, 'POST', {})).body;
      assert.equal(recovered.id, first.id, '实际start只恢复旧答卷，不在同请求创建number2');
      assert.equal(recovered.number, 1);
      assert.equal(recovered.status, 'timed_out', 'start返回前内部attempt读取清算该旧答卷');
      assert.deepEqual(counts(await overview(learner)), [0, 1]);
      const finalized = (await call(learner, `/attempts/${first.id}`)).body;
      assert.equal(finalized.status, 'timed_out');
      assert.deepEqual(counts(await overview(learner)), [0, 1]);
      const second = (await call(learner, `/exams/${exam.id}/start`, 'POST', {})).body;
      assert.equal(second.number, 2);
      assert.notEqual(second.id, first.id);
    });

    await run('501作业加501考试直接SQL精确计数，不受take100/500/7天约束', async (learner) => {
      const assignments = Array.from({ length: 501 }, (_, index) => ({
        id: `overview-many-a-${suffix}-${index}`,
        organizationId: organization.id,
        courseId: course.id,
        creatorId: teacher.user.id,
        title: `远期作业${index}`,
        status: 'published',
        opensAt: at(-1000),
        dueAt: at((30 + index) * 86400_000),
        totalCents: 100,
        attachmentIds: [],
        maxAttempts: 1,
      }));
      const exams = Array.from({ length: 501 }, (_, index) => ({
        id: `overview-many-x-${suffix}-${index}`,
        organizationId: organization.id,
        courseId: course.id,
        creatorId: teacher.user.id,
        title: `个人延期考试${index}`,
        status: 'published',
        startsAt: at(-3 * 3600_000),
        endsAt: at(-3600_000),
        entryClosesAt: at(-2 * 3600_000),
        durationMinutes: 60,
        totalCents: 100,
        passCents: 60,
        graderIds: [],
      }));
      await db!.assignment.createMany({ data: assignments });
      await db!.assignmentAudience.createMany({
        data: assignments.map((row) => ({ assignmentId: row.id, userId: learner.user.id })),
      });
      await db!.exam.createMany({ data: exams });
      await db!.examAudience.createMany({
        data: exams.map((row) => ({ examId: row.id, userId: learner.user.id })),
      });
      await db!.examExtension.createMany({
        data: exams.map((row) => ({
          examId: row.id,
          userId: learner.user.id,
          approvedBy: teacher.user.id,
          reason: '远期有效个人窗口',
          deadlineAt: at(30 * 86400_000),
        })),
      });
      const first = await overview(learner);
      assert.deepEqual(counts(first), [501, 501]);
      assert.ok(first.tasks.length <= 8);
      assert.deepEqual((await list(learner, 'upcoming')).items, []);
      await db!.assignmentAudience.delete({
        where: {
          assignmentId_userId: {
            assignmentId: assignments[500].id,
            userId: learner.user.id,
          },
        },
      });
      await db!.examAudience.update({
        where: { examId_userId: { examId: exams[500].id, userId: learner.user.id } },
        data: { eligible: false },
      });
      assert.deepEqual(counts(await overview(learner)), [500, 500]);
    });

    await run('机构、课程发布/归档、Enrollment、本人受众与当前权限共同控制来源', async (learner) => {
      await makeAssignment('本课程正常作业');
      await makeExam('本课程正常考试');
      const other = await db!.course.create({
        data: {
          organizationId: foreign.id,
          teacherId: teacher.user.id,
          title: '外机构伪关联',
          status: 'PUBLISHED',
        },
      });
      await db!.enrollment.create({ data: { userId: learner.user.id, courseId: other.id } });
      await makeAssignment('跨机构课程不计', { courseId: other.id });
      const wrongOrganization = await makeExam('跨机构exam不计', { organizationId: foreign.id });
      const wrongAssignment = await makeAssignment('跨机构assignment不计', {
        organizationId: foreign.id,
      });
      await makeAssignment('未发布不计', { status: 'draft' });
      const initial = await overview(learner);
      assert.deepEqual(counts(initial), [1, 1]);
      assert.ok(
        !initial.tasks.some((item: any) => [wrongOrganization.id, wrongAssignment.id].includes(item.id)),
      );
      for (const status of ['DRAFT', 'ARCHIVED', 'PUBLISHED']) {
        await db!.course.update({ where: { id: course.id }, data: { status } });
        assert.deepEqual(counts(await overview(learner)), status === 'DRAFT' ? [0, 0] : [1, 1]);
      }
      await db!.enrollment.update({
        where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
        data: { active: false },
      });
      assert.deepEqual(counts(await overview(learner)), [0, 0]);
      await db!.enrollment.update({
        where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
        data: { active: true },
      });
      for (const permissionId of ['learning.use', 'course.read']) {
        await db!.rolePermission.delete({
          where: { roleId_permissionId: { roleId: 'STUDENT', permissionId } },
        });
        try {
          await call(learner, endpoint, 'GET', undefined, 403);
        } finally {
          await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId } });
        }
      }
    });

    async function delayedRead(
      client: Client,
      expected: number | number[],
      revoke: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>,
    ) {
      let pending: Promise<{ response?: Awaited<ReturnType<typeof call>>; error?: unknown }> | undefined;
      try {
        await db!.$transaction(
          async (tx) => {
            // Only the broad facts read ExamExtension. Its leading observability
            // tag fits even PostgreSQL's default 1024-byte activity-query window;
            // COUNT/FILTER and course_action_facts occur too late in this long SQL.
            await tx.$executeRawUnsafe('LOCK TABLE "ExamExtension" IN ACCESS EXCLUSIVE MODE');
            const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            pending = call(client, endpoint, 'GET', undefined, expected).then(
              (response) => ({ response }),
              (error: unknown) => ({ error }),
            );
            let blocked = false;
            for (let probe = 0; probe < 200; probe++) {
              const [state] = await owner.$queryRaw<{ blocked: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity s
              WHERE s.datname = ${databaseName} AND ${pid} = ANY(pg_blocking_pids(s.pid))
                AND s.query LIKE '%student_learning_overview_initial_counts%'
                AND s.query LIKE '%allowed_courses%') AS blocked
          `;
              if (state.blocked) {
                blocked = true;
                break;
              }
              await wait(20);
            }
            assert.ok(blocked, '必须观测实际shared facts聚合SQL等待本fixture锁，不能用固定sleep替代');
            await revoke(tx);
          },
          { timeout: 12000 },
        );
        assert.ok(pending);
        const result = await pending;
        if (result.error) throw result.error;
        assert.ok(result.response);
        return result.response;
      } finally {
        // A failed observer releases the transaction lock first, then settles its
        // request. Do not leave a late old-snapshot request racing the next case.
        if (pending) await pending;
      }
    }

    await run('真实聚合锁等待期间撤销未显示的第501受众，最终当前count少1', async (learner) => {
      const rows = Array.from({ length: 501 }, (_, index) => ({
        id: `overview-queued-${suffix}-${index}`,
        organizationId: organization.id,
        courseId: course.id,
        creatorId: teacher.user.id,
        title: `待查作业${index}`,
        status: 'published',
        opensAt: at(-1000),
        dueAt: at((30 + index) * 86400_000),
        totalCents: 100,
        attachmentIds: [],
        maxAttempts: 1,
      }));
      await db!.assignment.createMany({ data: rows });
      await db!.assignmentAudience.createMany({
        data: rows.map((row) => ({ assignmentId: row.id, userId: learner.user.id })),
      });
      assert.deepEqual(counts(await overview(learner)), [501, 0]);
      const response = await delayedRead(learner, 200, (tx) =>
        tx.assignmentAudience.delete({
          where: { assignmentId_userId: { assignmentId: rows[500].id, userId: learner.user.id } },
        }),
      );
      assert.deepEqual(counts(response.body), [500, 0]);
      assert.ok(!response.body.tasks.some((item: any) => item.id === rows[500].id));
    });

    await run('聚合等待期间撤回Enrollment或已显示受众，不能返回旧课程私有payload', async (learner) => {
      const assigned = await makeAssignment('显示任务授权复核');
      assert.equal((await overview(learner)).tasks[0].id, assigned.id);
      for (const source of ['enrollment', 'audience']) {
        const response = await delayedRead(learner, 403, async (tx) =>
          source === 'enrollment'
            ? tx.enrollment.update({
                where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
                data: { active: false },
              })
            : tx.assignmentAudience.delete({
                where: { assignmentId_userId: { assignmentId: assigned.id, userId: learner.user.id } },
              }),
        );
        assert.equal('metrics' in response.body, false);
        assert.equal('courses' in response.body, false);
        assert.equal('tasks' in response.body, false);
        if (source === 'enrollment')
          await db!.enrollment.update({
            where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
            data: { active: true },
          });
        else
          await db!.assignmentAudience.create({
            data: { assignmentId: assigned.id, userId: learner.user.id },
          });
      }
    });

    await run('聚合等待后再次验证当前会话、空间、角色和effective permissions', async (learner) => {
      let current = learner;
      for (const kind of ['learning.use', 'course.read', 'space', 'organization', 'session', 'role']) {
        const expected = kind.includes('.') ? 403 : 401;
        let mutated = false;
        let originalFailure: unknown;
        try {
          const response = await delayedRead(current, expected, async (tx) => {
            let changed: unknown;
            if (kind.includes('.'))
              changed = await tx.rolePermission.delete({
                where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: kind } },
              });
            else if (kind === 'space')
              changed = await tx.user.update({
                where: { id: learner.user.id },
                data: { organizationId: foreign.id },
              });
            else if (kind === 'organization')
              changed = await tx.organization.update({
                where: { id: organization.id },
                data: { active: false },
              });
            else if (kind === 'session')
              changed = await tx.session.deleteMany({ where: { userId: learner.user.id } });
            else
              changed = await tx.userRole.delete({
                where: { userId_roleId: { userId: learner.user.id, roleId: 'STUDENT' } },
              });
            mutated = true;
            return changed;
          });
          assert.equal('metrics' in response.body, false);
        } catch (error) {
          originalFailure = error;
          throw error;
        } finally {
          try {
            if (mutated) {
              if (kind.includes('.'))
                await db!.rolePermission.upsert({
                  where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: kind } },
                  create: { roleId: 'STUDENT', permissionId: kind },
                  update: {},
                });
              if (kind === 'space')
                await db!.user.update({
                  where: { id: learner.user.id },
                  data: { organizationId: organization.id },
                });
              if (kind === 'organization')
                await db!.organization.update({ where: { id: organization.id }, data: { active: true } });
              if (kind === 'role')
                await db!.userRole.upsert({
                  where: { userId_roleId: { userId: learner.user.id, roleId: 'STUDENT' } },
                  create: { userId: learner.user.id, roleId: 'STUDENT' },
                  update: {},
                });
              if (kind === 'session') current = await login(learner.user.username);
            }
          } catch (restoreFailure) {
            if (originalFailure)
              throw new AggregateError(
                [originalFailure, restoreFailure],
                '原始验收失败且owned权限夹具恢复失败',
              );
            throw restoreFailure;
          }
        }
      }
    });

    await run('三连接API池六个并发dashboard请求不会因授权嵌套连接死锁', async (learner) => {
      await makeAssignment('并发统计作业');
      await makeExam('并发统计考试');
      const responses = await Promise.all(Array.from({ length: 6 }, () => overview(learner)));
      for (const response of responses) assert.deepEqual(counts(response), [1, 1]);
    });
    assert.ok(!logs.includes(password), 'API日志不能包含测试密码');
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : '学习概览集成验收失败'));
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
        assert.match(databaseName, /^learning_overview_it_[a-f0-9]{16}$/);
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
    if (cleanupFailed) throw new Error('独立概览测试资源清理未完成；仅检查learning_overview_it_前缀随机库。');
  }
});
