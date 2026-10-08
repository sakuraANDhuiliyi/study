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

type Truth = Record<string, boolean>;
const table = (result: StudyResult, title: string) => {
  const found = result.tables.find((item) => item.title === title);
  assert.ok(found, `缺少${title}`);
  return found;
};
// Independent oracle: explicit JavaScript Boolean functions, never parse/eval user text.
function assertComparison(
  result: StudyResult,
  variables: string[],
  left: (v: Truth) => boolean,
  right: (v: Truth) => boolean,
) {
  const expected = Array.from({ length: 2 ** variables.length }, (_, mask) => {
    const input = Object.fromEntries(
      variables.map((name, i) => [name, !!(mask & (1 << (variables.length - i - 1)))]),
    );
    const output = Number(left(input)),
      comparisonOutput = Number(right(input));
    return {
      ...Object.fromEntries(variables.map((name) => [name, Number(input[name])])),
      output,
      comparisonOutput,
      matches: output === comparisonOutput ? '一致' : '不同',
    };
  });
  assert.deepEqual(table(result, '真值表').rows, expected);
  assert.deepEqual(
    table(result, '真值表').columns.map((c) => c.key),
    [...variables, 'output', 'comparisonOutput', 'matches'],
  );
  const differences = expected.filter((row) => row.matches === '不同');
  assert.match(result.summary, differences.length ? /逻辑不等价/ : /逻辑等价/);
  assert.equal(result.metrics.find((m) => m.label === '检查组合数')?.value, expected.length);
  assert.equal(result.metrics.find((m) => m.label === '差异组合数')?.value, differences.length);
  assert.equal(
    result.metrics.find((m) => m.label === '一致组合数')?.value,
    expected.length - differences.length,
  );
  if (differences.length) {
    assert.deepEqual(table(result, '全部反例').rows, differences);
    const first = result.sections.find((section) => section.title === '首个反例');
    assert.ok(first);
    for (const name of variables) assert.ok(first.content.includes(`${name}=${differences[0][name]}`));
  } else {
    assert.ok(!result.tables.some((item) => item.title === '全部反例'));
    assert.ok(!result.sections.some((item) => item.title === '首个反例'));
  }
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

test('数字逻辑等价比较：独立PostgreSQL与真实HTTP验收', { timeout: 180_000 }, async (t) => {
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
  const name = `digital_logic_it_${suffix}`;
  assert.match(name, /^digital_logic_it_[a-f0-9]{16}$/);
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
  const directory = mkdtempSync(join(tmpdir(), 'digital-logic-http-'));
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
    const institution = await db.organization.create({ data: { name: '数字逻辑验收机构' } });
    const hash = await hashPasswordAsync(password);
    const fixtures = [];
    for (const roleId of ['ADMIN', 'TEACHER', 'STUDENT']) {
      fixtures.push(
        await db.user.create({
          data: {
            username: `logic_${suffix}_${roleId.toLowerCase()}`,
            name: roleId,
            organizationId: institution.id,
            passwordHash: hash,
            roles: { create: { roleId } },
          },
        }),
      );
    }
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
    const personal = await register('logic_personal');
    const endpoint = '/academics/modules/digital-logic/evaluate';
    const scope = { userId: personal.user.id, organizationId: personal.user.organizationId };
    const run = async (values: Record<string, unknown>, title?: string) =>
      (await call(personal, endpoint, 'POST', { values, ...(title ? { title } : {}) })).body as {
        record: any;
        result: StudyResult;
      };
    let baseline: StudyResult;
    let compared: any;
    let historical: any;

    await t.test('可选对照字段兼容缺失/null/空白，旧默认表达式8行7真且结果完全一致', async () => {
      const module = (await call(personal, '/academics/modules/digital-logic')).body;
      assert.equal(module.fields.find((field: any) => field.key === 'compareExpression').required, false);
      const original = await run({ expression: '!(A && B) || C' }, '原始单表达式');
      baseline = original.result;
      const rows = Array.from({ length: 8 }, (_, mask) => {
        const A = (mask >> 2) & 1,
          B = (mask >> 1) & 1,
          C = mask & 1;
        return { A, B, C, output: Number(!(A && B) || C) };
      });
      assert.deepEqual(table(baseline, '真值表').rows, rows);
      assert.equal(rows.filter((row) => row.output === 1).length, 7);
      assert.equal(original.record.status, 'COMPLETED');
      assert.ok(!baseline.tables.some((item) => item.title === '全部反例'));
      for (const compareExpression of [null, '', '   \t\n']) {
        const output = await run({ expression: '!(A && B) || C', compareExpression });
        assert.deepEqual(output.result, baseline);
      }
    });

    await t.test('德摩根/异或/优先级及四变量并集由独立布尔函数验证完整真值表', async () => {
      const examples: [string, string, string[], (v: Truth) => boolean, (v: Truth) => boolean][] = [
        ['!(A && B)', '!A || !B', ['A', 'B'], (v) => !(v.A && v.B), (v) => !v.A || !v.B],
        [
          'A ^ B',
          '(A || B) && !(A && B)',
          ['A', 'B'],
          (v) => v.A !== v.B,
          (v) => (v.A || v.B) && !(v.A && v.B),
        ],
        [
          'A || B && C',
          'A || (B && C)',
          ['A', 'B', 'C'],
          (v) => v.A || (v.B && v.C),
          (v) => v.A || (v.B && v.C),
        ],
        ['A', 'A && (B || !B) && (C || !C) && (D || !D)', ['A', 'B', 'C', 'D'], (v) => v.A, (v) => v.A],
      ];
      for (const [expression, compareExpression, variables, left, right] of examples) {
        const { record, result } = await run({ expression, compareExpression });
        assertComparison(result, variables, left, right);
        assert.equal(record.status, 'COMPLETED', '完成实验不代表表达式正确性或能力评分');
        const persisted = await db!.academicsRecord.findUniqueOrThrow({ where: { id: record.id } });
        assert.deepEqual(persisted.values, { expression, compareExpression });
        assert.deepEqual(persisted.result, result);
      }
    });

    await t.test('非等价是正常实验，列出全部两反例而不是仅首例，16组合差异正确', async () => {
      const output = await run({ expression: 'A && B', compareExpression: 'A || B' }, '两个反例的比较');
      compared = output.record;
      assertComparison(
        output.result,
        ['A', 'B'],
        (v) => v.A && v.B,
        (v) => v.A || v.B,
      );
      assert.equal(table(output.result, '全部反例').rows.length, 2);
      assert.equal(compared.status, 'COMPLETED');
      assert.equal(
        (await db!.academicsRecord.findUniqueOrThrow({ where: { id: compared.id } })).status,
        'COMPLETED',
      );
      const four = await run({ expression: '(A && B) || C', compareExpression: 'A ^ D' });
      assertComparison(
        four.result,
        ['A', 'B', 'C', 'D'],
        (v) => (v.A && v.B) || v.C,
        (v) => v.A !== v.D,
      );
      const precedence = await run({ expression: 'A || B && C', compareExpression: '(A || B) && C' });
      assertComparison(
        precedence.result,
        ['A', 'B', 'C'],
        (v) => v.A || (v.B && v.C),
        (v) => (v.A || v.B) && v.C,
      );
    });

    await t.test('非法对照和未知字段400，角色/CSRF拒绝，均不新增记录', async () => {
      const before = await db!.academicsRecord.count();
      for (const compareExpression of [
        'E',
        'a',
        'A & B',
        'A | B',
        'A &&',
        'A B',
        '(A || B',
        'A);process.exit()',
        'A\0B',
        '!'.repeat(21) + 'A',
        '('.repeat(21) + 'A' + ')'.repeat(21),
        ' '.repeat(201),
        'A'.repeat(201),
        1,
        false,
        [],
        {},
      ]) {
        await call(personal, endpoint, 'POST', { values: { expression: 'A', compareExpression } }, 400);
      }
      await call(
        personal,
        endpoint,
        'POST',
        { values: { expression: 'A', compareExpression: 'A', unsupported: true } },
        400,
      );
      await call(
        personal,
        endpoint,
        'POST',
        { values: { expression: 'A', compareExpression: 'A' }, result: { summary: '伪造' } },
        400,
      );
      await call(null, endpoint, 'POST', { values: { expression: 'A' } }, 401);
      await call(personal, endpoint, 'POST', { values: { expression: 'A' } }, 403, false);
      for (const account of [admin, teacher])
        await call(account, endpoint, 'POST', { values: { expression: 'A' } }, 403);
      assert.equal(await db!.academicsRecord.count(), before);
    });

    await t.test('功能及权限撤销阻止保存，跨账号和跨空间均看不到本人比较记录', async () => {
      const before = await db!.academicsRecord.count({ where: scope });
      await db!.systemSetting.create({
        data: { organizationId: personal.user.organizationId, key: 'features', value: { practice: false } },
      });
      try {
        await call(personal, endpoint, 'POST', { values: { expression: 'A', compareExpression: 'B' } }, 403);
      } finally {
        await db!.systemSetting.deleteMany({
          where: { organizationId: personal.user.organizationId, key: 'features' },
        });
      }
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
      });
      try {
        await call(personal, endpoint, 'POST', { values: { expression: 'A', compareExpression: 'B' } }, 403);
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'learning.use' } });
      }
      assert.equal(await db!.academicsRecord.count({ where: scope }), before);
      await call(other, `/academics/records/${compared.id}`, 'GET', undefined, 404);
      const sameSpaceUser = await db!.user.create({
        data: {
          organizationId: institution.id,
          username: `logic_${suffix}_peer`,
          name: '同空间',
          passwordHash: hash,
          roles: { create: { roleId: 'STUDENT' } },
        },
      });
      const sameSpace = await login(sameSpaceUser.username);
      const institutionRecord = await db!.academicsRecord.create({
        data: {
          organizationId: institution.id,
          userId: other.user.id,
          moduleId: 'digital-logic',
          title: '机构学生私有比较',
          values: compared.values,
          result: compared.result,
        },
      });
      await call(sameSpace, `/academics/records/${institutionRecord.id}`, 'GET', undefined, 404);
      const otherSpace = await db!.academicsRecord.create({
        data: {
          organizationId: institution.id,
          userId: personal.user.id,
          moduleId: 'digital-logic',
          title: '本人其他空间的历史',
          values: compared.values,
          result: compared.result,
        },
      });
      await call(personal, `/academics/records/${otherSpace.id}`, 'GET', undefined, 404);
    });

    await t.test('持久化历史单式result原样读取，新计算和修改笔记不重算历史', async () => {
      historical = await db!.academicsRecord.create({
        data: {
          ...scope,
          moduleId: 'digital-logic',
          title: '升级前的单式记录',
          values: { expression: '!(A && B) || C' },
          result: { ...baseline!, summary: '升级前保存的原始真值表' },
          notes: '保持原始学习记录',
          createdAt: new Date('2020-01-01'),
        },
      });
      const fetched = (await call(personal, `/academics/records/${historical.id}`)).body;
      assert.deepEqual(fetched.result, historical.result);
      assert.deepEqual(fetched.values, historical.values);
      const changed = (
        await call(personal, `/academics/records/${historical.id}`, 'PATCH', {
          revision: fetched.revision,
          notes: '只改变笔记',
          status: 'DRAFT',
        })
      ).body;
      assert.equal(changed.status, 'DRAFT');
      assert.deepEqual(changed.result, historical.result);
      const after = (await call(personal, `/academics/records/${compared.id}`)).body;
      assert.deepEqual(after.result, compared.result);
    });

    await t.test('CSV摘要与Markdown完整双输入/全部反例和旧result都从持久化导出', async () => {
      const persisted = await db!.academicsRecord.findMany({
        where: { ...scope, moduleId: 'digital-logic' },
      });
      for (const format of ['csv', 'md']) {
        const response = await fetch(`${origin}/api/academics/records/export`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            cookie: personal.cookie,
            'x-csrf-token': personal.csrf,
          },
          body: JSON.stringify({
            format,
            moduleId: 'digital-logic',
            status: 'all',
            ...(format === 'md' ? { limit: 50 } : {}),
          }),
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        const text = bytes.toString('utf8');
        assert.match(response.headers.get('content-disposition') || '', /attachment/);
        assert.equal(response.headers.get('x-export-record-count'), String(persisted.length));
        assert.equal(response.headers.get('x-export-truncated'), 'false');
        assert.ok(text.includes(compared.result.summary));
        assert.ok(text.includes('升级前保存的原始真值表'));
        if (format === 'csv') assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
        else {
          const blocks = [...text.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1\n/gm)].map((match) =>
            JSON.parse(match[2]),
          );
          for (const record of persisted) {
            assert.ok(
              blocks.some((value) => JSON.stringify(value) === JSON.stringify(record.values)) ||
                blocks.some((value) => {
                  try {
                    assert.deepEqual(value, record.values);
                    return true;
                  } catch {
                    return false;
                  }
                }),
            );
            assert.ok(
              blocks.some((value) => {
                try {
                  assert.deepEqual(value, record.result);
                  return true;
                } catch {
                  return false;
                }
              }),
            );
          }
          const comparisonResult = blocks.find((value) => value.summary === compared.result.summary);
          assert.deepEqual(
            comparisonResult.tables.find((item: any) => item.title === '全部反例').rows,
            table(compared.result, '全部反例').rows,
          );
        }
      }
      assert.equal(await db!.auditLog.count({ where: { ...scope, action: 'academics.records.export' } }), 2);
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
      assert.match(name, /^digital_logic_it_[a-f0-9]{16}$/);
      try {
        await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      } catch {
        t.diagnostic(
          '本次随机测试库清理失败；仅需管理员检查digital_logic_it_前缀的遗留测试库。未触碰现有业务库。',
        );
      }
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
