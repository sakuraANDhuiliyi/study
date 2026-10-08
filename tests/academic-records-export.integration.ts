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

test('专业记录导出：独立PostgreSQL与真实HTTP验收', { timeout: 180_000 }, async (t) => {
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
  const name = `academic_exports_it_${suffix}`;
  assert.match(name, /^academic_exports_it_[a-f0-9]{16}$/);
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

    async function exportFile(
      client: Client | null,
      body: unknown = {},
      expected: number | number[] = 200,
      csrf = true,
    ) {
      const response = await fetch(`${origin}/api/academics/records/export`, {
        method: 'POST',
        signal: AbortSignal.timeout(20000),
        headers: {
          origin,
          'content-type': 'application/json',
          ...(client ? { cookie: client.cookie, ...(csrf ? { 'x-csrf-token': client.csrf } : {}) } : {}),
        },
        body: JSON.stringify(body),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const text = buffer.toString('utf8');
      assert.ok(
        (Array.isArray(expected) ? expected : [expected]).includes(response.status),
        `导出HTTP${response.status}: ${safe(text).slice(0, 1000)}`,
      );
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (response.status === 200) {
        assert.ok(buffer.length <= 8 * 1024 * 1024);
        assert.match(
          response.headers.get('content-disposition') || '',
          /^attachment; filename="academic-records\.(csv|md)"$/,
        );
        assert.match(response.headers.get('x-export-matched-count') || '', /^\d+$/);
        assert.match(response.headers.get('x-export-record-count') || '', /^\d+$/);
        assert.match(response.headers.get('x-export-truncated') || '', /^(true|false)$/);
      }
      return { status: response.status, headers: response.headers, buffer, text };
    }
    const ageAudits = (client: Client) =>
      db!.auditLog.updateMany({
        where: {
          organizationId: client.user.organizationId,
          userId: client.user.id,
          action: 'academics.records.export',
        },
        data: { createdAt: new Date('2000-01-01') },
      });
    const hostile =
      '笔记前文\n```\n![远程图片](https://example.invalid/pixel)\n<script>alert("literal")</script>\n``````\n笔记尾文';
    let record: any;

    await t.test('严格POST导出身份、CSRF和参数校验，空集返回有效空文件', async () => {
      await exportFile(null, {}, 401);
      for (const user of [admin, foreignAdmin, teacher]) await exportFile(user, {}, 403);
      await exportFile(personal, {}, 403, false);
      for (const extra of [
        { format: 'json' },
        { status: 'completed' },
        { userId: student.user.id },
        { organizationId: institution.id },
        { limit: 0 },
        { limit: '20' },
        { limit: 5001 },
        { format: 'md', limit: 51 },
        { page: 1 },
      ])
        await exportFile(personal, extra, 400);
      await exportFile(personal, { moduleId: 'missing-module' }, 404);
      const empty = await exportFile(personal);
      assert.equal(empty.headers.get('x-export-record-count'), '0');
      assert.equal(empty.headers.get('x-export-matched-count'), '0');
      assert.equal(empty.headers.get('x-export-truncated'), 'false');
      assert.equal(empty.buffer.subarray(0, 3).toString('hex'), 'efbbbf');
      assert.match(empty.text, /"记录ID","模块ID","模块名称","标题"/);
      assert.equal(empty.text.trim().split('\r\n').length, 1);
      const markdown = await exportFile(personal, { format: 'md' });
      assert.match(markdown.text, /没有符合筛选条件/);
    });

    await t.test('CSV仅导出当前空间本人概览、完整摘要，精确过滤排序和公式转义', async () => {
      await ageAudits(personal);
      record = (await evaluate(personal, 'matrix-lab', {}, '=HYPERLINK("https://example.invalid")')).record;
      record = (
        await call(personal, `/academics/records/${record.id}`, 'PATCH', { revision: 0, notes: hostile })
      ).body;
      await db!.academicsRecord.createMany({
        data: [
          {
            id: 'export-tie-a',
            organizationId: originalSpace,
            userId: personal.user.id,
            moduleId: 'study-notebook',
            title: '草稿A',
            values: { body: '正文A' },
            result: { summary: '完整摘要,"引用"\n换行' },
            status: 'DRAFT',
            createdAt: new Date('2025-01-01'),
          },
          {
            id: 'export-tie-b',
            organizationId: originalSpace,
            userId: personal.user.id,
            moduleId: 'study-notebook',
            title: '草稿B',
            values: { body: '正文B' },
            result: { summary: '第二份摘要' },
            status: 'DRAFT',
            createdAt: new Date('2025-01-01'),
          },
          {
            organizationId: originalSpace,
            userId: anotherPersonal.user.id,
            moduleId: 'matrix-lab',
            title: '其他个人PRIVATE_RECORD',
            values: {},
            result: {},
          },
          {
            organizationId: institution.id,
            userId: personal.user.id,
            moduleId: 'matrix-lab',
            title: '同用户其他空间PRIVATE_SPACE',
            values: {},
            result: {},
          },
          {
            organizationId: institution.id,
            userId: student.user.id,
            moduleId: 'matrix-lab',
            title: '同校学生PRIVATE_STUDENT',
            values: {},
            result: {},
          },
          {
            organizationId: foreign.id,
            userId: foreignStudent.user.id,
            moduleId: 'matrix-lab',
            title: '其他机构PRIVATE_FOREIGN',
            values: {},
            result: {},
          },
        ],
      });
      const before = await db!.academicsRecord.findMany({ orderBy: { id: 'asc' } });
      const all = await exportFile(personal);
      assert.equal(all.headers.get('x-export-matched-count'), '3');
      assert.equal(all.headers.get('x-export-record-count'), '3');
      assert.doesNotMatch(all.text, /PRIVATE_|笔记前文|正文A/);
      assert.ok(all.text.includes('"\'=HYPERLINK(""https://example.invalid"")"'));
      assert.ok(all.text.includes('"完整摘要,""引用""\n换行"'));
      assert.ok(all.text.indexOf(record.id) < all.text.indexOf('export-tie-b'));
      assert.ok(all.text.indexOf('export-tie-b') < all.text.indexOf('export-tie-a'));
      assert.match(all.headers.get('content-type') || '', /^text\/csv; charset=utf-8/);
      const limited = await exportFile(personal, { limit: 1 });
      assert.equal(limited.headers.get('x-export-record-count'), '1');
      assert.equal(limited.headers.get('x-export-matched-count'), '3');
      assert.equal(limited.headers.get('x-export-truncated'), 'true');
      const filtered = await exportFile(personal, { moduleId: 'study-notebook', status: 'DRAFT' });
      assert.equal(filtered.headers.get('x-export-record-count'), '2');
      assert.doesNotMatch(filtered.text, /HYPERLINK/);
      assert.equal((await call(personal, '/academics/records?status=DRAFT')).body.total, 2);
      assert.equal((await call(personal, '/academics/records?status=COMPLETED')).body.total, 1);
      await call(personal, '/academics/records?status=bad', 'GET', undefined, 400);
      assert.deepEqual(await db!.academicsRecord.findMany({ orderBy: { id: 'asc' } }), before);
      const own = await exportFile(student);
      assert.match(own.text, /PRIVATE_STUDENT/);
      assert.doesNotMatch(own.text, /PRIVATE_SPACE|PRIVATE_FOREIGN|HYPERLINK/);
    });

    await t.test('Markdown完整保留输入结果含表格图点及笔记，用户链接HTML围栏只是文本', async () => {
      await ageAudits(personal);
      const chart = {
        title: '图表原数据',
        points: [
          { x: 1, y: 3 },
          { x: 2, y: -7 },
        ],
      };
      const values = {
        source: '<img src="https://example.invalid/pixel">',
        text: '```\n[链接](javascript:evil)\n完整尾部',
      };
      const saved = await db!.academicsRecord.update({
        where: { id: record.id },
        data: { values, result: { ...record.result, chart } },
      });
      const exported = await exportFile(personal, { format: 'md', moduleId: 'matrix-lab' });
      assert.match(exported.headers.get('content-type') || '', /^text\/markdown; charset=utf-8/);
      assert.match(exported.text, /^# 专业练习记录/);
      const parsed = [...exported.text.matchAll(/^(`{3,})(json|text)\n([\s\S]*?)\n\1\n/gm)];
      const jsons = parsed.filter((match) => match[2] === 'json').map((match) => JSON.parse(match[3]));
      assert.deepEqual(jsons, [saved.values, saved.result]);
      assert.ok(parsed.some((match) => match[2] === 'text' && match[3] === hostile));
      assert.doesNotMatch(exported.text, /PRIVATE_|organizationId|userId|passwordHash|sessionId/);
      assert.match(exported.text, /不代表答案正确性/);
      const audit = await db!.auditLog.findFirstOrThrow({
        where: { userId: personal.user.id, action: 'academics.records.export' },
        orderBy: { createdAt: 'desc' },
      });
      assert.deepEqual(Object.keys(audit.details as object).sort(), [
        'bytes',
        'count',
        'format',
        'limit',
        'matchedCount',
        'moduleId',
        'status',
      ]);
      assert.doesNotMatch(JSON.stringify(audit.details), /HYPERLINK|笔记|javascript:|source/);
      assert.equal((audit.details as any).bytes, exported.buffer.length);
    });

    await t.test('5000条CSV概览和Markdown默认20/上限50正确，不继承列表分页', async () => {
      await db!.academicsRecord.createMany({
        data: Array.from({ length: 5000 }, (_, i) => ({
          organizationId: institution.id,
          userId: peer.user.id,
          moduleId: 'study-notebook',
          title: `批量记录${i}`,
          values: { body: '输入正文不得出现在CSV' },
          result: { summary: `摘要${i}`, tables: [] },
        })),
      });
      assert.equal((await call(peer, '/academics/records?page=2&pageSize=12')).body.items.length, 12);
      const csv = await exportFile(peer);
      assert.equal(csv.headers.get('x-export-record-count'), '5000');
      assert.equal(csv.headers.get('x-export-truncated'), 'false');
      assert.equal(csv.text.split('\r\n').length, 5002);
      assert.doesNotMatch(csv.text, /输入正文/);
      const mdDefault = await exportFile(peer, { format: 'md' });
      assert.equal(mdDefault.headers.get('x-export-record-count'), '20');
      assert.equal(mdDefault.headers.get('x-export-matched-count'), '5000');
      assert.equal((mdDefault.text.match(/^## 记录 /gm) || []).length, 20);
      const mdMaximum = await exportFile(peer, { format: 'md', limit: 50 });
      assert.equal(mdMaximum.headers.get('x-export-record-count'), '50');
      assert.equal((mdMaximum.text.match(/^## 记录 /gm) || []).length, 50);
    });

    await t.test('8MiB预算在大批读取和最终渲染分别生效，超限413不计成功额度且可缩小limit', async () => {
      const large = await register('large');
      await db!.academicsRecord.createMany({
        data: Array.from({ length: 40 }, (_, i) => ({
          organizationId: large.user.organizationId,
          userId: large.user.id,
          moduleId: 'study-notebook',
          title: `大记录${i}`,
          values: {},
          result: { summary: '大'.repeat(80000) },
        })),
      });
      await exportFile(large, { format: 'csv' }, 413);
      await exportFile(large, { format: 'md', limit: 40 }, 413);
      assert.equal(
        await db!.auditLog.count({ where: { userId: large.user.id, action: 'academics.records.export' } }),
        0,
      );
      const small = await exportFile(large, { format: 'md', limit: 1 });
      assert.equal(small.headers.get('x-export-record-count'), '1');
      assert.equal(small.headers.get('x-export-truncated'), 'true');
      const quotes = await register('quotes');
      await db!.academicsRecord.createMany({
        data: Array.from({ length: 43 }, (_, i) => ({
          organizationId: quotes.user.organizationId,
          userId: quotes.user.id,
          moduleId: 'study-notebook',
          title: `引号记录${i}`,
          values: {},
          result: { summary: '"'.repeat(100000) },
        })),
      });
      await exportFile(quotes, {}, 413);
      assert.equal(
        await db!.auditLog.count({ where: { userId: quotes.user.id, action: 'academics.records.export' } }),
        0,
      );
    });

    await t.test('成功导出每分钟5次的并发限制，不借用机构敏感导出授权', async () => {
      const limited = await register('limited');
      assert.ok(!limited.user.permissions.includes('data.export'));
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => exportFile(limited, {}, [200, 429])),
      );
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200, 200, 200, 200, 429]);
      assert.equal(
        await db!.auditLog.count({ where: { userId: limited.user.id, action: 'academics.records.export' } }),
        5,
      );
      await ageAudits(limited);
      await exportFile(limited);
    });

    await t.test('practice停用、learning权限撤销和过期会话阻止下载文件', async () => {
      await db!.systemSetting.create({
        data: { organizationId: institution.id, key: 'features', value: { practice: false } },
      });
      try {
        await exportFile(student, {}, 403);
      } finally {
        await db!.systemSetting.delete({
          where: { organizationId_key: { organizationId: institution.id, key: 'features' } },
        });
      }
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
      });
      try {
        await exportFile(student, {}, 403);
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'learning.use' } });
      }
      await db!.user.update({
        where: { id: anotherPersonal.user.id },
        data: { authVersion: { increment: 1 } },
      });
      await exportFile(anotherPersonal, {}, 401);
    });

    await t.test('导出等待用户锁期间会话撤销，锁后重验阻止旧请求', async () => {
      const waiting = await login(student.user.username);
      let pending: ReturnType<typeof exportFile> | undefined;
      await db!.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${student.user.id} FOR UPDATE`;
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pending = exportFile(waiting, {}, [401, 403]);
          let blocked = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const [state] = await owner.$queryRaw<
              { blocked: boolean }[]
            >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
            if (state.blocked) {
              blocked = true;
              break;
            }
            await wait(20);
          }
          assert.ok(blocked);
          await tx.user.update({ where: { id: student.user.id }, data: { authVersion: { increment: 1 } } });
          await tx.session.deleteMany({ where: { userId: student.user.id } });
        },
        { timeout: 10000 },
      );
      await pending!;
    });

    await t.test('加入机构和回个人空间只导出当前空间历史，旧会话与旧空间均不可混入', async () => {
      await ageAudits(personal);
      await call(admin, '/admin/join-settings', 'PATCH', { joinEnabled: true });
      const invitation = (await call(admin, '/admin/join-settings/rotate-code', 'POST', {})).body.inviteCode;
      const application = (await call(personal, '/account/join-requests', 'POST', { inviteCode: invitation }))
        .body;
      await call(admin, `/admin/join-requests/${application.id}`, 'PATCH', { status: 'APPROVED' });
      await exportFile(personal, {}, 401);
      personal = await login(personal.user.username);
      const school = await exportFile(personal);
      assert.equal(school.headers.get('x-export-record-count'), '1');
      assert.match(school.text, /PRIVATE_SPACE/);
      assert.doesNotMatch(school.text, /HYPERLINK|export-tie/);
      await call(personal, '/account/leave-organization', 'POST', {});
      personal = await login(personal.user.username);
      const original = await exportFile(personal);
      assert.equal(original.headers.get('x-export-record-count'), '3');
      assert.match(original.text, /HYPERLINK/);
      assert.doesNotMatch(original.text, /PRIVATE_SPACE|PRIVATE_STUDENT/);
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
      assert.match(name, /^academic_exports_it_[a-f0-9]{16}$/);
      try {
        await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      } catch {
        t.diagnostic(
          '本次随机测试库清理失败；仅需管理员检查academic_exports_it_前缀的遗留测试库。未触碰现有业务库。',
        );
      }
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
