import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPasswordAsync } from '../apps/api/src/auth/password';
import { permissionDefinitions, roleDefinitions } from '../apps/api/src/auth/permissions';
import type { StudyResult } from '../apps/api/src/academics/academics.types';

const moduleId = 'confusion-matrix';
const fields = ['tp', 'fp', 'fn', 'tn'] as const;
const counts = (tp: number, fp: number, fn: number, tn: number) => ({ tp, fp, fn, tn });
type Counts = ReturnType<typeof counts>;
const defaults = counts(45, 5, 10, 40);
const rareValues = counts(0, 0, 1, 99);
const metricLabels = [
  '准确率 Accuracy',
  '精确率 Precision',
  '召回率 Recall',
  '负类召回率 Specificity',
  'F1',
  '二分类平衡准确率',
];
const close = (actual: unknown, expected: number) => {
  assert.equal(typeof actual, 'number');
  assert.ok(Number.isFinite(actual));
  if (expected === 0) assert.equal(actual, 0);
  else
    assert.ok(
      Math.abs((Number(actual) - expected) / expected) < 1e-10,
      'Result differs from independent confusion-matrix arithmetic',
    );
};

// Independent oracle: sum the observed confusion cells and compute the two class
// recalls separately. No production evaluator, formatter, or fraction helper is imported.
function assertConfusion(result: StudyResult, values: Counts) {
  const { tp, fp, fn, tn } = values;
  const total = tp + fp + fn + tn;
  const actualPositive = tp + fn,
    actualNegative = tn + fp;
  const fractions = [
    [tp + tn, total],
    [tp, tp + fp],
    [tp, actualPositive],
    [tn, actualNegative],
    [2 * tp, 2 * tp + fp + fn],
    [tp * actualNegative + tn * actualPositive, 2 * actualPositive * actualNegative],
  ];
  const expected = fractions.map(([n, d], index) =>
    d === 0 ? undefined : index === 5 ? (tp / actualPositive + tn / actualNegative) * 50 : (n / d) * 100,
  );
  assert.deepEqual(
    result.metrics.map((item) => item.label),
    metricLabels,
  );
  result.metrics.forEach((item, i) => {
    if (expected[i] === undefined) {
      assert.equal(item.value, '未定义');
      assert.equal(Object.hasOwn(item, 'unit'), false);
    } else {
      close(item.value, expected[i]!);
      assert.equal(item.unit, '%');
    }
  });
  assert.equal(result.tables.length, 2);
  const [matrix, metrics] = result.tables;
  assert.equal(matrix.title, '混淆矩阵（行实际，列预测）');
  assert.deepEqual(
    matrix.columns.map((item) => item.key),
    ['actual', 'predictedNegative', 'predictedPositive', 'total'],
  );
  assert.deepEqual(matrix.rows, [
    { actual: '实际负类', predictedNegative: tn, predictedPositive: fp, total: actualNegative },
    { actual: '实际正类', predictedNegative: fn, predictedPositive: tp, total: actualPositive },
    { actual: '合计', predictedNegative: tn + fn, predictedPositive: tp + fp, total },
  ]);
  assert.equal(metrics.title, '指标分子与分母');
  assert.deepEqual(
    metrics.columns.map((item) => item.key),
    ['metric', 'formula', 'numerator', 'denominator', 'percent', 'reason'],
  );
  assert.equal(metrics.rows.length, 6);
  metrics.rows.forEach((row, i) => {
    assert.equal(row.metric, metricLabels[i]);
    assert.equal(typeof row.formula, 'string');
    assert.ok(String(row.formula).length > 3);
    assert.equal(row.numerator, fractions[i][0]);
    assert.equal(row.denominator, fractions[i][1]);
    if (expected[i] === undefined) {
      assert.equal(row.percent, '未定义');
      assert.equal(typeof row.reason, 'string');
      assert.ok(String(row.reason).length > 5);
    } else {
      close(row.percent, expected[i]!);
      assert.equal(row.reason, '');
    }
  });
  assert.deepEqual(result.categoryChart, {
    title: '四格样本计数',
    categories: ['TP', 'FP', 'FN', 'TN'],
    series: [{ name: '计数', values: [tp, fp, fn, tn] }],
    yAxisLabel: '样本数',
  });
  assert.equal(Object.hasOwn(result, 'chart'), false);
  assert.ok(!('score' in result) && !('mastered' in result));
  return expected;
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

test('二分类混淆矩阵指标与增量迁移：独立PostgreSQL与真实HTTP验收', { timeout: 180_000 }, async (t) => {
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
  const name = `confusion_matrix_it_${suffix}`;
  assert.match(name, /^confusion_matrix_it_[a-f0-9]{16}$/);
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
  const directory = mkdtempSync(join(tmpdir(), 'confusion-matrix-http-'));
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
  function schemaThrough(ceiling: number) {
    const staged = join(directory, `prisma-through-${ceiling}`);
    cpSync(resolve('prisma'), staged, {
      recursive: true,
      filter: (source) => {
        const version = /[/\\]\d{8}(\d{4})_/.exec(source);
        return !version || Number(version[1]) <= ceiling;
      },
    });
    return staged;
  }
  async function appliedMigrations() {
    const rows = await db!.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name
    `;
    return rows.map((row) => row.migration_name);
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
    const beforeSchema = schemaThrough(20);
    const targetSchema = schemaThrough(21);
    await deploy(beforeSchema);
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
    const institution = await db.organization.create({ data: { name: '混淆矩阵验收机构' } });
    const hash = await hashPasswordAsync(password);
    const fixtures: { id: string; username: string }[] = [];
    for (const roleId of ['ADMIN', 'TEACHER', 'STUDENT']) {
      fixtures.push(
        await db.user.create({
          data: {
            username: `confusion_${suffix}_${roleId.toLowerCase()}`,
            name: roleId,
            organizationId: institution.id,
            passwordHash: hash,
            roles: { create: { roleId } },
          },
        }),
      );
    }
    await t.test('021仅追加三类公共专业，顺序/已包含项/机构模板/个人偏好及重复部署稳定', async () => {
      const migrationsBefore = await appliedMigrations();
      assert.equal(migrationsBefore.length, 20);
      assert.equal(new Set(migrationsBefore).size, 20);
      assert.equal(migrationsBefore.at(-1), '202610090020_simpson_paradox');
      const targets = ['major-statistics', 'major-data-science', 'major-artificial-intelligence'];
      const oldDate = new Date('2001-01-01T00:00:00.000Z');
      for (const id of targets) {
        const major = await db!.academicsMajor.findUniqueOrThrow({ where: { id } });
        assert.ok(!major.moduleIds.includes('confusion-matrix'), '020之前不应预先包含新模块');
        await db!.academicsMajor.update({
          where: { id },
          data: {
            revision: 7,
            updatedAt: oldDate,
            ...(id === 'major-artificial-intelligence'
              ? { moduleIds: [...major.moduleIds, 'confusion-matrix'] }
              : {}),
          },
        });
      }
      const localMajor = await db!.academicsMajor.create({
        data: {
          organizationId: institution.id,
          subjectId: 'subject-science',
          name: '机构自定义数据分析',
          moduleIds: ['study-notebook', 'statistics-lab'],
          revision: 8,
          updatedAt: oldDate,
        },
      });
      await db!.user.update({ where: { id: fixtures[2].id }, data: { majorId: localMajor.id } });
      await db!.academicsPreference.create({
        data: {
          organizationId: institution.id,
          userId: fixtures[2].id,
          selectedModuleIds: ['statistics-lab', 'study-notebook'],
          revision: 9,
          updatedAt: oldDate,
        },
      });
      const personalSpace = await db!.organization.create({
        data: { name: '迁移前个人学习空间', kind: 'PERSONAL' },
      });
      const personalOwner = await db!.user.create({
        data: {
          organizationId: personalSpace.id,
          personalOrganizationId: personalSpace.id,
          accountMode: 'PERSONAL',
          personalMajorId: 'major-statistics',
          username: `confusion_${suffix}_before_migration`,
          name: '迁移前个人同学',
          passwordHash: hash,
          roles: { create: { roleId: 'STUDENT' } },
        },
      });
      await db!.academicsPreference.create({
        data: {
          organizationId: personalSpace.id,
          userId: personalOwner.id,
          selectedModuleIds: ['study-notebook', 'statistics-lab'],
          revision: 11,
          updatedAt: oldDate,
        },
      });
      const before = await db!.academicsMajor.findMany({ orderBy: { id: 'asc' } });
      const preference = await db!.academicsPreference.findMany({ orderBy: { id: 'asc' } });
      const users = await db!.user.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, organizationId: true, majorId: true, personalMajorId: true, accountMode: true },
      });
      await deploy(targetSchema);
      const migrationsAfter = await appliedMigrations();
      assert.deepEqual(migrationsAfter, [...migrationsBefore, '202610090021_confusion_matrix']);
      assert.equal(migrationsAfter.length, 21);
      const after = await db!.academicsMajor.findMany({ orderBy: { id: 'asc' } });
      assert.equal(after.length, before.length);
      for (const previous of before) {
        const current = after.find((item) => item.id === previous.id)!;
        const changed =
          targets.includes(previous.id) &&
          previous.organizationId === null &&
          !previous.moduleIds.includes('confusion-matrix');
        if (changed) {
          assert.deepEqual(current.moduleIds, [...previous.moduleIds, 'confusion-matrix']);
          assert.equal(current.revision, previous.revision + 1);
          assert.ok(current.updatedAt.getTime() > previous.updatedAt.getTime());
          assert.deepEqual(
            {
              ...current,
              moduleIds: previous.moduleIds,
              revision: previous.revision,
              updatedAt: previous.updatedAt,
            },
            previous,
          );
        } else assert.deepEqual(current, previous);
      }
      for (const id of targets)
        assert.equal(
          after.find((item) => item.id === id)!.moduleIds.filter((item) => item === 'confusion-matrix')
            .length,
          1,
        );
      assert.deepEqual(
        after.find((item) => item.id === localMajor.id),
        localMajor,
      );
      assert.deepEqual(await db!.academicsPreference.findMany({ orderBy: { id: 'asc' } }), preference);
      assert.deepEqual(
        await db!.user.findMany({
          orderBy: { id: 'asc' },
          select: { id: true, organizationId: true, majorId: true, personalMajorId: true, accountMode: true },
        }),
        users,
      );
      await deploy(targetSchema);
      assert.deepEqual(await appliedMigrations(), migrationsAfter);
      assert.deepEqual(await db!.academicsMajor.findMany({ orderBy: { id: 'asc' } }), after);
      assert.deepEqual(await db!.academicsPreference.findMany({ orderBy: { id: 'asc' } }), preference);
      assert.deepEqual(
        await db!.user.findMany({
          orderBy: { id: 'asc' },
          select: { id: true, organizationId: true, majorId: true, personalMajorId: true, accountMode: true },
        }),
        users,
      );
    });
    // Migration-specific assertions are complete; the HTTP suite uses all current migrations.
    await deploy(resolve('prisma'));
    api = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-80000);
      });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (api.exitCode !== null || api.signalCode !== null) throw new Error(`测试API启动失败：${safe(logs)}`);
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
    const personal = await register('confusion_personal');
    const endpoint = `/academics/modules/${moduleId}/evaluate`;
    const scope = { userId: personal.user.id, organizationId: personal.user.organizationId };
    const run = async (values: Record<string, unknown>, title?: string) =>
      (await call(personal, endpoint, 'POST', { values, ...(title ? { title } : {}) })).body as {
        record: any;
        result: StudyResult;
      };
    let baseline: any;
    let rare: any;
    await t.test('自由学习目录、四个严格整数字段与默认矩阵指标按独立手算复核', async () => {
      const me = (await call(personal, '/academics/me')).body;
      assert.equal(me.accountMode, 'PERSONAL');
      assert.equal(me.majorId, null);
      assert.deepEqual(me.selectedModuleIds, []);
      const catalog = (await call(personal, '/academics/catalog')).body;
      assert.ok(catalog.modules.some((item: any) => item.id === moduleId && item.kind === 'calculator'));
      const module = (await call(personal, `/academics/modules/${moduleId}`)).body;
      assert.equal(module.title, '二分类混淆矩阵与指标');
      assert.deepEqual(module.defaultValues, defaults);
      assert.deepEqual(
        module.fields.map((field: any) => field.key),
        [...fields],
      );
      for (const field of module.fields)
        assert.deepEqual(
          (({ type, required, min, max, step }: any) => ({ type, required, min, max, step }))(field),
          { type: 'number', required: true, min: 0, max: 1000000, step: 1 },
        );
      baseline = await run(defaults, '默认混合预测');
      const expected = assertConfusion(baseline.result, defaults);
      assert.deepEqual(expected.slice(0, 2), [85, 90]);
      close(expected[2], 900 / 11);
      close(expected[3], 800 / 9);
      close(expected[4], 600 / 7);
      close(expected[5], (900 / 11 + 800 / 9) / 2);
      assert.equal(baseline.record.status, 'COMPLETED');
    });

    await t.test('六组原创示例和零分母分别保留未定义，高准确率不能替代正类召回', async () => {
      const module = (await call(personal, `/academics/modules/${moduleId}`)).body;
      assert.equal(module.examples.length, 6);
      assert.deepEqual(
        module.examples.map((item: any) => item.values),
        [
          defaults,
          rareValues,
          counts(30, 0, 0, 70),
          counts(0, 40, 60, 0),
          counts(25, 0, 0, 0),
          counts(0, 0, 0, 100),
        ],
      );
      for (const example of module.examples) {
        const output = await run(example.values, example.title);
        const expected = assertConfusion(output.result, example.values);
        const stored = await db!.academicsRecord.findUniqueOrThrow({ where: { id: output.record.id } });
        assert.deepEqual(stored.values, example.values);
        assert.deepEqual(stored.result, output.result);
        if (example.values.fn === 1) {
          rare = output;
          assert.deepEqual(expected, [99, undefined, 0, 100, 0, 50]);
          assert.equal(output.result.metrics[1].value, '未定义');
          assert.equal(output.result.metrics[4].value, 0, 'F1 uses its own count denominator');
        }
        if (example.values.tn === 100)
          assert.deepEqual(expected, [100, undefined, undefined, 100, undefined, undefined]);
        if (example.values.tp === 25) assert.deepEqual(expected, [100, 100, 100, undefined, 100, undefined]);
        assert.equal(output.record.status, 'COMPLETED');
      }
      assert.ok(rare);
    });

    await t.test('上限、微小非零比例与缩放/交换标签/转置关系均符合独立计数算术', async () => {
      // Numeric exploration is a separate learner's session. Keep each real
      // account within the unchanged 20-records/minute evaluation policy.
      const numeric = await register('numeric_oracle');
      const numericScope = { userId: numeric.user.id, organizationId: numeric.user.organizationId };
      assert.notEqual(numericScope.userId, scope.userId);
      assert.notEqual(numericScope.organizationId, scope.organizationId);
      const personalCount = await db!.academicsRecord.count({ where: scope });
      const runNumeric = async (values: Counts) => {
        const output = (await call(numeric, endpoint, 'POST', { values, title: 'NUMERIC_ORACLE_PRIVATE' }))
          .body as { record: any; result: StudyResult };
        const stored = await db!.academicsRecord.findUniqueOrThrow({ where: { id: output.record.id } });
        assert.equal(stored.userId, numericScope.userId);
        assert.equal(stored.organizationId, numericScope.organizationId);
        assert.equal(stored.status, 'COMPLETED');
        assert.deepEqual(stored.values, values);
        assert.deepEqual(stored.result, output.result);
        return output;
      };
      const inputs = [counts(1000000, 1000000, 1000000, 1000000), counts(1, 1000000, 999999, 1000000)];
      let seed = 92741;
      for (let i = 0; i < 5; i++) {
        const next = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed % 10001;
        };
        inputs.push(counts(next(), next(), next(), next()));
      }
      for (const values of inputs) {
        const output = await runNumeric(values);
        assertConfusion(output.result, values);
        if (values.tp === 1) {
          assert.ok(Number(output.result.metrics[1].value) > 0);
          assert.ok(Number(output.result.metrics[1].value) < 0.001);
        }
      }
      const values = counts(13, 7, 9, 21);
      const base = assertConfusion((await runNumeric(values)).result, values);
      const scaledValues = counts(91, 49, 63, 147);
      const scaled = assertConfusion((await runNumeric(scaledValues)).result, scaledValues);
      base.forEach((value, i) => close(scaled[i], value!));
      const swappedValues = counts(values.tn, values.fn, values.fp, values.tp);
      const swapped = assertConfusion((await runNumeric(swappedValues)).result, swappedValues);
      close(swapped[0], base[0]!);
      close(swapped[2], base[3]!);
      close(swapped[3], base[2]!);
      close(swapped[5], base[5]!);
      const transposedValues = counts(values.tp, values.fn, values.fp, values.tn);
      const transposed = assertConfusion((await runNumeric(transposedValues)).result, transposedValues);
      close(transposed[0], base[0]!);
      close(transposed[1], base[2]!);
      close(transposed[2], base[1]!);
      close(transposed[4], base[4]!);
      assert.equal(await db!.academicsRecord.count({ where: numericScope }), inputs.length + 4);
      assert.equal(await db!.academicsRecord.count({ where: scope }), personalCount);
    });

    await t.test('非法类型/全零/非有限/额外字段、CSRF、角色和失效会话均拒绝且不落库', async () => {
      const before = await db!.academicsRecord.count();
      for (const field of fields) {
        const without: Partial<Counts> = { ...defaults };
        delete without[field];
        await call(personal, endpoint, 'POST', { values: without }, 400);
        for (const value of [-1, 0.5, 1000001, 1e100, '1', '', null, true, [], {}])
          await call(personal, endpoint, 'POST', { values: { ...defaults, [field]: value } }, 400);
        const nonFinite = await fetch(`${origin}/api${endpoint}`, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            origin,
            'content-type': 'application/json',
            cookie: personal.cookie,
            'x-csrf-token': personal.csrf,
          },
          body: JSON.stringify({ values: defaults }).replace(
            `"${field}":${defaults[field]}`,
            `"${field}":1e309`,
          ),
        });
        assert.equal(nonFinite.status, 400);
        await nonFinite.arrayBuffer();
      }
      await call(personal, endpoint, 'POST', { values: counts(0, 0, 0, 0) }, 400);
      await call(personal, endpoint, 'POST', { values: { ...defaults, unknown: 1 } }, 400);
      await call(personal, endpoint, 'POST', { values: defaults, result: { score: 100 } }, 400);
      await call(null, endpoint, 'POST', { values: defaults }, 401);
      await call(personal, endpoint, 'POST', { values: defaults }, 403, false);
      for (const account of [admin, teacher])
        await call(account, endpoint, 'POST', { values: defaults }, 403);
      const revoked = await register('revoked');
      await db!.session.deleteMany({ where: { userId: revoked.user.id } });
      await call(revoked, endpoint, 'POST', { values: defaults }, 401);
      assert.equal(await db!.academicsRecord.count(), before);
    });

    await t.test('功能和学习权限撤销不留记录，跨账号与当前空间外记录不可读写或导出', async () => {
      const before = await db!.academicsRecord.count({ where: scope });
      await db!.systemSetting.create({
        data: { organizationId: scope.organizationId, key: 'features', value: { practice: false } },
      });
      try {
        await call(personal, endpoint, 'POST', { values: defaults }, 403);
      } finally {
        await db!.systemSetting.deleteMany({
          where: { organizationId: scope.organizationId, key: 'features' },
        });
      }
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
      });
      try {
        await call(personal, endpoint, 'POST', { values: defaults }, 403);
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'learning.use' } });
      }
      assert.equal(await db!.academicsRecord.count({ where: scope }), before);
      await call(other, `/academics/records/${rare.record.id}`, 'GET', undefined, 404);
      await call(other, `/academics/records/${rare.record.id}`, 'PATCH', { revision: 0, notes: '越权' }, 404);
      await call(other, `/academics/records/${rare.record.id}`, 'DELETE', undefined, 404);
      const outsiders: { id: string }[] = [];
      for (const data of [
        { organizationId: institution.id, userId: other.user.id, title: 'OTHER_USER_RECORD' },
        { ...scope, organizationId: institution.id, title: 'OTHER_SPACE_RECORD' },
      ])
        outsiders.push(
          await db!.academicsRecord.create({
            data: { ...data, moduleId, values: defaults, result: baseline.result },
          }),
        );
      for (const item of outsiders)
        await call(personal, `/academics/records/${item.id}`, 'GET', undefined, 404);
      const listed = (await call(personal, `/academics/records?moduleId=${moduleId}&pageSize=20`)).body;
      assert.ok(!listed.items.some((item: any) => outsiders.some((outsider) => outsider.id === item.id)));
      assert.equal(listed.total, before);
    });

    await t.test('目标仅统计完成实验次数，完美或全部预测错误均不自动代表能力评分', async () => {
      const goal = (
        await call(personal, '/academics/goals', 'POST', {
          moduleId,
          title: '分析两种预测分布',
          targetCount: 2,
        })
      ).body;
      const readGoal = async () =>
        (await call(personal, '/academics/goals?status=all')).body.items.find(
          (item: any) => item.id === goal.id,
        );
      assert.equal((await readGoal()).progressCount, 0);
      const perfect = await run(counts(30, 0, 0, 70));
      assert.equal(perfect.record.status, 'COMPLETED');
      assert.equal((await readGoal()).progressCount, 1);
      const wrong = await run(counts(0, 40, 60, 0));
      assert.equal(wrong.record.status, 'COMPLETED');
      const progress = await readGoal();
      assert.equal(progress.progressCount, 2);
      assert.equal(progress.unit, '次');
      assert.equal(progress.completed, true);
      assert.ok(!('score' in progress) && !('mastered' in progress));
      await call(personal, `/academics/records/${wrong.record.id}`, 'PATCH', {
        revision: 0,
        status: 'DRAFT',
      });
      assert.equal((await readGoal()).progressCount, 1);
      assert.equal((await readGoal()).completed, false);
    });

    await t.test('笔记CAS与历史矩阵/未定义/图保持原样，后续实验不重算旧快照', async () => {
      const notes =
        '准确率99%，但全部正类被漏掉；Precision未定义，F1为0。\n```\n<script>literal</script>\n``````\n记录完成不表示掌握。';
      const historical = await db!.academicsRecord.create({
        data: {
          ...scope,
          moduleId,
          title: '固定历史快照',
          values: defaults,
          result: { ...baseline.result, summary: 'HISTORICAL_SNAPSHOT_DO_NOT_RECOMPUTE' },
          createdAt: new Date('2020-01-01'),
        },
      });
      const saved = (
        await call(personal, `/academics/records/${rare.record.id}`, 'PATCH', { revision: 0, notes })
      ).body;
      assert.equal(saved.revision, 1);
      assert.equal(saved.notes, notes);
      assert.deepEqual(saved.values, rareValues);
      assert.deepEqual(saved.result, rare.result);
      await call(
        personal,
        `/academics/records/${rare.record.id}`,
        'PATCH',
        { revision: 0, notes: 'stale' },
        409,
      );
      await run(counts(1, 3, 5, 7));
      const old = (await call(personal, `/academics/records/${historical.id}`)).body;
      assert.deepEqual(old.values, historical.values);
      assert.deepEqual(old.result, historical.result);
      const current = (await call(personal, `/academics/records/${rare.record.id}`)).body;
      assert.equal(current.notes, notes);
      assert.deepEqual(current.result, rare.result);
      assert.equal(current.result.metrics[1].value, '未定义');
      assert.equal(current.result.metrics[4].value, 0);
    });

    await t.test('实际CSV总览与Markdown完整矩阵/分子分母/未定义/图和笔记只包含本人当前空间', async () => {
      const persisted = await db!.academicsRecord.findMany({ where: { ...scope, moduleId } });
      assert.ok(persisted.length < 50);
      for (const format of ['csv', 'md']) {
        const response = await fetch(`${origin}/api/academics/records/export`, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            origin,
            'content-type': 'application/json',
            cookie: personal.cookie,
            'x-csrf-token': personal.csrf,
          },
          body: JSON.stringify({
            format,
            moduleId,
            status: 'all',
            ...(format === 'md' ? { limit: 50 } : {}),
          }),
        });
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer()),
          text = bytes.toString('utf8');
        assert.equal(Number(response.headers.get('content-length')), bytes.length);
        assert.equal(response.headers.get('x-export-record-count'), String(persisted.length));
        assert.equal(response.headers.get('x-export-matched-count'), String(persisted.length));
        assert.equal(response.headers.get('x-export-truncated'), 'false');
        assert.match(response.headers.get('content-disposition') || '', /attachment/);
        assert.ok(!text.includes('OTHER_USER_RECORD') && !text.includes('OTHER_SPACE_RECORD'));
        assert.ok(!text.includes('NUMERIC_ORACLE_PRIVATE'));
        for (const item of persisted) assert.ok(text.includes((item.result as any).summary));
        if (format === 'csv') {
          assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
          assert.ok(
            !text.includes('<script>literal</script>'),
            'CSV contains only overview and a notes marker',
          );
          assert.ok(
            !text.includes('predictedNegative'),
            'CSV must not claim to contain complete matrix JSON',
          );
        } else {
          const blocks = [...text.matchAll(/^(`{3,})(json|text)\n([\s\S]*?)\n\1\n/gm)];
          const json = blocks.filter((block) => block[2] === 'json').map((block) => JSON.parse(block[3]));
          const includes = (value: unknown) =>
            json.some((item) => {
              try {
                assert.deepEqual(item, value);
                return true;
              } catch {
                return false;
              }
            });
          for (const item of persisted) {
            assert.ok(includes(item.values));
            assert.ok(includes(item.result));
            if (item.notes) assert.ok(blocks.some((block) => block[3] === item.notes));
          }
          assert.ok(includes(rare.result));
          assert.ok(text.includes('未定义'));
        }
      }
      assert.equal(await db!.auditLog.count({ where: { ...scope, action: 'academics.records.export' } }), 2);
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
        assert.match(name, /^confusion_matrix_it_[a-f0-9]{16}$/);
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
