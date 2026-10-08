import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, PayloadTooLargeException, UnauthorizedException } from '@nestjs/common';
import { academicRecordExportInput } from '../apps/api/src/academics/records-export.schemas';
import {
  AcademicExportRenderer,
  academicExportMaxBytes,
  academicLiteralBlock,
} from '../apps/api/src/academics/records-export.renderer';
import { AcademicRecordExportService } from '../apps/api/src/academics/records-export.service';
import { academicRecordQuery } from '../apps/api/src/academics/academics.schemas';
import { AuthService } from '../apps/api/src/auth/auth.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { PrismaService } from '../apps/api/src/common/prisma.service';

const context = { matchedCount: 1, recordCount: 1, generatedAt: new Date('2026-10-10T00:00:00Z') };
const row = {
  id: 'record',
  moduleId: 'matrix-lab',
  title: '矩阵练习',
  status: 'COMPLETED',
  revision: 2,
  createdAt: context.generatedAt,
  updatedAt: context.generatedAt,
};

test('导出请求严格限制格式、状态、数量、未知身份字段，并与列表状态保持一致', () => {
  assert.deepEqual(academicRecordExportInput.parse({}), { format: 'csv', status: 'all' });
  for (const input of [
    { format: 'json' },
    { status: 'completed' },
    { limit: '20' },
    { limit: 0 },
    { limit: 5001 },
    { limit: 1.5 },
    { format: 'md', limit: 51 },
    { userId: 'other' },
    { organizationId: 'other' },
    { page: 1 },
    { moduleId: '' },
    { moduleId: 'x\0' },
  ])
    assert.equal(academicRecordExportInput.safeParse(input).success, false);
  assert.equal(academicRecordExportInput.safeParse({ format: 'md', limit: 50 }).success, true);
  assert.equal(academicRecordExportInput.safeParse({ format: 'csv', limit: 5000 }).success, true);
  assert.equal(academicRecordQuery.parse({ status: 'DRAFT' }).status, 'DRAFT');
  assert.equal(academicRecordQuery.parse({}).status, 'all');
});

test('CSV使用BOM和所有字段完整引用，含前导空白的公式不会作为公式打开', () => {
  for (const formula of ['=1+1', ' +SUM(A1)', '\t-2', '\r\n@evil', '\uFEFF=HYPERLINK("https://evil")']) {
    const renderer = new AcademicExportRenderer({ ...context, format: 'csv' });
    renderer.addCsv({ ...row, title: formula, summary: '第一行,"完整"\n第二行', hasNotes: true });
    const output = renderer.finish();
    assert.equal(output.buffer.subarray(0, 3).toString('hex'), 'efbbbf');
    const text = output.buffer.toString('utf8');
    assert.ok(text.includes(`"'${formula.replaceAll('"', '""')}"`));
    assert.ok(text.includes('"第一行,""完整""\n第二行"'));
    assert.ok(text.endsWith('"是"\r\n'));
    assert.equal(output.bytes, Buffer.byteLength(text));
    assert.equal(output.count, 1);
  }
});

test('Markdown动态围栏使HTML、图片链接和反向围栏保持字面文本，JSON表格图点完整保留', () => {
  const notes = '前文\n```\n![跟踪](https://example.invalid/pixel)\n<script>alert(1)</script>\n``````\n后文';
  const block = academicLiteralBlock(notes);
  assert.ok(block.startsWith('```````text\n'));
  assert.ok(block.endsWith('\n```````\n'));
  assert.equal(block.slice('```````text\n'.length, -'\n```````\n'.length), notes);
  const values = { query: 'SELECT name FROM students', payload: '`'.repeat(8) };
  const result = {
    summary: '完整结果',
    tables: [{ columns: ['数值'], rows: [{ value: 1 }] }],
    chart: { points: [{ x: 1, y: 2 }] },
  };
  const renderer = new AcademicExportRenderer({ ...context, format: 'md' });
  renderer.addMarkdown({
    ...row,
    title: notes,
    notes,
    valuesJson: JSON.stringify(values),
    resultJson: JSON.stringify(result),
  });
  const output = renderer.finish().buffer.toString('utf8');
  assert.ok(output.includes(JSON.stringify(values)));
  assert.ok(output.includes(JSON.stringify(result)));
  assert.ok(output.includes(notes));
  assert.match(output, /## 记录 1/);
  assert.match(output, /不代表答案正确性/);
});

test('最终输出逐段按UTF8字节限制，超过8MiB报413而不返回截断正文', () => {
  const renderer = new AcademicExportRenderer({ ...context, format: 'csv' });
  assert.throws(
    () =>
      renderer.addCsv({
        ...row,
        summary: '中'.repeat(Math.ceil(academicExportMaxBytes / 3)),
        hasNotes: false,
      }),
    PayloadTooLargeException,
  );
  const empty = new AcademicExportRenderer({
    ...context,
    matchedCount: 0,
    recordCount: 0,
    format: 'md',
  }).finish();
  assert.equal(empty.count, 0);
  assert.match(empty.buffer.toString('utf8'), /没有符合筛选条件/);
});

test('导出服务在数据库访问前拒绝非学生、无learning.use和practice停用', async () => {
  const actor: Actor = {
    id: 'student',
    organizationId: 'space',
    name: '学生',
    role: 'STUDENT',
    permissions: ['learning.use'],
  };
  const auth = {
    require: AuthService.prototype.require,
    checkFeature: async () => {},
  } as unknown as AuthService;
  const service = new AcademicRecordExportService({} as PrismaService, auth);
  for (const blocked of [
    { ...actor, role: 'TEACHER' },
    { ...actor, role: 'ADMIN' },
    { ...actor, permissions: [] },
  ])
    await assert.rejects(service.export(blocked, {}), ForbiddenException);
  auth.checkFeature = async () => {
    throw new ForbiddenException('停用');
  };
  await assert.rejects(service.export(actor, {}), ForbiddenException);
});

function transactionFixture(revoke?: (state: ReturnType<typeof transactionState>) => void) {
  const state = transactionState();
  const actor: Actor = {
    id: state.user.id,
    organizationId: state.user.organizationId,
    name: '学生',
    role: 'STUDENT',
    permissions: ['learning.use'],
    sessionId: 'session',
  };
  let inTransaction = false;
  let audits = 0;
  let externalResolves = 0;
  let permissionChecks = 0;
  const tx = {
    user: {
      findUnique: async () => state.user,
      findUniqueOrThrow: async () => state.user,
    },
    session: {
      findFirst: async ({ where }: any) =>
        where.id === actor.sessionId &&
        where.userId === actor.id &&
        where.authVersion === state.session.authVersion &&
        (!where.role || where.role === state.session.role) &&
        state.session.expiresAt > where.expiresAt.gt
          ? state.session
          : null,
    },
    organization: { findUnique: async () => state.organization },
    rolePermission: {
      findUnique: async ({ where }: any) => {
        assert.deepEqual(where.roleId_permissionId, { roleId: 'STUDENT', permissionId: 'learning.use' });
        permissionChecks++;
        return state.permission;
      },
    },
    sensitiveGrant: { findFirst: async () => null },
    systemSetting: { findUnique: async () => ({ value: { practice: state.practice } }) },
    auditLog: {
      create: async () => {
        audits++;
      },
    },
    $queryRaw: async (query: any) => {
      const sql = (Array.isArray(query) ? query : query.strings).join('');
      if (sql.includes('FROM "User"')) return [state.user];
      if (sql.includes('FROM "AuditLog"')) return [{ recent: 0 }];
      if (sql.includes('WITH selected AS')) {
        revoke?.(state);
        return [{ ...context, matchedCount: 0, recordCount: 0, minimumBytes: 0n }];
      }
      if (sql.includes('clock_timestamp()::timestamptz(3)')) return [{ createdAt: context.generatedAt }];
      throw new Error('Unexpected transaction query');
    },
  };
  const db = {
    $transaction: async (callback: (client: unknown) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await callback(tx);
      } finally {
        inTransaction = false;
      }
    },
  } as unknown as PrismaService;
  const auth = {
    require: AuthService.prototype.require,
    checkFeature: async () => {
      assert.equal(inTransaction, false, '事务内不能借用AuthService全局连接');
    },
    resolveSessionId: async () => {
      assert.equal(inTransaction, false, '事务内不能借用AuthService全局连接');
      externalResolves++;
      return actor;
    },
  } as unknown as AuthService;
  return {
    run: () => new AcademicRecordExportService(db, auth).export(actor, {}),
    counts: () => ({ audits, externalResolves, permissionChecks }),
  };
}

function transactionState() {
  return {
    user: {
      id: 'student',
      organizationId: 'space',
      accountMode: 'ORGANIZATION',
      personalOrganizationId: null as string | null,
      active: true,
      authVersion: 1,
      passwordHash: 'hash',
      roles: [{ roleId: 'STUDENT' }],
    },
    session: { authVersion: 1, role: 'STUDENT', expiresAt: new Date(Date.now() + 60000) },
    organization: { id: 'space', active: true, kind: 'INSTITUTION' },
    permission: { permission: { sensitive: false } } as { permission: { sensitive: boolean } } | null,
    practice: true,
  };
}

test('导出事务的两轮安全复查只使用事务连接，提交后才使用全局会话查询', async () => {
  const fixture = transactionFixture();
  const output = await fixture.run();
  assert.equal(output.recordCount, 0);
  assert.deepEqual(fixture.counts(), { audits: 1, externalResolves: 1, permissionChecks: 2 });
});

test('生成文件期间权限、身份、空间和功能发生变化时，事务内末次复查仍拒绝导出', async () => {
  const cases: [string, Parameters<typeof transactionFixture>[0], typeof ForbiddenException][] = [
    ['权限撤销', (state) => (state.permission = null), ForbiddenException],
    ['权限变为需要敏感授权', (state) => (state.permission!.permission.sensitive = true), ForbiddenException],
    ['功能停用', (state) => (state.practice = false), ForbiddenException],
    ['学生角色撤销', (state) => (state.user.roles = []), UnauthorizedException],
    ['会话角色变更', (state) => (state.session.role = 'TEACHER'), UnauthorizedException],
    ['安全版本更新', (state) => state.user.authVersion++, UnauthorizedException],
    ['会话过期', (state) => (state.session.expiresAt = new Date(0)), UnauthorizedException],
    ['机构停用', (state) => (state.organization.active = false), ForbiddenException],
    ['空间类型变化', (state) => (state.organization.kind = 'PERSONAL'), UnauthorizedException],
    ['个人空间不匹配', (state) => (state.user.accountMode = 'PERSONAL'), UnauthorizedException],
  ];
  for (const [label, revoke, ErrorType] of cases) {
    const fixture = transactionFixture(revoke);
    await assert.rejects(fixture.run(), ErrorType, label);
    assert.equal(fixture.counts().audits, 0, label);
    assert.equal(fixture.counts().externalResolves, 0, label);
  }
});
