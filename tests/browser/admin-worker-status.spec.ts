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
    schedulerStatus?: unknown;
    leakScheduler?: boolean;
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
  let metadataSet = 'schedulerStatus' in options,
    metadata = options.schedulerStatus;
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
      ...(isPlatform || options.leakScheduler
        ? {
            schedulerStatus: marker
              ? instanceStatus('scheduled', true, true, '2026-10-09T00:00:00.000Z')
              : metadataSet
                ? metadata
                : instanceStatus(
                    epoch ? 'disabled' : 'scheduled',
                    !epoch,
                    false,
                    epoch ? '2026-10-10T08:01:00.000Z' : '2026-10-10T08:00:30.000Z',
                  ),
          }
        : {}),
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
    scheduler(value: unknown) {
      metadataSet = true;
      metadata = value;
    },
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
async function delivered(page: Page, status: number, from: number) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ status, from }) =>
          (window as any).__jobsArrivals
            .slice(from)
            .some((entry: any) =>
              status === 401
                ? entry.status === 401
                : entry.status === 200 && entry.body.includes('OLD_INFLIGHT_JOB'),
            ),
        { status, from },
      ),
    )
    .toBe(true);
}

const instance = (page: Page) =>
  board(page).getByRole('region', { name: '当前响应 API 实例调度', exact: true });
const common = (page: Page) => instance(page).getByRole('status', { name: '通用任务自动调度', exact: true });
const exam = (page: Page) => instance(page).getByRole('status', { name: '考试截止自动调度', exact: true });
function instanceStatus(
  lifecycle = 'scheduled',
  automaticEnabled = true,
  pollInProgress = false,
  observedAt = '2026-10-10T08:00:30.000Z',
) {
  return {
    scope: 'responding_api_instance',
    observedAt,
    common: { automaticEnabled, lifecycle, pollIntervalMs: 5000, pollInProgress },
    examDeadline: { automaticEnabled, lifecycle, pollIntervalMs: 10000, pollInProgress },
  };
}
async function noOldInstance(page: Page) {
  await oldAbsent(page);
  await expect(board(page)).not.toContainText('08:00:00');
}

for (const state of [
  { lifecycle: 'scheduled', enabled: true, busy: false, label: '已注册自动调度' },
  { lifecycle: 'disabled', enabled: false, busy: false, label: '自动调度关闭' },
  { lifecycle: 'stopped', enabled: true, busy: true, label: '已停止后续调度' },
  { lifecycle: 'not_initialized', enabled: true, busy: false, label: '尚未初始化' },
])
  test('本实例 ' + state.lifecycle + ' 如实显示而不推断任务完成/健康', async ({ page }) => {
    await fixture(page, {
      platform: true,
      schedulerStatus: instanceStatus(state.lifecycle, state.enabled, state.busy),
    });
    await open(page);
    await ready(page);
    await expect(instance(page)).toBeVisible();
    for (const row of [common(page), exam(page)]) {
      await expect(row).toContainText(state.label);
      await expect(row).toContainText(state.enabled ? '开启' : '关闭');
      await expect(row).toContainText(state.busy ? '一次轮询进行中' : '当前没有轮询执行');
    }
    await expect(common(page)).toContainText('5 秒');
    await expect(exam(page)).toContainText('10 秒');
    await expect(instance(page)).toContainText('其他实例可能继续处理共享任务');
    await expect(instance(page)).toContainText('停止后仍可能有在途轮询收尾');
    await expect(instance(page)).toContainText('不能证明任务成功或全平台健康');
    await expect(count(page, 'pending')).toHaveText('107');
    await expect(count(page, 'failed')).toHaveText('107');
    await expect(board(page).getByTestId('jobs-row-job-001')).toContainText('待处理');
  });

test('旧平台响应没有metadata仍能看真jobs，不发明关闭/0', async ({ page }) => {
  await fixture(page, { platform: true, schedulerStatus: undefined });
  await open(page);
  await ready(page);
  await expect(instance(page)).toHaveCount(0);
  await expect(count(page, 'all')).toHaveText('535');
  await expect(board(page).getByTestId(/^jobs-row-/)).toHaveCount(20);
});
for (const role of ['ADMIN', 'TEACHER'])
  test(role + '普通范围即使body误含metadata也绝不展示', async ({ page }) => {
    await fixture(page, { role, leakScheduler: true, schedulerStatus: instanceStatus() });
    await open(page);
    await ready(page);
    await expect(instance(page)).toHaveCount(0);
    await expect(count(page, 'all')).toHaveText('268');
    await expect(board(page).getByRole('status', { name: '任务查询范围' })).toContainText('当前机构');
  });
for (const value of [
  null,
  { ...instanceStatus(), scope: 'cluster' },
  { ...instanceStatus(), common: { ...instanceStatus().common, pollIntervalMs: 10000 } },
  { ...instanceStatus(), observedAt: '<img src=x onerror="window.__schedulerXss=1">' },
  { ...instanceStatus(), common: { ...instanceStatus().common, automaticEnabled: 'false' } },
  { ...instanceStatus(), examDeadline: { ...instanceStatus().examDeadline, lifecycle: 'healthy' } },
])
  test('非法实例metadata安全降级并保留授权jobs ' + JSON.stringify(value), async ({ page }) => {
    await fixture(page, { platform: true, schedulerStatus: value });
    await open(page);
    await ready(page);
    await expect(instance(page)).toContainText('本实例调度状态暂不可用');
    await expect(common(page)).toHaveCount(0);
    await expect(count(page, 'all')).toHaveText('535');
    expect(await page.evaluate(() => (window as any).__schedulerXss)).toBeUndefined();
  });

test('实例观测时间独立于SQL统计，刷新沿用applied而且不改变facets', async ({ page }) => {
  const state = await fixture(page, { platform: true });
  await open(page);
  await ready(page);
  await expect(instance(page).getByRole('status', { name: '调度状态观测时间' })).toContainText('16:00:30');
  await expect(board(page).getByRole('status', { name: '任务状态概览' })).toContainText('16:00:00');
  await apply(page, 'NOTIFICATION', 'PENDING');
  const total = await count(page, 'all').textContent();
  const before = state.readCalls().length;
  await board(page).getByRole('textbox', { name: '任务类型关键词' }).fill('UNAPPLIED');
  state.scheduler(instanceStatus('stopped', true, true, '2026-10-10T08:02:00.000Z'));
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await expect(common(page)).toContainText('已停止后续调度');
  await expect(instance(page).getByRole('status', { name: '调度状态观测时间' })).toContainText('16:02:00');
  expect(state.readCalls().length).toBe(before + 1);
  expect(state.readCalls().at(-1)?.query.action).toBe('NOTIFICATION');
  expect(state.readCalls().at(-1)?.query.status).toBe('PENDING');
  await expect(count(page, 'all')).toHaveText(total!);
  await expect(board(page)).not.toContainText('GLOBAL_RUN_ERROR');
});

test('500保留明确旧授权实例快照，403跨filters/tab撤回，500不复活，同body新200恢复', async ({ page }) => {
  const state = await fixture(page, { platform: true });
  await open(page);
  await ready(page);
  await apply(page, 'NOTIFICATION');
  state.failRead(500);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await expect(board(page)).toContainText('正在显示上次载入');
  await expect(common(page)).toContainText('已注册自动调度');
  state.failRead(403);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await expect(instance(page)).toHaveCount(0);
  await expect(count(page, 'all')).toHaveCount(0);
  state.failRead(500);
  await tabAway(page);
  await tabBack(page);
  await expect(board(page)).toContainText('无权查看后台任务');
  await expect(instance(page)).toHaveCount(0);
  await board(page).getByRole('button', { name: '重试加载后台任务' }).click();
  await expect(common(page)).toContainText('已注册自动调度');
  await expect(count(page, 'all')).toHaveText('535');
});

for (const target of ['same', 'other', 'space'] as const)
  for (const status of [200, 401])
    test('旧实例body实际到达 ' + target + ' 新会话 ' + status + ' 仍被拒', async ({ page }) => {
      const state = await fixture(page, { platform: true, ignoreAbort: true, loginTarget: target });
      await open(page);
      await ready(page);
      const from = await page.evaluate(() => (window as any).__jobsArrivals.length),
        held = state.holdRead(status, true);
      await board(page).getByRole('button', { name: '刷新后台任务' }).click();
      await held.started;
      await loginAgain(page);
      await expect(common(page)).toContainText('自动调度关闭');
      await expect(instance(page).getByRole('status', { name: '调度状态观测时间' })).toContainText(
        '16:01:00',
      );
      const expiry = await page.evaluate(() => (window as any).__jobsExpired);
      held.release();
      await held.handled;
      await delivered(page, status, from);
      await noOldInstance(page);
      await expect(common(page)).toContainText('自动调度关闭');
      expect(await page.evaluate(() => (window as any).__jobsExpired)).toBe(expiry);
    });

for (const change of ['permissions', 'roles'] as const)
  for (const status of [200, 401])
    test('sameCSRF ' + change + ' 在JSON完成前改变拒旧metadata ' + status, async ({ page }) => {
      await page.clock.install();
      const state = await fixture(page, { platform: true, ignoreAbort: true });
      await open(page);
      await ready(page);
      const token = state.token(),
        from = await page.evaluate(() => (window as any).__jobsArrivals.length);
      await page.evaluate(() => ((window as any).__holdJobsJson = true));
      state.failRead(status);
      state.markNext();
      await board(page).getByRole('button', { name: '刷新后台任务' }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__jobsJsonStarted)).toBe(true);
      if (change === 'permissions') state.permissions(['audit.read', 'analytics.view']);
      else state.roles(['ADMIN', 'TEACHER', 'SUPER_ADMIN', 'OTHER_AVAILABLE_ROLE']);
      expect(state.token()).toBe(token);
      await refreshAuth(page);
      await ready(page);
      if (change === 'permissions') await expect(instance(page)).toHaveCount(0);
      else await expect(common(page)).toContainText('自动调度关闭');
      const expiry = await page.evaluate(() => (window as any).__jobsExpired);
      await page.evaluate(() => (window as any).__releaseJobsJson());
      await expect.poll(() => page.evaluate(() => (window as any).__jobsJsonDone)).toBe(true);
      await delivered(page, status, from);
      await noOldInstance(page);
      if (change === 'permissions') await expect(instance(page)).toHaveCount(0);
      else await expect(common(page)).toContainText('自动调度关闭');
      expect(await page.evaluate(() => (window as any).__jobsExpired)).toBe(expiry);
    });

test('sameCSRF平台权限恢复不能从旧scope缓存立刻恢复实例状态', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page, { platform: true, ignoreAbort: true });
  await open(page);
  await ready(page);
  const token = state.token();
  state.permissions(['audit.read', 'analytics.view']);
  await refreshAuth(page);
  await ready(page);
  await expect(instance(page)).toHaveCount(0);
  state.permissions(['audit.read', 'analytics.view', 'org.platform']);
  const held = state.holdRead();
  await refreshAuth(page);
  await held.started;
  expect(state.token()).toBe(token);
  await expect(instance(page)).toHaveCount(0);
  // audit.read still authorizes the user's current-organization jobs. Only
  // platform instance metadata must stay absent until a fresh platform read.
  held.release();
  await held.handled;
  await expect(common(page)).toContainText('自动调度关闭');
});

test('卸载后旧实例200实际到达不能覆盖重新读取的当前实例metadata', async ({ page }) => {
  const state = await fixture(page, { platform: true, ignoreAbort: true });
  await open(page);
  await ready(page);
  const from = await page.evaluate(() => (window as any).__jobsArrivals.length),
    held = state.holdRead(200, true);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await held.started;
  await tabAway(page);
  state.scheduler(instanceStatus('disabled', false, false, '2026-10-10T08:02:00.000Z'));
  await tabBack(page);
  await expect(instance(page).getByRole('status', { name: '调度状态观测时间' })).toContainText('16:02:00');
  held.release();
  await held.handled;
  await delivered(page, 200, from);
  await noOldInstance(page);
  await expect(common(page)).toContainText('自动调度关闭');
});

test('真实AntD角色切换后新实例状态稳定且旧200实际到达被隔离', async ({ page }) => {
  const state = await fixture(page, { platform: true, ignoreAbort: true });
  await open(page);
  await ready(page);
  const from = await page.evaluate(() => (window as any).__jobsArrivals.length),
    held = state.holdRead(200, true);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await held.started;
  const role = page.getByRole('combobox', { name: '切换角色', exact: true });
  await role.focus();
  await role.press('Enter');
  await expect(role).toHaveAttribute('aria-expanded', 'true');
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: /^超级管理员$/ })
    .click();
  await expect(page.getByRole('heading', { name: '平台工作台', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '审计日志', exact: true }).click();
  await page.getByRole('tab', { name: '后台任务', exact: true }).click();
  await ready(page);
  await expect(common(page)).toContainText('自动调度关闭');
  held.release();
  await held.handled;
  await delivered(page, 200, from);
  await noOldInstance(page);
  await expect(common(page)).toContainText('自动调度关闭');
});

test('390px只读实例区域不撑宽页面，不新增请求/轮询/操作按钮', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, {
    platform: true,
    schedulerStatus: {
      ...instanceStatus(),
      hostname: 'HOST_MUST_NOT_RENDER',
      pid: 9999,
      env: { SECRET: 'SECRET_MUST_NOT_RENDER' },
    },
  });
  await open(page);
  await ready(page);
  await expect(instance(page)).toBeVisible();
  await expect(instance(page).getByRole('button')).toHaveCount(0);
  await expect(instance(page)).not.toContainText('HOST_MUST_NOT_RENDER');
  await expect(instance(page)).not.toContainText('SECRET_MUST_NOT_RENDER');
  const calls = state.readCalls().length;
  await page.clock.fastForward(60001);
  expect(state.readCalls().length).toBe(calls);
  expect(state.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('当前401撤回实例区域及计数且只触发一次登录失效', async ({ page }) => {
  const state = await fixture(page, { platform: true });
  await open(page);
  await ready(page);
  await expect(instance(page)).toBeVisible();
  state.failRead(401);
  await board(page).getByRole('button', { name: '刷新后台任务' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('region', { name: '当前响应 API 实例调度', exact: true })).toHaveCount(0);
  await expect(board(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__jobsExpired)).toBe(1);
});
