// MOCK contracts only: UI query/download/session behavior. They do not prove real
// PostgreSQL organization isolation, grant authorization or CSV server rendering.
import { expect, test, type Download, type Page, type Route } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles', actionTimeout: 15000 });
const csv =
  '\uFEFF"审计ID","时间(UTC)","操作人ID","操作人名称","操作","资源类型","资源标识","追踪ID"\r\n' +
  '"audit-01","2026-10-10T08:00:00.000Z","actor-a","历史账号","user.update","User","中文😀","trace-a"\r\n';
type Call = { path: string; method: string; query: Record<string, string>; body?: any; csrf?: string };
type Gate = { entered: () => void; wait: Promise<void>; done: () => void };
const board = (page: Page) => page.getByRole('region', { name: '机构操作审计', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: '导出机构审计 CSV', exact: true });
const row = (page: Page, id: string) => board(page).getByTestId(`audit-row-${id}`);

async function fixture(
  page: Page,
  options: { permissions?: string[]; loginTarget?: 'same' | 'other'; rows?: number } = {},
) {
  let logged = true,
    account = 'a',
    role = 'ADMIN',
    session = 1;
  let permissions = options.permissions ?? ['audit.read', 'data.export', 'analytics.view'];
  let readStatus = 200,
    exportStatus = 200,
    exportTransportError = false;
  let nextRead: Gate | null = null,
    nextExport: Gate | null = null;
  let metadata = { count: '1', matched: String(options.rows ?? 45), truncated: 'true' };
  let mime = 'text/csv; charset=utf-8',
    exportBody = csv;
  const calls: Call[] = [],
    errors: string[] = [],
    downloads: Download[] = [];
  page.on('pageerror', (failure) => errors.push(failure.message));
  page.on('download', (download) => downloads.push(download));
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    (window as any).__auditExportSignalAborts = 0;
    window.fetch = (input, init) => {
      const target = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (target.endsWith('/api/admin/audit/export') && init?.signal)
        init.signal.addEventListener('abort', () => (window as any).__auditExportSignalAborts++, {
          once: true,
        });
      return nativeFetch(input, init);
    };
    const active = new Set<string>();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = create(object);
      active.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      active.delete(url);
      revoke(url);
    };
    (window as any).__auditActiveUrls = active;
  });
  const user = () => ({
    id: `audit-user-${account}`,
    organizationId: `audit-org-${account}`,
    accountMode: 'ORGANIZATION',
    username: `audit-${account}`,
    name: account === 'a' ? '审计管理员' : '新审计管理员',
    role,
    roles: ['ADMIN', 'SUPER_ADMIN'],
    permissions,
  });
  const token = () => `audit-csrf-${account}-${role}-${session}`;
  const records = () =>
    Array.from({ length: account === 'a' && session === 1 ? (options.rows ?? 45) : 1 }, (_, index) => ({
      id: `audit-${String(index + 1).padStart(2, '0')}`,
      createdAt: '2026-10-10T08:00:00.000Z',
      userId: index === 1 ? null : 'actor-a',
      actorName: index === 1 ? '系统' : '历史账号',
      action: index === 0 ? 'user.update' : 'class.membership',
      resourceType: index === 0 ? 'User' : 'Class',
      resourceId: index === 0 ? 'user-a' : `class-${index}`,
      requestId: index === 0 ? 'trace-a' : `trace-${index}`,
      details: {
        marker: 'DETAILS_NOT_SEARCHABLE',
        session: account === 'a' && session === 1 ? '旧审计快照' : '当前会话审计',
      },
    }));
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    calls.push({
      path,
      method,
      query: Object.fromEntries(url.searchParams),
      body: method === 'GET' ? undefined : request.postDataJSON(),
      csrf: request.headers()['x-csrf-token'],
    });
    if (path === '/api/auth/me')
      return logged
        ? json(route, { user: user(), csrfToken: token() })
        : json(route, { message: '未登录' }, 401);
    if (path === '/api/auth/logout') {
      logged = false;
      return json(route, { ok: true });
    }
    if (path === '/api/auth/login') {
      logged = true;
      session++;
      if (options.loginTarget !== 'same') account = 'b';
      return json(route, { user: user(), csrfToken: token() });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], unreadCount: 0, total: 0 });
    if (path === '/api/dashboard')
      return json(route, { metrics: [], courses: [], tasks: [], activity: [], announcements: [] });
    if (path === '/api/admin/jobs')
      return json(route, {
        items: [
          {
            id: 'job-a',
            organizationId: user().organizationId,
            organizationName: '审计夹具机构',
            kind: 'fixture.sync',
            status: 'SUCCEEDED',
            attempts: 1,
            runAt: '2026-10-10T08:00:00Z',
            createdAt: '2026-10-10T08:00:00Z',
            lastError: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        stateCounts: { all: 1, pending: 0, running: 0, succeeded: 1, failed: 0, other: 0 },
        scope: permissions.includes('org.platform') ? 'platform_institutions' : 'current_organization',
        serverTime: '2026-10-10T08:00:00Z',
        examDeadlineRuns: [],
      });
    if (path === '/api/admin/audit' && method === 'GET') {
      const filters = Object.fromEntries(url.searchParams),
        number = Number(filters.page ?? 1),
        size = Number(filters.pageSize ?? 20);
      const visible = records().filter(
        (item) =>
          (!filters.action || item.action.includes(filters.action)) &&
          (!filters.search ||
            [item.action, item.resourceType, item.resourceId, item.requestId].some((value) =>
              value.toLowerCase().includes(filters.search.toLowerCase()),
            )) &&
          (!filters.actorId || item.userId === filters.actorId) &&
          (!filters.resourceType || item.resourceType === filters.resourceType) &&
          (!filters.resourceId || item.resourceId === filters.resourceId) &&
          (!filters.requestId || item.requestId === filters.requestId) &&
          (!filters.from || new Date(item.createdAt) >= new Date(filters.from)) &&
          (!filters.to || new Date(item.createdAt) <= new Date(filters.to)),
      );
      const data = {
        items: visible.slice((number - 1) * size, number * size),
        total: visible.length,
        page: number,
        pageSize: size,
      };
      const status = readStatus,
        held = nextRead;
      if (held && data.items[0]) data.items[0].resourceId = 'OLD_INFLIGHT_AUDIT_ROW';
      readStatus = 200;
      nextRead = null;
      if (held) {
        held.entered();
        await held.wait;
      }
      try {
        await json(route, status === 200 ? data : { message: '审计测试拒绝或网络故障' }, status);
      } catch {
        /* A guarded read intentionally aborts when its component disappears. */
      } finally {
        held?.done();
      }
      return;
    }
    if (path === '/api/admin/audit/export' && method === 'POST') {
      const status = exportStatus,
        held = nextExport,
        headers = { ...metadata },
        contentType = mime,
        content = exportBody,
        transportError = exportTransportError;
      nextExport = null;
      exportStatus = 200;
      exportTransportError = false;
      if (held) {
        held.entered();
        await held.wait;
      }
      try {
        if (transportError) await route.abort('failed');
        else if (status !== 200)
          await json(route, { message: status === 401 ? '旧会话已过期' : '导出暂时不可用' }, status);
        else
          await route.fulfill({
            status: 200,
            contentType,
            body: Buffer.from(content, 'utf8'),
            headers: {
              'X-Export-Record-Count': headers.count,
              'X-Export-Matched-Count': headers.matched,
              'X-Export-Truncated': headers.truncated,
              'Content-Disposition': 'attachment; filename="audit-records.csv"',
              'Cache-Control': 'no-store',
            },
          });
      } catch {
        /* Cancel/unmount can abort the deferred fixture transport. */
      } finally {
        held?.done();
      }
      return;
    }
    return json(route, { items: [], total: 0 });
  });
  function hold(kind: 'read' | 'export', status = 200) {
    let entered!: () => void, release!: () => void, done!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handled = new Promise<void>((resolve) => {
      done = resolve;
    });
    const gate = { entered, wait, done };
    if (kind === 'read') {
      nextRead = gate;
      readStatus = status;
    } else {
      nextExport = gate;
      exportStatus = status;
    }
    return { started, release, handled };
  }
  return {
    calls,
    errors,
    downloads,
    token,
    holdRead: (status = 200) => hold('read', status),
    holdExport: (status = 200) => hold('export', status),
    failRead(status: number) {
      readStatus = status;
    },
    failExport(status: number) {
      exportStatus = status;
    },
    abortExport() {
      exportTransportError = true;
    },
    metadata(value: typeof metadata) {
      metadata = value;
    },
    content(value: string) {
      exportBody = value;
    },
    mime(value: string) {
      mime = value;
    },
    permissions(value: string[]) {
      permissions = value;
    },
    role(value: string) {
      role = value;
    },
    rotate() {
      session++;
    },
  };
}
async function open(page: Page) {
  await page.goto('/admin/audit');
  await expect(board(page)).toBeVisible();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toBeVisible();
}
async function openExport(page: Page) {
  await board(page).getByRole('button', { name: '导出审计 CSV', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function cancelExport(page: Page) {
  await dialog(page).getByRole('button', { name: '取消导出', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(board(page).getByLabel('综合关键词', { exact: true })).toBeEnabled();
}
async function refreshAuth(page: Page) {
  await page.clock.fastForward(21001);
  const response = page.waitForResponse((reply) => reply.url().endsWith('/api/auth/me'));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await response;
}
async function bytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Browser did not produce a readable download');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function changeAccount(page: Page) {
  await page.getByRole('button', { name: '审计管理员的账号菜单', exact: true }).click();
  await page.getByText('退出登录', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('账号', { exact: true }).fill('audit-fixture');
  await page.getByLabel('密码', { exact: true }).fill('MockOnly-123!');
  await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: '审计日志', exact: true }).click();
  await expect(board(page)).toBeVisible();
}

test('草稿不请求，组合筛选按北京时间双端精确秒应用并重置页码', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await board(page).locator('.ant-pagination-item-2').click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('第 2 页');
  const count = state.calls.filter((call) => call.path === '/api/admin/audit').length;
  const values = {
    综合关键词: 'USER-A',
    '操作包含（兼容旧筛选）': 'user.',
    '操作人 ID': 'actor-a',
    资源类型: 'User',
    资源标识: 'user-a',
    '追踪 ID': 'trace-a',
    // Chromium normalizes zero seconds out of datetime-local's native value.
    // The UI must still convert this value to the explicit :00+08:00 API instant.
    '开始时间（北京时间）': '2026-10-10T16:00',
    '结束时间（北京时间）': '2026-10-10T16:00',
  };
  for (const [label, value] of Object.entries(values))
    await board(page).getByLabel(label, { exact: true }).fill(value);
  expect(state.calls.filter((call) => call.path === '/api/admin/audit')).toHaveLength(count);
  await expect(board(page).getByLabel('已应用的审计筛选')).toContainText('当前机构全部审计');
  await board(page).getByRole('button', { name: '应用审计筛选', exact: true }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText(
    '匹配 1 条审计记录 · 第 1 页',
  );
  const last = state.calls.filter((call) => call.path === '/api/admin/audit').at(-1)!;
  expect(last.query).toEqual({
    search: 'USER-A',
    action: 'user.',
    actorId: 'actor-a',
    resourceType: 'User',
    resourceId: 'user-a',
    requestId: 'trace-a',
    from: '2026-10-10T16:00:00+08:00',
    to: '2026-10-10T16:00:00+08:00',
    page: '1',
    pageSize: '20',
  });
  await expect(row(page, 'audit-01')).toContainText('2026/10/10 16:00:00');
  await expect(row(page, 'audit-01')).toContainText('历史账号');
  await expect(row(page, 'audit-01')).toContainText('actor-a');
  await board(page).getByLabel('开始时间（北京时间）').fill('2026-10-10T16:00:01');
  await board(page).getByLabel('结束时间（北京时间）').fill('2026-10-10T16:00:59');
  await board(page).getByRole('button', { name: '应用审计筛选', exact: true }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 0 条');
  expect(state.calls.filter((call) => call.path === '/api/admin/audit').at(-1)!.query).toMatchObject({
    from: '2026-10-10T16:00:01+08:00',
    to: '2026-10-10T16:00:59+08:00',
  });
  await board(page).getByRole('button', { name: '重置审计筛选', exact: true }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 45 条');
  expect(state.calls.filter((call) => call.path === '/api/admin/audit').at(-1)!.query).toEqual({
    page: '1',
    pageSize: '20',
  });
  expect(state.calls.some((call) => call.path === '/api/admin/people')).toBe(false);
  expect(state.errors).toEqual([]);
});

test('倒置时间拒绝应用并保留已应用结果，空筛选明确显示空状态', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const count = state.calls.filter((call) => call.path === '/api/admin/audit').length;
  await board(page).getByLabel('开始时间（北京时间）').fill('2026-10-11T16:00');
  await board(page).getByLabel('结束时间（北京时间）').fill('2026-10-10T16:00');
  await board(page).getByRole('button', { name: '应用审计筛选' }).click();
  await expect(board(page)).toContainText('结束时间不能早于开始时间');
  expect(state.calls.filter((call) => call.path === '/api/admin/audit')).toHaveLength(count);
  await board(page).getByRole('button', { name: '重置审计筛选' }).click();
  await board(page).getByLabel('综合关键词').fill('DETAILS_NOT_SEARCHABLE');
  await board(page).getByRole('button', { name: '应用审计筛选' }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 0 条');
  await expect(board(page).getByTestId(/^audit-row-/)).toHaveCount(0);
});

test('CSV 真实下载字节和响应计数，导出使用已应用快照而不是草稿或当前页', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await open(page);
  await board(page).getByLabel('操作人 ID').fill('actor-a');
  await board(page).getByRole('button', { name: '应用审计筛选' }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 44 条');
  await board(page).locator('.ant-pagination-item-2').click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('第 2 页');
  await board(page).getByLabel('操作人 ID').fill('unapplied-actor');
  state.metadata({ count: '1', matched: '7', truncated: 'true' });
  await openExport(page);
  await expect(dialog(page).getByLabel('导出筛选快照')).toContainText('操作人 ID：actor-a');
  await dialog(page).getByLabel('导出上限').fill('1');
  const downloading = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: '下载审计 CSV', exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe('audit-records.csv');
  expect(await bytes(file)).toEqual(Buffer.from(csv, 'utf8'));
  expect(state.calls.filter((call) => call.path === '/api/admin/audit/export').at(-1)).toMatchObject({
    method: 'POST',
    body: { actorId: 'actor-a', limit: 1 },
    csrf: state.token(),
  });
  await expect(dialog(page).getByRole('status', { name: '审计导出结果' })).toContainText('已导出 1 / 7 条');
  await expect(dialog(page)).toContainText('仅包含最新 1 条');
  await page.clock.fastForward(1101);
  expect(await page.evaluate(() => (window as any).__auditActiveUrls.size)).toBe(0);
  expect(state.errors).toEqual([]);
});

test('缺少独立导出授权只能查看，不调用账户管理接口；jobs tab 保持独立后台视图', async ({ page }) => {
  const state = await fixture(page, { permissions: ['audit.read'] });
  await page.goto('/admin/audit?tab=jobs');
  await expect(page.getByRole('tab', { name: '后台任务' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('cell', { name: 'fixture.sync' })).toBeVisible();
  expect(state.calls.filter((call) => call.path === '/api/admin/audit')).toHaveLength(0);
  await expect(board(page)).toHaveCount(0);
  await page.getByRole('tab', { name: '操作审计' }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toBeVisible();
  await expect(board(page).getByRole('button', { name: '导出审计 CSV' })).toHaveCount(0);
  await expect(board(page)).toContainText('独立限时导出授权');
  expect(state.calls.some((call) => call.path === '/api/admin/people')).toBe(false);
});

test('忙碌防重复导出，取消中止后可重新打开下载', async ({ page }) => {
  const state = await fixture(page),
    held = state.holdExport();
  await open(page);
  await openExport(page);
  await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
  await held.started;
  await expect(dialog(page).getByRole('button', { name: '下载审计 CSV' })).toBeDisabled();
  expect(state.calls.filter((call) => call.path === '/api/admin/audit/export')).toHaveLength(1);
  await cancelExport(page);
  expect(await page.evaluate(() => (window as any).__auditExportSignalAborts)).toBe(1);
  held.release();
  await held.handled;
  expect(state.downloads).toHaveLength(0);
  await expect(page.getByRole('status', { name: '审计导出结果' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__auditActiveUrls.size)).toBe(0);
  await openExport(page);
  const downloading = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
  await downloading;
  expect(state.calls.filter((call) => call.path === '/api/admin/audit/export')).toHaveLength(2);
});

for (const status of [403, 400])
  test(`GET ${status} 撤回已缓存的筛选/分页快照，离页返回不得复现`, async ({ page }) => {
    const state = await fixture(page);
    await open(page);
    await board(page).getByLabel('资源类型').fill('User');
    await board(page).getByRole('button', { name: '应用审计筛选' }).click();
    await expect(row(page, 'audit-01')).toBeVisible();
    await board(page).getByRole('button', { name: '重置审计筛选' }).click();
    await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 45 条');
    state.failRead(status);
    await board(page).getByRole('button', { name: '刷新审计日志' }).click();
    await expect(board(page)).toContainText(status === 403 ? '无权查看审计日志' : '审计请求被拒绝');
    await expect(board(page).getByTestId(/^audit-row-/)).toHaveCount(0);
    const held = state.holdRead(status);
    await board(page).getByLabel('资源类型').fill('User');
    await board(page).getByRole('button', { name: '应用审计筛选' }).click();
    await held.started;
    await expect(row(page, 'audit-01')).toHaveCount(0);
    await page.getByRole('tab', { name: '后台任务' }).click();
    held.release();
    await held.handled;
    const returnRead = state.holdRead();
    await page.getByRole('tab', { name: '操作审计' }).click();
    await returnRead.started;
    await expect(board(page).getByTestId(/^audit-row-/)).toHaveCount(0);
    returnRead.release();
    await returnRead.handled;
    await expect(row(page, 'audit-01')).toBeVisible();
  });

test('普通 500 保留标明旧快照且禁止导出，恢复后可用', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  state.failRead(500);
  await board(page).getByRole('button', { name: '刷新审计日志' }).click();
  await expect(board(page)).toContainText('正在显示上次加载的审计快照');
  await expect(row(page, 'audit-01')).toBeVisible();
  await expect(board(page).getByRole('button', { name: '导出审计 CSV' })).toBeDisabled();
  await board(page).getByRole('button', { name: '重试加载审计' }).click();
  await expect(board(page).getByRole('button', { name: '导出审计 CSV' })).toBeEnabled();
});

for (const failure of ['403', '500', 'transport', 'metadata', 'mime'] as const)
  test(`导出 ${failure} 不产生文件，保留筛选并允许修复后重试`, async ({ page }) => {
    const state = await fixture(page);
    await open(page);
    await openExport(page);
    if (failure === '403' || failure === '500') state.failExport(Number(failure));
    else if (failure === 'transport') state.abortExport();
    else if (failure === 'metadata') state.metadata({ count: '3', matched: '2', truncated: 'false' });
    else state.mime('application/json');
    await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
    await expect(dialog(page)).toContainText('审计导出未完成');
    expect(state.downloads).toHaveLength(0);
    await expect(dialog(page).getByRole('button', { name: '下载审计 CSV' })).toBeEnabled();
    state.metadata({ count: '1', matched: '45', truncated: 'true' });
    state.mime('text/csv; charset=utf-8');
    const downloading = page.waitForEvent('download');
    await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
    await downloading;
    await expect(dialog(page).getByRole('status', { name: '审计导出结果' })).toContainText(
      '已导出 1 / 45 条',
    );
  });

for (const change of ['grant', 'audit-read', 'role', 'csrf', 'unrelated-permission'] as const)
  test(`响应等待期间 ${change} 变化阻止旧 CSV 下载`, async ({ page }) => {
    await page.clock.install();
    const state = await fixture(page);
    await open(page);
    await openExport(page);
    const held = state.holdExport();
    await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
    await held.started;
    if (change === 'grant') state.permissions(['audit.read', 'analytics.view']);
    else if (change === 'audit-read') state.permissions(['data.export', 'analytics.view']);
    else if (change === 'role') state.role('SUPER_ADMIN');
    else if (change === 'csrf') state.rotate();
    else state.permissions(['audit.read', 'data.export']);
    await refreshAuth(page);
    await expect(dialog(page)).toHaveCount(0);
    held.release();
    await held.handled;
    expect(state.downloads).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).__auditActiveUrls.size)).toBe(0);
    expect(state.errors).toEqual([]);
  });

for (const loginTarget of ['same', 'other'] as const)
  test(`切换 ${loginTarget} 登录后迟到旧 401 不驱逐新会话且不下载`, async ({ page }) => {
    const state = await fixture(page, { loginTarget });
    await open(page);
    await openExport(page);
    const held = state.holdExport(401);
    await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
    await held.started;
    await cancelExport(page);
    expect(await page.evaluate(() => (window as any).__auditExportSignalAborts)).toBe(1);
    await changeAccount(page);
    held.release();
    await held.handled;
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 1 条');
    expect(state.downloads).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });

test('Blob 等待中同账号新 CSRF 阻止迟到文件，已建立 URL 被及时清理', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await open(page);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    (window as any).__releaseAuditBlob = release;
    (window as any).__auditBlobEntered = false;
    (window as any).__auditBlobFinished = false;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]) === '/api/admin/audit/export') {
        const blob = response.blob.bind(response);
        response.blob = async () => {
          (window as any).__auditBlobEntered = true;
          await waiting;
          try {
            return await blob();
          } finally {
            (window as any).__auditBlobFinished = true;
          }
        };
      }
      return response;
    };
  });
  await openExport(page);
  await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__auditBlobEntered)).toBe(true);
  state.rotate();
  await refreshAuth(page);
  await expect(dialog(page)).toHaveCount(0);
  await page.evaluate(() => (window as any).__releaseAuditBlob());
  await expect.poll(() => page.evaluate(() => (window as any).__auditBlobFinished)).toBe(true);
  expect(state.downloads).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__auditActiveUrls.size)).toBe(0);
});

test('手机筛选单列可操作，表格仅在区域内滚动，导出可下载', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await open(page);
  await board(page).getByLabel('资源类型').fill('User');
  await board(page).getByRole('button', { name: '应用审计筛选' }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 1 条');
  const keyword = await board(page).getByLabel('综合关键词').boundingBox();
  const actor = await board(page).getByLabel('操作人 ID').boundingBox();
  expect(keyword && actor && actor.y > keyword.y).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  state.metadata({ count: '1', matched: '1', truncated: 'false' });
  await openExport(page);
  const downloading = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
  expect(await bytes(await downloading)).toEqual(Buffer.from(csv, 'utf8'));
  await expect(dialog(page).getByRole('status', { name: '审计导出结果' })).toContainText('已导出 1 / 1 条');
});

for (const change of ['csrf', 'role', 'permission'] as const)
  test(`读取等待期间 ${change} 变化不缓存旧响应`, async ({ page }) => {
    await page.clock.install();
    const state = await fixture(page);
    await open(page);
    const held = state.holdRead();
    await board(page).getByRole('button', { name: '刷新审计日志' }).click();
    await held.started;
    if (change === 'csrf') state.rotate();
    else if (change === 'role') state.role('SUPER_ADMIN');
    else state.permissions(['audit.read', 'data.export']);
    await refreshAuth(page);
    await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toBeVisible();
    held.release();
    await held.handled;
    await expect(board(page)).not.toContainText('OLD_INFLIGHT_AUDIT_ROW');
    expect(state.errors).toEqual([]);
  });

test('卸载待完成读取后返回不从缓存复现旧响应', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const held = state.holdRead();
  await board(page).getByRole('button', { name: '刷新审计日志' }).click();
  await held.started;
  await page.getByRole('tab', { name: '后台任务' }).click();
  held.release();
  await held.handled;
  await page.getByRole('tab', { name: '操作审计' }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toBeVisible();
  await expect(board(page)).not.toContainText('OLD_INFLIGHT_AUDIT_ROW');
  expect(state.errors).toEqual([]);
});

test('空匹配可下载只有表头的 CSV，零计数不被当作缺少响应头', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await board(page).getByLabel('资源标识').fill('missing-resource');
  await board(page).getByRole('button', { name: '应用审计筛选' }).click();
  await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 0 条');
  state.metadata({ count: '0', matched: '0', truncated: 'false' });
  const header = csv.slice(0, csv.indexOf('\r\n') + 2);
  state.content(header);
  await openExport(page);
  const downloading = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
  expect(await bytes(await downloading)).toEqual(Buffer.from(header, 'utf8'));
  await expect(dialog(page).getByRole('status', { name: '审计导出结果' })).toContainText('已导出 0 / 0 条');
});

test('当前会话导出 401 仅触发一次登录失效，撤回页面且不生成 CSV', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await page.evaluate(() => {
    (window as any).__auditExpiredCount = 0;
    window.addEventListener('auth-expired', () => {
      (window as any).__auditExpiredCount++;
    });
  });
  state.failExport(401);
  await openExport(page);
  await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(board(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__auditExpiredCount)).toBe(1);
  expect(state.downloads).toHaveLength(0);
});

for (const status of [200, 401])
  test(`原生传输忽略 abort 后旧 ${status} 确实到达，仍不下载或驱逐同账号新登录`, async ({ page }) => {
    // Keep the old network request alive deliberately: the test must prove the
    // explicit auth/mounted/generation fence, rather than relying on native abort.
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      (window as any).__auditLateResponses = [];
      (window as any).__auditExpiredCount = 0;
      window.addEventListener('auth-expired', () => {
        (window as any).__auditExpiredCount++;
      });
      window.fetch = async (input, init) => {
        const target =
          typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const exportRequest = target.endsWith('/api/admin/audit/export');
        const response = await nativeFetch(input, exportRequest ? { ...init, signal: undefined } : init);
        if (exportRequest) {
          // Consume a clone inside the fixture so body arrival is observed even
          // when the application correctly declines to read the stale response.
          const body = await response.clone().arrayBuffer();
          (window as any).__auditLateResponses.push({ status: response.status, bytes: body.byteLength });
        }
        return response;
      };
    });
    const state = await fixture(page, { loginTarget: 'same' });
    await open(page);
    const oldCsrf = state.token(),
      held = state.holdExport(status);
    await openExport(page);
    await dialog(page).getByRole('button', { name: '下载审计 CSV' }).click();
    await held.started;
    await page.evaluate(() => window.dispatchEvent(new Event('auth-expired')));
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('账号', { exact: true }).fill('audit-fixture');
    await page.getByLabel('密码', { exact: true }).fill('MockOnly-123!');
    await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: '审计日志', exact: true }).click();
    await expect(board(page).getByRole('status', { name: '审计匹配数量' })).toContainText('匹配 1 条');
    expect(state.token()).not.toBe(oldCsrf);
    const expiryCount = await page.evaluate(() => (window as any).__auditExpiredCount);
    expect(expiryCount).toBe(1);
    held.release();
    await held.handled;
    await expect.poll(() => page.evaluate(() => (window as any).__auditLateResponses.length)).toBe(1);
    const delivered = await page.evaluate(() => (window as any).__auditLateResponses[0]);
    expect(delivered.status).toBe(status);
    expect(delivered.bytes).toBeGreaterThan(0);
    if (status === 200) expect(delivered.bytes).toBe(Buffer.byteLength(csv, 'utf8'));
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(page.getByRole('button', { name: '审计管理员的账号菜单', exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: '审计导出结果' })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__auditExpiredCount)).toBe(expiryCount);
    expect(await page.evaluate(() => (window as any).__auditActiveUrls.size)).toBe(0);
    expect(state.downloads).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
