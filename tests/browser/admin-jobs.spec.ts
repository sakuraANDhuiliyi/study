// MOCK contracts only. Real SQL scope, snapshot totals, fresh session and worker
// behavior require separate HTTP/live fixtures; none is inferred from these routes.
import { expect, test, type Page, type Route } from '@playwright/test';
test.use({ timezoneId: 'America/Los_Angeles', actionTimeout: 15000 });
const stamp = '2026-10-10T08:00:00.000Z';
const board = (page: Page) => page.getByRole('region', { name: '后台任务记录', exact: true });
const count = (page: Page, key: string) => board(page).getByTestId('jobs-count-' + key);
type Call = { path: string; method: string; query: Record<string, string> };
type Gate = { seen: () => void; wait: Promise<void>; done: () => void; marker: boolean };
async function fixture(
  page: Page,
  options: {
    role?: string;
    platform?: boolean;
    permissions?: string[];
    loginTarget?: 'same' | 'other' | 'space';
    initialStatus?: number;
    ignoreAbort?: boolean;
    unsafe?: boolean;
    incomplete?: boolean;
  } = {},
) {
  let logged = true,
    account = 'a',
    space = 'a',
    role = options.role ?? 'ADMIN',
    session = 1,
    epoch = 0;
  let permissions = options.permissions ?? [
    'audit.read',
    'analytics.view',
    ...(options.platform ? ['org.platform'] : []),
  ];
  let roles = ['ADMIN', 'TEACHER', 'SUPER_ADMIN'];
  let readStatus = options.initialStatus ?? 200,
    heldRead: Gate | null = null,
    markerNext = false,
    incomplete = options.incomplete ?? false;
  const calls: Call[] = [],
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ ignoreAbort }) => {
      const nativeFetch = window.fetch.bind(window);
      (window as any).__jobsArrivals = [];
      (window as any).__jobsExpired = 0;
      (window as any).__holdJobsJson = false;
      (window as any).__jobsJsonStarted = false;
      (window as any).__jobsJsonDone = false;
      window.addEventListener('auth-expired', () => (window as any).__jobsExpired++);
      window.fetch = async (input, init) => {
        const target =
          typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const isJobs = new URL(target, location.href).pathname === '/api/admin/jobs';
        const response = await nativeFetch(
          input,
          isJobs && ignoreAbort ? { ...init, signal: undefined } : init,
        );
        if (isJobs && ignoreAbort)
          (window as any).__jobsArrivals.push({
            status: response.status,
            body: await response.clone().text(),
          });
        if (isJobs && (window as any).__holdJobsJson) {
          (window as any).__holdJobsJson = false;
          const parse = response.json.bind(response);
          const wait = new Promise<void>((resolve) => ((window as any).__releaseJobsJson = resolve));
          response.json = async () => {
            (window as any).__jobsJsonStarted = true;
            await wait;
            try {
              return await parse();
            } finally {
              (window as any).__jobsJsonDone = true;
            }
          };
        }
        return response;
      };
    },
    { ignoreAbort: options.ignoreAbort ?? false },
  );
  const token = () => 'jobs-csrf-' + [account, space, role, session].join('-');
  const user = () => ({
    id: 'jobs-user-' + account,
    organizationId: 'jobs-org-' + space,
    accountMode: 'ORGANIZATION',
    role,
    roles,
    permissions,
    username: 'jobs-' + account,
    name: '任务管理员',
  });
  const records = () =>
    Array.from({ length: epoch ? 3 : 535 }, (_, index) => ({
      id: 'job-' + String(index + 1).padStart(3, '0'),
      organizationId: index % 2 ? 'jobs-org-b' : 'jobs-org-a',
      organizationName: index % 2 ? '乙停用机构' : '甲机构',
      kind: ['NOTIFICATION', 'ASSIGNMENT_EXPORT', 'custom_100%\\job', 'legacy.sync'][index % 4],
      status: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'LEGACY_STATE'][index % 5],
      attempts: index % 3,
      runAt: stamp,
      createdAt: stamp,
      lastError: index === 0 ? (epoch ? '当前会话任务' : '甲最近暂时错误') : null,
    }));
  function output(query: URLSearchParams, marker = false) {
    const isPlatform = permissions.includes('org.platform');
    const action = query.get('action') ?? '',
      status = query.get('status') ?? 'ALL';
    const pageNumber = Number(query.get('page') ?? 1),
      pageSize = Number(query.get('pageSize') ?? 20);
    let base = records().filter(
      (item) =>
        (isPlatform || item.organizationId === 'jobs-org-' + space) &&
        item.kind.toLowerCase().includes(action.toLowerCase()),
    );
    if (options.unsafe && !action)
      base = [
        {
          ...records()[0],
          kind: '<img src=x onerror="window.__jobXss=1">',
          status: '<b>UNKNOWN</b>',
          lastError: '<script>window.__jobXss=2</script>' + '很长的错误'.repeat(70),
          organizationName: '很长的机构'.repeat(60),
        },
      ];
    const stateCounts = { all: base.length, pending: 0, running: 0, succeeded: 0, failed: 0, other: 0 };
    for (const item of base) {
      const key =
        ({ PENDING: 'pending', RUNNING: 'running', SUCCEEDED: 'succeeded', FAILED: 'failed' } as const)[
          item.status as 'PENDING'
        ] ?? 'other';
      stateCounts[key]++;
    }
    const matched = base.filter((item) => status === 'ALL' || item.status === status);
    const items = matched.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    if (marker && items.length)
      items[0] = { ...items[0], id: 'OLD_INFLIGHT_JOB', lastError: '迟到旧任务内容' };
    return {
      items,
      total: matched.length,
      page: pageNumber,
      pageSize,
      ...(incomplete ? {} : { stateCounts }),
      scope: isPlatform ? 'platform_institutions' : 'current_organization',
      serverTime: stamp,
      // Distinct independent rows cannot inflate facets or become job details.
      examDeadlineRuns: isPlatform
        ? [
            {
              id: 'GLOBAL_RUN_NOT_A_JOB',
              type: 'exam_deadline',
              status: 'FAILED',
              processed: 99999,
              error: 'GLOBAL_RUN_ERROR',
              startedAt: stamp,
            },
          ]
        : [],
      payload: { marker: 'PAYLOAD_MUST_NOT_RENDER' },
      eventKey: 'EVENTKEY_MUST_NOT_RENDER',
    };
  }
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    calls.push({ path, method, query: Object.fromEntries(url.searchParams) });
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
      epoch++;
      if (options.loginTarget === 'space') space = 'b';
      else if (options.loginTarget !== 'same') {
        account = 'b';
        space = 'b';
      }
      return json(route, { user: user(), csrfToken: token() });
    }
    if (path === '/api/auth/role') {
      role = request.postDataJSON().role;
      session++;
      epoch++;
      return json(route, { user: user(), csrfToken: token() });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], unreadCount: 0, total: 0 });
    if (path === '/api/dashboard')
      return json(route, { metrics: [], courses: [], tasks: [], announcements: [], activity: [] });
    if (path === '/api/admin/jobs') {
      const held = heldRead,
        status = readStatus,
        data = output(url.searchParams, held?.marker || markerNext);
      heldRead = null;
      readStatus = 200;
      markerNext = false;
      if (held) {
        held.seen();
        await held.wait;
      }
      try {
        await json(
          route,
          status === 200 ? data : { message: status === 401 ? '旧会话已失效' : '任务读取失败' },
          status,
        );
      } catch {
        /* Non-ignored native cancellation may end fixture transport. */
      } finally {
        held?.done();
      }
      return;
    }
    if (path === '/api/admin/audit') return json(route, { items: [], total: 0, page: 1, pageSize: 20 });
    return json(route, { items: [], total: 0 });
  });
  return {
    calls,
    errors,
    token,
    readCalls: () => calls.filter((call) => call.path === '/api/admin/jobs'),
    failRead: (status: number) => {
      readStatus = status;
    },
    incomplete: (value: boolean) => {
      incomplete = value;
    },
    markNext: () => {
      markerNext = true;
    },
    holdRead(status = 200, marker = false) {
      let seen!: () => void, release!: () => void, done!: () => void;
      const started = new Promise<void>((resolve) => (seen = resolve)),
        wait = new Promise<void>((resolve) => (release = resolve)),
        handled = new Promise<void>((resolve) => (done = resolve));
      heldRead = { seen, wait, done, marker };
      readStatus = status;
      return { started, release, handled };
    },
    permissions(value: string[]) {
      permissions = value;
      epoch++;
    },
    roles(value: string[]) {
      roles = value;
      epoch++;
    },
    rotate() {
      session++;
      epoch++;
    },
  };
}
async function open(page: Page) {
  await page.goto('/admin/audit?tab=jobs');
  await expect(page.getByRole('heading', { name: '审计与运行记录', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '后台任务', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(board(page)).toBeVisible();
}
async function ready(page: Page) {
  await expect(board(page).getByRole('status', { name: '任务匹配数量' })).toBeVisible();
}
async function apply(page: Page, keyword = '', status = 'ALL') {
  await board(page).getByRole('textbox', { name: '任务类型关键词' }).fill(keyword);
  await board(page).getByRole('combobox', { name: '任务状态' }).selectOption(status);
  const reply = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/admin/jobs' &&
      (url.searchParams.get('action') ?? '') === keyword &&
      url.searchParams.get('status') === status &&
      url.searchParams.get('page') === '1'
    );
  });
  await board(page).getByRole('button', { name: '应用任务筛选' }).click();
  await reply;
  await expect(board(page).getByRole('button', { name: '刷新后台任务' })).toBeEnabled();
}
async function refreshAuth(page: Page) {
  await page.clock.fastForward(21001);
  const response = page.waitForResponse((reply) => reply.url().endsWith('/api/auth/me'));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await response;
}
async function loginAgain(page: Page) {
  await page.getByRole('button', { name: '任务管理员的账号菜单', exact: true }).click();
  await page.getByText('退出登录', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('账号', { exact: true }).fill('jobs-fixture');
  await page.getByLabel('密码', { exact: true }).fill('MockOnly-123!');
  await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
  await page.getByRole('link', { name: '审计日志', exact: true }).click();
  await page.getByRole('tab', { name: '后台任务', exact: true }).click();
  await ready(page);
}
async function tabAway(page: Page) {
  await page.getByRole('tab', { name: '操作审计', exact: true }).click();
  await expect(board(page)).toHaveCount(0);
}
async function tabBack(page: Page) {
  await page.getByRole('tab', { name: '后台任务', exact: true }).click();
  await expect(board(page)).toBeVisible();
}
async function oldAbsent(page: Page) {
  await expect(board(page).getByTestId('jobs-row-OLD_INFLIGHT_JOB')).toHaveCount(0);
  await expect(board(page)).not.toContainText('迟到旧任务内容');
}
async function delivered(page: Page, status: number) {
  await expect
    .poll(() =>
      page.evaluate(
        (value) =>
          (window as any).__jobsArrivals.some((entry: any) =>
            value === 401 ? entry.status === 401 : entry.body.includes('OLD_INFLIGHT_JOB'),
          ),
        status,
      ),
    )
    .toBe(true);
}

test('服务端535全机构facet独立于20条页，机构归属与考试run不混入', async ({ page }) => {
  const state = await fixture(page, { platform: true });
  await open(page);
  await ready(page);
  await expect(count(page, 'all')).toHaveText('535');
  for (const key of ['pending', 'running', 'succeeded', 'failed', 'other'])
    await expect(count(page, key)).toHaveText('107');
  await expect(board(page).getByTestId(/^jobs-row-/)).toHaveCount(20);
  await expect(board(page).getByRole('status', { name: '任务查询范围' })).toContainText('包含停用机构');
  await expect(board(page)).toContainText('乙停用机构');
  await expect(board(page)).toContainText('jobs-org-b');
  await expect(board(page)).not.toContainText('GLOBAL_RUN_NOT_A_JOB');
  await expect(board(page)).not.toContainText('GLOBAL_RUN_ERROR');
  await expect(board(page)).not.toContainText('PAYLOAD_MUST_NOT_RENDER');
  await expect(board(page)).not.toContainText('EVENTKEY_MUST_NOT_RENDER');
  await expect(board(page).getByRole('button', { name: /展开|重试任务|删除|立即运行/ })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
test('草稿类型/状态编辑不请求，应用才发送旧action兼容和status', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await ready(page);
  const previous = state.readCalls().length;
  await board(page).getByRole('textbox', { name: '任务类型关键词' }).fill('notification');
  await board(page).getByRole('combobox', { name: '任务状态' }).selectOption('PENDING');
  expect(state.readCalls()).toHaveLength(previous);
  await expect(board(page).getByLabel('已应用的任务筛选')).toContainText('全部类型');
  const response = page.waitForResponse(
    (reply) =>
      reply.url().includes('/api/admin/jobs?') &&
      new URL(reply.url()).searchParams.get('action') === 'notification',
  );
  await board(page).getByRole('button', { name: '应用任务筛选' }).click();
  await response;
  await expect
    .poll(() => state.readCalls().at(-1)?.query)
    .toEqual({ action: 'notification', status: 'PENDING', page: '1', pageSize: '20' });
  await expect(board(page).getByLabel('已应用的任务筛选')).toContainText('notification');
});
test('页2应用组合筛选回页1，facet不受selectedstatus影响', async ({ page }) => {
  const state = await fixture(page, { platform: true });
  await open(page);
  await ready(page);
  await board(page).getByTitle('2', { exact: true }).click();
  await expect(board(page).getByRole('status', { name: '任务匹配数量' })).toContainText('第 2 页');
  await apply(page, 'NOTIFICATION', 'FAILED');
  await expect
    .poll(() => state.readCalls().at(-1)?.query)
    .toEqual({ action: 'NOTIFICATION', status: 'FAILED', page: '1', pageSize: '20' });
  await expect(count(page, 'all')).toHaveText('134');
  await expect(count(page, 'failed')).toHaveText('27');
  await expect(board(page).getByRole('status', { name: '任务匹配数量' })).toContainText('共 27 项');
});
test('重置页2和草稿到全部状态第1页，刷新保持已应用条件而非草稿', async ({ page }) => {
  const state = await fixture(page, { platform: true });
  await open(page);
  await ready(page);
  await apply(page, 'NOTIFICATION');
  await expect(count(page, 'all')).toHaveText('134');
  await board(page).getByTitle('2', { exact: true }).click();
  await expect(board(page).getByRole('status', { name: '任务匹配数量' })).toContainText('第 2 页');
  await board(page).getByRole('textbox', { name: '任务类型关键词' }).fill('UNAPPLIED');
  const beforeRefresh = state.readCalls().length;
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await expect.poll(() => state.readCalls().length).toBe(beforeRefresh + 1);
  await expect.poll(() => state.readCalls().at(-1)?.query.action).toBe('NOTIFICATION');
  await expect(board(page).getByRole('button', { name: '刷新后台任务' })).toBeEnabled();
  await board(page).getByRole('button', { name: '重置任务筛选' }).click();
  await expect(count(page, 'all')).toHaveText('535');
  await expect
    .poll(() => state.readCalls().at(-1)?.query)
    .toEqual({ status: 'ALL', page: '1', pageSize: '20' });
  await expect(board(page).getByRole('textbox', { name: '任务类型关键词' })).toHaveValue('');
  await expect(board(page).getByRole('combobox', { name: '任务状态' })).toHaveValue('ALL');
});
for (const keyword of ['%', '_', '\\', '  '])
  test('类型字面包含保留关键词 ' + JSON.stringify(keyword), async ({ page }) => {
    const state = await fixture(page, { platform: true });
    await open(page);
    await ready(page);
    await apply(page, keyword);
    await expect.poll(() => state.readCalls().at(-1)?.query.action).toBe(keyword);
    await expect(count(page, 'all')).toHaveText(keyword === '  ' ? '0' : keyword === '_' ? '268' : '134');
    if (keyword !== '  ')
      await expect(
        board(page)
          .getByTestId(/^jobs-row-/)
          .first(),
      ).toContainText(keyword === '_' ? 'ASSIGNMENT_EXPORT' : 'custom_100%\\job');
    if (keyword === '_') {
      const rows = board(page).getByTestId(/^jobs-row-/);
      await expect(rows.filter({ hasText: 'ASSIGNMENT_EXPORT' })).toHaveCount(10);
      await expect(rows.filter({ hasText: 'custom_100%\\job' })).toHaveCount(10);
    }
  });
test('已知状态按精确枚举筛选，未知状态列入other并显示文本', async ({ page }) => {
  await fixture(page, { platform: true });
  await open(page);
  await ready(page);
  await expect(count(page, 'other')).toHaveText('107');
  await expect(board(page).getByTestId('jobs-row-job-005')).toContainText('LEGACY_STATE');
  await apply(page, '', 'SUCCEEDED');
  await expect(board(page).getByRole('status', { name: '任务匹配数量' })).toContainText('共 107 项');
  await expect(count(page, 'other')).toHaveText('107');
  await expect(
    board(page)
      .getByTestId(/^jobs-row-/)
      .first(),
  ).toContainText('已完成');
});
test('成功空结果显示真实0和空态，首读500与缺contract不伪造0', async ({ page }) => {
  const state = await fixture(page, { initialStatus: 500 });
  await open(page);
  await expect(board(page)).toContainText('暂时无法加载后台任务');
  await expect(count(page, 'all')).toHaveCount(0);
  state.incomplete(true);
  await board(page).getByRole('button', { name: '重试加载后台任务' }).click();
  await expect(board(page)).toContainText('后台任务统计响应不完整');
  await expect(count(page, 'all')).toHaveCount(0);
  state.incomplete(false);
  await apply(page, 'NO_SUCH_TYPE');
  await expect(count(page, 'all')).toHaveText('0');
  await expect(board(page)).toContainText('没有符合筛选的后台任务');
});
for (const role of ['TEACHER', 'ADMIN'])
  test(role + '即便有audit.read也只显示当前机构范围', async ({ page }) => {
    await fixture(page, { role });
    await open(page);
    await ready(page);
    await expect(board(page).getByRole('status', { name: '任务查询范围' })).toContainText('当前机构');
    await expect(count(page, 'all')).toHaveText('268');
    await expect(board(page)).not.toContainText('乙停用机构');
    await expect(board(page)).not.toContainText('jobs-org-b');
  });
test('无audit.read不发后台任务读，不展示旧计数或假空态', async ({ page }) => {
  const state = await fixture(page, { permissions: ['analytics.view'] });
  await page.goto('/admin/audit?tab=jobs');
  await expect(board(page)).toHaveCount(0);
  expect(state.readCalls()).toHaveLength(0);
});
test('未知kind/status与最近错误按文本，时间明确北京时间无completedAt假字段', async ({ page }) => {
  await fixture(page, { unsafe: true });
  await open(page);
  await ready(page);
  await expect(board(page)).toContainText('<img src=x onerror=');
  await expect(board(page)).toContainText('<b>UNKNOWN</b>');
  await expect(board(page)).toContainText('<script>window.__jobXss=2</script>');
  await expect(board(page).locator('img, script')).toHaveCount(0);
  await expect(board(page)).toContainText('2026/10/10 16:00:00');
  await expect(board(page)).not.toContainText('完成时间');
  expect(await page.evaluate(() => (window as any).__jobXss)).toBeUndefined();
});
test('首次加载和手动刷新不轮询，刷新busy禁用重复请求', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page),
    held = state.holdRead();
  await open(page);
  await held.started;
  await expect(board(page).getByRole('status', { name: '后台任务加载状态' })).toBeVisible();
  await expect(count(page, 'all')).toHaveCount(0);
  await expect(board(page).getByRole('button', { name: '刷新后台任务' })).toBeDisabled();
  held.release();
  await held.handled;
  await ready(page);
  const before = state.readCalls().length;
  await page.clock.fastForward(60001);
  expect(state.readCalls()).toHaveLength(before);
});
test('普通500保留明确标注的授权快照，retry成功清除提示', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await ready(page);
  state.failRead(500);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await expect(board(page)).toContainText('正在显示上次载入的后台任务');
  await expect(count(page, 'all')).toHaveText('268');
  await board(page).getByRole('button', { name: '重试加载后台任务' }).click();
  await expect(board(page)).not.toContainText('正在显示上次载入的后台任务');
});
test('403撤回所有计数和行，500不复活，同body新200可恢复', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await ready(page);
  state.failRead(403);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await expect(board(page)).toContainText('无权查看后台任务');
  await expect(count(page, 'all')).toHaveCount(0);
  await expect(board(page).getByTestId(/^jobs-row-/)).toHaveCount(0);
  state.failRead(500);
  const failed = page.waitForResponse(
    (reply) => reply.url().includes('/api/admin/jobs?') && reply.status() === 500,
  );
  await board(page).getByRole('button', { name: '重试加载后台任务' }).click();
  await failed;
  await expect(board(page).getByRole('button', { name: '刷新后台任务' })).toBeEnabled();
  await expect(count(page, 'all')).toHaveCount(0);
  await board(page).getByRole('button', { name: '重试加载后台任务' }).click();
  await expect(count(page, 'all')).toHaveText('268');
});
test('403跨过滤页和tab卸载缓存拒绝，返回500不能恢复预加载行', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await ready(page);
  await board(page).getByTitle('2', { exact: true }).click();
  await expect(board(page).getByRole('status', { name: '任务匹配数量' })).toContainText('第 2 页');
  state.failRead(403);
  await apply(page, 'NOTIFICATION');
  await expect(count(page, 'all')).toHaveCount(0);
  await tabAway(page);
  const held = state.holdRead(500);
  await tabBack(page);
  await held.started;
  await expect(count(page, 'all')).toHaveCount(0);
  held.release();
  await held.handled;
  await expect(count(page, 'all')).toHaveCount(0);
  await expect(board(page).getByTestId(/^jobs-row-/)).toHaveCount(0);
  await board(page).getByRole('button', { name: '重试加载后台任务' }).click();
  await expect(count(page, 'all')).toHaveText('268');
});
test('403 generation拒绝此前不同filter晚到200，即使原生abort被忽略', async ({ page }) => {
  const state = await fixture(page, { ignoreAbort: true });
  await open(page);
  await ready(page);
  const held = state.holdRead(200, true);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await held.started;
  state.failRead(403);
  await board(page).getByRole('textbox', { name: '任务类型关键词' }).fill('NOTIFICATION');
  await board(page).getByRole('button', { name: '应用任务筛选' }).click();
  await expect(board(page)).toContainText('无权查看后台任务');
  held.release();
  await held.handled;
  await delivered(page, 200);
  await expect(count(page, 'all')).toHaveCount(0);
  await oldAbsent(page);
  const again = state.holdRead(500);
  await board(page).getByRole('button', { name: '重置任务筛选' }).click();
  await again.started;
  await expect(count(page, 'all')).toHaveCount(0);
  again.release();
  await again.handled;
  await expect(count(page, 'all')).toHaveCount(0);
});
for (const target of ['same', 'other', 'space'] as const)
  for (const status of [200, 401])
    test('忽略transport abort后旧' + status + '确实到达，' + target + '新会话不被污染', async ({ page }) => {
      const state = await fixture(page, { loginTarget: target, ignoreAbort: true });
      await open(page);
      await ready(page);
      const oldToken = state.token(),
        held = state.holdRead(status, true);
      await board(page).getByRole('button', { name: '刷新后台任务' }).click();
      await held.started;
      await loginAgain(page);
      expect(state.token()).not.toBe(oldToken);
      const before = await page.evaluate(() => (window as any).__jobsExpired);
      held.release();
      await held.handled;
      await delivered(page, status);
      await oldAbsent(page);
      await expect(count(page, 'all')).toHaveText(target === 'same' ? '2' : '1');
      expect(await page.evaluate(() => (window as any).__jobsExpired)).toBe(before);
      await expect(page).toHaveURL(/\/admin\/audit$/);
      await expect(page.getByRole('tab', { name: '后台任务', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(board(page)).toBeVisible();
      expect(state.errors).toEqual([]);
    });
for (const change of ['csrf', 'permission', 'roles', 'platform'] as const)
  for (const status of [200, 401])
    test('JSON等待期间同owner ' + change + '变化挡旧' + status + '且当前scope恢复', async ({ page }) => {
      await page.clock.install();
      const state = await fixture(page, { platform: true, ignoreAbort: true });
      await open(page);
      await ready(page);
      state.failRead(status);
      state.markNext();
      await page.evaluate(() => ((window as any).__holdJobsJson = true));
      await board(page).getByRole('button', { name: '刷新后台任务' }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__jobsJsonStarted)).toBe(true);
      const token = state.token();
      if (change === 'csrf') state.rotate();
      else if (change === 'permission') state.permissions(['audit.read', 'org.platform']);
      else if (change === 'roles') state.roles(['ADMIN']);
      else state.permissions(['audit.read', 'analytics.view']);
      await refreshAuth(page);
      await expect(count(page, 'all')).toHaveText(change === 'platform' ? '2' : '3');
      if (change !== 'csrf') expect(state.token()).toBe(token);
      if (change === 'platform')
        await expect(board(page).getByRole('status', { name: '任务查询范围' })).toContainText('当前机构');
      await page.evaluate(() => (window as any).__releaseJobsJson());
      await expect.poll(() => page.evaluate(() => (window as any).__jobsJsonDone)).toBe(true);
      await oldAbsent(page);
      expect(await page.evaluate(() => (window as any).__jobsExpired)).toBe(0);
      await expect(page).toHaveURL(/\/admin\/audit\?tab=jobs$/);
    });
test('同CSRF撤audit权限导航隐藏，恢复相同授权签名仍先等待新body', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await open(page);
  await ready(page);
  const token = state.token();
  state.permissions(['analytics.view']);
  await refreshAuth(page);
  await expect(board(page)).toHaveCount(0);
  const held = state.holdRead();
  state.permissions(['audit.read', 'analytics.view']);
  await refreshAuth(page);
  await held.started;
  await expect(count(page, 'all')).toHaveCount(0);
  expect(state.token()).toBe(token);
  held.release();
  await held.handled;
  await expect(count(page, 'all')).toHaveText('2');
});
test('tab卸载旧200实际到达不覆盖重新读取的当前任务', async ({ page }) => {
  const state = await fixture(page, { ignoreAbort: true });
  await open(page);
  await ready(page);
  const held = state.holdRead(200, true);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await held.started;
  await tabAway(page);
  await tabBack(page);
  await ready(page);
  held.release();
  await held.handled;
  await delivered(page, 200);
  await oldAbsent(page);
  await expect(count(page, 'all')).toHaveText('268');
});
test('真实UI切换超级管理员角色仍按当前授权scope，旧200不能写新列表', async ({ page }) => {
  const state = await fixture(page, { ignoreAbort: true });
  await open(page);
  await ready(page);
  const held = state.holdRead(200, true);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await held.started;
  const roleControl = page.getByRole('combobox', { name: '切换角色', exact: true });
  await roleControl.focus();
  await roleControl.press('Enter');
  await expect(roleControl).toHaveAttribute('aria-expanded', 'true');
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: /^超级管理员$/ })
    .click();
  await expect(page.getByRole('heading', { name: '机构工作台', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '审计日志', exact: true }).click();
  await page.getByRole('tab', { name: '后台任务', exact: true }).click();
  await ready(page);
  await expect(count(page, 'all')).toHaveText('2');
  await expect(board(page).getByRole('status', { name: '任务查询范围' })).toContainText('当前机构');
  held.release();
  await held.handled;
  await delivered(page, 200);
  await oldAbsent(page);
});
test('当前401仅失效一次，私有counts/row不可继续显示', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await ready(page);
  state.failRead(401);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(board(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__jobsExpired)).toBe(1);
});
test('Audit tab保留原面板且不预加载后台任务', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/admin/audit');
  await expect(page.getByRole('region', { name: '机构操作审计', exact: true })).toBeVisible();
  expect(state.readCalls()).toHaveLength(0);
  await page.getByRole('tab', { name: '后台任务', exact: true }).click();
  await ready(page);
  await tabAway(page);
  await expect(page.getByRole('region', { name: '机构操作审计', exact: true })).toBeVisible();
});
test('390px长文本只在列表区域横向滚动，键盘可操作状态和应用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { unsafe: true });
  await open(page);
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const select = board(page).getByRole('combobox', { name: '任务状态' });
  await select.focus();
  await expect(select).toBeFocused();
  await select.selectOption('FAILED');
  await board(page).getByRole('button', { name: '应用任务筛选' }).focus();
  await page.keyboard.press('Enter');
  await expect(count(page, 'all')).toHaveText('1');
  await expect(board(page)).toContainText('没有符合筛选的后台任务');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
