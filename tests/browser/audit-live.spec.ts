import {
  test,
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPasswordAsync } from '../../apps/api/src/auth/password';
import { auditUserRestrictError } from '../helpers/audit-errors';

const api = process.env.TEST_BASE_URL;
const web = process.env.WEB_BASE_URL || 'http://localhost:5173';
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
function permittedReview() {
  try {
    const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/none');
    return (
      process.env.NODE_ENV !== 'production' &&
      Boolean(api) &&
      loopback(new URL(api!).hostname) &&
      loopback(new URL(web).hostname) &&
      loopback(database.hostname) &&
      ['postgres:', 'postgresql:'].includes(database.protocol) &&
      /review/i.test(database.pathname)
    );
  } catch {
    return false;
  }
}
test.skip(!permittedReview(), 'Live audit exports require loopback web/API and a review PostgreSQL database');
// Credentials exist only in memory/API requests. No trace/video/screenshot captures them.
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15_000,
  timezoneId: 'America/Los_Angeles',
  viewport: { width: 1440, height: 1000 },
});
type Client = {
  api: APIRequestContext;
  csrf: string;
  user: {
    id: string;
    organizationId: string;
    username: string;
    role: string;
    permissions: string[];
  };
};
type Filters = Partial<
  Record<
    'search' | 'action' | 'actorId' | 'resourceType' | 'resourceId' | 'requestId' | 'from' | 'to',
    string
  >
>;
type AuditRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  createdAt: string;
};
type AuditList = { items: AuditRow[]; total: number; page: number; pageSize: number };
const panel = (page: Page) => page.getByRole('region', { name: '机构操作审计', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: '导出机构审计 CSV', exact: true });
const row = (page: Page, id: string) => panel(page).getByTestId(`audit-row-${id}`);
const listResponse = (page: Page, condition: (url: URL) => boolean = () => true) =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/audit' && response.request().method() === 'GET' && condition(url);
  });
const exportResponse = (page: Page) =>
  page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/audit/export' &&
      response.request().method() === 'POST',
  );

async function login(context: APIRequestContext, username: string, password: string): Promise<Client> {
  let response;
  try {
    response = await context.post(`${web}/api/auth/login`, {
      headers: { Origin: web },
      data: { username, password },
    });
  } catch {
    throw new Error('Independent audit fixture authentication failed');
  }
  expect(response.status(), 'Owned fixture login must succeed').toBe(201);
  const body = await response.json();
  return { api: context, csrf: body.csrfToken, user: body.user };
}
async function call<T = any>(
  client: Client,
  path: string,
  method = 'GET',
  data?: unknown,
  status = method === 'POST' ? 201 : 200,
): Promise<T> {
  const response = await client.api.fetch(`${web}/api${path}`, {
    method,
    headers: { Origin: web, 'x-csrf-token': client.csrf },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), `${method} ${path} must return ${status}`).toBe(status);
  return response.json();
}
const getList = (client: Client, filters: Filters = {}, page = 1) =>
  call<AuditList>(
    client,
    `/admin/audit?${new URLSearchParams({ ...filters, page: String(page), pageSize: '20' })}`,
  );
async function show(page: Page) {
  await page.goto(`${web}/admin/audit`);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('status', { name: '审计匹配数量', exact: true })).toBeVisible();
}
async function apply(page: Page, expected: Filters) {
  const response = listResponse(page, (url) =>
    Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value),
  );
  await panel(page).getByRole('button', { name: '应用审计筛选', exact: true }).click();
  const received = await response;
  expect(received.status()).toBe(200);
  const url = new URL(received.url());
  expect(url.searchParams.get('page')).toBe('1');
  for (const [key, value] of Object.entries(expected)) expect(url.searchParams.get(key)).toBe(value);
  const list = (await received.json()) as AuditList;
  await expect(panel(page).getByRole('status', { name: '审计匹配数量', exact: true })).toContainText(
    `匹配 ${list.total} 条审计记录 · 第 1 页`,
  );
  return list;
}
async function reset(page: Page) {
  const response = listResponse(
    page,
    (url) =>
      !['search', 'action', 'actorId', 'resourceType', 'resourceId', 'requestId', 'from', 'to'].some((key) =>
        url.searchParams.has(key),
      ),
  );
  await panel(page).getByRole('button', { name: '重置审计筛选', exact: true }).click();
  expect((await response).status()).toBe(200);
  for (const label of [
    '综合关键词',
    '操作包含（兼容旧筛选）',
    '操作人 ID',
    '资源类型',
    '资源标识',
    '追踪 ID',
    '开始时间（北京时间）',
    '结束时间（北京时间）',
  ])
    await expect(panel(page).getByLabel(label, { exact: true })).toHaveValue('');
}
async function openExport(page: Page) {
  await panel(page).getByRole('button', { name: '导出审计 CSV', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function closeExport(page: Page) {
  await dialog(page).getByRole('button', { name: '取消导出', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
}

// Independent RFC 4180 parser: commas/newlines inside quoted fields remain in one cell.
function csvRows(bytes: Buffer) {
  expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
  const text = bytes.toString('utf8').slice(1),
    rows: string[][] = [];
  let cells: string[] = [],
    cell = '',
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && character === ',') {
      cells.push(cell);
      cell = '';
    } else if (!quoted && character === '\r' && text[index + 1] === '\n') {
      cells.push(cell);
      rows.push(cells);
      cells = [];
      cell = '';
      index++;
    } else cell += character;
  }
  expect(quoted).toBe(false);
  expect(cell).toBe('');
  expect(cells).toHaveLength(0);
  const [header, ...records] = rows;
  expect(header).toEqual([
    '审计ID',
    '时间(UTC)',
    '操作人ID',
    '操作人名称',
    '操作',
    '资源类型',
    '资源标识',
    '追踪ID',
  ]);
  for (const record of records) expect(record).toHaveLength(8);
  return records;
}
const literalCell = (value: string | null) =>
  value === null ? '' : /^[\t\r\n]|^\s*[=+\-@]/.test(value) ? "'" + value : value;
function verifyCsv(bytes: Buffer, expected: AuditRow[]) {
  const rows = csvRows(bytes);
  expect(rows.map((record) => record[0])).toEqual(expected.map((record) => record.id));
  for (let index = 0; index < expected.length; index++) {
    const item = expected[index];
    expect(rows[index]).toEqual([
      literalCell(item.id),
      new Date(item.createdAt).toISOString(),
      literalCell(item.userId),
      literalCell(item.actorName),
      literalCell(item.action),
      literalCell(item.resourceType),
      literalCell(item.resourceId),
      literalCell(item.requestId),
    ]);
  }
}
async function download(
  page: Page,
  csrf: string,
  filters: Filters,
  expected: AuditRow[],
  matched: number,
  limit = 5000,
): Promise<{ bytes: Buffer; response: Response }> {
  await dialog(page).getByLabel('导出上限', { exact: true }).fill(String(limit));
  const received = exportResponse(page),
    downloadEvent = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: '下载审计 CSV', exact: true }).click();
  const [response, file] = await Promise.all([received, downloadEvent]);
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ ...filters, limit });
  expect(
    response.request().headers()['x-csrf-token'] === csrf,
    'Download uses the current fixture CSRF',
  ).toBe(true);
  expect(file.suggestedFilename()).toBe('audit-records.csv');
  expect(await file.failure()).toBeNull();
  const path = await file.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
  const headers = response.headers();
  expect(headers['content-type']).toMatch(/^text\/csv;\s*charset=utf-8$/i);
  expect(headers['content-length']).toBe(String(bytes.length));
  expect(headers['content-disposition']).toContain('attachment; filename="audit-records.csv"');
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['x-export-matched-count']).toBe(String(matched));
  expect(headers['x-export-record-count']).toBe(String(expected.length));
  expect(headers['x-export-truncated']).toBe(String(expected.length < matched));
  verifyCsv(bytes, expected);
  await expect(page.getByRole('status', { name: '审计导出结果', exact: true })).toContainText(
    `已导出 ${expected.length} / ${matched} 条匹配记录`,
  );
  if (expected.length < matched) await expect(dialog(page)).toContainText(`仅包含最新 ${expected.length} 条`);
  return { bytes, response };
}

test('机构审计真实组合筛选、跨页UTF8 CSV、历史身份隔离与撤权无下载', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const db = new PrismaClient(),
    suffix = randomBytes(8).toString('hex');
  const password = `Audit-${randomBytes(24).toString('base64url')}!`,
    prefix = `audit.live.${suffix}`;
  const ownedOrganizations: string[] = [],
    ownedUsers: string[] = [];
  const requests: string[] = [],
    errors: string[] = [],
    downloads: string[] = [];
  const managers: APIRequestContext[] = [];
  let foreignContext: BrowserContext | undefined;
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  page.on('request', (received) => requests.push(new URL(received.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (
      entry.type() === 'error' &&
      /content security policy|violat.*policy|refused to (?:load|execute|create)/i.test(entry.text())
    )
      errors.push(entry.text());
  });
  try {
    const roles = await db.rolePermission.findMany({
      where: { roleId: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      include: { permission: true },
    });
    // Read the actual current template. No global Role/RolePermission/Permission is changed.
    for (const [roleId, permissionId] of [
      ['ADMIN', 'audit.read'],
      ['ADMIN', 'data.export'],
      ['SUPER_ADMIN', 'grants.manage'],
    ])
      expect(
        roles.some((entry) => entry.roleId === roleId && entry.permissionId === permissionId),
        'Review role must currently support the exercised permission',
      ).toBe(true);
    const organizationA = await db.organization.create({ data: { name: `审计真实验收甲-${suffix}` } });
    ownedOrganizations.push(organizationA.id);
    const organizationB = await db.organization.create({ data: { name: `审计真实验收乙-${suffix}` } });
    ownedOrganizations.push(organizationB.id);
    const passwordHash = await hashPasswordAsync(password);
    let sequence = 0;
    async function makeUser(name: string, roleId: string, organizationId = organizationA.id) {
      const user = await db.user.create({
        data: {
          organizationId,
          name,
          username: `audit_live_${suffix}_${++sequence}`,
          passwordHash,
          roles: { create: { roleId } },
        },
      });
      ownedUsers.push(user.id);
      return user;
    }
    const [managerA, managerB, adminA, adminB, retainedHistorical, moved, disabled] = await Promise.all([
      makeUser('独立授权甲经理', 'SUPER_ADMIN'),
      makeUser('独立授权乙经理', 'SUPER_ADMIN', organizationB.id),
      makeUser('甲审计管理员', 'ADMIN'),
      makeUser('乙审计管理员', 'ADMIN', organizationB.id),
      makeUser('保留历史甲成员', 'STUDENT'),
      makeUser('转出甲成员', 'STUDENT'),
      makeUser('停用成员,中文😀\n含"引号"', 'STUDENT'),
    ]);
    const anchor = new Date('2026-10-09T08:00:00Z');
    const target = {
      userId: adminA.id,
      action: `${prefix}.updated`,
      resourceType: 'Course',
      resourceId: 'target-record',
      requestId: 'trace-target',
    };
    const rows = [
      { id: `audit-live-${suffix}-target`, ...target, createdAt: anchor },
      { id: `audit-live-${suffix}-before`, ...target, createdAt: new Date(anchor.getTime() - 1) },
      { id: `audit-live-${suffix}-after`, ...target, createdAt: new Date(anchor.getTime() + 1) },
      {
        id: `audit-live-${suffix}-historical`,
        userId: retainedHistorical.id,
        action: `${prefix}.legacy`,
        resourceType: 'RetiredResource',
        resourceId: 'historical-record',
        requestId: 'legacy:non-uuid',
        createdAt: new Date('2019-01-01T00:00:00Z'),
      },
      {
        id: `audit-live-${suffix}-moved`,
        userId: moved.id,
        action: `${prefix}.transfer`,
        resourceType: 'User',
        resourceId: 'moved-history',
        requestId: 'trace-moved',
        createdAt: new Date('2026-10-08T00:00:00Z'),
      },
      {
        id: `audit-live-${suffix}-disabled`,
        userId: disabled.id,
        action: `${prefix}.actor`,
        resourceType: 'User',
        resourceId: 'disabled-history',
        requestId: 'trace-disabled',
        createdAt: new Date('2026-10-07T00:00:00Z'),
      },
      {
        id: `audit-live-${suffix}-system`,
        userId: null,
        action: `${prefix}.system`,
        resourceType: 'BackgroundJob',
        resourceId: 'system-history',
        requestId: null,
        createdAt: new Date('2026-10-06T00:00:00Z'),
      },
      ...[
        '=SUM(1,2)',
        ' +SUM(A1)',
        '\t-2',
        '\r\n@literal',
        '\ufeff=HYPERLINK("https://invalid.example")',
      ].map((resourceId, index) => ({
        id: `audit-live-${suffix}-formula-${index}`,
        userId: adminA.id,
        action: `${prefix}.literal`,
        resourceType: 'History',
        resourceId,
        requestId: '中文😀,逗号\n含"双引号"',
        createdAt: new Date(new Date('2026-10-05T00:00:00Z').getTime() + index),
      })),
      ...Array.from({ length: 14 }, (_, index) => ({
        id: `audit-live-${suffix}-page-${String(index).padStart(2, '0')}`,
        userId: adminA.id,
        action: `${prefix}.page`,
        resourceType: 'History',
        resourceId: `分页记录-${index}`,
        requestId: `trace-page-${index}`,
        createdAt: new Date(new Date('2026-10-04T00:00:00Z').getTime() + index * 1000),
      })),
    ];
    await db.auditLog.createMany({
      data: rows.map((item) => ({
        organizationId: organizationA.id,
        ...item,
        details: { marker: `DETAILS_MUST_NOT_EXPORT_${suffix}` },
      })),
    });
    const foreignId = `audit-live-${suffix}-foreign-target`;
    await db.auditLog.create({
      data: {
        id: foreignId,
        organizationId: organizationB.id,
        ...target,
        createdAt: anchor,
        details: { marker: `FOREIGN_PRIVATE_${suffix}` },
      },
    });
    const [auditFk] = await db.$queryRaw<{ deleteAction: string; validated: boolean }[]>`
      SELECT confdeltype::text AS "deleteAction", convalidated AS validated FROM pg_constraint
      WHERE conname = 'AuditLog_userId_fkey' AND conrelid = '"AuditLog"'::regclass`;
    expect(auditFk?.deleteAction).toBe('r');
    expect(auditFk.validated).toBe(true);
    await db.userRole.deleteMany({ where: { userId: retainedHistorical.id } });
    const refused = await db.user
      .delete({ where: { id: retainedHistorical.id } })
      .then(() => false, auditUserRestrictError);
    expect(
      refused,
      'The exact AuditLog_userId_fkey RESTRICT constraint must reject deleting this audited User',
    ).toBe(true);
    expect(await db.user.findUnique({ where: { id: retainedHistorical.id } })).not.toBeNull();
    expect(await db.auditLog.count({ where: { userId: retainedHistorical.id } })).toBe(1);
    const foreignHistoricalName = `乙机构历史当前私有姓名_${suffix}`;
    await db.user.update({
      where: { id: retainedHistorical.id },
      data: { organizationId: organizationB.id, name: foreignHistoricalName },
    });
    // Deleting a user with no audit references is permitted; its raw former ID filters to zero.
    const deleted = await makeUser('无审计可删除甲成员', 'STUDENT');
    await db.userRole.deleteMany({ where: { userId: deleted.id } });
    await db.user.delete({ where: { id: deleted.id } });
    const foreignName = `乙机构当前私有姓名_${suffix}`;
    await db.user.update({
      where: { id: moved.id },
      data: { organizationId: organizationB.id, name: foreignName, authVersion: { increment: 1 } },
    });
    await db.user.update({ where: { id: disabled.id }, data: { active: false } });
    const contextA = await request.newContext();
    managers.push(contextA);
    const contextB = await request.newContext();
    managers.push(contextB);
    const [managerClientA, managerClientB] = await Promise.all([
      login(contextA, managerA.username, password),
      login(contextB, managerB.username, password),
    ]);
    expect(managerClientA.user.role).toBe('SUPER_ADMIN');
    expect(managerClientB.user.role).toBe('SUPER_ADMIN');
    expect(managerClientA.user.permissions).toContain('grants.manage');
    const grant = (manager: Client, userId: string) =>
      call<{ id: string }>(manager, '/admin/grants', 'POST', {
        userId,
        permissionId: 'data.export',
        reason: '自有机构审计真实浏览器验收',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
    const grantA = await grant(managerClientA, adminA.id);
    await grant(managerClientB, adminB.id);
    let current = await login(page.request, adminA.username, password);
    expect(current.user.role).toBe('ADMIN');
    expect(current.user.permissions).toContain('audit.read');
    expect(current.user.permissions).toContain('data.export');
    const names = new Map([
      [adminA.id, adminA.name],
      [disabled.id, disabled.name],
    ]);
    const expected = rows
      .map((item): AuditRow => ({
        ...item,
        organizationId: organizationA.id,
        createdAt: item.createdAt.toISOString(),
        actorName: item.userId === null ? '系统' : (names.get(item.userId) ?? '历史账号'),
      }))
      .sort(
        (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      );
    const fullFilters = { action: prefix };
    const preparedCount = () =>
      db.auditLog.count({
        where: { organizationId: organizationA.id, userId: adminA.id, action: 'admin.audit.export' },
      });

    await test.step('原始action筛选、跨页26条真实记录及草稿未应用时导出旧快照', async () => {
      await show(page);
      await panel(page).getByLabel('操作包含（兼容旧筛选）', { exact: true }).fill(prefix);
      const list = await apply(page, fullFilters);
      expect(list.total).toBe(26);
      expect(list.items).toHaveLength(20);
      for (const item of list.items) await expect(row(page, item.id)).toBeVisible();
      const next = listResponse(page, (url) => url.searchParams.get('page') === '2');
      await panel(page).locator('.ant-pagination').getByTitle('2', { exact: true }).click();
      expect((await next).status()).toBe(200);
      await expect(panel(page).getByRole('status', { name: '审计匹配数量', exact: true })).toContainText(
        '第 2 页',
      );
      await expect(row(page, `audit-live-${suffix}-historical`)).toContainText('历史账号');
      await expect(row(page, `audit-live-${suffix}-historical`)).toContainText('2019');
      await panel(page).getByLabel('综合关键词', { exact: true }).fill('尚未应用的搜索草稿');
      await openExport(page);
      await expect(dialog(page).getByRole('list', { name: '导出筛选快照', exact: true })).not.toContainText(
        '尚未应用的搜索草稿',
      );
      const output = await download(page, current.csrf, fullFilters, expected, expected.length);
      expect(output.bytes.toString('utf8')).not.toContain(`DETAILS_MUST_NOT_EXPORT_${suffix}`);
      expect(output.bytes.toString('utf8')).not.toContain(foreignName);
      expect(output.bytes.toString('utf8')).not.toContain(foreignHistoricalName);
      expect(output.bytes.toString('utf8')).not.toContain(foreignId);
      await closeExport(page);
    });

    await test.step('组合字段与北京时间精确瞬时边界，浏览器美西时区不改变+08筛选', async () => {
      await reset(page);
      const inputs = {
        综合关键词: 'TARGET-RECORD',
        '操作包含（兼容旧筛选）': `${prefix}.updated`,
        '操作人 ID': adminA.id,
        资源类型: 'Course',
        资源标识: 'target-record',
        '追踪 ID': 'trace-target',
        // Chromium normalizes zero seconds to minute precision in datetime-local.
        '开始时间（北京时间）': '2026-10-09T16:00',
        '结束时间（北京时间）': '2026-10-09T16:00',
      };
      for (const [label, value] of Object.entries(inputs))
        await panel(page).getByLabel(label, { exact: true }).fill(value);
      const filters: Filters = {
        search: 'TARGET-RECORD',
        action: `${prefix}.updated`,
        actorId: adminA.id,
        resourceType: 'Course',
        resourceId: 'target-record',
        requestId: 'trace-target',
        from: '2026-10-09T16:00:00+08:00',
        to: '2026-10-09T16:00:00+08:00',
      };
      const list = await apply(page, filters);
      expect(list.total).toBe(1);
      expect(list.items.map((item) => item.id)).toEqual([`audit-live-${suffix}-target`]);
      await expect(row(page, list.items[0].id)).toContainText('2026');
      await expect(row(page, `audit-live-${suffix}-before`)).toHaveCount(0);
      await expect(row(page, `audit-live-${suffix}-after`)).toHaveCount(0);
      await openExport(page);
      const output = await download(
        page,
        current.csrf,
        filters,
        [expected.find((item) => item.id === list.items[0].id)!],
        1,
      );
      const event = await db.auditLog.findFirstOrThrow({
        where: {
          organizationId: organizationA.id,
          userId: adminA.id,
          action: 'admin.audit.export',
          requestId: output.response.headers()['x-request-id'],
        },
      });
      expect(event.resourceType).toBe('AuditLog');
      expect(event.resourceId).toBe('batch');
      expect(event.details).toEqual({
        format: 'csv',
        deliveryState: 'prepared',
        limit: 5000,
        filters,
        matchedCount: 1,
        count: 1,
        bytes: output.bytes.length,
      });
      expect(csvRows(output.bytes).some((cells) => cells[0] === event.id)).toBe(false);
      await closeExport(page);
    });

    await test.step('历史身份姓名隔离、手机布局及限额截断数量来自实际响应', async () => {
      await reset(page);
      await panel(page).getByLabel('操作包含（兼容旧筛选）', { exact: true }).fill(prefix);
      await apply(page, fullFilters);
      await expect(row(page, `audit-live-${suffix}-moved`)).toContainText('历史账号');
      await expect(row(page, `audit-live-${suffix}-disabled`)).toContainText('停用成员,中文😀');
      await expect(row(page, `audit-live-${suffix}-system`)).toContainText('系统');
      await expect(panel(page)).not.toContainText(foreignName);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
        .toBe(true);
      await openExport(page);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
        .toBe(true);
      await download(page, current.csrf, fullFilters, expected.slice(0, 3), 26, 3);
      await closeExport(page);
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    await test.step('机构乙独立当前会话相同全部字段也只查/下载乙记录', async () => {
      foreignContext = await browser.newContext({
        baseURL: web,
        timezoneId: 'UTC',
        viewport: { width: 1440, height: 1000 },
      });
      const other = await login(foreignContext.request, adminB.username, password);
      expect(other.user.organizationId).toBe(organizationB.id);
      expect(other.user.role).toBe('ADMIN');
      expect(other.user.permissions).toContain('data.export');
      const otherPage = await foreignContext.newPage();
      otherPage.on('pageerror', (error) => errors.push(error.message));
      await show(otherPage);
      const inputs = {
        综合关键词: 'target-record',
        '操作包含（兼容旧筛选）': `${prefix}.updated`,
        '操作人 ID': adminA.id,
        资源类型: 'Course',
        资源标识: 'target-record',
        '追踪 ID': 'trace-target',
      };
      for (const [label, value] of Object.entries(inputs))
        await panel(otherPage).getByLabel(label, { exact: true }).fill(value);
      const filters: Filters = {
        search: 'target-record',
        action: `${prefix}.updated`,
        actorId: adminA.id,
        resourceType: 'Course',
        resourceId: 'target-record',
        requestId: 'trace-target',
      };
      const list = await apply(otherPage, filters);
      expect(list.total).toBe(1);
      expect(list.items[0].id).toBe(foreignId);
      expect(list.items[0].actorName).toBe('历史账号');
      await openExport(otherPage);
      await download(
        otherPage,
        other.csrf,
        filters,
        [
          {
            id: foreignId,
            organizationId: organizationB.id,
            ...target,
            createdAt: anchor.toISOString(),
            actorName: '历史账号',
          },
        ],
        1,
      );
      await closeExport(otherPage);
      const missing = await getList(current, { actorId: deleted.id });
      expect(missing.total).toBe(0);
      expect(missing.items).toEqual([]);
      const direct = await getList(other, { actorId: deleted.id });
      expect(direct.total).toBe(0);
    });

    await test.step('UI有授权快照，独立grant撤销后真实403不生成CSV或准备事件', async () => {
      await openExport(page);
      const beforeDownloads = downloads.length,
        beforeEvents = await preparedCount();
      await call(managerClientA, `/admin/grants/${grantA.id}`, 'DELETE', { reason: '撤销自有验收用户授权' });
      const denied = exportResponse(page);
      await dialog(page).getByRole('button', { name: '下载审计 CSV', exact: true }).click();
      expect((await denied).status()).toBe(403);
      await expect(dialog(page).getByRole('alert')).toContainText('审计导出未完成');
      expect(downloads).toHaveLength(beforeDownloads);
      expect(await preparedCount()).toBe(beforeEvents);
      await closeExport(page);
      await grant(managerClientA, adminA.id);
    });

    await test.step('grant仍有效但当前UserRole撤销，实际401无下载；新会话可恢复', async () => {
      const sessions = await db.session.findMany({ where: { userId: adminA.id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].role).toBe('ADMIN');
      const activeGrant = await db.sensitiveGrant.findUniqueOrThrow({
        where: { userId_permissionId: { userId: adminA.id, permissionId: 'data.export' } },
      });
      expect(activeGrant.expiresAt.valueOf()).toBeGreaterThan(Date.now());
      await openExport(page);
      const beforeDownloads = downloads.length,
        beforeEvents = await preparedCount();
      await db.userRole.delete({ where: { userId_roleId: { userId: adminA.id, roleId: sessions[0].role } } });
      try {
        const denied = exportResponse(page);
        await dialog(page).getByRole('button', { name: '下载审计 CSV', exact: true }).click();
        expect((await denied).status()).toBe(401);
        await expect(page).toHaveURL(/\/login(?:\?|$)/);
        expect(downloads).toHaveLength(beforeDownloads);
        expect(await preparedCount()).toBe(beforeEvents);
      } finally {
        await db.userRole.create({ data: { userId: adminA.id, roleId: sessions[0].role } });
      }
      current = await login(page.request, adminA.username, password);
      await show(page);
      await panel(page).getByLabel('操作包含（兼容旧筛选）', { exact: true }).fill(prefix);
      await apply(page, fullFilters);
    });

    await test.step('grant有效时会话撤销与authVersion变化，旧页面实际401不得下载', async () => {
      await openExport(page);
      const beforeDownloads = downloads.length,
        beforeEvents = await preparedCount();
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: adminA.id }, data: { authVersion: { increment: 1 } } });
        await tx.session.deleteMany({ where: { userId: adminA.id } });
      });
      const denied = exportResponse(page);
      await dialog(page).getByRole('button', { name: '下载审计 CSV', exact: true }).click();
      expect((await denied).status()).toBe(401);
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      expect(downloads).toHaveLength(beforeDownloads);
      expect(await preparedCount()).toBe(beforeEvents);
    });
    expect(errors, 'Live audit page must have no fatal JavaScript/CSP error').toEqual([]);
    expect(
      requests.includes('/api/admin/people'),
      'Audit filters must not require account-management lookup',
    ).toBe(false);
  } finally {
    const cleanupErrors: string[] = [];
    const resources = await Promise.allSettled([
      ...(foreignContext ? [foreignContext.close()] : []),
      ...managers.map((manager) => manager.dispose()),
    ]);
    if (resources.some((result) => result.status === 'rejected'))
      cleanupErrors.push('Owned audit browser/API context cleanup failed');
    try {
      // Every DELETE is bounded to IDs created above. Existing review actors/roles/templates stay intact.
      if (ownedUsers.length || ownedOrganizations.length)
        await db.$transaction(async (tx) => {
          await tx.session.deleteMany({ where: { userId: { in: ownedUsers } } });
          await tx.sensitiveGrant.deleteMany({ where: { organizationId: { in: ownedOrganizations } } });
          await tx.auditLog.deleteMany({ where: { organizationId: { in: ownedOrganizations } } });
          await tx.userRole.deleteMany({ where: { userId: { in: ownedUsers } } });
          await tx.user.deleteMany({ where: { id: { in: ownedUsers } } });
          await tx.organization.deleteMany({ where: { id: { in: ownedOrganizations } } });
        });
    } catch {
      cleanupErrors.push('Owned audit database fixture cleanup failed');
    } finally {
      try {
        await db.$disconnect();
      } catch {
        cleanupErrors.push('Audit fixture database disconnect failed');
      }
    }
    if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '));
  }
});
