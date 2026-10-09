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

test('学习行动筛选：独立数据库真实HTTP、课程选择精确分页与实际任务链', { timeout: 180_000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production', '集成测试禁止在production模式运行');
  const configured =
    process.env.LEARNING_ACTION_FILTERS_TEST_ADMIN_DATABASE_URL ||
    process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL ||
    (process.env.DOTENV_CONFIG_PATH && process.env.DATABASE_URL);
  assert.ok(
    configured,
    '需要显式本机review/test数据库：LEARNING_ACTION_FILTERS_TEST_ADMIN_DATABASE_URL、ACADEMICS_TEST_ADMIN_DATABASE_URL或DOTENV_CONFIG_PATH',
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
  const databaseName = `learning_action_filters_it_${suffix}`;
  assert.match(databaseName, /^learning_action_filters_it_[a-f0-9]{16}$/);
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
  const directory = mkdtempSync(join(tmpdir(), 'learning-action-filters-http-'));
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
    LEARNING_ACTION_FILTERS_FIXTURE_TIME: '2028-12-31T10:15:00.000Z',
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
    // The same owned child suppresses Common JobsService startup explicitly;
    // DISABLE_JOBS currently applies only to Assessment's automatic sweeps.
    const clockPath = join(directory, 'fixture-clock.cjs');
    writeFileSync(
      clockPath,
      'const NativeDate=Date;const stamp=NativeDate.parse(process.env.LEARNING_ACTION_FILTERS_FIXTURE_TIME);' +
        'global.Date=class extends NativeDate{constructor(...args){if(args.length)super(...args);else super(stamp);}static now(){return stamp;}};' +
        `require(${JSON.stringify(resolve('apps/api/dist/common/jobs.service.js'))}).JobsService.prototype.onModuleInit=function(){};`,
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
    const stamp = new Date(env.LEARNING_ACTION_FILTERS_FIXTURE_TIME);
    const at = (delta: number) => new Date(stamp.getTime() + delta);
    const zero = { today: 0, upcoming: 0, overdue: 0 };
    const pickerPath = `${endpoint}/courses`;
    let current = student;
    const list = async (query: Record<string, string | number> = {}, client = current) =>
      (
        await call(
          client,
          `${endpoint}?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`,
        )
      ).body;
    const picker = async (query: Record<string, string | number> = {}, client = current) =>
      (
        await call(
          client,
          `${pickerPath}?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`,
        )
      ).body;
    const course = await db.course.create({
      data: {
        organizationId: organization.id,
        teacherId: teacher.user.id,
        title: '筛选课程甲',
        status: 'PUBLISHED',
      },
    });
    const otherCourse = await db.course.create({
      data: {
        organizationId: organization.id,
        teacherId: teacher.user.id,
        title: '筛选课程乙',
        status: 'ARCHIVED',
      },
    });
    await db.teachingAssignment.create({ data: { courseId: course.id, userId: teacher.user.id } });
    let caseIndex = 0;
    const run = (name: string, fn: (learner: Client) => Promise<void>) =>
      t.test(name, async () => {
        const user = await makeUser(`case-${caseIndex++}`);
        current = await login(user.username);
        await db!.enrollment.createMany({
          data: [course, otherCourse].map((row) => ({
            courseId: row.id,
            userId: current.user.id,
          })),
        });
        await fn(current);
      });
    const makeAssignment = (tag: string, overrides: Record<string, any> = {}) =>
      db!.assignment.create({
        data: {
          organizationId: organization.id,
          courseId: course.id,
          creatorId: teacher.user.id,
          title: tag,
          status: 'published',
          opensAt: at(-3600_000),
          dueAt: at(3600_000),
          totalCents: 100,
          maxAttempts: 3,
          attachmentIds: [],
          audience: { create: { userId: current.user.id } },
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
          startsAt: at(-60_000),
          endsAt: at(4 * 3600_000),
          entryClosesAt: at(2 * 3600_000),
          durationMinutes: 60,
          passCents: 60,
          totalCents: 100,
          graderIds: [],
          audience: { create: { userId: current.user.id } },
          ...overrides,
        },
      });
    const personal = (tag: string, dueAt = at(3600_000)) =>
      db!.personalTask.create({
        data: {
          organizationId: organization.id,
          userId: current.user.id,
          title: tag,
          dueAt,
          description: 'PRIVATE_PERSONAL_DESCRIPTION',
        },
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
    const realExam = async (learner: Client) => {
      // An exam gets its own confidential question; published assignment content
      // is public and cannot be reused as proof of valid exam availability.
      const q = await question('独立保密考试题');
      const exam = (
        await call(teacher, '/exams', 'POST', {
          courseId: course.id,
          title: '筛选真实恢复资格链',
          startsAt: at(-60_000).toISOString(),
          endsAt: at(4 * 3600_000).toISOString(),
          entryClosesAt: at(2 * 3600_000).toISOString(),
          durationMinutes: 60,
          questionVersionIds: [q.versions[0].id],
          audienceIds: [learner.user.id],
          maxAttempts: 2,
          passCents: 60,
        })
      ).body;
      await call(teacher, `/exams/${exam.id}/publish`, 'POST', {});
      assert.ok(await db!.examPaperItem.count({ where: { snapshot: { examId: exam.id } } }));
      return exam;
    };
    function safeAction(data: any) {
      assert.deepEqual(Object.keys(data.counts).sort(), ['overdue', 'today', 'upcoming']);
      assert.equal(data.total, data.counts[data.bucket]);
      assert.equal(data.timezone, 'Asia/Shanghai');
      assert.equal(data.serverTime, stamp.toISOString());
      assert.ok(
        !/PRIVATE|answers|passwordHash|snapshot|scoreCents|courseIds|selectedCourseAllowed/.test(
          JSON.stringify(data),
        ),
      );
    }
    async function rejection(path: string, status: number, client = current) {
      const response = await call(client, path, 'GET', undefined, status);
      for (const field of ['items', 'counts', 'total', 'filters', 'courseIds', 'title'])
        assert.equal(field in response.body, false);
      return response;
    }
    async function blockedRead(
      client: Client,
      path: string,
      table: 'Course' | 'PersonalTask',
      signature: string,
      expected: number,
      change: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>,
    ) {
      let pending: Promise<{ response?: Awaited<ReturnType<typeof call>>; error?: unknown }> | undefined;
      try {
        await db!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);
            const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            pending = call(client, path, 'GET', undefined, expected).then(
              (response) => ({ response }),
              (error: unknown) => ({ error }),
            );
            let observed = false;
            for (let probe = 0; probe < 200; probe++) {
              const [state] = await owner.$queryRaw<{ blocked: boolean }[]>`
              SELECT EXISTS (SELECT 1 FROM pg_stat_activity s
                WHERE s.datname = ${databaseName} AND ${pid} = ANY(pg_blocking_pids(s.pid))
                  AND s.query LIKE ${`%${signature}%`}) AS blocked
            `;
              if (state.blocked) {
                observed = true;
                break;
              }
              await wait(20);
            }
            assert.ok(observed, '必须观测本随机DB实际授权SQL被fixture PID阻塞，不用固定sleep假定阶段');
            await change(tx);
          },
          { timeout: 12000 },
        );
        assert.ok(pending);
        const completed = await pending;
        if (completed.error) throw completed.error;
        assert.ok(completed.response);
        return completed.response;
      } finally {
        if (pending) await pending;
      }
    }

    await t.test('实际HTTP单值验证、角色限制与旧默认合同', async () => {
      await call(null, endpoint, 'GET', undefined, 401);
      await call(null, pickerPath, 'GET', undefined, 401);
      for (const client of [teacher, admin]) {
        await rejection(endpoint, 403, client);
        await rejection(pickerPath, 403, client);
      }
      const data = await list({}, student);
      safeAction(data);
      assert.deepEqual(data.filters, { type: 'all', courseId: null });
      assert.equal(data.pageSize, 10);
      for (const query of [
        'type=exam&type=assignment',
        'courseId=x&courseId=y',
        'page=1&page=2',
        'pageSize=10&pageSize=20',
        'pageSize[x]=2',
        'userId=peer',
        'organizationId=foreign',
        'scope=all',
        'type=invalid',
        'courseId=' + 'x'.repeat(129),
        'courseId=%00',
        'type=personal&courseId=' + course.id,
      ])
        await rejection(`${endpoint}?${query}`, 400, student);
      for (const query of [
        'search=a&search=b',
        'pageSize=20&pageSize=50',
        'pageSize[x]=2',
        'search=' + 'x'.repeat(101),
        'search=%00',
        'pageSize=51',
        'page=10001',
        'userId=peer',
        'courseId=x',
        'type=exam',
      ])
        await rejection(`${pickerPath}?${query}`, 400, student);
    });

    await run('三桶来源/课程组合筛选使用完整集合；个人待办不猜课程归属', async () => {
      const dueDates = [at(-1), at(3600_000), new Date('2029-01-01T12:00:00Z')];
      for (const [index, dueAt] of dueDates.entries()) {
        await personal(`个人待办${index}`, dueAt);
        for (const c of [course, otherCourse]) {
          await makeAssignment(`作业${c.id}-${index}`, { courseId: c.id, dueAt });
          await makeExam(`考试${c.id}-${index}`, {
            courseId: c.id,
            startsAt: index === 2 ? dueAt : at(-3600_000),
            endsAt: index === 2 ? new Date(dueAt.getTime() + 4 * 3600_000) : at(4 * 3600_000),
            entryClosesAt: index === 2 ? new Date(dueAt.getTime() + 2 * 3600_000) : at(2 * 3600_000),
            attempts:
              index === 0
                ? {
                    create: {
                      userId: current.user.id,
                      number: 1,
                      status: 'in_progress',
                      deadlineAt: at(3600_000),
                      questionOrder: [],
                      optionOrder: {},
                      flags: [],
                    },
                  }
                : undefined,
            entryClosesAt: index === 0 ? at(-1) : dueAt,
          });
        }
      }
      // Expired general entry with a still-live personal attempt belongs to today.
      const expected = { today: 7, upcoming: 5, overdue: 3 };
      for (const bucket of ['today', 'upcoming', 'overdue']) {
        const all = await list({ bucket, pageSize: 20 });
        safeAction(all);
        assert.deepEqual(all.counts, expected);
        const scoped = await list({ bucket, courseId: course.id });
        assert.deepEqual(scoped.counts, { today: 3, upcoming: 2, overdue: 1 });
        assert.ok(scoped.items.every((item: any) => item.courseId === course.id && item.type !== 'personal'));
        const assigned = await list({ bucket, courseId: course.id, type: 'assignment' });
        assert.deepEqual(assigned.counts, { today: 1, upcoming: 1, overdue: 1 });
        assert.ok(assigned.items.every((item: any) => item.type === 'assignment'));
        const own = await list({ bucket, type: 'personal' });
        assert.deepEqual(own.counts, { today: 1, upcoming: 1, overdue: 1 });
        assert.ok(own.items.every((item: any) => item.type === 'personal' && !('courseId' in item)));
      }
    });

    await run('501筛选匹配精确计数和末页；Overview完整指标不随行动筛选改变', async (learner) => {
      const rows = Array.from({ length: 501 }, (_, index) => ({
        id: `filter-many-${suffix}-${String(index).padStart(4, '0')}`,
        organizationId: organization.id,
        courseId: course.id,
        creatorId: teacher.user.id,
        title: `过滤501作业${index}`,
        status: 'published',
        opensAt: at(-1000),
        dueAt: at(3600_000),
        totalCents: 100,
        maxAttempts: 1,
        attachmentIds: [],
      }));
      await db!.assignment.createMany({ data: rows });
      await db!.assignmentAudience.createMany({
        data: rows.map((row) => ({ assignmentId: row.id, userId: learner.user.id })),
      });
      await makeAssignment('其他课程不匹配', { courseId: otherCourse.id });
      await makeAssignment('超7天只入Overview', { dueAt: at(30 * 86400_000) });
      await personal('个人不匹配');
      const first = await list({ courseId: course.id, type: 'assignment', pageSize: 20 });
      const last = await list({ courseId: course.id, type: 'assignment', pageSize: 20, page: 26 });
      assert.equal(first.total, 501);
      assert.equal(first.items.length, 20);
      assert.equal(last.total, 501);
      assert.deepEqual(
        last.items.map((item: any) => item.id),
        [rows[500].id],
      );
      assert.equal((await list({ courseId: course.id, type: 'assignment', page: 10000 })).total, 501);
      const before = (await call(learner, '/dashboard')).body.metrics;
      assert.equal(before[1].value, 503);
      await list({ type: 'personal' });
      await list({ type: 'exam', courseId: otherCourse.id });
      assert.deepEqual((await call(learner, '/dashboard')).body.metrics, before);
    });

    await run('Picker精确501授权课程、稳定后续页、ARCHIVED与0行动选课', async (learner) => {
      const rows = Array.from({ length: 501 }, (_, index) => ({
        id: `picker-${suffix}-${String(index).padStart(4, '0')}`,
        organizationId: organization.id,
        teacherId: teacher.user.id,
        title: `Picker-${String(Math.floor(index / 2)).padStart(4, '0')}`,
        status: index === 500 ? 'ARCHIVED' : 'PUBLISHED',
      }));
      await db!.course.createMany({ data: rows });
      await db!.enrollment.createMany({
        data: rows.map((row) => ({ courseId: row.id, userId: learner.user.id })),
      });
      const ordered = await db!.course.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
        select: { id: true, title: true },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
      });
      const first = await picker({ search: 'pIcKeR-', pageSize: 50 });
      const last = await picker({ search: 'Picker-', pageSize: 50, page: 11 });
      assert.deepEqual(first, { items: ordered.slice(0, 50), total: 501, page: 1, pageSize: 50 });
      assert.deepEqual(last, { items: ordered.slice(500), total: 501, page: 11, pageSize: 50 });
      for (const item of [...first.items, ...last.items])
        assert.deepEqual(Object.keys(item).sort(), ['id', 'title']);
      const selected = await list({ courseId: rows[500].id });
      assert.deepEqual(selected.counts, zero);
      assert.deepEqual(selected.items, []);
      assert.deepEqual((await picker({ search: 'Picker-', page: 10000 })).items, []);
      let mutated = false;
      try {
        const refreshed = await blockedRead(
          learner,
          `${pickerPath}?search=Picker-&pageSize=50`,
          'Course',
          'allowed_courses',
          200,
          async (tx) => {
            await tx.enrollment.update({
              where: { courseId_userId: { courseId: ordered[500].id, userId: learner.user.id } },
              data: { active: false },
            });
            mutated = true;
          },
        );
        assert.equal(refreshed.body.total, 500, '未展示第501课被撤销后，返回第二次完整当前聚合而非旧501');
        assert.deepEqual(refreshed.body.items, ordered.slice(0, 50), '第一页稳定，没有裁剪旧页伪装修正总数');
      } finally {
        if (mutated)
          await db!.enrollment.update({
            where: { courseId_userId: { courseId: ordered[500].id, userId: learner.user.id } },
            data: { active: true },
          });
      }
    });

    await run('Picker搜索的百分号/下划线/反斜杠/引号/空白按字面匹配，不泄露他人课程', async (learner) => {
      const tokens = ['%', '_', '\\', "'", '  '];
      const rows = [];
      for (const token of tokens) {
        const row = await db!.course.create({
          data: {
            organizationId: organization.id,
            teacherId: teacher.user.id,
            title: `literal${token}end`,
            status: 'PUBLISHED',
          },
        });
        rows.push(row);
        await db!.enrollment.create({ data: { courseId: row.id, userId: learner.user.id } });
      }
      const peerCourse = await db!.course.create({
        data: {
          organizationId: organization.id,
          teacherId: teacher.user.id,
          title: 'literalPRIVATEpeer',
          status: 'PUBLISHED',
        },
      });
      await db!.enrollment.create({ data: { courseId: peerCourse.id, userId: peer.user.id } });
      for (const [index, token] of tokens.entries()) {
        const data = await picker({ search: token });
        assert.equal(data.total, 1);
        assert.deepEqual(data.items, [{ id: rows[index].id, title: rows[index].title }]);
      }
      assert.equal((await picker({ search: 'PRIVATEpeer' })).total, 0);
    });

    await run('所选无行动课程仍校验同机构/当前Enrollment/发布状态，拒绝不回退全部', async (learner) => {
      const hidden = await db!.course.create({
        data: {
          organizationId: organization.id,
          teacherId: teacher.user.id,
          title: '未入课',
          status: 'PUBLISHED',
        },
      });
      const foreignCourse = await db!.course.create({
        data: {
          organizationId: foreign.id,
          teacherId: teacher.user.id,
          title: '跨机构课程',
          status: 'PUBLISHED',
        },
      });
      await db!.enrollment.create({ data: { courseId: foreignCourse.id, userId: learner.user.id } });
      for (const courseId of ['missing-id', hidden.id, foreignCourse.id])
        await rejection(`${endpoint}?courseId=${courseId}`, 403);
      assert.deepEqual((await list({ courseId: course.id })).counts, zero);
      await db!.enrollment.update({
        where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
        data: { active: false },
      });
      await rejection(`${endpoint}?courseId=${course.id}`, 403);
      assert.ok(!(await picker()).items.some((item: any) => item.id === course.id));
      await db!.enrollment.update({
        where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
        data: { active: true },
      });
      await db!.course.update({ where: { id: course.id }, data: { status: 'DRAFT' } });
      try {
        await rejection(`${endpoint}?courseId=${course.id}`, 403);
      } finally {
        await db!.course.update({ where: { id: course.id }, data: { status: 'PUBLISHED' } });
      }
      assert.deepEqual((await picker({}, foreignStudent)).items, []);
    });

    await run('缺course.read只允许本人个人清单；双权限与完整旧scope不做静默扩大', async () => {
      await personal('无课程权个人待办');
      await makeAssignment('无权课程作业');
      // Role rows belong solely to this random DB; no shared server/template is touched.
      for (const permissionId of ['course.read', 'learning.use']) {
        await db!.rolePermission.delete({
          where: { roleId_permissionId: { roleId: 'STUDENT', permissionId } },
        });
        try {
          if (permissionId === 'course.read') {
            assert.equal((await list()).items[0].type, 'personal');
            assert.equal((await list({ type: 'personal' })).total, 1);
            for (const query of [`courseId=${course.id}`, 'type=assignment', 'type=exam'])
              await rejection(`${endpoint}?${query}`, 403);
          } else await rejection(endpoint, 403);
          await rejection(pickerPath, 403);
        } finally {
          await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId } });
        }
      }
    });

    await run('真实提交/退回个人延期与最新formal和draft规则在课程筛选后保持', async (learner) => {
      const q = await question('独立作业题');
      const assigned = (
        await call(teacher, '/assignments', 'POST', {
          courseId: course.id,
          title: '筛选真实作业链',
          opensAt: at(-3600_000).toISOString(),
          dueAt: at(3600_000).toISOString(),
          questionVersionIds: [q.versions[0].id],
          audienceIds: [learner.user.id],
          maxAttempts: 1,
        })
      ).body;
      await call(teacher, `/assignments/${assigned.id}/publish`, 'POST', {});
      await db!.assignment.update({ where: { id: assigned.id }, data: { dueAt: stamp } });
      const query = { type: 'assignment', courseId: course.id };
      await call(learner, `/assignments/${assigned.id}/draft`, 'PUT', {
        revision: 0,
        answers: [{ questionVersionId: q.versions[0].id, value: 'A' }],
      });
      assert.equal((await list(query)).items[0].action, 'submit');
      const first = (
        await call(learner, `/assignments/${assigned.id}/submit`, 'POST', {
          answers: [{ questionVersionId: q.versions[0].id, value: 'A' }],
          idempotencyKey: `filter-first-${suffix}`,
        })
      ).body;
      assert.equal((await list(query)).total, 0);
      await call(teacher, `/submissions/${first.id}/return`, 'POST', { reason: '筛选真实退回规则验收' });
      const exception = await db!.assignmentException.findUniqueOrThrow({
        where: { assignmentId_userId: { assignmentId: assigned.id, userId: learner.user.id } },
      });
      assert.equal(exception.extraAttempts, 1);
      assert.equal((await list({ ...query, bucket: 'upcoming' })).items[0].action, 'resubmit');
      await db!.assignmentException.update({ where: { id: exception.id }, data: { allowUntil: stamp } });
      assert.equal((await list(query)).items[0].action, 'resubmit');
      const second = (
        await call(learner, `/assignments/${assigned.id}/submit`, 'POST', {
          answers: [{ questionVersionId: q.versions[0].id, value: 'A' }],
          idempotencyKey: `filter-second-${suffix}`,
        })
      ).body;
      assert.equal(second.version, 2);
      assert.equal((await list(query)).total, 0);
    });

    await run('真实资格撤销取消历史→恢复→再次进入，过滤后仍消耗真实次数且续答优先', async (learner) => {
      const exam = await realExam(learner);
      const query = { type: 'exam', courseId: course.id };
      assert.equal((await list(query)).items[0].action, 'start_exam');
      const first = (await call(learner, `/exams/${exam.id}/start`, 'POST', {})).body;
      assert.equal((await list(query)).items[0].path, `/exam-attempts/${first.id}`);
      for (const eligible of [false, true]) {
        await call(teacher, `/exams/${exam.id}/eligibility`, 'PUT', {
          userId: learner.user.id,
          eligible,
          reason: '筛选资格恢复链验收',
        });
        if (!eligible) {
          assert.equal((await list(query)).total, 0);
          await call(learner, `/exams/${exam.id}/start`, 'POST', {}, 403);
        }
      }
      assert.equal(
        (await db!.examAttempt.findUniqueOrThrow({ where: { id: first.id } })).status,
        'cancelled',
      );
      assert.equal((await list(query)).items[0].actionLabel, '再次考试');
      const second = (await call(learner, `/exams/${exam.id}/start`, 'POST', {})).body;
      assert.equal(second.number, 2);
      assert.equal((await list(query)).items[0].action, 'continue_exam');
      await db!.examAttempt.update({ where: { id: second.id }, data: { deadlineAt: stamp } });
      assert.equal((await list(query)).total, 0, '只读GET不清算expired inprogress');
      assert.equal(
        (await db!.examAttempt.findUniqueOrThrow({ where: { id: second.id } })).status,
        'in_progress',
      );
      assert.equal((await call(learner, `/attempts/${second.id}`)).body.status, 'timed_out');
      await call(learner, `/exams/${exam.id}/start`, 'POST', {}, 409);
      await call(teacher, `/exams/${exam.id}/extensions`, 'POST', {
        userId: learner.user.id,
        deadlineAt: at(2 * 3600_000).toISOString(),
        extraAttempts: 1,
        reason: '补一次额度以独立验证考试本体取消',
      });
      assert.equal((await list(query)).total, 1, '先恢复有效入口，再让本体取消独立解释消失');
      await call(teacher, `/exams/${exam.id}/cancel`, 'POST', { reason: '取消考试本体' });
      assert.equal((await list(query)).total, 0);
    });

    await run('个人完成CAS刷新全部过滤桶，旧revision不能重复完成', async (learner) => {
      const task = (
        await call(learner, '/planner/tasks', 'POST', {
          title: '筛选个人CAS',
          dueAt: at(3600_000).toISOString(),
        })
      ).body;
      assert.equal((await list({ type: 'personal' })).total, 1);
      await call(
        learner,
        `/planner/tasks/${task.id}`,
        'PATCH',
        { revision: task.revision, completed: true },
        403,
        false,
      );
      await call(learner, `/planner/tasks/${task.id}`, 'PATCH', { revision: task.revision, completed: true });
      await call(
        learner,
        `/planner/tasks/${task.id}`,
        'PATCH',
        { revision: task.revision, completed: true },
        409,
      );
      for (const bucket of ['today', 'upcoming', 'overdue'])
        assert.equal((await list({ type: 'personal', bucket })).total, 0);
    });

    await run('实际授权查询锁等待后，零行动选课和Picker旧页资格撤销都拒绝', async (learner) => {
      const selected = await blockedRead(
        learner,
        `${endpoint}?courseId=${course.id}`,
        'Course',
        'allowed_courses',
        403,
        (tx) =>
          tx.enrollment.update({
            where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
            data: { active: false },
          }),
      );
      assert.equal('items' in selected.body, false);
      assert.equal('total' in selected.body, false);
      await db!.enrollment.update({
        where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
        data: { active: true },
      });

      // If access is revoked before the picker query starts, there are no old
      // private titles to guard. The safe current result is an empty page.
      const pickerResult = await blockedRead(
        learner,
        `${pickerPath}?search=筛选课程甲`,
        'Course',
        'allowed_courses',
        200,
        (tx) =>
          tx.enrollment.update({
            where: { courseId_userId: { courseId: course.id, userId: learner.user.id } },
            data: { active: false },
          }),
      );
      assert.deepEqual(pickerResult.body.items, []);
      assert.equal(pickerResult.body.total, 0);
    });

    await run('实际查询等待后最终effective权限/空间/CSRF/会话撤回不返回旧payload', async (learner) => {
      let logged = learner;
      for (const source of ['course.read', 'learning.use', 'nonce', 'space', 'role', 'session']) {
        const expected = source.includes('.') ? 403 : 401;
        let mutated = false;
        let originalFailure: unknown;
        try {
          const response = await blockedRead(
            logged,
            pickerPath,
            'Course',
            'matched AS MATERIALIZED',
            expected,
            async (tx) => {
              let changed: unknown;
              if (source.includes('.'))
                changed = await tx.rolePermission.delete({
                  where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: source } },
                });
              else if (source === 'nonce')
                changed = await tx.session.updateMany({
                  where: { userId: learner.user.id },
                  data: { csrfToken: `replaced-${suffix}` },
                });
              else if (source === 'space')
                changed = await tx.user.update({
                  where: { id: learner.user.id },
                  data: { organizationId: foreign.id },
                });
              else if (source === 'role')
                changed = await tx.userRole.delete({
                  where: { userId_roleId: { userId: learner.user.id, roleId: 'STUDENT' } },
                });
              else changed = await tx.session.deleteMany({ where: { userId: learner.user.id } });
              mutated = true;
              return changed;
            },
          );
          assert.equal('items' in response.body, false);
          assert.equal('total' in response.body, false);
        } catch (error) {
          originalFailure = error;
          throw error;
        } finally {
          try {
            if (mutated) {
              if (source.includes('.'))
                await db!.rolePermission.upsert({
                  where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: source } },
                  create: { roleId: 'STUDENT', permissionId: source },
                  update: {},
                });
              if (source === 'space')
                await db!.user.update({
                  where: { id: learner.user.id },
                  data: { organizationId: organization.id },
                });
              if (source === 'role')
                await db!.userRole.upsert({
                  where: { userId_roleId: { userId: learner.user.id, roleId: 'STUDENT' } },
                  create: { userId: learner.user.id, roleId: 'STUDENT' },
                  update: {},
                });
              if (source === 'nonce' || source === 'session') logged = await login(learner.user.username);
            }
          } catch (restoreFailure) {
            if (originalFailure)
              throw new AggregateError(
                [originalFailure, restoreFailure],
                '原始筛选验收失败且owned夹具恢复失败',
              );
            throw restoreFailure;
          }
        }
      }
    });

    await run('小池三连接同时六读筛选行动和Picker无持Tx再次取连接死锁', async (learner) => {
      await makeAssignment('并发过滤作业');
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          index % 2 ? picker({}, learner) : list({ courseId: course.id, type: 'assignment' }, learner),
        ),
      );
      for (const [index, response] of responses.entries()) assert.equal(response.total, index % 2 ? 2 : 1);
    });
    assert.ok(!logs.includes(password), 'API日志不能包含测试密码');
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : '学习行动筛选验收失败'));
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
        assert.match(databaseName, /^learning_action_filters_it_[a-f0-9]{16}$/);
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
    if (cleanupFailed) throw new Error('独立筛选测试清理未完成；仅检查learning_action_filters_it_随机库。');
  }
});
