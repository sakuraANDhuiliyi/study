import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { AuthService } from '../apps/api/src/auth/auth.service';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import { AdminJobsService } from '../apps/api/src/admin/jobs.service';
import { jobsKindPattern, parseJobsQuery } from '../apps/api/src/admin/jobs.schemas';

const actor: Actor = {
  id: 'manager',
  name: '机构审计员',
  organizationId: 'org-a',
  role: 'ADMIN',
  accountMode: 'ORGANIZATION',
  majorId: null,
  sessionId: 'session',
  csrfToken: 'csrf',
  permissions: ['audit.read'],
};
const stamp = new Date('2026-10-10T03:04:05.123Z');
const counts = { pending: 501, running: 4, succeeded: 3, failed: 2, other: 1, all: 511 };
const job = {
  id: 'job',
  kind: 'UNKNOWN_%_\\',
  status: 'PENDING',
  attempts: 2,
  lastError: '<b>文本错误</b>',
  runAt: '2026-10-10T03:00:00.000+00:00',
  createdAt: '2026-10-10T02:00:00+00:00',
  organizationId: 'org-a',
  organizationName: '机构甲',
  payload: { credential: 'PRIVATE_PAYLOAD' },
  eventKey: 'PRIVATE_EVENT',
  updatedAt: stamp,
  lockedAt: stamp,
};

function fixture(options: { current?: Actor | null; result?: any; afterRead?: () => void } = {}) {
  const sql: Prisma.Sql[] = [];
  const operations: string[] = [];
  const result = options.result ?? {
    items: [job],
    total: 501,
    stateCounts: counts,
    examDeadlineRuns: [],
    serverTime: stamp,
  };
  const db = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(Prisma.sql(strings, ...values));
      operations.push('query');
      options.afterRead?.();
      return [result];
    },
  } as unknown as PrismaService;
  const auth = {
    require: (candidate: Actor, permission: string) => {
      if (!candidate.permissions.includes(permission)) throw new ForbiddenException('权限不足');
    },
    resolveSessionId: async (id: string) => {
      assert.equal(id, actor.sessionId);
      operations.push('fresh');
      return options.current === undefined ? actor : options.current;
    },
  } as unknown as AuthService;
  return { service: new AdminJobsService(db, auth), sql, operations };
}

test('Known job query fields are scalar, bounded and cannot override authority', () => {
  assert.deepEqual(parseJobsQuery({}), { action: undefined, status: 'ALL', page: 1, pageSize: 20, skip: 0 });
  assert.equal(parseJobsQuery({ action: '  NOTIFICATION  ', status: '' }).action, '  NOTIFICATION  ');
  assert.equal(parseJobsQuery({ action: '', ignoredLegacy: 'value' }).action, undefined);
  for (const value of [
    { action: ['NOTIFICATION'] },
    { action: {} },
    { action: 1 },
    { action: 'x'.repeat(201) },
    { action: 'a\0b' },
    { status: ['ALL'] },
    { status: 'pending' },
    { status: 'OTHER' },
    { status: 'DROP TABLE' },
    { page: ['1'] },
    { page: 1 },
    { page: 'x'.repeat(201) },
    { pageSize: {} },
    { organizationId: 'foreign' },
    { userId: 'peer' },
    { role: 'SUPER_ADMIN' },
    { permissions: [] },
    { sessionId: 'foreign' },
    { csrfToken: 'foreign' },
    { scope: 'platform_institutions' },
  ])
    assert.throws(() => parseJobsQuery(value), JSON.stringify(value));
});

test('The legacy paging protocol retains defaults, floor and upper/lower clamps', () => {
  assert.deepEqual(parseJobsQuery({ page: '2.9', pageSize: '20.9' }), {
    action: undefined,
    status: 'ALL',
    page: 2,
    pageSize: 20,
    skip: 20,
  });
  assert.equal(parseJobsQuery({ page: '99999999', pageSize: '99999999' }).page, 100000);
  assert.equal(parseJobsQuery({ page: '99999999', pageSize: '99999999' }).pageSize, 100);
  assert.equal(parseJobsQuery({ page: '-1', pageSize: '-1' }).page, 1);
  assert.equal(parseJobsQuery({ page: 'NaN', pageSize: '0' }).pageSize, 20);
});

test('Kind contains treats wildcard characters, quotes and whitespace literally', () => {
  for (const [keyword, expected] of [
    ['a%b', '%a\\%b%'],
    ['a_b', '%a\\_b%'],
    ['a\\b', '%a\\\\b%'],
    ["a'b", "%a'b%"],
    ['  ', '%  %'],
    ['普通中文😀', '%普通中文😀%'],
  ])
    assert.equal(jobsKindPattern(keyword), expected);
});

test('Ordinary jobs query includes only current organization and never reads global exam runs', async () => {
  const context = fixture();
  const result = await context.service.list(actor, {
    action: 'nOtIf_%\\',
    status: 'PENDING',
    page: '2',
    pageSize: '20',
  });
  assert.equal(context.sql.length, 1);
  const sql = context.sql[0];
  assert.match(sql.sql.slice(0, 200), /admin-jobs-list/);
  assert.match(sql.sql, /j\."organizationId" = \?/);
  assert.doesNotMatch(sql.sql, /AssessmentJobRun|org\.platform|payload|eventKey/);
  assert.ok(sql.values.includes(actor.organizationId));
  assert.ok(sql.values.includes('%nOtIf\\_\\%\\\\%'));
  assert.ok(sql.values.includes('\\'), 'ESCAPE is a single bound backslash');
  assert.match(sql.sql, /base AS MATERIALIZED/);
  assert.match(sql.sql, /matched AS MATERIALIZED \(\s*SELECT \* FROM base WHERE status = \?/);
  assert.match(sql.sql, /FROM base\) AS "stateCounts"/);
  assert.deepEqual(context.operations, ['query', 'fresh']);
  assert.equal(result.scope, 'current_organization');
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 20);
  assert.equal(result.total, 501);
  assert.deepEqual(
    result.stateCounts,
    counts,
    'status facet is the full base contract, never current page length',
  );
  assert.equal(result.serverTime, stamp.toISOString());
});

test('Platform scope uses every institution including inactive and keeps independent global20 history', async () => {
  const platform = { ...actor, permissions: ['audit.read', 'org.platform'] };
  const context = fixture({ current: platform });
  const result = await context.service.list(platform, {});
  assert.match(context.sql[0].sql, /o\.kind = 'INSTITUTION'/);
  assert.doesNotMatch(context.sql[0].sql, /o\.active|WHERE j\."organizationId"/);
  assert.match(context.sql[0].sql, /FROM "AssessmentJobRun"\s*ORDER BY "startedAt" DESC, id DESC LIMIT 20/);
  assert.equal(result.scope, 'platform_institutions');
});

test('DTO allowlists safe scalars and normalizes stored date strings to existing ISO Z convention', async () => {
  const run = {
    id: 'run',
    type: 'deadline',
    status: 'SUCCEEDED',
    processed: 7,
    error: null,
    startedAt: '2026-10-10T03:00:00+00:00',
    completedAt: '2026-10-10T03:00:01+00:00',
    secret: 'PRIVATE_RUN',
  };
  const platform = { ...actor, permissions: ['audit.read', 'org.platform'] };
  const context = fixture({
    current: platform,
    result: { items: [job], total: 1, stateCounts: counts, examDeadlineRuns: [run], serverTime: stamp },
  });
  const result = await context.service.list(platform, {});
  assert.deepEqual(
    Object.keys(result.items[0]).sort(),
    [
      'id',
      'kind',
      'status',
      'attempts',
      'runAt',
      'lastError',
      'createdAt',
      'organizationId',
      'organizationName',
    ].sort(),
  );
  assert.equal(result.items[0].runAt, '2026-10-10T03:00:00.000Z');
  assert.equal(result.items[0].lastError, '<b>文本错误</b>');
  assert.equal(result.examDeadlineRuns[0].completedAt, '2026-10-10T03:00:01.000Z');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|payload|eventKey|lockedAt|updatedAt|secret/);
});

test('Missing audit permission rejects before any private query even for platform role names', async () => {
  for (const candidate of [
    { ...actor, permissions: [] },
    { ...actor, role: 'SUPER_ADMIN', permissions: ['org.platform'] },
  ]) {
    const context = fixture();
    await assert.rejects(context.service.list(candidate, {}), ForbiddenException);
    assert.equal(context.sql.length, 0);
  }
});

test('Session/identity/space/role/account mode/nonce changes after the read reject all private payloads', async () => {
  for (const current of [
    null,
    { ...actor, id: 'peer' },
    { ...actor, organizationId: 'foreign' },
    { ...actor, role: 'SUPER_ADMIN' },
    { ...actor, accountMode: 'PERSONAL' },
    { ...actor, csrfToken: 'new' },
  ]) {
    const context = fixture({ current });
    await assert.rejects(context.service.list(actor, {}), UnauthorizedException);
    assert.deepEqual(context.operations, ['query', 'fresh']);
  }
});

test('audit.read withdrawal after SQL is checked on actual current permissions', async () => {
  const context = fixture({ current: { ...actor, permissions: [] } });
  await assert.rejects(context.service.list(actor, {}), ForbiddenException);
  assert.equal(context.sql.length, 1);
});

test('Either platform-scope withdrawal or gain denies a previously captured scope', async () => {
  const platform = { ...actor, permissions: ['audit.read', 'org.platform'] };
  for (const [initial, current] of [
    [platform, actor],
    [actor, platform],
  ]) {
    const context = fixture({ current });
    await assert.rejects(context.service.list(initial, {}), ForbiddenException);
    assert.equal(context.sql.length, 1);
  }
});

test('A current successful empty query returns zeros while query errors stay errors', async () => {
  const zeros = { pending: 0, running: 0, succeeded: 0, failed: 0, other: 0, all: 0 };
  const context = fixture({
    result: { items: [], total: 0, stateCounts: zeros, serverTime: stamp, examDeadlineRuns: [] },
  });
  const result = await context.service.list(actor, { action: 'no-match' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.stateCounts, zeros);
  const failure = fixture({
    afterRead: () => {
      throw new Error('database unavailable');
    },
  });
  await assert.rejects(failure.service.list(actor, {}), /database unavailable/);
  assert.deepEqual(failure.operations, ['query']);
});
