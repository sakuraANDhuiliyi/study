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

const moduleId = 'simpson-paradox';
const fields = [
  'aSuccess1',
  'aTotal1',
  'bSuccess1',
  'bTotal1',
  'aSuccess2',
  'aTotal2',
  'bSuccess2',
  'bTotal2',
] as const;
const counts = (...values: number[]) => Object.fromEntries(fields.map((field, i) => [field, values[i]]));
const defaults = counts(9, 10, 80, 100, 20, 100, 1, 10);

// Independent oracle: expand all four strata to a shared integer population grid.
// The common-weight numerator is a sum of replicated successes on that grid, without
// importing the production evaluator or using its normalized-fraction arithmetic.
type Fraction = readonly [bigint, bigint];
const fraction = (numerator: bigint | number, denominator: bigint | number = 1): Fraction => [
  BigInt(numerator),
  BigInt(denominator),
];
const subtract = (a: Fraction, b: Fraction): Fraction => [a[0] * b[1] - b[0] * a[1], a[1] * b[1]];
const sign = (a: Fraction) => (a[0] === 0n ? 0 : a[0] > 0n ? 1 : -1);
const number = (a: Fraction) => Number(a[0]) / Number(a[1]);
const percentage = (a: Fraction) => Number(a[0] * 100n) / Number(a[1]);
const direction = (value: Fraction) => ['方案B较高', '持平', '方案A较高'][sign(value) + 1];
function assertSimpson(result: StudyResult, values: Record<string, number>) {
  const inputs = [
    [values.aSuccess1, values.aTotal1, values.bSuccess1, values.bTotal1],
    [values.aSuccess2, values.aTotal2, values.bSuccess2, values.bTotal2],
  ];
  const totalA = values.aTotal1 + values.aTotal2,
    totalB = values.bTotal1 + values.bTotal2;
  const rates = inputs.map(([a, an, b, bn]) => [fraction(a, an), fraction(b, bn)]);
  const weights = inputs.map(([, an, , bn]) => fraction(an + bn, totalA + totalB));
  const aggregate = [
    fraction(values.aSuccess1 + values.aSuccess2, totalA),
    fraction(values.bSuccess1 + values.bSuccess2, totalB),
  ];
  const grid = inputs.reduce((scale, row) => scale * BigInt(row[1]) * BigInt(row[3]), 1n);
  const standardized = [0, 1].map((group) =>
    fraction(
      inputs.reduce(
        (successes, row) =>
          successes + BigInt(row[group * 2]) * (grid / BigInt(row[group * 2 + 1])) * BigInt(row[1] + row[3]),
        0n,
      ),
      grid * BigInt(totalA + totalB),
    ),
  );
  const comparisons = [...rates, aggregate, standardized];
  const differences = comparisons.map(([a, b]) => subtract(a, b));
  const signs = differences.map(sign);
  const classification =
    signs[0] === 0 || signs[1] === 0
      ? '分层持平'
      : signs[0] !== signs[1]
        ? '分层混向'
        : signs[2] === 0
          ? '汇总持平'
          : signs[2] !== signs[0]
            ? '严格反转'
            : '方向一致';
  const close = (actual: unknown, expected: number) => {
    assert.equal(typeof actual, 'number');
    assert.ok(Number.isFinite(actual));
    if (expected === 0) assert.equal(actual, 0);
    else
      assert.ok(
        Math.abs((Number(actual) - expected) / expected) < 1e-10,
        'Result differs from independent exact fraction oracle',
      );
  };
  assert.equal(result.metrics.find((item) => item.label === '比较分类')?.value, classification);
  assert.equal(result.tables.length, 3);
  const [raw, contributions, comparison] = result.tables;
  assert.equal(raw.title, '分层原始数据');
  assert.deepEqual(
    raw.columns.map((item) => item.key),
    [
      'layer',
      'aSuccess',
      'aTotal',
      'bSuccess',
      'bTotal',
      'aPercent',
      'bPercent',
      'aWeight',
      'bWeight',
      'differencePp',
    ],
  );
  assert.equal(raw.rows.length, 2);
  raw.rows.forEach((row, i) => {
    assert.equal(row.layer, `分层${i + 1}`);
    for (const [j, key] of ['aSuccess', 'aTotal', 'bSuccess', 'bTotal'].entries())
      assert.equal(row[key], inputs[i][j]);
    close(row.aPercent, percentage(rates[i][0]));
    close(row.bPercent, percentage(rates[i][1]));
    close(row.aWeight, inputs[i][1] / totalA);
    close(row.bWeight, inputs[i][3] / totalB);
    close(row.differencePp, percentage(differences[i]));
  });
  assert.equal(contributions.title, '共同权重与贡献');
  assert.deepEqual(
    contributions.columns.map((item) => item.key),
    ['layer', 'aTotal', 'bTotal', 'pooledTotal', 'pooledWeight', 'aContributionPp', 'bContributionPp'],
  );
  assert.equal(contributions.rows.length, 2);
  contributions.rows.forEach((row, i) => {
    assert.equal(row.layer, `分层${i + 1}`);
    assert.equal(row.aTotal, inputs[i][1]);
    assert.equal(row.bTotal, inputs[i][3]);
    assert.equal(row.pooledTotal, inputs[i][1] + inputs[i][3]);
    close(row.pooledWeight, number(weights[i]));
    close(
      row.aContributionPp,
      percentage(fraction(BigInt(inputs[i][0]) * weights[i][0], BigInt(inputs[i][1]) * weights[i][1])),
    );
    close(
      row.bContributionPp,
      percentage(fraction(BigInt(inputs[i][2]) * weights[i][0], BigInt(inputs[i][3]) * weights[i][1])),
    );
  });
  assert.equal(comparison.title, '四种口径比较');
  assert.deepEqual(
    comparison.columns.map((item) => item.key),
    ['basis', 'aPercent', 'bPercent', 'differencePp', 'direction'],
  );
  const categories = ['分层1', '分层2', '原始汇总', '共同权重'];
  assert.equal(comparison.rows.length, 4);
  comparison.rows.forEach((row, i) => {
    assert.equal(row.basis, categories[i]);
    assert.equal(row.direction, direction(differences[i]));
    close(row.aPercent, percentage(comparisons[i][0]));
    close(row.bPercent, percentage(comparisons[i][1]));
    close(row.differencePp, percentage(differences[i]));
  });
  const chart = result.categoryChart!;
  assert.equal(chart.title, '分层与汇总达成比例');
  assert.equal(chart.yAxisLabel, '达成比例（%）');
  assert.deepEqual(chart.categories, categories);
  assert.deepEqual(
    chart.series.map((series) => series.name),
    ['方案A', '方案B'],
  );
  chart.series.forEach((series, group) => {
    assert.equal(series.values.length, 4);
    series.values.forEach((value, i) => close(value, percentage(comparisons[i][group])));
  });
  assert.ok(!('score' in result) && !('mastered' in result));
  return { classification, weights, standardized, differences };
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

test('辛普森反转精确比例与增量迁移：独立PostgreSQL与真实HTTP验收', { timeout: 180_000 }, async (t) => {
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
  const name = `simpson_paradox_it_${suffix}`;
  assert.match(name, /^simpson_paradox_it_[a-f0-9]{16}$/);
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
  const directory = mkdtempSync(join(tmpdir(), 'simpson-paradox-http-'));
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
    const beforeSchema = schemaThrough(19);
    const targetSchema = schemaThrough(20);
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
    const institution = await db.organization.create({ data: { name: '辛普森反转验收机构' } });
    const hash = await hashPasswordAsync(password);
    const fixtures: { id: string; username: string }[] = [];
    for (const roleId of ['ADMIN', 'TEACHER', 'STUDENT']) {
      fixtures.push(
        await db.user.create({
          data: {
            username: `simpson_${suffix}_${roleId.toLowerCase()}`,
            name: roleId,
            organizationId: institution.id,
            passwordHash: hash,
            roles: { create: { roleId } },
          },
        }),
      );
    }
    await t.test('020仅追加四类公共专业，顺序/已包含项/机构模板/个人偏好及重复部署稳定', async () => {
      const migrationsBefore = await appliedMigrations();
      assert.equal(migrationsBefore.length, 19);
      assert.equal(new Set(migrationsBefore).size, 19);
      assert.equal(migrationsBefore.at(-1), '202610090019_population_genetics');
      const targets = ['major-statistics', 'major-data-science', 'major-economics', 'major-marketing'];
      const oldDate = new Date('2001-01-01T00:00:00.000Z');
      for (const id of targets) {
        const major = await db!.academicsMajor.findUniqueOrThrow({ where: { id } });
        assert.ok(!major.moduleIds.includes('simpson-paradox'), '019之前不应预先包含新模块');
        await db!.academicsMajor.update({
          where: { id },
          data: {
            revision: 7,
            updatedAt: oldDate,
            ...(id === 'major-economics' ? { moduleIds: [...major.moduleIds, 'simpson-paradox'] } : {}),
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
          username: `simpson_${suffix}_before_migration`,
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
      assert.deepEqual(migrationsAfter, [...migrationsBefore, '202610090020_simpson_paradox']);
      assert.equal(migrationsAfter.length, 20);
      const after = await db!.academicsMajor.findMany({ orderBy: { id: 'asc' } });
      assert.equal(after.length, before.length);
      for (const previous of before) {
        const current = after.find((item) => item.id === previous.id)!;
        const changed =
          targets.includes(previous.id) &&
          previous.organizationId === null &&
          !previous.moduleIds.includes('simpson-paradox');
        if (changed) {
          assert.deepEqual(current.moduleIds, [...previous.moduleIds, 'simpson-paradox']);
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
          after.find((item) => item.id === id)!.moduleIds.filter((item) => item === 'simpson-paradox').length,
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
    const personal = await register('simpson_personal');
    const endpoint = `/academics/modules/${moduleId}/evaluate`;
    const scope = { userId: personal.user.id, organizationId: personal.user.organizationId };
    const run = async (values: Record<string, unknown>, title?: string) =>
      (await call(personal, endpoint, 'POST', { values, ...(title ? { title } : {}) })).body as {
        record: any;
        result: StudyResult;
      };
    let baseline: any;
    let unequal: any;
    let near: any;
    await t.test('自由学习目录、八个严格计数字段与默认反转按手算和独立有理数复核', async () => {
      const me = (await call(personal, '/academics/me')).body;
      assert.equal(me.accountMode, 'PERSONAL');
      assert.equal(me.majorId, null);
      assert.deepEqual(me.selectedModuleIds, []);
      assert.ok(
        (await call(personal, '/academics/catalog')).body.modules.some((item: any) => item.id === moduleId),
      );
      const module = (await call(personal, `/academics/modules/${moduleId}`)).body;
      assert.equal(module.title, '分层与汇总比例：辛普森反转');
      assert.deepEqual(module.defaultValues, defaults);
      assert.deepEqual(
        module.fields.map((field: any) => field.key),
        [...fields],
      );
      for (const field of module.fields)
        assert.deepEqual(
          (({ type, required, min, max, step }: any) => ({ type, required, min, max, step }))(field),
          { type: 'number', required: true, min: field.key.includes('Total') ? 1 : 0, max: 1000000, step: 1 },
        );
      baseline = await run(defaults, '默认反转：实验并非因果结论');
      const checked = assertSimpson(baseline.result, defaults);
      assert.equal(checked.classification, '严格反转');
      assert.deepEqual(checked.weights.map(number), [0.5, 0.5]);
      assert.deepEqual(checked.standardized.map(percentage), [55, 45]);
      assert.deepEqual(
        baseline.result.tables[2].rows.map((row: any) => row.direction),
        ['方案A较高', '方案A较高', '方案B较高', '方案A较高'],
      );
      assert.equal(baseline.record.status, 'COMPLETED');
      assert.match(baseline.result.sections.map((section: any) => section.content).join(' '), /因果/);
    });

    await t.test('非等权、反向反转、持平和混向分类均按未舍入有理数判断', async () => {
      const nonEqual = counts(9, 10, 160, 200, 20, 100, 1, 10);
      unequal = await run(nonEqual, '非等权21比11');
      const check = assertSimpson(unequal.result, nonEqual);
      assert.deepEqual(check.weights.map(number), [21 / 32, 11 / 32]);
      assert.deepEqual(check.standardized.map(percentage), [65.9375, 55.9375]);
      const examples: [number[], string][] = [
        [[80, 100, 9, 10, 1, 10, 20, 100], '严格反转'],
        [[1, 2, 1, 2, 1, 2, 0, 1], '分层持平'],
        [[9, 10, 8, 10, 1, 10, 2, 10], '分层混向'],
        [[9, 10, 48, 60, 1, 10, 2, 40], '汇总持平'],
        [[9, 10, 8, 10, 2, 10, 1, 10], '方向一致'],
        [[0, 1, 0, 1000000, 1000000, 1000000, 1, 1], '分层持平'],
      ];
      for (const [input, classification] of examples) {
        const values = counts(...input),
          output = await run(values);
        assert.equal(assertSimpson(output.result, values).classification, classification);
        const persisted = await db!.academicsRecord.findUniqueOrThrow({ where: { id: output.record.id } });
        assert.deepEqual(persisted.values, values);
        assert.deepEqual(persisted.result, output.result);
      }
    });

    await t.test('百万上限与超53位分母保持极小非零差值，显示近似不能篡改方向', async () => {
      const input = counts(999999, 1000000, 999998, 999999, 999982, 999983, 999981, 999982);
      near = await run(input, '精确微小差值');
      const checked = assertSimpson(near.result, input);
      assert.ok(checked.differences[3][1] > BigInt(Number.MAX_SAFE_INTEGER));
      assert.equal(checked.classification, '方向一致');
      for (const row of near.result.tables[2].rows) {
        assert.equal(row.direction, '方案A较高');
        assert.ok(row.differencePp > 0 && row.differencePp < 1e-8);
      }
      const swapped = counts(999998, 999999, 999999, 1000000, 999981, 999982, 999982, 999983);
      const negative = await run(swapped);
      assertSimpson(negative.result, swapped);
      assert.ok(negative.result.tables[2].rows.every((row: any) => row.differencePp < 0));
      const cancellation = counts(999999, 1000000, 999998, 999999, 999997, 999998, 999998, 999999);
      const cancelled = await run(cancellation, '抵消后仍有方向');
      assert.equal(assertSimpson(cancelled.result, cancellation).classification, '分层混向');
      const last = cancelled.result.tables[2].rows[3];
      assert.equal(last.aPercent, last.bPercent, 'Display rounding is allowed to show equal rates');
      assert.equal(last.direction, '方案B较高');
      assert.ok(typeof last.differencePp === 'number');
      assert.ok(last.differencePp < 0 && last.differencePp > -1e-15);
      const manual = -50 / (1000000 * 999999 * 999998);
      assert.ok(Math.abs((last.differencePp - manual) / manual) < 1e-10);
    });

    await t.test('每个字段的非法类型/范围、超出分母、CSRF和管理角色均拒绝且不落库', async () => {
      // Every failed calculation is charged; each field gets its own bounded learner batch.
      const invalidEnvelope = await register('invalid_envelope');
      const before = await db!.academicsRecord.count();
      for (const field of fields) {
        const invalidField = await register(`invalid_${field.toLowerCase()}`);
        const without = { ...defaults };
        delete without[field];
        await call(invalidField, endpoint, 'POST', { values: without }, 400);
        for (const value of [-1, 0.25, 1000001, 1e100, '1', '', null, true, [], {}])
          await call(invalidField, endpoint, 'POST', { values: { ...defaults, [field]: value } }, 400);
        if (field.includes('Total'))
          await call(invalidField, endpoint, 'POST', { values: { ...defaults, [field]: 0 } }, 400);
      }
      for (const [success, total] of [
        ['aSuccess1', 'aTotal1'],
        ['bSuccess1', 'bTotal1'],
        ['aSuccess2', 'aTotal2'],
        ['bSuccess2', 'bTotal2'],
      ])
        await call(
          invalidEnvelope,
          endpoint,
          'POST',
          { values: { ...defaults, [success]: defaults[total] + 1 } },
          400,
        );
      await call(invalidEnvelope, endpoint, 'POST', { values: { ...defaults, unknown: 1 } }, 400);
      await call(invalidEnvelope, endpoint, 'POST', { values: defaults, result: { score: 100 } }, 400);
      await call(null, endpoint, 'POST', { values: defaults }, 401);
      await call(personal, endpoint, 'POST', { values: defaults }, 403, false);
      for (const account of [admin, teacher])
        await call(account, endpoint, 'POST', { values: defaults }, 403);
      assert.equal(await db!.academicsRecord.count(), before);
    });

    await t.test('功能和学习权限撤销禁止新记录，本人及当前空间隔离不可越权读写', async () => {
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
      await call(other, `/academics/records/${unequal.record.id}`, 'GET', undefined, 404);
      await call(
        other,
        `/academics/records/${unequal.record.id}`,
        'PATCH',
        { revision: 0, notes: '越权' },
        404,
      );
      await call(other, `/academics/records/${unequal.record.id}`, 'DELETE', undefined, 404);
      const outsider = await db!.academicsRecord.create({
        data: {
          organizationId: institution.id,
          userId: other.user.id,
          moduleId,
          title: 'OTHER_USER_RECORD',
          values: defaults,
          result: baseline.result,
        },
      });
      const foreign = await db!.academicsRecord.create({
        data: {
          ...scope,
          organizationId: institution.id,
          moduleId,
          title: 'OTHER_SPACE_RECORD',
          values: defaults,
          result: baseline.result,
        },
      });
      for (const item of [outsider, foreign])
        await call(personal, `/academics/records/${item.id}`, 'GET', undefined, 404);
      const listed = (await call(personal, `/academics/records?moduleId=${moduleId}&pageSize=20`)).body;
      assert.ok(!listed.items.some((item: any) => [outsider.id, foreign.id].includes(item.id)));
    });

    await t.test('目标统计完成实验次数，反转或持平都不自动代表能力掌握', async () => {
      const goal = (
        await call(personal, '/academics/goals', 'POST', {
          moduleId,
          title: '比较两个不同的统计口径',
          targetCount: 2,
        })
      ).body;
      const readGoal = async () =>
        (await call(personal, '/academics/goals?status=all')).body.items.find(
          (item: any) => item.id === goal.id,
        );
      assert.equal((await readGoal()).progressCount, 0);
      const first = await run(defaults);
      assert.equal(first.record.status, 'COMPLETED');
      assert.equal((await readGoal()).progressCount, 1);
      await run(counts(1, 2, 1, 2, 1, 2, 1, 2));
      const progress = await readGoal();
      assert.equal(progress.progressCount, 2);
      assert.equal(progress.unit, '次');
      assert.equal(progress.completed, true);
      assert.ok(!('score' in progress) && !('mastered' in progress));
      await call(personal, `/academics/records/${first.record.id}`, 'PATCH', {
        revision: 0,
        status: 'DRAFT',
      });
      assert.equal((await readGoal()).progressCount, 1);
      assert.equal((await readGoal()).completed, false);
    });

    await t.test('笔记CAS与历史输入/表/图保持原样，后续运行不会重算历史快照', async () => {
      const notes =
        '统一权重是21/32与11/32；原始计数必须保留。\n```\n<script>literal</script>\n``````\n反转不推出因果结论。';
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
        await call(personal, `/academics/records/${unequal.record.id}`, 'PATCH', { revision: 0, notes })
      ).body;
      assert.equal(saved.revision, 1);
      assert.equal(saved.notes, notes);
      assert.deepEqual(saved.values, unequal.record.values);
      assert.deepEqual(saved.result, unequal.result);
      await call(
        personal,
        `/academics/records/${unequal.record.id}`,
        'PATCH',
        { revision: 0, notes: 'stale' },
        409,
      );
      await run(counts(1, 3, 0, 2, 3, 7, 2, 9));
      const old = (await call(personal, `/academics/records/${historical.id}`)).body;
      assert.deepEqual(old.values, historical.values);
      assert.deepEqual(old.result, historical.result);
      const current = (await call(personal, `/academics/records/${unequal.record.id}`)).body;
      assert.equal(current.notes, notes);
      assert.deepEqual(current.result, unequal.result);
      assert.deepEqual(
        (await call(personal, `/academics/records/${near.record.id}`)).body.result,
        near.result,
      );
    });

    await t.test('CSV总览与Markdown完整计数/权重/差值/分类图JSON及笔记均隔离其他空间', async () => {
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
        for (const item of persisted) assert.ok(text.includes((item.result as any).summary));
        if (format === 'csv') assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
        else {
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
          assert.ok(includes(unequal.result));
          assert.ok(includes(near.result));
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
        assert.match(name, /^simpson_paradox_it_[a-f0-9]{16}$/);
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
