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
const metric = (result: StudyResult, label: string) => {
  const found = result.metrics.find((entry) => entry.label === label);
  assert.ok(found, `结果缺少指标：${label}`);
  return found.value;
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

test('专业学习中心：独立PostgreSQL数据库与真实HTTP端到端验收', { timeout: 180_000 }, async (t) => {
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
  const name = `academics_it_${suffix}`;
  assert.match(name, /^academics_it_[a-f0-9]{16}$/);
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
    const inactiveMajor = await db.academicsMajor.create({
      data: {
        name: `停用专业-${suffix}`,
        subjectId: 'subject-science',
        moduleIds: ['matrix-lab'],
        active: false,
      },
    });
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
    let localSubject: any, localMajor: any, foreignSubject: any, foreignMajor: any;
    let personalRecord: any, institutionalRecord: any;
    let personalPreferences: any;

    await t.test('目录与模块需要身份，学生端覆盖学科和专业但不泄漏知识题答案', async () => {
      await call(null, '/academics/catalog', 'GET', undefined, 401);
      const catalog = (await call(personal, '/academics/catalog')).body;
      assert.ok(catalog.subjects.length >= 15);
      assert.ok(catalog.majors.length >= 50);
      assert.ok(catalog.modules.length >= 40);
      assert.ok(catalog.majors.some((item: any) => item.id === 'major-computer-science'));
      assert.ok(
        catalog.majors.every((item: any) => item.id !== inactiveMajor.id && item.organizationId === null),
      );
      assert.ok(catalog.modules.some((item: any) => item.id === 'sql-lab'));
      assert.ok(catalog.modules.some((item: any) => item.id === 'chemistry-balance'));
      assert.doesNotMatch(JSON.stringify(catalog), /correctChoiceId|passwordHash/);
      const quiz = (await call(personal, '/academics/modules/anatomy-quiz')).body;
      assert.ok(quiz.questions.length >= 6);
      assert.ok(
        quiz.questions.every(
          (item: any) => item.correctChoiceId === undefined && item.explanation === undefined,
        ),
      );
      assert.doesNotMatch(JSON.stringify(quiz), /correctChoiceId|参考选择/);
      await call(personal, '/academics/modules/nonexistent-module', 'GET', undefined, 404);
      await call(teacher, '/academics/modules/matrix-lab/evaluate', 'POST', { values: {} }, 403);
    });

    await t.test('机构管理员只能创建修改本机构目录，全局只读且跨机构模板不可见', async () => {
      await call(student, '/academics/admin/subjects', 'GET', undefined, 403);
      await call(personal, '/academics/admin/majors', 'GET', undefined, 403);
      await call(teacher, '/academics/admin/majors', 'POST', {}, 403);
      localSubject = (
        await call(admin, '/academics/admin/subjects', 'POST', {
          name: '甲机构交叉学科',
          description: '仅甲机构可维护',
        })
      ).body;
      foreignSubject = (
        await call(foreignAdmin, '/academics/admin/subjects', 'POST', { name: '乙机构交叉学科' })
      ).body;
      assert.equal(localSubject.organizationId, institution.id);
      assert.equal(foreignSubject.organizationId, foreign.id);
      localMajor = (
        await call(admin, '/academics/admin/majors', 'POST', {
          name: '甲机构跨学科学习',
          subjectId: localSubject.id,
          moduleIds: ['matrix-lab', 'sql-lab'],
        })
      ).body;
      foreignMajor = (
        await call(foreignAdmin, '/academics/admin/majors', 'POST', {
          name: '乙机构跨学科学习',
          subjectId: foreignSubject.id,
          moduleIds: ['statistics-lab'],
        })
      ).body;
      const ownSubjects = (await call(admin, '/academics/admin/subjects')).body.items;
      const ownMajors = (await call(admin, '/academics/admin/majors')).body.items;
      assert.ok(ownSubjects.some((item: any) => item.id === localSubject.id));
      assert.ok(!ownSubjects.some((item: any) => item.id === foreignSubject.id));
      assert.ok(ownMajors.some((item: any) => item.id === localMajor.id));
      assert.ok(!ownMajors.some((item: any) => item.id === foreignMajor.id));
      await call(
        admin,
        `/academics/admin/subjects/${foreignSubject.id}`,
        'PATCH',
        { revision: 0, name: '越权' },
        404,
      );
      await call(
        admin,
        `/academics/admin/majors/${foreignMajor.id}`,
        'PATCH',
        { revision: 0, name: '越权' },
        404,
      );
      await call(
        admin,
        '/academics/admin/subjects/subject-science',
        'PATCH',
        { revision: 0, name: '覆盖公共模板' },
        [403, 404],
      );
      await call(
        admin,
        '/academics/admin/majors/major-chemistry',
        'PATCH',
        { revision: 0, name: '覆盖公共模板' },
        [403, 404],
      );
      await call(admin, '/academics/admin/subjects', 'POST', { name: '甲机构交叉学科' }, 409);
      await call(
        admin,
        '/academics/admin/subjects',
        'POST',
        { name: '注入机构', organizationId: foreign.id },
        400,
      );
      await call(
        admin,
        '/academics/admin/majors',
        'POST',
        { name: '外学科', subjectId: foreignSubject.id, moduleIds: ['matrix-lab'] },
        400,
      );
      await call(
        admin,
        '/academics/admin/majors',
        'POST',
        { name: '未知模块', subjectId: localSubject.id, moduleIds: ['not-a-module'] },
        404,
      );
      localSubject = (
        await call(admin, `/academics/admin/subjects/${localSubject.id}`, 'PATCH', {
          revision: localSubject.revision,
          description: '更新后的本地学科说明',
        })
      ).body;
      assert.equal(localSubject.revision, 1);
      await call(
        admin,
        `/academics/admin/subjects/${localSubject.id}`,
        'PATCH',
        { revision: 0, description: '旧版本覆盖' },
        409,
      );
      localMajor = (
        await call(admin, `/academics/admin/majors/${localMajor.id}`, 'PATCH', {
          revision: localMajor.revision,
          moduleIds: ['matrix-lab', 'sql-lab', 'genetics-lab'],
        })
      ).body;
      assert.equal(localMajor.revision, 1);
      await call(
        admin,
        `/academics/admin/majors/${localMajor.id}`,
        'PATCH',
        { revision: 0, description: '旧版本不能覆盖' },
        409,
      );
      await call(
        admin,
        `/academics/admin/subjects/${localSubject.id}`,
        'PATCH',
        { revision: 1, active: false },
        409,
      );
      // Disabling a major must not bypass validation of a simultaneously changed parent scope.
      await call(
        admin,
        `/academics/admin/majors/${localMajor.id}`,
        'PATCH',
        { revision: 1, active: false, subjectId: foreignSubject.id },
        400,
      );
      localMajor = (
        await call(admin, `/academics/admin/majors/${localMajor.id}`, 'PATCH', {
          revision: 1,
          active: false,
        })
      ).body;
      assert.equal(localMajor.revision, 2);
      localSubject = (
        await call(admin, `/academics/admin/subjects/${localSubject.id}`, 'PATCH', {
          revision: 1,
          active: false,
        })
      ).body;
      assert.equal(localSubject.revision, 2);
      const disabledCatalog = (await call(student, '/academics/catalog')).body;
      assert.ok(!disabledCatalog.subjects.some((item: any) => item.id === localSubject.id));
      assert.ok(!disabledCatalog.majors.some((item: any) => item.id === localMajor.id));
      assert.equal(
        (await call(admin, '/academics/admin/majors')).body.items.find(
          (item: any) => item.id === localMajor.id,
        ).active,
        false,
      );
      await call(
        admin,
        `/academics/admin/majors/${localMajor.id}`,
        'PATCH',
        { revision: 2, active: true },
        400,
      );
      localSubject = (
        await call(admin, `/academics/admin/subjects/${localSubject.id}`, 'PATCH', {
          revision: 2,
          active: true,
        })
      ).body;
      localMajor = (
        await call(admin, `/academics/admin/majors/${localMajor.id}`, 'PATCH', {
          revision: 2,
          active: true,
        })
      ).body;
      assert.equal(localSubject.revision, 3);
      assert.equal(localMajor.revision, 3);
      const studentCatalog = (await call(student, '/academics/catalog')).body;
      assert.ok(studentCatalog.majors.some((item: any) => item.id === localMajor.id));
      assert.ok(!studentCatalog.majors.some((item: any) => item.id === foreignMajor.id));
      const personalCatalog = (await call(personal, '/academics/catalog')).body;
      assert.ok(
        !personalCatalog.majors.some((item: any) => [localMajor.id, foreignMajor.id].includes(item.id)),
      );
      await db!.user.update({ where: { id: student.user.id }, data: { majorId: localMajor.id } });
    });

    await t.test('个人自由选择全局专业和跨专业模块，机构学生不能自行改专业，偏好CAS防覆盖', async () => {
      const initial = (await call(personal, '/academics/me')).body;
      assert.equal(initial.accountMode, 'PERSONAL');
      assert.equal(initial.majorId, null);
      assert.equal(initial.revision, 0);
      assert.deepEqual(initial.stats, { records: 0, completed: 0, modulesPracticed: 0 });
      const selected = ['matrix-lab', 'sql-lab', 'language-lab', 'study-notebook'];
      await call(
        personal,
        '/academics/preferences',
        'PATCH',
        { revision: 0, selectedModuleIds: selected, majorId: localMajor.id },
        400,
      );
      await call(
        personal,
        '/academics/preferences',
        'PATCH',
        { revision: 0, selectedModuleIds: selected, majorId: inactiveMajor.id },
        400,
      );
      await call(
        personal,
        '/academics/preferences',
        'PATCH',
        { revision: 0, selectedModuleIds: ['not-a-module'] },
        404,
      );
      await call(
        personal,
        '/academics/preferences',
        'PATCH',
        { revision: 0, selectedModuleIds: ['matrix-lab', 'matrix-lab'] },
        400,
      );
      await call(
        personal,
        '/academics/preferences',
        'PATCH',
        { revision: 0, selectedModuleIds: selected, organizationId: foreign.id },
        400,
      );
      await call(
        personal,
        '/academics/preferences',
        'PATCH',
        { revision: 0, selectedModuleIds: selected },
        403,
        false,
      );
      await call(personal, '/academics/preferences', 'PATCH', {
        revision: 0,
        selectedModuleIds: selected,
        majorId: 'major-chemistry',
      });
      personalPreferences = (await call(personal, '/academics/me')).body;
      assert.equal(personalPreferences.majorId, 'major-chemistry');
      assert.equal(personalPreferences.major.id, 'major-chemistry');
      assert.deepEqual(personalPreferences.selectedModuleIds, selected);
      assert.equal(personalPreferences.revision, 1);
      assert.ok(personalPreferences.recommendations.some((module: any) => module.id === 'chemistry-balance'));
      const savedUser = await db!.user.findUniqueOrThrow({ where: { id: personal.user.id } });
      assert.equal(savedUser.personalMajorId, 'major-chemistry');
      const concurrent = await Promise.all(
        ['genetics-lab', 'geography-lab'].map((last) =>
          call(
            personal,
            '/academics/preferences',
            'PATCH',
            { revision: 1, selectedModuleIds: [...selected, last] },
            [200, 409],
          ),
        ),
      );
      assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 409]);
      personalPreferences = (await call(personal, '/academics/me')).body;
      assert.equal(personalPreferences.revision, 2);
      assert.equal(personalPreferences.selectedModuleIds.length, 5);
      const school = (await call(student, '/academics/me')).body;
      assert.equal(school.majorId, localMajor.id);
      await call(
        student,
        '/academics/preferences',
        'PATCH',
        { revision: school.revision, selectedModuleIds: ['chemistry-balance'], majorId: 'major-mathematics' },
        403,
      );
      await call(student, '/academics/preferences', 'PATCH', {
        revision: school.revision,
        selectedModuleIds: ['chemistry-balance', 'inventory-lab'],
      });
      assert.equal((await call(student, '/academics/me')).body.majorId, localMajor.id);
    });

    await t.test('跨专业计算真实执行并持久化，详细统计最大输入可保存，结果不可由客户端注入', async () => {
      const matrix = await evaluate(personal, 'matrix-lab', {}, '矩阵独立验收记录');
      personalRecord = matrix.record;
      assert.equal(metric(matrix.result, '方程状态'), '唯一解');
      assert.ok(matrix.result.tables.some((entry) => entry.title === '消元过程' && entry.rows.length > 1));
      assert.deepEqual(matrix.record.result, matrix.result);
      const stored = await db!.academicsRecord.findUniqueOrThrow({ where: { id: personalRecord.id } });
      assert.equal(stored.organizationId, originalSpace);
      assert.equal(stored.userId, personal.user.id);
      assert.deepEqual(stored.result, matrix.result);
      const chemistry = await evaluate(personal, 'chemistry-balance');
      assert.equal(chemistry.result.summary, '4 Fe + 3 O2 → 2 Fe2O3');
      const business = await evaluate(personal, 'inventory-lab');
      assert.ok(Math.abs(Number(metric(business.result, '经济订货量 EOQ')) - Math.sqrt(500000)) < 0.001);
      const engineering = await evaluate(personal, 'subnet-lab');
      assert.equal(metric(engineering.result, '可用主机数'), 254);
      const notebook = await evaluate(personal, 'study-notebook');
      assert.ok(notebook.result.sections.length > 0);
      const x = Array.from({ length: 500 }, (_, i) => ((-1) ** i * (1 + Math.sin(i))) / 1e9);
      const statistics = await evaluate(personal, 'statistics-lab', {
        x,
        y: x.map((value, i) => value * Math.cos(i)),
      });
      assert.equal(metric(statistics.result, '样本数量'), 500);
      assert.ok(Buffer.byteLength(JSON.stringify(statistics.result)) > 65536);
      assert.ok(await db!.academicsRecord.findUnique({ where: { id: statistics.record.id } }));
      const [storedBytes] = await db!.$queryRaw<{ bytes: number }[]>`
        SELECT octet_length("result"::text) AS bytes FROM "AcademicsRecord" WHERE "id" = ${statistics.record.id}
      `;
      assert.ok(storedBytes.bytes > 98304, '合法的500点详细统计结果超过旧96KiB数据库上限');
      assert.ok(storedBytes.bytes <= 262144);
      const before = await db!.academicsRecord.count({ where: { userId: personal.user.id } });
      const compactValues = { x: Array(500).fill(1e-250), y: Array(500).fill(-1e-250) };
      assert.ok(Buffer.byteLength(JSON.stringify(compactValues)) < 65536);
      const [expandedBytes] = await db!.$queryRaw<{ bytes: number }[]>`
        SELECT octet_length(${JSON.stringify(compactValues)}::jsonb::text) AS bytes
      `;
      assert.ok(expandedBytes.bytes > 98304, '指数形式的短输入会在JSONB中展开，需在持久化前拒绝');
      await call(
        personal,
        '/academics/modules/statistics-lab/evaluate',
        'POST',
        { values: compactValues },
        400,
      );
      await call(
        personal,
        '/academics/modules/matrix-lab/evaluate',
        'POST',
        { values: {}, result: { status: 'accepted' } },
        400,
      );
      await call(
        personal,
        '/academics/modules/matrix-lab/evaluate',
        'POST',
        { values: { operation: 'solve', a: [[1]], b: [1], code: 'process.exit(1)' } },
        400,
      );
      await call(
        personal,
        '/academics/modules/calculus-lab/evaluate',
        'POST',
        { values: { coefficients: '[1]', x: 1, left: 0, right: 1, intervals: 3 } },
        400,
      );
      await call(personal, '/academics/modules/algorithms/evaluate', 'POST', { values: {} }, 400);
      assert.equal(await db!.academicsRecord.count({ where: { userId: personal.user.id } }), before);
    });

    await t.test('SQL查询由真实SQLite执行，JOIN/聚合结果核验，危险SQL不接触应用库', async () => {
      const correct = await evaluate(personal, 'sql-lab');
      assert.equal(metric(correct.result, '任务是否匹配'), '是');
      assert.deepEqual(
        correct.result.tables[0].rows.map((row) => Object.values(row)),
        [
          ['Dana', 95],
          ['Alice', 92],
          ['Chen', 88],
          ['Faye', 81],
        ],
      );
      const count = await evaluate(personal, 'sql-lab', { query: 'SELECT COUNT(*) AS total FROM students;' });
      assert.equal(metric(count.result, '任务是否匹配'), '否');
      assert.deepEqual(Object.values(count.result.tables[0].rows[0]), [6]);
      const joined = await evaluate(personal, 'sql-lab', {
        exercise: 'student-courses',
        query:
          "SELECT s.name, c.title FROM students s JOIN enrollments e ON s.id = e.student_id JOIN courses c ON c.id = e.course_id WHERE s.name = 'Alice' ORDER BY c.title ASC;",
      });
      assert.equal(metric(joined.result, '任务是否匹配'), '是');
      assert.deepEqual(
        joined.result.tables[0].rows.map((row) => Object.values(row)),
        [
          ['Alice', 'Algorithms'],
          ['Alice', 'Statistics'],
        ],
      );
      const average = await evaluate(personal, 'sql-lab', {
        exercise: 'course-average',
        query:
          'SELECT c.title, AVG(e.grade) AS avg_grade FROM courses c LEFT JOIN enrollments e ON c.id = e.course_id GROUP BY c.id, c.title ORDER BY c.title ASC;',
      });
      assert.equal(metric(average.result, '任务是否匹配'), '是');
      assert.deepEqual(
        average.result.tables[0].rows.map((row) => row.column_0),
        ['Algorithms', 'Physics', 'Statistics'],
      );
      assert.ok(Math.abs(Number(average.result.tables[0].rows[2].column_1) - 233 / 3) < 1e-6);
      const usersBefore = await db!.user.count();
      const recordsBefore = await db!.academicsRecord.count();
      for (const query of [
        'DELETE FROM students',
        'SELECT * FROM User',
        'SELECT * FROM students; DROP TABLE students;',
        "ATTACH DATABASE '/tmp/private' AS leak",
        'SELECT load_extension(1) FROM students',
      ]) {
        await call(
          personal,
          '/academics/modules/sql-lab/evaluate',
          'POST',
          { values: { exercise: 'high-scores', query } },
          400,
        );
      }
      assert.equal(await db!.user.count(), usersBefore);
      assert.equal(await db!.academicsRecord.count(), recordsBefore);
      const again = await evaluate(personal, 'sql-lab', { query: 'SELECT COUNT(*) AS total FROM students' });
      assert.deepEqual(Object.values(again.result.tables[0].rows[0]), [6]);
    });

    await t.test('知识题仅提交后出现逐题解析，并拒绝未知题目或答案字段注入', async () => {
      const submitted = await evaluate(personal, 'anatomy-quiz', {
        answers: { chambers: 'c', pulmonary: 'b' },
      });
      assert.equal(metric(submitted.result, '正确题数'), 1);
      assert.equal(metric(submitted.result, '已作答'), 2);
      assert.equal(metric(submitted.result, '题目总数'), 6);
      assert.ok(submitted.result.sections.some((section) => section.status === 'success'));
      assert.ok(submitted.result.sections.some((section) => section.status === 'warning'));
      assert.match(JSON.stringify(submitted.result), /参考选择|右心室|左心房/);
      const module = (await call(personal, '/academics/modules/anatomy-quiz')).body;
      assert.doesNotMatch(JSON.stringify(module), /correctChoiceId|参考选择/);
      await call(
        personal,
        '/academics/modules/anatomy-quiz/evaluate',
        'POST',
        { values: { answers: { nonexistent: 'a' } } },
        400,
      );
      await call(
        personal,
        '/academics/modules/anatomy-quiz/evaluate',
        'POST',
        { values: { answers: { chambers: 'unknown' } } },
        400,
      );
      await call(
        personal,
        '/academics/modules/anatomy-quiz/evaluate',
        'POST',
        { values: { answers: {}, correctChoiceId: 'c' } },
        400,
      );
    });

    await t.test('记录列表分页过滤与本人读取，跨账号、同机构同学及管理员均不能读取私人结果', async () => {
      institutionalRecord = (await evaluate(student, 'matrix-lab', {}, '机构内私人记录')).record;
      const page1 = (await call(personal, '/academics/records?page=1&pageSize=3')).body;
      const page2 = (await call(personal, '/academics/records?page=2&pageSize=3')).body;
      assert.equal(page1.items.length, 3);
      assert.equal(page2.items.length, 3);
      assert.ok(page1.items.every((a: any) => page2.items.every((b: any) => a.id !== b.id)));
      const scoped = await db!.academicsRecord.count({
        where: { userId: personal.user.id, organizationId: originalSpace },
      });
      assert.equal(page1.total, scoped);
      const sql = (await call(personal, '/academics/records?moduleId=sql-lab&pageSize=20')).body;
      assert.ok(sql.items.length >= 4 && sql.items.every((item: any) => item.moduleId === 'sql-lab'));
      const fetched = (await call(personal, `/academics/records/${personalRecord.id}`)).body;
      assert.equal(fetched.id, personalRecord.id);
      assert.deepEqual(fetched.result, personalRecord.result);
      for (const other of [anotherPersonal, student, foreignStudent])
        await call(other, `/academics/records/${personalRecord.id}`, 'GET', undefined, 404);
      for (const other of [peer, foreignStudent, personal])
        await call(other, `/academics/records/${institutionalRecord.id}`, 'GET', undefined, 404);
      await call(admin, `/academics/records/${institutionalRecord.id}`, 'GET', undefined, [403, 404]);
      assert.equal((await call(anotherPersonal, '/academics/records')).body.total, 0);
      assert.equal((await call(peer, '/academics/records')).body.total, 0);
      await call(personal, '/academics/records?pageSize=21', 'GET', undefined, 400);
      await call(personal, '/academics/records?organizationId=foreign', 'GET', undefined, 400);
      const home = (await call(personal, '/academics/me')).body;
      assert.equal(home.stats.records, scoped);
      assert.ok(home.recentRecords.every((record: any) => record.id !== institutionalRecord.id));
    });

    await t.test('记录笔记与状态通过CAS修改，并发旧版本409且越权更新/删除不生效', async () => {
      const outcomes = await Promise.all(
        ['窗口甲的复盘', '窗口乙的复盘'].map((notes) =>
          call(
            personal,
            `/academics/records/${personalRecord.id}`,
            'PATCH',
            { revision: personalRecord.revision, notes },
            [200, 409],
          ),
        ),
      );
      assert.deepEqual(outcomes.map((item) => item.status).sort(), [200, 409]);
      const winner = outcomes.find((item) => item.status === 200)!.body;
      assert.equal(winner.revision, 1);
      assert.ok(['窗口甲的复盘', '窗口乙的复盘'].includes(winner.notes));
      await call(
        personal,
        `/academics/records/${personalRecord.id}`,
        'PATCH',
        { revision: 0, notes: '旧窗口覆盖' },
        409,
      );
      for (const other of [anotherPersonal, student, foreignStudent]) {
        await call(
          other,
          `/academics/records/${personalRecord.id}`,
          'PATCH',
          { revision: 1, notes: '越权' },
          404,
        );
        await call(other, `/academics/records/${personalRecord.id}`, 'DELETE', undefined, 404);
      }
      await call(
        personal,
        `/academics/records/${personalRecord.id}`,
        'PATCH',
        { revision: 1, result: { status: 'accepted' } },
        400,
      );
      await call(
        personal,
        `/academics/records/${personalRecord.id}`,
        'PATCH',
        { revision: 1, notes: 'x'.repeat(12001) },
        400,
      );
      await call(
        personal,
        `/academics/records/${personalRecord.id}`,
        'PATCH',
        { revision: 1, notes: '未带CSRF' },
        403,
        false,
      );
      personalRecord = (
        await call(personal, `/academics/records/${personalRecord.id}`, 'PATCH', {
          revision: 1,
          title: '矩阵复盘已修订',
          status: 'DRAFT',
          notes: '个人空间保留的复盘',
        })
      ).body;
      assert.equal(personalRecord.revision, 2);
      assert.equal(personalRecord.status, 'DRAFT');
      const home = (await call(personal, '/academics/me')).body;
      assert.equal(home.stats.completed, home.stats.records - 1);
      const disposable = (await evaluate(personal, 'genetics-lab')).record;
      await call(personal, `/academics/records/${disposable.id}`, 'DELETE');
      await call(personal, `/academics/records/${disposable.id}`, 'GET', undefined, 404);
      assert.equal(await db!.academicsRecord.findUnique({ where: { id: disposable.id } }), null);
    });

    await t.test('关闭机构practice立即阻断学习操作，目录仍可浏览且其他空间不受影响', async () => {
      await db!.systemSetting.upsert({
        where: { organizationId_key: { organizationId: institution.id, key: 'features' } },
        create: { organizationId: institution.id, key: 'features', value: { practice: false } },
        update: { value: { practice: false } },
      });
      try {
        for (const path of [
          '/academics/me',
          '/academics/modules/matrix-lab',
          '/academics/records',
          `/academics/records/${institutionalRecord.id}`,
        ])
          await call(student, path, 'GET', undefined, 403);
        await call(student, '/academics/modules/matrix-lab/evaluate', 'POST', { values: {} }, 403);
        await call(student, '/academics/preferences', 'PATCH', { revision: 1, selectedModuleIds: [] }, 403);
        await call(student, '/academics/catalog');
        await call(admin, '/academics/admin/subjects');
        await call(personal, '/academics/catalog');
        await call(foreignStudent, '/academics/catalog');
      } finally {
        await db!.systemSetting.update({
          where: { organizationId_key: { organizationId: institution.id, key: 'features' } },
          data: { value: { practice: true } },
        });
      }
      await call(student, '/academics/me');
    });

    await t.test('加入机构不迁移个人记录和偏好，退出后恢复原专业、个人笔记与偏好', async () => {
      const before = (await call(personal, '/academics/me')).body;
      const setting = (await call(admin, '/admin/join-settings', 'PATCH', { joinEnabled: true })).body;
      const application = (
        await call(personal, '/account/join-requests', 'POST', {
          inviteCode: setting.inviteCode,
          majorId: localMajor.id,
          note: '专业学习验收申请',
        })
      ).body;
      await call(admin, `/admin/join-requests/${application.id}`, 'PATCH', {
        status: 'APPROVED',
        majorId: localMajor.id,
      });
      await call(personal, '/academics/me', 'GET', undefined, 401);
      personal = await login(personal.user.username);
      assert.equal(personal.user.accountMode, 'ORGANIZATION');
      assert.equal(personal.user.organizationId, institution.id);
      const joined = (await call(personal, '/academics/me')).body;
      assert.equal(joined.majorId, localMajor.id);
      assert.equal(joined.stats.records, 0);
      assert.equal(joined.revision, 0);
      await call(personal, `/academics/records/${personalRecord.id}`, 'GET', undefined, 404);
      await call(
        personal,
        `/academics/records/${personalRecord.id}`,
        'PATCH',
        { revision: 2, notes: '不能跨空间改写' },
        404,
      );
      const retained = await db!.academicsRecord.findUniqueOrThrow({ where: { id: personalRecord.id } });
      assert.equal(retained.organizationId, originalSpace);
      assert.equal(retained.notes, '个人空间保留的复盘');
      const joinedRecord = (await evaluate(personal, 'environment-lab', {}, '加入后的机构记录')).record;
      await call(personal, '/academics/preferences', 'PATCH', {
        revision: joined.revision,
        selectedModuleIds: ['environment-lab'],
      });
      assert.equal((await call(personal, '/academics/records')).body.total, 1);
      const exited = (await call(personal, '/account/leave-organization', 'POST', {})).body;
      assert.equal(exited.loginRequired, true);
      await call(personal, '/academics/me', 'GET', undefined, 401);
      personal = await login(personal.user.username);
      const restored = (await call(personal, '/academics/me')).body;
      assert.equal(restored.accountMode, 'PERSONAL');
      assert.equal(restored.majorId, 'major-chemistry');
      assert.equal(restored.stats.records, before.stats.records);
      assert.equal(restored.revision, before.revision);
      assert.deepEqual(restored.selectedModuleIds, before.selectedModuleIds);
      assert.equal(
        (await call(personal, `/academics/records/${personalRecord.id}`)).body.notes,
        '个人空间保留的复盘',
      );
      await call(personal, `/academics/records/${joinedRecord.id}`, 'GET', undefined, 404);
      const schoolRecord = await db!.academicsRecord.findUniqueOrThrow({ where: { id: joinedRecord.id } });
      assert.equal(schoolRecord.organizationId, institution.id);
      assert.equal(schoolRecord.userId, personal.user.id);
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
      assert.match(name, /^academics_it_[a-f0-9]{16}$/);
      try {
        await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      } catch {
        t.diagnostic(
          '本次随机测试库清理失败；仅需管理员检查academics_it_前缀的遗留测试库。未触碰现有业务库。',
        );
      }
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
