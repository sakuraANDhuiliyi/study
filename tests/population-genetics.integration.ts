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

// Independent oracle: derive frequencies by drawing two alleles with replacement from
// the explicitly counted allele pool. No module evaluator is imported into this suite.
function assertPopulation(result: StudyResult, observed: number[]) {
  const total = observed.reduce((sum, value) => sum + value, 0);
  const alleles = [2 * observed[0] + observed[1], 2 * observed[2] + observed[1]];
  const alleleTotal = alleles[0] + alleles[1];
  const expectedFrequency = [
    alleles[0] * alleles[0],
    2 * alleles[0] * alleles[1],
    alleles[1] * alleles[1],
  ].map((value) => value / (alleleTotal * alleleTotal));
  const close = (actual: unknown, expected: number) => {
    assert.equal(typeof actual, 'number');
    assert.ok(Number.isFinite(actual));
    assert.ok(
      Math.abs(Number(actual) - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
      `Numeric value ${actual} differs from oracle ${expected}`,
    );
  };
  const labels = ['个体总数 N', 'A 等位基因数', 'a 等位基因数', 'A 频率 p', 'a 频率 q'];
  const metricValues = [total, ...alleles, alleles[0] / alleleTotal, alleles[1] / alleleTotal];
  labels.forEach((label, i) =>
    close(result.metrics.find((metric) => metric.label === label)?.value, metricValues[i]),
  );
  assert.equal(result.tables.length, 1);
  const table = result.tables[0];
  assert.equal(table.title, '观察与模型期望');
  assert.deepEqual(
    table.columns.map((column) => column.key),
    [
      'genotype',
      'observedCount',
      'observedFrequency',
      'expectedCount',
      'expectedFrequency',
      'countDifference',
      'frequencyDifference',
    ],
  );
  assert.equal(table.rows.length, 3);
  table.rows.forEach((row, i) => {
    assert.equal(row.genotype, ['AA', 'Aa', 'aa'][i]);
    close(row.observedCount, observed[i]);
    close(row.observedFrequency, observed[i] / total);
    close(row.expectedFrequency, expectedFrequency[i]);
    close(row.expectedCount, total * expectedFrequency[i]);
    close(row.countDifference, observed[i] - total * expectedFrequency[i]);
    close(row.frequencyDifference, observed[i] / total - expectedFrequency[i]);
  });
  const chart = result.categoryChart!;
  assert.equal(chart.title, '观察计数与模型期望计数');
  assert.deepEqual(chart.categories, ['AA', 'Aa', 'aa']);
  assert.equal(chart.yAxisLabel, '个体数');
  assert.deepEqual(
    chart.series.map((series) => series.name),
    ['观察计数', '模型期望计数'],
  );
  assert.deepEqual(chart.series[0].values, observed);
  chart.series[1].values.forEach((value, i) => close(value, total * expectedFrequency[i]));
  close(
    table.rows.reduce((sum, row) => sum + Number(row.expectedCount), 0),
    total,
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

test('群体遗传模型与增量迁移：独立PostgreSQL与真实HTTP验收', { timeout: 180_000 }, async (t) => {
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
  const name = `population_genetics_it_${suffix}`;
  assert.match(name, /^population_genetics_it_[a-f0-9]{16}$/);
  const isolatedUrl = new URL(adminUrl);
  isolatedUrl.pathname = `/${name}`;
  // Keep the API pool smaller than the concurrent export batch. Transactions must never
  // borrow a second connection while holding the user lock, even on small CI runners.
  const apiUrl = new URL(isolatedUrl);
  apiUrl.searchParams.set('connection_limit', '3');
  const password = `Fixture-${randomBytes(20).toString('hex')}!`;
  const safe = (text: string) =>
    [password, configured, isolatedUrl.href, apiUrl.href, decodeURIComponent(adminUrl.password)]
      .filter(Boolean)
      .reduce((value, secret) => value.split(secret).join('[redacted]'), text)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]');
  const port = await freePort();
  const directory = mkdtempSync(join(tmpdir(), 'population-genetics-http-'));
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
    const migration = spawn(
      process.execPath,
      [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
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
    const stagedSchema = join(directory, 'prisma');
    cpSync(resolve('prisma'), stagedSchema, {
      recursive: true,
      filter: (source) => !/202610090019[^/\\]*/.test(source),
    });
    await deploy(stagedSchema);
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
    const institution = await db.organization.create({ data: { name: '群体遗传验收机构' } });
    const hash = await hashPasswordAsync(password);
    const fixtures = [];
    for (const roleId of ['ADMIN', 'TEACHER', 'STUDENT']) {
      fixtures.push(
        await db.user.create({
          data: {
            username: `population_${suffix}_${roleId.toLowerCase()}`,
            name: roleId,
            organizationId: institution.id,
            passwordHash: hash,
            roles: { create: { roleId } },
          },
        }),
      );
    }
    await t.test('019仅追加五类公共专业，顺序/现有项/机构模板/个人偏好及重复部署稳定', async () => {
      const targets = [
        'major-biology',
        'major-ecology',
        'major-agronomy',
        'major-horticulture',
        'major-animal-science',
      ];
      const oldDate = new Date('2001-01-01T00:00:00.000Z');
      for (const id of targets) {
        const major = await db!.academicsMajor.findUniqueOrThrow({ where: { id } });
        assert.ok(!major.moduleIds.includes('population-genetics'), '018之前不应预先包含新模块');
        await db!.academicsMajor.update({
          where: { id },
          data: {
            revision: 7,
            updatedAt: oldDate,
            ...(id === 'major-ecology' ? { moduleIds: [...major.moduleIds, 'population-genetics'] } : {}),
          },
        });
      }
      const localMajor = await db!.academicsMajor.create({
        data: {
          organizationId: institution.id,
          subjectId: 'subject-science',
          name: '机构自定义生物学',
          moduleIds: ['study-notebook', 'genetics-lab'],
          revision: 8,
          updatedAt: oldDate,
        },
      });
      await db!.academicsPreference.create({
        data: {
          organizationId: institution.id,
          userId: fixtures[2].id,
          selectedModuleIds: ['genetics-lab', 'study-notebook'],
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
          personalMajorId: 'major-biology',
          username: `population_${suffix}_before_migration`,
          name: '迁移前个人同学',
          passwordHash: hash,
          roles: { create: { roleId: 'STUDENT' } },
        },
      });
      await db!.academicsPreference.create({
        data: {
          organizationId: personalSpace.id,
          userId: personalOwner.id,
          selectedModuleIds: ['study-notebook', 'genetics-lab'],
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
      await deploy(resolve('prisma'));
      const after = await db!.academicsMajor.findMany({ orderBy: { id: 'asc' } });
      assert.equal(after.length, before.length);
      for (const previous of before) {
        const current = after.find((item) => item.id === previous.id)!;
        const changed =
          targets.includes(previous.id) &&
          previous.organizationId === null &&
          !previous.moduleIds.includes('population-genetics');
        if (changed) {
          assert.deepEqual(current.moduleIds, [...previous.moduleIds, 'population-genetics']);
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
          after.find((item) => item.id === id)!.moduleIds.filter((item) => item === 'population-genetics')
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
      await deploy(resolve('prisma'));
      assert.deepEqual(await db!.academicsMajor.findMany({ orderBy: { id: 'asc' } }), after);
      assert.deepEqual(await db!.academicsPreference.findMany({ orderBy: { id: 'asc' } }), preference);
    });
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
    const personal = await register('population_personal');
    const moduleId = 'population-genetics';
    const endpoint = `/academics/modules/${moduleId}/evaluate`;
    const scope = { userId: personal.user.id, organizationId: personal.user.organizationId };
    const counts = (AA: number, Aa: number, aa: number) => ({ countAA: AA, countAa: Aa, countaa: aa });
    const run = async (values: Record<string, unknown>, title?: string) =>
      (await call(personal, endpoint, 'POST', { values, ...(title ? { title } : {}) })).body as {
        record: any;
        result: StudyResult;
      };
    let baseline: any;
    let fractional: any;
    let zero: any;

    await t.test('自由学习目录与严格整数元数据可访问，默认比例由独立等位基因配对oracle复核', async () => {
      const me = (await call(personal, '/academics/me')).body;
      assert.equal(me.accountMode, 'PERSONAL');
      assert.equal(me.majorId, null);
      assert.deepEqual(me.selectedModuleIds, []);
      const catalog = (await call(personal, '/academics/catalog')).body;
      assert.ok(catalog.modules.some((item: any) => item.id === moduleId));
      const module = (await call(personal, `/academics/modules/${moduleId}`)).body;
      assert.equal(module.title, '群体等位基因频率与模型期望');
      assert.deepEqual(module.defaultValues, counts(36, 48, 16));
      for (const key of ['countAA', 'countAa', 'countaa'])
        assert.deepEqual(
          (({ type, required, min, max, step }: any) => ({ type, required, min, max, step }))(
            module.fields.find((field: any) => field.key === key),
          ),
          { type: 'number', required: true, min: 0, max: 1_000_000, step: 1 },
        );
      baseline = await run(counts(36, 48, 16), '课堂观察与模型期望');
      assertPopulation(baseline.result, [36, 48, 16]);
      assert.equal(baseline.record.status, 'COMPLETED');
      assert.ok(!('score' in baseline.result) && !('mastered' in baseline.result));
      assert.match(baseline.result.sections.map((item) => item.content).join(' '), /随机|模型/);
    });

    await t.test('单个杂合体的小数期望、纯合零列和最大计数均数值守恒', async () => {
      fractional = await run(counts(0, 1, 0), '单个杂合体的小数期望');
      assertPopulation(fractional.result, [0, 1, 0]);
      assert.deepEqual(fractional.result.categoryChart.series[1].values, [0.25, 0.5, 0.25]);
      zero = await run(counts(0, 0, 17), '只有a且保留零值');
      assertPopulation(zero.result, [0, 0, 17]);
      for (const values of [
        [17, 0, 0],
        [50, 0, 50],
        [1_000_000, 1_000_000, 1_000_000],
        [999_999, 1, 0],
        [2, 3, 7],
      ]) {
        const output = await run(counts(values[0], values[1], values[2]));
        assertPopulation(output.result, values);
        if (values[0] === 999_999) {
          assert.ok(Number(output.result.tables[0].rows[2].expectedFrequency) > 0);
          assert.ok(Number(output.result.tables[0].rows[2].expectedCount) > 0);
        }
        const persisted = await db!.academicsRecord.findUniqueOrThrow({ where: { id: output.record.id } });
        assert.deepEqual(persisted.values, counts(values[0], values[1], values[2]));
        assert.deepEqual(persisted.result, output.result);
      }
    });

    await t.test('非法数值、缺字段、伪造结果与错误角色或CSRF均拒绝且不落库', async () => {
      // Split failed-input vectors into separate learners, each within 20 requests/minute.
      const invalidLearners = await Promise.all([register('invalid_a'), register('invalid_b')]);
      const before = await db!.academicsRecord.count();
      const invalid: Record<string, unknown>[] = [
        counts(0, 0, 0),
        {},
        { countAA: 1, countAa: 0 },
        { countAA: 1, countAa: 0, countAAa: 0 },
        { ...counts(1, 0, 0), unexpected: 1 },
      ];
      for (const field of ['countAA', 'countAa', 'countaa'])
        for (const value of [-1, 0.5, 1_000_001, 1e100, '1', '', null, true, [], {}])
          invalid.push({ ...counts(1, 1, 1), [field]: value });
      for (const [index, values] of invalid.entries())
        await call(invalidLearners[index % 2], endpoint, 'POST', { values }, 400);
      await call(
        invalidLearners[0],
        endpoint,
        'POST',
        { values: counts(1, 1, 1), result: { score: 100 } },
        400,
      );
      await call(null, endpoint, 'POST', { values: counts(1, 1, 1) }, 401);
      await call(personal, endpoint, 'POST', { values: counts(1, 1, 1) }, 403, false);
      for (const account of [admin, teacher])
        await call(account, endpoint, 'POST', { values: counts(1, 1, 1) }, 403);
      assert.equal(await db!.academicsRecord.count(), before);
    });

    await t.test('功能撤销和learning权限撤销不保存，记录按本人及当前空间隔离', async () => {
      const before = await db!.academicsRecord.count({ where: scope });
      await db!.systemSetting.create({
        data: { organizationId: scope.organizationId, key: 'features', value: { practice: false } },
      });
      try {
        await call(personal, endpoint, 'POST', { values: counts(1, 1, 1) }, 403);
      } finally {
        await db!.systemSetting.deleteMany({
          where: { organizationId: scope.organizationId, key: 'features' },
        });
      }
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
      });
      try {
        await call(personal, endpoint, 'POST', { values: counts(1, 1, 1) }, 403);
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'learning.use' } });
      }
      assert.equal(await db!.academicsRecord.count({ where: scope }), before);
      await call(other, `/academics/records/${fractional.record.id}`, 'GET', undefined, 404);
      await call(
        other,
        `/academics/records/${fractional.record.id}`,
        'PATCH',
        { revision: 0, notes: '越权' },
        404,
      );
      const outsider = await db!.academicsRecord.create({
        data: {
          organizationId: institution.id,
          userId: other.user.id,
          moduleId,
          title: '机构学生的私有记录',
          values: counts(1, 2, 3),
          result: baseline.result,
        },
      });
      const foreign = await db!.academicsRecord.create({
        data: {
          ...scope,
          organizationId: institution.id,
          moduleId,
          title: '同一用户其他空间记录',
          values: counts(1, 2, 3),
          result: baseline.result,
        },
      });
      for (const item of [outsider, foreign])
        await call(personal, `/academics/records/${item.id}`, 'GET', undefined, 404);
      const listed = (await call(personal, `/academics/records?moduleId=${moduleId}&pageSize=20`)).body;
      assert.ok(!listed.items.some((item: any) => [outsider.id, foreign.id].includes(item.id)));
    });

    await t.test('目标只统计完成实验次数，修改草稿状态降低计数而不产生掌握结论', async () => {
      const goal = (
        await call(personal, '/academics/goals', 'POST', {
          moduleId,
          title: '比较两次观察样本',
          targetCount: 2,
        })
      ).body;
      const readGoal = async () =>
        (await call(personal, '/academics/goals?status=all')).body.items.find(
          (item: any) => item.id === goal.id,
        );
      assert.equal((await readGoal()).progressCount, 0, '目标创建前的历史实验不计入');
      const first = await run(counts(50, 0, 50));
      assert.equal(first.record.status, 'COMPLETED', '观察与模型不吻合也表示完成本次实验');
      assert.equal((await readGoal()).progressCount, 1);
      await run(counts(36, 48, 16));
      let progress = await readGoal();
      assert.equal(progress.progressCount, 2);
      assert.equal(progress.unit, '次');
      assert.equal(progress.completed, true);
      assert.ok(!('score' in progress) && !('mastered' in progress));
      await call(personal, `/academics/records/${first.record.id}`, 'PATCH', {
        revision: 0,
        status: 'DRAFT',
      });
      progress = await readGoal();
      assert.equal(progress.progressCount, 1);
      assert.equal(progress.completed, false);
    });

    await t.test('笔记CAS、持久化历史和新计算互不重算，零值与小数图数据原样保存', async () => {
      const notes =
        '观察计数允许为0，期望计数保留0.25。\n```\n<script>not executable</script>\n``````\n模型不等于群体达标或掌握。';
      const historical = await db!.academicsRecord.create({
        data: {
          ...scope,
          moduleId,
          title: '固定的历史结果',
          values: counts(36, 48, 16),
          result: { ...baseline.result, summary: '历史快照，不因后续输入重算' },
          createdAt: new Date('2020-01-01'),
        },
      });
      const updated = (
        await call(personal, `/academics/records/${fractional.record.id}`, 'PATCH', { revision: 0, notes })
      ).body;
      assert.equal(updated.revision, 1);
      assert.equal(updated.notes, notes);
      assert.deepEqual(updated.values, fractional.record.values);
      assert.deepEqual(updated.result, fractional.result);
      await call(
        personal,
        `/academics/records/${fractional.record.id}`,
        'PATCH',
        { revision: 0, notes: '旧版本覆盖' },
        409,
      );
      await run(counts(2, 0, 1));
      assert.deepEqual(
        (await call(personal, `/academics/records/${historical.id}`)).body.result,
        historical.result,
      );
      const read = (await call(personal, `/academics/records/${fractional.record.id}`)).body;
      assert.equal(read.notes, notes);
      assert.deepEqual(read.result, fractional.result);
      assert.deepEqual(
        (await call(personal, `/academics/records/${zero.record.id}`)).body.result,
        zero.result,
      );
    });

    await t.test(
      'CSV完整摘要及实际Markdown字节包含持久化输入/表格/分类图和笔记且不混入其他空间',
      async () => {
        const persisted = await db!.academicsRecord.findMany({ where: { ...scope, moduleId } });
        for (const format of ['csv', 'md']) {
          const response = await fetch(`${origin}/api/academics/records/export`, {
            method: 'POST',
            signal: AbortSignal.timeout(15_000),
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
          assert.ok(!text.includes('同一用户其他空间记录') && !text.includes('机构学生的私有记录'));
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
            assert.ok(includes(fractional.result));
            assert.ok(includes(zero.result));
          }
        }
        assert.equal(
          await db!.auditLog.count({ where: { ...scope, action: 'academics.records.export' } }),
          2,
        );
      },
    );
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
      assert.match(name, /^population_genetics_it_[a-f0-9]{16}$/);
      try {
        await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      } catch {
        t.diagnostic(
          '本次随机测试库清理失败；仅需管理员检查population_genetics_it_前缀的遗留测试库。未触碰现有业务库。',
        );
      }
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
