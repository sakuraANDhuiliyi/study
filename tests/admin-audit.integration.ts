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
import { auditCsvHeader, auditExportMaxBytes } from '../apps/api/src/admin/audit-export.renderer';
import { auditUserRestrictError } from './helpers/audit-errors';

// This suite creates/drops only its randomly named local database. It never seeds or changes
// configured review/business data. The API pool has 3 connections; exports must not nest pools.
const wait = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));
type Client = {
  cookie: string;
  csrf: string;
  user: { id: string; organizationId: string; username: string };
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
function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  const input = text.replace(/^\ufeff/, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && char === '\r' && input[index + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index++;
    } else cell += char;
  }
  assert.equal(quoted, false, 'CSV字段必须闭合');
  assert.equal(cell, '');
  assert.equal(row.length, 0);
  for (const cells of rows) assert.equal(cells.length, 8);
  return rows;
}

test('机构审计组合筛选和CSV导出：隔离PostgreSQL与真实HTTP', { timeout: 240_000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production', '集成测试禁止在production模式运行');
  const configured = process.env.DATABASE_URL;
  assert.ok(configured, '需要本机DATABASE_URL和CREATEDB权限');
  const adminUrl = new URL(configured);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname), '只连接本机PostgreSQL');
  assert.ok(['postgres:', 'postgresql:'].includes(adminUrl.protocol));
  const suffix = randomBytes(8).toString('hex');
  const databaseName = `admin_audit_it_${suffix}`;
  assert.match(databaseName, /^admin_audit_it_[a-f0-9]{16}$/);
  const isolatedUrl = new URL(adminUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  const apiUrl = new URL(isolatedUrl);
  apiUrl.searchParams.set('connection_limit', '3');
  const password = `Fixture-${randomBytes(20).toString('hex')}!`;
  const safe = (text: string) =>
    [password, configured, isolatedUrl.href, apiUrl.href, decodeURIComponent(adminUrl.password)]
      .filter(Boolean)
      .reduce((value, secret) => value.split(secret).join('[redacted]'), text)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]');
  const directory = mkdtempSync(join(tmpdir(), 'admin-audit-http-'));
  const configPath = join(directory, 'config.yaml');
  writeFileSync(configPath, 'judge0: {enabled: false}\nai: {enabled: false}\nwebSearch: {enabled: false}\n', {
    mode: 0o600,
  });
  const port = await freePort();
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
    PROGRAMMING_PREVIEW_ENABLED: 'false',
    UPLOAD_DIR: join(directory, 'uploads'),
  };
  const owner = new PrismaClient({ datasourceUrl: adminUrl.href });
  let db: PrismaClient | undefined,
    api: ChildProcess | undefined,
    created = false,
    logs = '';
  async function request(
    client: Client | null,
    path: string,
    method = 'GET',
    body?: unknown,
    expected: number | number[] = method === 'POST' ? 201 : 200,
    options: { csrf?: boolean; origin?: string } = {},
  ) {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        origin: options.origin ?? origin,
        'content-type': 'application/json',
        ...(client
          ? { cookie: client.cookie, ...(options.csrf === false ? {} : { 'x-csrf-token': client.csrf }) }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString('utf8');
    assert.ok(
      (Array.isArray(expected) ? expected : [expected]).includes(response.status),
      `${method} ${path}: ${response.status}; ${safe(text).slice(0, 1500)}`,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return {
      response,
      buffer,
      text,
      body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    };
  }
  async function login(username: string): Promise<Client> {
    const value = await request(null, '/auth/login', 'POST', { username, password });
    return { cookie: value.cookie, csrf: value.body.csrfToken, user: value.body.user };
  }
  const list = (client: Client | null, filters: Record<string, string> = {}, expected = 200) =>
    request(client, `/admin/audit?${new URLSearchParams(filters)}`, 'GET', undefined, expected);
  async function exportFile(
    client: Client | null,
    body: unknown = {},
    expected: number | number[] = 200,
    options: { csrf?: boolean; origin?: string } = {},
  ) {
    const result = await request(client, '/admin/audit/export', 'POST', body, expected, options);
    if (result.response.status === 200) {
      assert.ok(result.buffer.length <= auditExportMaxBytes);
      assert.match(result.response.headers.get('content-type') ?? '', /^text\/csv; charset=utf-8$/);
      assert.equal(
        result.response.headers.get('content-disposition'),
        'attachment; filename="audit-records.csv"',
      );
      assert.match(result.response.headers.get('x-export-matched-count') ?? '', /^\d+$/);
      assert.match(result.response.headers.get('x-export-record-count') ?? '', /^\d+$/);
      assert.match(result.response.headers.get('x-export-truncated') ?? '', /^(true|false)$/);
      assert.ok(result.text.startsWith(auditCsvHeader));
    } else assert.ok(!result.response.headers.get('content-type')?.includes('text/csv'));
    return result;
  }
  try {
    try {
      await owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
      created = true;
    } catch {
      throw new Error('无法创建隔离测试库；请确认本机数据库和CREATEDB权限。未修改现有数据。');
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
    assert.equal(migrationCode, 0, `隔离数据库迁移失败：${safe(migrationLog)}`);
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
    const institution = await db.organization.create({ data: { name: '审计验收机构甲' } });
    const foreign = await db.organization.create({ data: { name: '审计验收机构乙' } });
    const personalSpace = await db.organization.create({ data: { name: '独立个人空间', kind: 'PERSONAL' } });
    const passwordHash = await hashPasswordAsync(password);
    let userSequence = 0;
    const makeUser = (tag: string, roleId: string, organizationId = institution.id) =>
      db!.user.create({
        data: {
          organizationId,
          username: `audit_${suffix}_${++userSequence}`,
          name: tag,
          passwordHash,
          roles: { create: { roleId } },
        },
      });
    const [
      managerUser,
      adminUser,
      readerUser,
      superUser,
      foreignUser,
      foreignManagerUser,
      studentUser,
      teacherUser,
      disabledUser,
      movedUser,
    ] = await Promise.all([
      makeUser('独立授权经理', 'SUPER_ADMIN'),
      makeUser('导出管理员', 'ADMIN'),
      makeUser('仅查看管理员', 'ADMIN'),
      makeUser('无grant超级管理员', 'SUPER_ADMIN'),
      makeUser('乙管理员', 'ADMIN', foreign.id),
      makeUser('乙授权经理', 'SUPER_ADMIN', foreign.id),
      makeUser('甲学生', 'STUDENT'),
      makeUser('甲教师', 'TEACHER'),
      makeUser('停用甲成员', 'STUDENT'),
      makeUser('已转乙成员', 'STUDENT'),
    ]);
    const retainedHistorical = await makeUser('保留的历史成员', 'STUDENT');
    const deleted = await makeUser('无审计可删除成员', 'STUDENT');
    // An unknown/deleted raw ID remains a valid filter; this user has no AuditLog FK references.
    await db.userRole.deleteMany({ where: { userId: deleted.id } });
    await db.user.delete({ where: { id: deleted.id } });
    const anchor = new Date('2026-10-09T08:00:00.000Z');
    const fixtureLogs = [
      {
        id: 'a-100',
        userId: adminUser.id,
        createdAt: new Date(anchor.getTime() - 1),
        action: 'user.update',
        resourceType: 'User',
        resourceId: 'user-10',
        requestId: 'trace-10',
        details: { marker: 'SENSITIVE_DETAILS_MUST_NOT_EXPORT' },
      },
      {
        id: 'a-101',
        userId: adminUser.id,
        createdAt: anchor,
        action: 'user.update',
        resourceType: 'User',
        resourceId: 'user-11',
        requestId: 'trace-11',
      },
      {
        id: 'a-102',
        userId: adminUser.id,
        createdAt: anchor,
        action: 'class.membership',
        resourceType: 'Class',
        resourceId: 'class-11',
        requestId: 'trace-12',
      },
      {
        id: 'a-103',
        userId: null,
        createdAt: new Date(anchor.getTime() + 1),
        action: 'background.completed',
        resourceType: 'BackgroundJob',
        resourceId: 'job-1',
        requestId: null,
      },
      {
        id: 'a-104',
        userId: retainedHistorical.id,
        createdAt: new Date('2019-01-01T00:00:00Z'),
        action: 'legacy.action',
        resourceType: 'RetiredResource',
        resourceId: 'old-1',
        requestId: 'non-uuid-request-id',
      },
      {
        id: 'a-105',
        userId: movedUser.id,
        createdAt: new Date('2026-10-08T00:00:00Z'),
        action: 'user.update',
        resourceType: 'User',
        resourceId: movedUser.id,
        requestId: 'trace-move',
      },
      {
        id: 'a-formula',
        userId: disabledUser.id,
        createdAt: new Date('2026-10-07T00:00:00Z'),
        action: 'custom.action',
        resourceType: 'History',
        resourceId: ' =HYPERLINK("https://invalid.example")',
        requestId: 'multi,line\nquoted"id',
      },
    ];
    await db.auditLog.createMany({
      data: fixtureLogs.map((item) => ({ organizationId: institution.id, ...item })),
    });
    // The physical initial migration retains this FK even though base.prisma models a scalar.
    const [auditFk] = await db.$queryRaw<{ deleteAction: string; validated: boolean }[]>`
      SELECT confdeltype::text AS "deleteAction", convalidated AS validated FROM pg_constraint
      WHERE conname = 'AuditLog_userId_fkey' AND conrelid = '"AuditLog"'::regclass`;
    assert.equal(auditFk?.deleteAction, 'r');
    assert.equal(auditFk.validated, true);
    await db.userRole.deleteMany({ where: { userId: retainedHistorical.id } });
    await assert.rejects(db.user.delete({ where: { id: retainedHistorical.id } }), auditUserRestrictError);
    assert.ok(await db.user.findUnique({ where: { id: retainedHistorical.id } }));
    assert.equal(await db.auditLog.count({ where: { userId: retainedHistorical.id } }), 1);
    await db.user.update({
      where: { id: retainedHistorical.id },
      data: { organizationId: foreign.id, name: '乙机构历史成员当前姓名不得泄漏' },
    });
    await db.user.update({ where: { id: disabledUser.id }, data: { active: false } });
    await db.user.update({
      where: { id: movedUser.id },
      data: { organizationId: foreign.id, name: '乙机构私有当前姓名不得泄漏' },
    });
    for (const organizationId of [foreign.id, personalSpace.id])
      await db.auditLog.create({
        data: {
          id: organizationId === foreign.id ? 'b-101' : 'p-101',
          organizationId,
          userId: foreignUser.id,
          createdAt: anchor,
          action: 'user.update',
          resourceType: 'User',
          resourceId: 'user-11',
          requestId: 'trace-11',
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
        /* Our isolated API is still starting. */
      }
      await wait(100);
    }
    assert.ok(ready, `请先构建API；隔离服务未就绪：${safe(logs)}`);
    const [manager, admin, reader, superAdmin, foreignAdmin, foreignManager, student, teacher] =
      await Promise.all(
        [
          managerUser,
          adminUser,
          readerUser,
          superUser,
          foreignUser,
          foreignManagerUser,
          studentUser,
          teacherUser,
        ].map((user) => login(user.username)),
      );
    const grant = async (client: Client, granter = manager) =>
      (
        await request(granter, '/admin/grants', 'POST', {
          userId: client.user.id,
          permissionId: 'data.export',
          reason: '本轮隔离审计功能验收',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
      ).body;
    const exportedAudits = (client: Client) =>
      db!.auditLog.count({
        where: {
          organizationId: client.user.organizationId,
          userId: client.user.id,
          action: 'admin.audit.export',
        },
      });

    await t.test('匿名、学生、教师、无独立grant管理员与超级管理员、CSRF和Origin边界', async () => {
      await list(null, {}, 401);
      await list(student, {}, 403);
      await list(teacher, {}, 403);
      await list(reader);
      await exportFile(reader, {}, 403);
      await exportFile(superAdmin, {}, 403);
      await exportFile(null, {}, 401);
      await exportFile(admin, {}, 403);
      await grant(admin);
      await grant(foreignAdmin, foreignManager);
      await exportFile(admin, {}, 403, { csrf: false });
      await exportFile(admin, {}, 403, { origin: 'https://foreign.invalid' });
      await exportFile(admin, { action: 'user.update' });
    });

    await t.test('固定当前机构，superadmin也不越机构，客户端安全范围覆盖被拒绝', async () => {
      const current = await list(admin, { resourceId: 'user-11', requestId: 'trace-11' });
      assert.deepEqual(
        current.body.items.map((item: any) => item.id),
        ['a-101'],
      );
      assert.deepEqual(
        (await list(foreignAdmin, { resourceId: 'user-11' })).body.items.map((item: any) => item.id),
        ['b-101'],
      );
      assert.deepEqual(
        (await list(superAdmin, { resourceId: 'user-11' })).body.items.map((item: any) => item.id),
        ['a-101'],
      );
      for (const key of ['organizationId', 'userId', 'role', 'permissions']) {
        await list(admin, { [key]: foreign.id }, 400);
        await exportFile(admin, { [key]: foreign.id }, 400);
      }
      const csv = await exportFile(admin, { resourceId: 'user-11', requestId: 'trace-11' });
      assert.deepEqual(
        csvRows(csv.text)
          .slice(1)
          .map((row) => row[0]),
        ['a-101'],
      );
      const foreignCsv = await exportFile(foreignAdmin, { resourceId: 'user-11', requestId: 'trace-11' });
      assert.deepEqual(
        csvRows(foreignCsv.text)
          .slice(1)
          .map((row) => row[0]),
        ['b-101'],
      );
    });

    await t.test('search覆盖四个标量并大小写无关，精确字段和action分别AND，details不搜索', async () => {
      for (const [search, id] of [
        ['CLASS.MEMBERSHIP', 'a-102'],
        ['retiredresource', 'a-104'],
        ['job-1', 'a-103'],
        ['non-uuid-request-id', 'a-104'],
      ])
        assert.deepEqual(
          (await list(admin, { search })).body.items.map((item: any) => item.id),
          [id],
        );
      assert.equal((await list(admin, { search: 'SENSITIVE_DETAILS_MUST_NOT_EXPORT' })).body.total, 0);
      assert.equal((await list(admin, { resourceId: 'user-1' })).body.total, 0);
      assert.equal((await list(admin, { requestId: 'trace-1' })).body.total, 0);
      assert.equal((await list(admin, { search: 'class-11', action: 'user.update' })).body.total, 0);
      assert.deepEqual(
        (await list(admin, { search: 'class-11', action: 'class.', resourceType: 'Class' })).body.items.map(
          (item: any) => item.id,
        ),
        ['a-102'],
      );
    });

    await t.test('组合与偏移时间等价、from/to端点包含及非法范围/重复标量400', async () => {
      const range = {
        actorId: adminUser.id,
        resourceType: 'User',
        from: '2026-10-09T16:00:00+08:00',
        to: '2026-10-09T08:00:00.000Z',
      };
      assert.deepEqual(
        (await list(admin, range)).body.items.map((item: any) => item.id),
        ['a-101'],
      );
      assert.deepEqual(
        csvRows((await exportFile(admin, range)).text)
          .slice(1)
          .map((row) => row[0]),
        ['a-101'],
      );
      assert.equal((await list(admin, { to: '2019-01-01T00:00:00Z' })).body.items[0].id, 'a-104');
      for (const filters of [
        { from: '2026-10-09T08:00:00' },
        { from: '2026-10-10T00:00:00Z', to: '2026-10-09T00:00:00Z' },
        { actorId: 'bad\0id' },
      ] as Record<string, string>[]) {
        await list(admin, filters, 400);
        await exportFile(admin, filters, 400);
      }
      await request(admin, '/admin/audit?action=user&action=class', 'GET', undefined, 400);
      for (const body of [{ limit: '1' }, { limit: 1.5 }, { limit: 5001 }, { page: 1 }, { details: {} }, []])
        await exportFile(admin, body, 400);
    });

    await t.test('legacy action分页floor/clamp、相同时间稳定id逆序和超页总数', async () => {
      const filter = { from: '2026-10-09T07:59:59.999Z', to: '2026-10-09T08:00:00.001Z', pageSize: '2' };
      const first = (await list(admin, { ...filter, page: '1.9' })).body;
      const second = (await list(admin, { ...filter, page: '2' })).body;
      assert.deepEqual(
        first.items.map((item: any) => item.id),
        ['a-103', 'a-102'],
      );
      assert.deepEqual(
        second.items.map((item: any) => item.id),
        ['a-101', 'a-100'],
      );
      assert.equal(first.total, 4);
      assert.equal(second.total, 4);
      assert.equal(first.page, 1);
      assert.equal(first.pageSize, 2);
      const beyond = (await list(admin, { ...filter, page: '3' })).body;
      assert.deepEqual(beyond.items, []);
      assert.equal(beyond.total, 4);
      assert.equal((await list(admin, { action: 'USER.UPDATE' })).body.total, 0);
      assert.equal(
        (await list(admin, { action: 'user.update', page: '1', pageSize: '1000' })).body.pageSize,
        100,
      );
    });

    await t.test('FK保留历史操作人与迁出姓名隔离，已删除无审计ID返回空结果且不需users.manage', async () => {
      await db!.rolePermission.delete({
        where: { roleId_permissionId: { roleId: 'ADMIN', permissionId: 'users.manage' } },
      });
      try {
        const missing = (await list(reader, { actorId: deleted.id })).body;
        assert.equal(missing.total, 0);
        assert.deepEqual(missing.items, []);
        const historical = (await list(reader, { actorId: retainedHistorical.id })).body;
        assert.equal(historical.total, 1);
        assert.equal(historical.items[0].userId, retainedHistorical.id);
        assert.equal(historical.items[0].actorName, '历史账号');
        assert.ok(!JSON.stringify(historical).includes('乙机构历史成员当前姓名不得泄漏'));
        const moved = (await list(reader, { actorId: movedUser.id })).body;
        assert.equal(moved.total, 1);
        assert.equal(moved.items[0].actorName, '历史账号');
        assert.ok(!JSON.stringify(moved).includes('乙机构私有当前姓名不得泄漏'));
        assert.equal(
          (await list(reader, { actorId: disabledUser.id })).body.items[0].actorName,
          '停用甲成员',
        );
        assert.equal((await list(reader, { resourceId: 'job-1' })).body.items[0].actorName, '系统');
        const csv = await exportFile(admin, { actorId: movedUser.id });
        assert.equal(csvRows(csv.text)[1][2], movedUser.id);
        assert.equal(csvRows(csv.text)[1][3], '历史账号');
      } finally {
        await db!.rolePermission.create({ data: { roleId: 'ADMIN', permissionId: 'users.manage' } });
      }
    });

    await t.test('应用筛选导出全部结果、限额匹配与零结果header-only，没有details/凭据泄漏', async () => {
      const input = {
        action: 'user.update',
        from: '2026-10-09T07:59:59.999Z',
        to: '2026-10-09T08:00:00.001Z',
      };
      const output = await exportFile(admin, { ...input, limit: 1 });
      assert.equal(output.response.headers.get('x-export-matched-count'), '2');
      assert.equal(output.response.headers.get('x-export-record-count'), '1');
      assert.equal(output.response.headers.get('x-export-truncated'), 'true');
      assert.equal(csvRows(output.text)[1][0], 'a-101');
      const all = await exportFile(admin, input);
      assert.equal(csvRows(all.text).length, 3);
      assert.ok(!all.text.includes('SENSITIVE_DETAILS_MUST_NOT_EXPORT'));
      assert.ok(!all.text.includes(password));
      const zero = await exportFile(admin, { search: 'nothing-matches-this-fixture' });
      assert.equal(zero.text, auditCsvHeader);
      assert.equal(zero.response.headers.get('x-export-matched-count'), '0');
      assert.equal(zero.response.headers.get('x-export-record-count'), '0');
      assert.equal(zero.response.headers.get('x-export-truncated'), 'false');
    });

    await t.test('CSV公式转义、中文引号换行UTF8保留；导出元数据count在自身事件之前', async () => {
      const formulas = [
        '=1+1',
        ' +SUM(A1)',
        '\t-2',
        '\r\n@evil',
        '\ufeff=HYPERLINK("https://invalid.example")',
      ];
      await db!.auditLog.createMany({
        data: formulas.map((resourceId, index) => ({
          id: `literal-${index}`,
          organizationId: institution.id,
          userId: adminUser.id,
          action: 'csv.literal',
          resourceType: 'Literal',
          resourceId,
          requestId: '中文😀,"换行\n内容',
          createdAt: new Date(anchor.getTime() + index),
        })),
      });
      const csv = await exportFile(admin, { action: 'csv.literal' });
      const rows = csvRows(csv.text).slice(1);
      assert.equal(rows.length, 5);
      for (const row of rows) {
        const index = Number(row[0].slice('literal-'.length));
        assert.equal(row[6], "'" + formulas[index]);
        assert.equal(row[7], '中文😀,"换行\n内容');
      }
      const before = await db!.auditLog.count({ where: { organizationId: institution.id } });
      const all = await exportFile(admin);
      assert.equal(Number(all.response.headers.get('x-export-matched-count')), before);
      const event = await db!.auditLog.findFirstOrThrow({
        where: {
          organizationId: institution.id,
          userId: adminUser.id,
          action: 'admin.audit.export',
          requestId: all.response.headers.get('x-request-id')!,
        },
      });
      assert.ok(
        !csvRows(all.text)
          .slice(1)
          .some((row) => row[0] === event.id),
      );
      assert.deepEqual(event.details, {
        format: 'csv',
        deliveryState: 'prepared',
        limit: 5000,
        filters: {},
        matchedCount: before,
        count: before,
        bytes: all.buffer.length,
      });
    });

    await t.test('巨大排除details不影响CSV；原始和转义后超8MiB标量413而非部分文件', async () => {
      await db!.auditLog.create({
        data: {
          id: 'huge-details',
          organizationId: institution.id,
          userId: adminUser.id,
          action: 'huge.details',
          resourceType: 'History',
          resourceId: 'small',
          details: { payload: 'SECRET_JSON'.repeat(900_000) },
        },
      });
      const small = await exportFile(admin, { action: 'huge.details' });
      assert.ok(small.buffer.length < 1024);
      assert.ok(!small.text.includes('SECRET_JSON'));
      for (const [id, resourceId] of [
        ['huge-raw', 'x'.repeat(auditExportMaxBytes + 1)],
        ['huge-escaped', '"'.repeat(auditExportMaxBytes / 2)],
      ] as const) {
        await db!.auditLog.create({
          data: {
            id,
            organizationId: institution.id,
            userId: adminUser.id,
            action: 'huge.scalar',
            resourceType: 'History',
            resourceId,
          },
        });
        const before = await exportedAudits(admin);
        await exportFile(admin, { action: 'huge.scalar' }, 413);
        assert.equal(await exportedAudits(admin), before);
        await db!.auditLog.delete({ where: { id } });
      }
    });

    await t.test('5001记录只导出最新5000并明确truncated，标量字段不会截断', async () => {
      await db!.auditLog.createMany({
        data: Array.from({ length: 5001 }, (_, index) => ({
          id: `batch-${String(index).padStart(5, '0')}`,
          organizationId: institution.id,
          userId: adminUser.id,
          action: 'batch.snapshot',
          resourceType: 'History',
          resourceId: `item-${index}`,
          createdAt: new Date(anchor.getTime() + index),
        })),
      });
      const output = await exportFile(admin, { action: 'batch.snapshot' });
      assert.equal(output.response.headers.get('x-export-matched-count'), '5001');
      assert.equal(output.response.headers.get('x-export-record-count'), '5000');
      assert.equal(output.response.headers.get('x-export-truncated'), 'true');
      const ids = csvRows(output.text)
        .slice(1)
        .map((row) => row[0]);
      assert.equal(ids[0], 'batch-05000');
      assert.equal(ids.at(-1), 'batch-00001');
      assert.equal(new Set(ids).size, 5000);
    });

    await t.test('数据SQL等待表锁期间并发插入，count与CSV均为同一语句快照', async () => {
      let pending: ReturnType<typeof exportFile> | undefined;
      await db!.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('LOCK TABLE "AuditLog" IN ACCESS EXCLUSIVE MODE');
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pending = exportFile(admin, { action: 'batch.snapshot' });
          let blocked = false;
          for (let attempt = 0; attempt < 150; attempt++) {
            const [state] = await owner.$queryRaw<{ blocked: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
              AND query LIKE '%WITH selected AS MATERIALIZED%') AS blocked`;
            if (state.blocked) {
              blocked = true;
              break;
            }
            await wait(20);
          }
          assert.ok(blocked, '必须证明真实导出数据语句已等待表锁');
          await tx.auditLog.create({
            data: {
              id: 'batch-concurrent-newest',
              organizationId: institution.id,
              userId: readerUser.id,
              action: 'batch.snapshot',
              resourceType: 'History',
              resourceId: 'concurrent',
              createdAt: new Date('2099-01-01T00:00:00Z'),
            },
          });
        },
        { timeout: 10_000 },
      );
      const output = await pending!;
      const matched = Number(output.response.headers.get('x-export-matched-count'));
      assert.ok([5001, 5002].includes(matched));
      const ids = csvRows(output.text)
        .slice(1)
        .map((row) => row[0]);
      assert.equal(new Set(ids).size, 5000);
      const expected = Array.from(
        { length: matched === 5002 ? 4999 : 5000 },
        (_, index) => `batch-${String(5000 - index).padStart(5, '0')}`,
      );
      assert.deepEqual(ids, matched === 5002 ? ['batch-concurrent-newest', ...expected] : expected);
    });

    await t.test('准备审计INSERT后撤销grant且sensitive误设false，最终独立授权拒绝文件', async () => {
      const waiting = await login(adminUser.username);
      const functionName = `audit_export_wait_${suffix}`;
      const triggerName = `audit_export_wait_${suffix}`;
      assert.match(functionName, /^audit_export_wait_[a-f0-9]{16}$/);
      assert.match(triggerName, /^audit_export_wait_[a-f0-9]{16}$/);
      const originalPermission = await db!.permission.findUniqueOrThrow({ where: { id: 'data.export' } });
      const originalGrant = await db!.sensitiveGrant.findUniqueOrThrow({
        where: { userId_permissionId: { userId: adminUser.id, permissionId: 'data.export' } },
      });
      const before = await exportedAudits(waiting);
      let pending: ReturnType<typeof exportFile> | undefined;
      let functionCreated = false,
        triggerCreated = false;
      try {
        // This isolated, randomly owned database alone gets this deterministic test gate.
        // The production service contains no hook and no template is changed in a review DB.
        await db!.permission.update({ where: { id: 'data.export' }, data: { sensitive: false } });
        await db!
          .$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW."action" = 'admin.audit.export' THEN
              PERFORM pg_advisory_xact_lock(180010115::bigint);
            END IF;
            RETURN NEW;
          END;
        $$`);
        functionCreated = true;
        await db!.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditLog"
          FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
        triggerCreated = true;
        await db!.$transaction(
          async (tx) => {
            // Advisory locks are database-scoped: hold it on the random fixture database,
            // while owner observes pg_stat_activity without consuming the small API pool.
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(180010115::bigint)`;
            const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            pending = exportFile(waiting, { action: 'user.update' }, 403);
            let blocked = false;
            for (let attempt = 0; attempt < 150; attempt++) {
              const [state] = await owner.$queryRaw<{ blocked: boolean }[]>`
              SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                WHERE datname = ${databaseName} AND ${pid} = ANY(pg_blocking_pids(pid))
                  AND query ILIKE '%INSERT%' AND query ILIKE '%AuditLog%') AS blocked`;
              if (state.blocked) {
                blocked = true;
                break;
              }
              await wait(20);
            }
            assert.ok(blocked, '必须证明API准备审计INSERT已经通过metadata current并等待fixture trigger');
            await tx.sensitiveGrant.update({
              where: { id: originalGrant.id },
              data: { expiresAt: new Date(Date.now() - 1) },
            });
          },
          { timeout: 10_000 },
        );
        const response = await pending!;
        assert.equal(response.response.status, 403);
        assert.ok(response.response.headers.get('content-type')?.includes('application/json'));
        for (const header of [
          'content-disposition',
          'x-export-matched-count',
          'x-export-record-count',
          'x-export-truncated',
        ])
          assert.equal(response.response.headers.get(header), null);
        assert.equal(await exportedAudits(waiting), before + 1);
        const prepared = await db!.auditLog.findFirstOrThrow({
          where: {
            organizationId: institution.id,
            userId: adminUser.id,
            action: 'admin.audit.export',
            requestId: response.response.headers.get('x-request-id')!,
          },
        });
        assert.equal((prepared.details as { deliveryState?: string }).deliveryState, 'prepared');
      } finally {
        // Always settle the in-flight request; a primary assertion failure must not leave
        // a rejected background promise or a trigger blocking later isolated test steps.
        await pending?.catch(() => undefined);
        let cleanupFailed = false;
        const restore = [
          ...(triggerCreated
            ? [() => db!.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON "AuditLog"`)]
            : []),
          ...(functionCreated ? [() => db!.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`)] : []),
          () =>
            db!.permission.update({
              where: { id: 'data.export' },
              data: { sensitive: originalPermission.sensitive },
            }),
          () =>
            db!.sensitiveGrant.update({
              where: { id: originalGrant.id },
              data: { expiresAt: originalGrant.expiresAt },
            }),
        ];
        for (const cleanup of restore) {
          try {
            await cleanup();
          } catch {
            cleanupFailed = true;
          }
        }
        if (cleanupFailed) throw new Error('隔离最终授权竞争夹具未能完全清理或恢复');
      }
    });

    await t.test('用户锁等待期间撤销grant/模板/会话/组织，锁后当前授权复验拒绝CSV', async () => {
      for (const change of ['grant', 'template', 'session', 'organization'] as const) {
        const waiting = await login(adminUser.username);
        let pending: ReturnType<typeof exportFile> | undefined;
        const before = await exportedAudits(waiting);
        try {
          await db!.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${adminUser.id} FOR UPDATE`;
              const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
              pending = exportFile(waiting, { action: 'user.update' }, [401, 403]);
              let blocked = false;
              for (let attempt = 0; attempt < 150; attempt++) {
                const [state] = await owner.$queryRaw<
                  { blocked: boolean }[]
                >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
                if (state.blocked) {
                  blocked = true;
                  break;
                }
                await wait(20);
              }
              assert.ok(blocked, `请求通过初始授权且确实等待用户锁：${change}`);
              if (change === 'grant')
                await tx.sensitiveGrant.updateMany({
                  where: { userId: adminUser.id, permissionId: 'data.export' },
                  data: { expiresAt: new Date(Date.now() - 1) },
                });
              if (change === 'template')
                await tx.rolePermission.delete({
                  where: { roleId_permissionId: { roleId: 'ADMIN', permissionId: 'data.export' } },
                });
              if (change === 'session') {
                await tx.user.update({
                  where: { id: adminUser.id },
                  data: { authVersion: { increment: 1 } },
                });
                await tx.session.deleteMany({ where: { userId: adminUser.id } });
              }
              if (change === 'organization')
                await tx.organization.update({ where: { id: institution.id }, data: { active: false } });
            },
            { timeout: 10_000 },
          );
          await pending!;
          assert.equal(await exportedAudits(waiting), before);
        } finally {
          if (change === 'organization')
            await db!.organization.update({ where: { id: institution.id }, data: { active: true } });
          if (change === 'template')
            await db!.rolePermission.create({ data: { roleId: 'ADMIN', permissionId: 'data.export' } });
          if (change === 'grant')
            await db!.sensitiveGrant.updateMany({
              where: { userId: adminUser.id, permissionId: 'data.export' },
              data: { expiresAt: new Date(Date.now() + 3_600_000) },
            });
        }
      }
    });

    await t.test('当前角色模板撤audit.read、data.export和会话/空间变化都不会绕过权限', async () => {
      const waiting = await login(adminUser.username);
      for (const permissionId of ['audit.read', 'data.export']) {
        await db!.rolePermission.delete({
          where: { roleId_permissionId: { roleId: 'ADMIN', permissionId } },
        });
        try {
          await exportFile(waiting, {}, 403);
          if (permissionId === 'audit.read') await list(waiting, {}, 403);
        } finally {
          await db!.rolePermission.create({ data: { roleId: 'ADMIN', permissionId } });
        }
      }
      await db!.user.update({ where: { id: readerUser.id }, data: { authVersion: { increment: 1 } } });
      await list(reader, {}, 401);
      await exportFile(reader, {}, 401);
      const grantRow = await db!.sensitiveGrant.findUniqueOrThrow({
        where: { userId_permissionId: { userId: adminUser.id, permissionId: 'data.export' } },
      });
      await request(
        manager,
        `/admin/grants/${grantRow.id}`,
        'DELETE',
        { reason: '隔离验收撤销导出授权' },
        200,
      );
      await exportFile(waiting, {}, 403);
      await grant(waiting);
    });

    await t.test('3连接池同时处理6次导出，无持锁二次连接死锁且各次count/meta一致', async () => {
      const current = await login(adminUser.username);
      const before = await exportedAudits(current);
      const outputs = await Promise.all(
        Array.from({ length: 6 }, () => exportFile(current, { action: 'csv.literal', limit: 3 })),
      );
      for (const output of outputs) {
        assert.equal(output.response.headers.get('x-export-record-count'), '3');
        assert.equal(output.response.headers.get('x-export-matched-count'), '5');
        assert.equal(csvRows(output.text).length, 4);
      }
      assert.equal(await exportedAudits(current), before + 6);
    });
    assert.ok(!logs.includes(password), '日志不能包含夹具密码');
  } catch (error) {
    throw new Error(safe(error instanceof Error ? error.message : '机构审计验收失败'));
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
      assert.match(databaseName, /^admin_audit_it_[a-f0-9]{16}$/);
      try {
        await owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      } catch {
        t.diagnostic('仅本次admin_audit_it_随机测试库清理失败；请检查遗留测试库。未触碰现有业务库。');
      }
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
