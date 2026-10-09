import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, PayloadTooLargeException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { AuthService } from '../apps/api/src/auth/auth.service';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import { AdminAuditService, auditExportAction, auditWhere } from '../apps/api/src/admin/audit.service';
import {
  auditExportInput,
  auditFilterSummary,
  parseAuditListQuery,
} from '../apps/api/src/admin/audit.schemas';
import {
  AuditExportRenderer,
  auditCsvHeader,
  auditExportMaxBytes,
  type AuditExportRecord,
} from '../apps/api/src/admin/audit-export.renderer';

test('审计查询保留action和分页的缺省、floor、clamp以及超页契约', () => {
  assert.deepEqual(parseAuditListQuery({}), { filters: {}, page: 1, pageSize: 20, skip: 0 });
  assert.deepEqual(parseAuditListQuery({ action: 'user.update', page: '2.9', pageSize: '10.9' }), {
    filters: { action: 'user.update' },
    page: 2,
    pageSize: 10,
    skip: 10,
  });
  assert.equal(parseAuditListQuery({ page: '100001', pageSize: '101' }).page, 100000);
  assert.equal(parseAuditListQuery({ page: '0', pageSize: '-1' }).pageSize, 1);
  assert.equal(parseAuditListQuery({ page: 'nonsense', pageSize: '0' }).pageSize, 20);
  assert.equal(parseAuditListQuery({ action: ' user.update ' }).filters.action, ' user.update ');
  assert.deepEqual(
    parseAuditListQuery({ search: '   ', actorId: '', ignoredLegacyKey: 'value' }).filters,
    {},
  );
});

test('审计过滤器拒绝数组、对象、重复标量、NUL及超限，允许历史非CUID标识', () => {
  const lengths = {
    search: 200,
    action: 200,
    actorId: 128,
    resourceType: 100,
    resourceId: 256,
    requestId: 200,
  };
  for (const [key, length] of Object.entries(lengths)) {
    assert.doesNotThrow(() => auditExportInput.parse({ [key]: 'x'.repeat(length) }));
    for (const value of ['x'.repeat(length + 1), 'bad\0text', ['one', 'two'], { toString: 'one' }, 1, null]) {
      assert.throws(() => parseAuditListQuery({ [key]: value }));
      assert.throws(() => auditExportInput.parse({ [key]: value }));
    }
  }
  assert.equal(
    auditExportInput.parse({ actorId: 'deleted-user-2019', requestId: 'old-trace:42' }).actorId,
    'deleted-user-2019',
  );
  for (const field of ['page', 'pageSize']) {
    assert.throws(() => parseAuditListQuery({ [field]: ['1', '2'] }));
    assert.throws(() => parseAuditListQuery({ [field]: '1\0' }));
  }
});

test('审计时间支持有偏移的瞬时时间、双端包含，拒绝无偏移及反向范围', () => {
  assert.doesNotThrow(() =>
    auditExportInput.parse({ from: '2019-01-01T00:00:00Z', to: '2026-10-09T16:00:00+08:00' }),
  );
  assert.doesNotThrow(() =>
    auditExportInput.parse({ from: '2026-10-09T08:00:00Z', to: '2026-10-09T16:00:00+08:00' }),
  );
  for (const value of ['2026-10-09', '2026-10-09T08:00:00', '2026-02-30T00:00:00Z', 'not-a-date'])
    assert.throws(() => auditExportInput.parse({ from: value }));
  assert.throws(() =>
    auditExportInput.parse({ from: '2026-10-09T08:00:00.001Z', to: '2026-10-09T08:00:00Z' }),
  );
});

test('审计导出strict body和数字整型上限拒绝客户端安全范围覆盖', () => {
  assert.equal(auditExportInput.parse({}).limit, 5000);
  for (const limit of [1, 5000]) assert.equal(auditExportInput.parse({ limit }).limit, limit);
  for (const limit of ['1', 0, -1, 5001, 1.1, null]) assert.throws(() => auditExportInput.parse({ limit }));
  for (const key of [
    'organizationId',
    'userId',
    'actor',
    'permissions',
    'role',
    'csrfToken',
    'page',
    'pageSize',
    'details',
    'format',
  ])
    assert.throws(() => auditExportInput.parse({ [key]: 'forged' }));
  for (const key of ['organizationId', 'userId', 'role', 'permissions', 'sessionId', 'csrfToken'])
    assert.throws(() => parseAuditListQuery({ [key]: 'forged' }));
});

test('审计where同机构固定，search各字段OR与精确筛选AND，details不参与搜索', () => {
  const where = auditWhere('org-A', {
    search: '100%_\\查找',
    action: 'User',
    actorId: 'old-user',
    resourceType: 'Retired',
    resourceId: 'old-item',
    requestId: 'legacy',
    from: '2026-10-09T00:00:00Z',
    to: '2026-10-10T00:00:00Z',
  });
  assert.match(where.sql, /"organizationId" = \?/);
  assert.equal(where.values[0], 'org-A');
  assert.equal(where.values.filter((value) => value === '%100\\%\\_\\\\查找%').length, 4);
  for (const field of [
    '"action" LIKE',
    '"userId" =',
    '"resourceType" =',
    '"resourceId" =',
    '"requestId" =',
    '"createdAt" >=',
    '"createdAt" <=',
  ])
    assert.ok(where.sql.includes(field));
  assert.ok(!where.sql.includes('details'));
  assert.equal(where.values.filter((value) => value instanceof Date).length, 2);
  assert.deepEqual(auditFilterSummary({ search: 'find', action: undefined, requestId: 'trace' }), {
    search: 'find',
    requestId: 'trace',
  });
});

const record: AuditExportRecord = {
  id: 'audit-1',
  createdAt: '2026-10-09T16:00:00+08:00',
  userId: 'deleted-1',
  actorName: '历史账号',
  action: 'user.update',
  resourceType: 'User',
  resourceId: 'u-1',
  requestId: null,
};
test('审计CSV只有白名单字段、BOM/CRLF和UTC时间，任意公式前缀均保持字面值', () => {
  const renderer = new AuditExportRenderer();
  for (const value of [
    '=1+1',
    ' +SUM(A1)',
    '\t-2',
    '\r\n@evil',
    '\ufeff=HYPERLINK("https://invalid.example")',
  ])
    renderer.add({ ...record, resourceId: value });
  renderer.add({
    ...record,
    actorName: '中文😀,"换行\n内容',
    requestId: 'quoted"id',
    details: { secret: 'HIDDEN_DETAILS' },
  } as AuditExportRecord);
  const output = renderer.finish();
  assert.ok(output.buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  const text = output.buffer.toString('utf8');
  assert.ok(text.startsWith(auditCsvHeader));
  assert.match(text, /"2026-10-09T08:00:00.000Z"/);
  assert.match(text, /"'=1\+1"/);
  assert.match(text, /"' \+SUM\(A1\)"/);
  assert.match(text, /"'\t-2"/);
  assert.match(text, /"'\r\n@evil"/);
  assert.match(text, /"'\ufeff=HYPERLINK\(""https:\/\/invalid.example""\)"/);
  assert.ok(text.includes('"中文😀,""换行\n内容"'));
  assert.ok(!text.includes('HIDDEN_DETAILS'));
  assert.equal(output.count, 6);
  assert.equal(output.bytes, Buffer.byteLength(text));
  assert.ok(text.endsWith('\r\n'));
});

test('审计CSV最终8MiB严格计入表头、引号转义与UTF8，超限没有部分文件', () => {
  assert.equal(auditExportMaxBytes, 8 * 1024 * 1024);
  const overhead = new AuditExportRenderer();
  overhead.add({ ...record, resourceId: '' });
  const allowed = auditExportMaxBytes - overhead.finish().bytes;
  const exact = new AuditExportRenderer();
  exact.add({ ...record, resourceId: 'x'.repeat(allowed) });
  assert.equal(exact.finish().bytes, auditExportMaxBytes);
  const oversized = new AuditExportRenderer();
  assert.throws(
    () => oversized.add({ ...record, resourceId: 'x'.repeat(allowed + 1) }),
    PayloadTooLargeException,
  );
  assert.equal(oversized.finish().count, 0);
  const escaped = new AuditExportRenderer();
  assert.throws(
    () => escaped.add({ ...record, resourceId: '"'.repeat(Math.floor(allowed / 2) + 1) }),
    PayloadTooLargeException,
  );
  const unicode = new AuditExportRenderer();
  assert.throws(
    () => unicode.add({ ...record, resourceId: '😀'.repeat(Math.floor(allowed / 4) + 1) }),
    PayloadTooLargeException,
  );
});

const actor: Actor = {
  id: 'admin-A',
  organizationId: 'org-A',
  accountMode: 'ORGANIZATION',
  role: 'ADMIN',
  permissions: ['audit.read', 'data.export'],
  name: '管理甲',
  sessionId: 'session-A',
  csrfToken: 'csrf-A',
  requestId: 'req-A',
};
function serviceFixture() {
  const state = {
    user: {
      id: actor.id,
      organizationId: actor.organizationId,
      accountMode: 'ORGANIZATION',
      active: true,
      authVersion: 0,
      passwordHash: 'hash',
      roles: [{ roleId: 'ADMIN' }],
    },
    organization: { active: true, kind: 'INSTITUTION' },
    session: true,
    templates: [
      { permissionId: 'audit.read', permission: { sensitive: false } },
      { permissionId: 'data.export', permission: { sensitive: true } },
    ],
    grants: [{ permissionId: 'data.export', expiresAt: new Date(Date.now() + 60_000) }],
    fresh: { ...actor },
    currentQueries: 0,
    outsideDuringLock: 0,
    holdingLock: false,
    snapshot: { matchedCount: 2n, recordCount: 1, minimumBytes: 100n, rows: [record] },
    audits: [] as any[],
    statements: [] as Prisma.Sql[],
    afterSnapshot: undefined as (() => void) | undefined,
    afterAudit: undefined as (() => void) | undefined,
    afterList: undefined as (() => void) | undefined,
  };
  const tx = {
    user: { findUnique: async () => state.user, findUniqueOrThrow: async () => state.user },
    organization: { findUnique: async () => state.organization },
    session: { findFirst: async () => (state.session ? { id: actor.sessionId } : null) },
    rolePermission: { findMany: async () => state.templates },
    sensitiveGrant: { findMany: async () => state.grants },
    auditLog: {
      create: async ({ data }: any) => {
        state.audits.push(data);
        state.afterAudit?.();
        return data;
      },
    },
    $queryRaw: async (query: Prisma.Sql | TemplateStringsArray) => {
      const sql = 'sql' in query ? query.sql : query.join('?');
      if (sql.includes('FOR UPDATE')) {
        state.holdingLock = true;
        state.currentQueries++;
        return [state.user];
      }
      if (sql.includes('WITH selected')) {
        state.statements.push(query as Prisma.Sql);
        state.afterSnapshot?.();
        return [state.snapshot];
      }
      if (sql.includes('clock_timestamp')) return [{ createdAt: new Date() }];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const db = {
    sensitiveGrant: {
      findFirst: async () => {
        if (state.holdingLock) state.outsideDuringLock++;
        return (
          state.grants.find(
            (entry) => entry.permissionId === 'data.export' && entry.expiresAt > new Date(),
          ) ?? null
        );
      },
    },
    $queryRaw: async (query: Prisma.Sql) => {
      state.statements.push(query);
      state.afterList?.();
      return [
        {
          total: 2n,
          items: [
            {
              ...record,
              organizationId: actor.organizationId,
              details: { action: 'preserved-list-details' },
            },
          ],
        },
      ];
    },
    $transaction: async (callback: (client: unknown) => Promise<unknown>, options: any) => {
      assert.equal(options.isolationLevel, 'ReadCommitted');
      try {
        return await callback(tx);
      } finally {
        state.holdingLock = false;
      }
    },
  };
  const auth = {
    require: (input: Actor, permission: string) => {
      if (!input.permissions.includes(permission)) throw new ForbiddenException();
    },
    resolveSessionId: async () => {
      if (state.holdingLock) state.outsideDuringLock++;
      return state.fresh;
    },
  };
  return {
    state,
    service: new AdminAuditService(db as unknown as PrismaService, auth as unknown as AuthService),
  };
}

test('审计list同语句匹配数/分页及机构内姓名关联，兼容ISO时间，读取后身份变更不返回旧数据', async () => {
  const { state, service } = serviceFixture();
  const output = await service.list(actor, { page: '2', pageSize: '1', actorId: 'deleted-user' });
  assert.equal(output.total, 2);
  assert.equal(output.page, 2);
  assert.equal(output.pageSize, 1);
  assert.equal(output.items[0].createdAt, '2026-10-09T08:00:00.000Z');
  assert.deepEqual(output.items[0].details, { action: 'preserved-list-details' });
  assert.equal(state.statements.length, 1);
  assert.match(state.statements[0].sql, /u\."organizationId" =/);
  assert.match(
    state.statements[0].sql,
    /CASE WHEN a\."userId" IS NULL THEN '系统' ELSE COALESCE\(u\."name", '历史账号'\)/,
  );
  assert.ok(!state.statements[0].sql.includes('u."active"'));
  assert.match(state.statements[0].sql, /COUNT\(\*\).*"AuditLog"/);
  state.afterList = () => {
    state.fresh.csrfToken = 'new-session';
  };
  await assert.rejects(service.list(actor, {}), UnauthorizedException);
});

test('审计导出固定白名单预检SQL、准备审计元数据与小连接池只用事务连接', async () => {
  const { state, service } = serviceFixture();
  const output = await service.export(actor, { search: 'user', limit: 1 });
  assert.equal(output.matchedCount, 2);
  assert.equal(output.recordCount, 1);
  assert.equal(output.truncated, true);
  assert.equal(output.filename, 'audit-records.csv');
  assert.equal(output.contentType, 'text/csv; charset=utf-8');
  assert.equal(state.outsideDuringLock, 0);
  assert.equal(state.currentQueries, 3);
  assert.equal(state.statements.length, 1);
  assert.match(state.statements[0].sql, /CASE WHEN b\."minimumBytes" <=/);
  assert.ok(!state.statements[0].sql.includes('details'));
  assert.ok(!state.statements[0].sql.includes('OFFSET'));
  assert.match(state.statements[0].sql, /u\."organizationId" =/);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].action, auditExportAction);
  assert.deepEqual(state.audits[0].details, {
    format: 'csv',
    deliveryState: 'prepared',
    limit: 1,
    filters: { search: 'user' },
    matchedCount: 2,
    count: 1,
    bytes: output.bytes,
  });
});

test('审计导出grant单独、template单独与SUPER_ADMIN身份都不能跳过独立限时授权', async () => {
  for (const change of [
    'missing-template',
    'missing-grant',
    'expired-grant',
    'missing-read-template',
  ] as const) {
    const { state, service } = serviceFixture();
    if (change === 'missing-template')
      state.templates = state.templates.filter((entry) => entry.permissionId !== 'data.export');
    if (change === 'missing-read-template')
      state.templates = state.templates.filter((entry) => entry.permissionId !== 'audit.read');
    if (change === 'missing-grant') state.grants = [];
    if (change === 'expired-grant') state.grants[0].expiresAt = new Date(Date.now() - 1);
    await assert.rejects(service.export(actor, {}), ForbiddenException);
    assert.equal(state.audits.length, 0);
  }
  const { service } = serviceFixture();
  await assert.rejects(
    service.export({ ...actor, role: 'SUPER_ADMIN', permissions: ['audit.read'] }, {}),
    ForbiddenException,
  );
  await assert.rejects(service.export({ ...actor, permissions: ['data.export'] }, {}), ForbiddenException);
  const sensitivity = serviceFixture();
  sensitivity.state.templates[1].permission.sensitive = false;
  sensitivity.state.grants = [];
  await assert.rejects(sensitivity.service.export(actor, {}), ForbiddenException);
});

test('审计导出在生成后撤销grant、模板、会话或机构即拒绝且不产生准备审计', async () => {
  for (const change of ['grant', 'template', 'session', 'organization'] as const) {
    const { state, service } = serviceFixture();
    state.afterSnapshot = () => {
      if (change === 'grant') state.grants = [];
      if (change === 'template') state.templates = [];
      if (change === 'session') state.session = false;
      if (change === 'organization') state.organization.active = false;
    };
    await assert.rejects(
      service.export(actor, {}),
      change === 'session' ? UnauthorizedException : ForbiddenException,
    );
    assert.equal(state.audits.length, 0);
  }
});

test('审计导出事务后独立再验同用户换角色、机构或新CSRF身份', async () => {
  for (const change of ['role', 'organizationId', 'csrfToken', 'permissions'] as const) {
    const { state, service } = serviceFixture();
    state.afterSnapshot = () => {
      if (change === 'role') state.fresh.role = 'SUPER_ADMIN';
      if (change === 'organizationId') state.fresh.organizationId = 'org-B';
      if (change === 'csrfToken') state.fresh.csrfToken = 'new-same-user-session';
      if (change === 'permissions') state.fresh.permissions = ['audit.read'];
    };
    await assert.rejects(
      service.export(actor, {}),
      change === 'permissions' ? ForbiddenException : UnauthorizedException,
    );
    assert.equal(state.audits.length, 0);
  }
});

test('审计准备记录之后最后身份变化仍拒绝文件，事件明确不是送达成功', async () => {
  const { state, service } = serviceFixture();
  state.afterAudit = () => {
    state.fresh.csrfToken = 'rotated';
  };
  await assert.rejects(service.export(actor, {}), UnauthorizedException);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].details.deliveryState, 'prepared');
});

test('Permission.sensitive误设false时准备事件后撤销或到期grant，最后独立复验仍拒绝CSV', async () => {
  for (const change of ['revoked', 'expired'] as const) {
    const { state, service } = serviceFixture();
    state.templates[1].permission.sensitive = false;
    // Simulates AuthService still returning template-based effective data.export.
    assert.ok(state.fresh.permissions.includes('data.export'));
    state.afterAudit = () => {
      if (change === 'revoked') state.grants = [];
      else state.grants[0].expiresAt = new Date(Date.now() - 1);
    };
    await assert.rejects(service.export(actor, {}), ForbiddenException);
    assert.equal(state.outsideDuringLock, 0);
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0].details.deliveryState, 'prepared');
  }
});

test('审计预检超大标量先拒绝，空结果输出仅表头且不会静默截断字节', async () => {
  const oversized = serviceFixture();
  oversized.state.snapshot.minimumBytes = BigInt(auditExportMaxBytes + 1);
  oversized.state.snapshot.rows = [];
  await assert.rejects(oversized.service.export(actor, {}), PayloadTooLargeException);
  assert.equal(oversized.state.audits.length, 0);
  const empty = serviceFixture();
  empty.state.snapshot = { matchedCount: 0n, recordCount: 0, minimumBytes: 0n, rows: [] };
  const result = await empty.service.export(actor, {});
  assert.equal(result.buffer.toString('utf8'), auditCsvHeader);
  assert.equal(result.truncated, false);
  assert.equal(result.recordCount, 0);
});
