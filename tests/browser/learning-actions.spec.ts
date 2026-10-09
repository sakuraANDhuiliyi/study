// Mock contracts exercise rendering, CAS payloads and session/permission races.
// Actual SQL membership, deadline and snapshot rules belong to HTTP/live checks.
import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles', actionTimeout: 15000 });
const stamp = '2026-12-31T10:15:00.000Z';
type Bucket = 'today' | 'upcoming' | 'overdue';
type Item = {
  id: string;
  type: 'personal' | 'assignment' | 'exam';
  title: string;
  dueAt: string;
  status: string;
  action: string;
  actionLabel: string;
  path: string;
  bucket: Bucket;
  revision?: number;
  reason?: string | null;
  originalDueAt?: string;
  courseId?: string;
  courseTitle?: string;
  startsAt?: string;
  completed?: boolean;
};
const personal = (id: string, title: string, bucket: Bucket = 'today'): Item => ({
  id,
  title,
  bucket,
  type: 'personal',
  revision: 3,
  dueAt:
    bucket === 'today'
      ? '2026-12-31T12:00:00Z'
      : bucket === 'upcoming'
        ? '2027-01-02T09:00:00Z'
        : '2026-12-31T10:00:00Z',
  status: bucket === 'overdue' ? 'overdue' : 'pending',
  action: 'complete_task',
  actionLabel: '标为完成',
  path: '/planner',
  reason: null,
});
const samples = (): Item[] => [
  personal('personal-a', '复习电路参数'),
  {
    id: 'assignment-extension',
    type: 'assignment',
    title: '个人延期数学作业',
    courseId: 'course-a',
    courseTitle: '数学课程',
    bucket: 'today',
    originalDueAt: '2026-12-30T12:00:00Z',
    dueAt: '2026-12-31T13:00:00Z',
    status: 'not_submitted',
    action: 'submit',
    actionLabel: '提交作业',
    path: '/assignments/assignment-extension',
    reason: null,
  },
  {
    id: 'exam-active',
    type: 'exam',
    title: '进行中的数学考试',
    courseId: 'course-a',
    courseTitle: '数学课程',
    bucket: 'today',
    startsAt: '2026-12-31T01:00:00Z',
    dueAt: '2026-12-31T14:00:00Z',
    status: 'in_progress',
    action: 'continue_exam',
    actionLabel: '继续答卷',
    path: '/exam-attempts/actual-attempt',
    reason: null,
  },
  {
    id: 'exam-upcoming',
    type: 'exam',
    title: '明天的物理考试',
    courseId: 'course-b',
    courseTitle: '物理课程',
    bucket: 'upcoming',
    startsAt: '2027-01-01T01:00:00Z',
    dueAt: '2027-01-01T01:00:00Z',
    status: 'upcoming',
    action: 'wait_exam',
    actionLabel: '查看考试',
    path: '/exams/exam-upcoming',
    reason: 'exam_not_started',
  },
  personal('future-personal', '下一轮预习', 'upcoming'),
  personal('past-today', '今天早些时候的待办', 'overdue'),
  {
    id: 'assignment-closed',
    type: 'assignment',
    title: '已关闭作业',
    courseId: 'course-a',
    courseTitle: '数学课程',
    bucket: 'overdue',
    originalDueAt: '2026-12-30T10:00:00Z',
    dueAt: '2026-12-30T10:00:00Z',
    status: 'closed',
    action: 'view',
    actionLabel: '查看作业',
    path: '/assignments/assignment-closed',
    reason: 'deadline_passed',
  },
  {
    id: 'assignment-late',
    type: 'assignment',
    title: '允许补交作业',
    courseId: 'course-a',
    courseTitle: '数学课程',
    bucket: 'overdue',
    originalDueAt: '2026-12-31T10:00:00Z',
    dueAt: '2026-12-31T10:00:00Z',
    status: 'overdue',
    action: 'submit',
    actionLabel: '补交作业',
    path: '/assignments/assignment-late',
    reason: null,
  },
  {
    id: 'assignment-limited',
    type: 'assignment',
    title: '次数耗尽待重交作业',
    courseId: 'course-a',
    courseTitle: '数学课程',
    bucket: 'overdue',
    originalDueAt: '2026-12-31T09:00:00Z',
    dueAt: '2026-12-31T09:00:00Z',
    status: 'returned',
    action: 'view',
    actionLabel: '查看作业',
    path: '/assignments/assignment-limited',
    reason: 'attempt_limit',
  },
];
type Gate = { seen: () => void; done: () => void; wait: Promise<void>; bucket?: Bucket; status?: number };
async function fixture(
  page: Page,
  options: {
    mode?: 'PERSONAL' | 'ORGANIZATION';
    role?: string;
    permissions?: string[];
    items?: Item[];
    counts?: Partial<Record<Bucket, number>>;
    loginTarget?: 'other' | 'space' | 'same';
    failInitial?: boolean;
  } = {},
) {
  let logged = true;
  let account = 'a';
  let space = 'a';
  let session = 1;
  let permissions = options.permissions ?? ['learning.use', 'course.read'];
  let items = options.items ?? samples();
  let nextRead: Gate | null = null;
  let nextWrite: Gate | null = null;
  let readStatus: number | undefined = options.failInitial ? 500 : undefined;
  const calls: {
    method: string;
    path: string;
    account: string;
    bucket?: string | null;
    page?: string | null;
    body?: any;
    csrf?: string;
  }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const user = () => ({
    id: `action-user-${account}`,
    organizationId: `action-space-${space}`,
    accountMode: options.mode ?? 'PERSONAL',
    role: options.role ?? 'STUDENT',
    roles: [options.role ?? 'STUDENT'],
    username: `action-${account}`,
    name: account === 'a' ? '行动清单同学' : '另一位同学',
    permissions,
  });
  const token = () => `actions-csrf-${account}-${space}-${session}`;
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method();
    const requestAccount = account;
    const body = ['GET', 'HEAD'].includes(method) ? undefined : req.postDataJSON();
    calls.push({
      path,
      method,
      account: requestAccount,
      bucket: url.searchParams.get('bucket'),
      page: url.searchParams.get('page'),
      body,
      csrf: req.headers()['x-csrf-token'],
    });
    if (path === '/api/auth/me')
      return logged
        ? json(route, { user: user(), csrfToken: token() })
        : json(route, { message: '当前未登录' }, 401);
    if (path === '/api/auth/logout') {
      logged = false;
      return json(route, { ok: true }, 201);
    }
    if (path === '/api/auth/login') {
      logged = true;
      session++;
      if (options.loginTarget === 'space') space = 'b';
      else if (options.loginTarget !== 'same') {
        account = 'b';
        space = 'b';
      }
      return json(route, { user: user(), csrfToken: token() }, 201);
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], unreadCount: 0, total: 0 });
    if (path === '/api/dashboard')
      return json(route, {
        metrics: [],
        courses: [],
        tasks: [],
        weeklyActivity: [],
        activity: [],
        announcements: [],
      });
    if (path === '/api/academics/catalog') return json(route, { subjects: [], majors: [], modules: [] });
    if (path === '/api/academics/me')
      return json(route, {
        accountMode: 'PERSONAL',
        major: null,
        selectedModuleIds: [],
        revision: 0,
        recommendations: [],
        recentRecords: [],
        stats: { records: 0, completed: 0, modulesPracticed: 0 },
      });
    if (path === '/api/academics/goals') return json(route, { items: [] });
    if (path === '/api/planner/actions') {
      const bucket = (url.searchParams.get('bucket') ?? 'today') as Bucket;
      const page = Number(url.searchParams.get('page') ?? 1),
        pageSize = Number(url.searchParams.get('pageSize') ?? 10);
      const source =
        requestAccount === 'a' && space === 'a' && session === 1
          ? items
          : [personal('new-session', '当前会话个人待办')];
      const visible = source.filter(
        (item) => !item.completed && (item.type === 'personal' || permissions.includes('course.read')),
      );
      const counts = Object.fromEntries(
        ['today', 'upcoming', 'overdue'].map((key) => [
          key,
          options.counts?.[key as Bucket] ?? visible.filter((item) => item.bucket === key).length,
        ]),
      );
      const response = {
        items: visible
          .filter((item) => item.bucket === bucket)
          .slice((page - 1) * pageSize, page * pageSize)
          .map(({ bucket: _bucket, completed: _completed, ...item }) => ({
            ...item,
            overdue: bucket === 'overdue',
            reason: item.reason ?? null,
          })),
        counts,
        total: counts[bucket],
        page,
        pageSize,
        bucket,
        timezone: 'Asia/Shanghai',
        serverTime: stamp,
        range: {
          todayStart: '2026-12-30T16:00:00Z',
          tomorrowStart: '2026-12-31T16:00:00Z',
          upcomingEnd: '2027-01-07T16:00:00Z',
        },
      };
      const status = readStatus ?? 200;
      readStatus = undefined;
      let held: Gate | null = null;
      if (nextRead && (!nextRead.bucket || nextRead.bucket === bucket)) {
        held = nextRead;
        nextRead = null;
        held.seen();
        await held.wait;
      }
      try {
        await json(route, status === 200 ? response : { message: '测试网络故障' }, status);
      } catch {
        // Reading with AbortSignal can deliberately cancel this deferred route.
      } finally {
        held?.done();
      }
      return;
    }
    const task = /^\/api\/planner\/tasks\/([^/]+)$/.exec(path);
    if (task && method === 'PATCH') {
      const item = items.find((item) => item.id === decodeURIComponent(task[1]));
      let status = !item ? 404 : item.revision !== body.revision ? 409 : 200;
      const held = nextWrite;
      nextWrite = null;
      if (held?.status) status = held.status;
      if (status === 200 && item) {
        item.completed = body.completed;
        item.revision!++;
      }
      const response =
        status === 200
          ? { ...item, completedAt: stamp }
          : {
              message:
                status === 409 ? '待办已在其他页面修改' : status === 401 ? '旧会话已过期' : '任务操作失败',
            };
      if (held) {
        held.seen();
        await held.wait;
      }
      try {
        await json(route, response, status);
      } catch {
        // Navigation may cancel the transport after the fixture applied a write.
      } finally {
        held?.done();
      }
      return;
    }
    return json(route, { items: [], total: 0 });
  });
  function gate(kind: 'read' | 'write', bucket?: Bucket, status?: number) {
    let seen!: () => void, release!: () => void, done!: () => void;
    const started = new Promise<void>((resolve) => {
      seen = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handled = new Promise<void>((resolve) => {
      done = resolve;
    });
    if (kind === 'read') nextRead = { seen, wait, done, bucket };
    else nextWrite = { seen, wait, done, status };
    return { started, release, handled };
  }
  return {
    calls,
    errors,
    token,
    holdRead: (bucket?: Bucket) => gate('read', bucket),
    holdWrite: (status?: number) => gate('write', undefined, status),
    failRead(status = 500) {
      readStatus = status;
    },
    change() {
      const item = items.find((item) => item.id === 'personal-a')!;
      item.title = '另一窗口更新后的待办';
      item.revision!++;
    },
    remove() {
      items = items.filter((item) => item.id !== 'personal-a');
    },
    setPermissions(value: string[]) {
      permissions = value;
    },
    rotateSession() {
      session++;
    },
  };
}
const board = (page: Page) => page.getByRole('region', { name: '我的学习行动清单', exact: true });
const card = (page: Page, type: string, id: string) =>
  board(page).getByTestId(`learning-action-${type}-${id}`);
async function open(page: Page) {
  await page.goto('/');
  await expect(board(page)).toBeVisible();
  await expect(board(page).getByRole('status', { name: '学习行动加载状态' })).toHaveCount(0);
}
async function changeAccount(page: Page) {
  await page.getByRole('button', { name: '行动清单同学的账号菜单', exact: true }).click();
  await page.getByText('退出登录', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('账号', { exact: true }).fill('fixture-account');
  await page.getByLabel('密码', { exact: true }).fill('ContractOnly-123!');
  await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
  await expect(board(page)).toBeVisible();
  await expect(card(page, 'personal', 'new-session')).toContainText('当前会话个人待办');
}
async function refreshAuth(page: Page) {
  await page.clock.fastForward(21001);
  const fresh = page.waitForResponse((response) => response.url().endsWith('/api/auth/me'));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await fresh;
}

for (const mode of ['PERSONAL', 'ORGANIZATION'] as const) {
  test(`${mode} 学生首页展示真实聚合计数、延期和答卷入口`, async ({ page }) => {
    const state = await fixture(page, { mode });
    await open(page);
    await expect(board(page).getByRole('tab', { name: /^今日 3$/ })).toHaveAttribute('aria-selected', 'true');
    await expect(board(page).getByRole('tab', { name: /^未来7天 2$/ })).toBeVisible();
    await expect(board(page).getByRole('tab', { name: /^逾期 4$/ })).toBeVisible();
    await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('今日共 3 项');
    const assignment = card(page, 'assignment', 'assignment-extension');
    await expect(assignment).toContainText('当前截止：2026/12/31 21:00');
    await expect(assignment).toContainText('原截止：2026/12/30 20:00');
    await expect(assignment).toContainText('个人延期安排');
    await expect(assignment.getByRole('link', { name: '提交作业' })).toHaveAttribute(
      'href',
      '/assignments/assignment-extension',
    );
    const exam = card(page, 'exam', 'exam-active');
    await expect(exam).toContainText('答卷截止：2026/12/31 22:00');
    await expect(exam.getByRole('link', { name: '继续答卷' })).toHaveAttribute(
      'href',
      '/exam-attempts/actual-attempt',
    );
    await expect(board(page).getByRole('link', { name: /安排个人待办/ })).toHaveAttribute('href', '/planner');
    expect(
      state.calls.filter((call) => call.path === '/api/planner/actions').every((call) => call.page === '1'),
    ).toBe(true);
    expect(state.errors).toEqual([]);
  });
}

test('今日不包含当天已到时项，未来7天从明日开始，状态决定行动文案', async ({ page }) => {
  await fixture(page);
  await open(page);
  await expect(board(page)).toContainText('今天已到时的行动归入逾期');
  await expect(card(page, 'personal', 'past-today')).toHaveCount(0);
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await expect(board(page)).toContainText('2027/01/01 00:00 至 2027/01/08 00:00');
  await expect(board(page)).toContainText('不包含今天');
  const upcoming = card(page, 'exam', 'exam-upcoming');
  await expect(upcoming).toContainText('考试开始：2027/01/01 09:00');
  await expect(upcoming).toContainText('考试尚未开始，可先查看安排');
  await expect(upcoming.getByRole('link', { name: '查看考试' })).toHaveAttribute(
    'href',
    '/exams/exam-upcoming',
  );
  await board(page).getByRole('tab', { name: /^逾期/ }).click();
  await expect(card(page, 'personal', 'past-today')).toBeVisible();
  await expect(card(page, 'assignment', 'assignment-closed')).toContainText('请联系教师处理延期');
  await expect(
    card(page, 'assignment', 'assignment-closed').getByRole('link', { name: '查看作业' }),
  ).toBeVisible();
  await expect(
    card(page, 'assignment', 'assignment-closed').getByRole('link', { name: /提交|补交/ }),
  ).toHaveCount(0);
  await expect(card(page, 'assignment', 'assignment-limited')).toContainText('提交次数已用完');
  await expect(
    card(page, 'assignment', 'assignment-late').getByRole('link', { name: '补交作业' }),
  ).toBeVisible();
});

test('跨日期重复考试按服务器 actionLabel 显示再次考试与进入截止', async ({ page }) => {
  await fixture(page, {
    items: [
      {
        id: 'repeat',
        type: 'exam',
        title: '可再次作答的考试',
        bucket: 'today',
        dueAt: '2026-12-31T15:00:00Z',
        startsAt: '2026-12-30T01:00:00Z',
        status: 'available',
        action: 'start_exam',
        actionLabel: '再次考试',
        path: '/exams/repeat',
      },
    ],
  });
  await open(page);
  await expect(card(page, 'exam', 'repeat')).toContainText('进入截止：2026/12/31 23:00');
  await expect(card(page, 'exam', 'repeat').getByRole('link', { name: '再次考试' })).toHaveAttribute(
    'href',
    '/exams/repeat',
  );
});

test('分页使用服务端总数，切换分桶复位至第一页并且不混入旧页', async ({ page }) => {
  const items = Array.from({ length: 13 }, (_, i) => personal(`page-${i + 1}`, `今日待办 ${i + 1}`));
  const state = await fixture(page, { items: [...items, personal('future-one', '未来专属项', 'upcoming')] });
  await open(page);
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('13 项');
  await board(page).getByTitle('2', { exact: true }).click();
  await expect(card(page, 'personal', 'page-11')).toBeVisible();
  await expect(card(page, 'personal', 'page-1')).toHaveCount(0);
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('第 2 页');
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await expect(card(page, 'personal', 'future-one')).toBeVisible();
  expect(state.calls.filter((call) => call.path === '/api/planner/actions').at(-1)).toMatchObject({
    bucket: 'upcoming',
    page: '1',
  });
  await board(page).getByRole('tab', { name: /^今日/ }).click();
  await expect(card(page, 'personal', 'page-1')).toBeVisible();
});

test('计数直接读取服务端聚合元数据，不用本页行数替代', async ({ page }) => {
  await fixture(page, { items: [personal('one', '当前页的一项')], counts: { today: 43 } });
  await open(page);
  await expect(board(page).getByRole('tab', { name: /^今日 43$/ })).toBeVisible();
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('43 项');
  await expect(board(page).getByRole('list', { name: '今日学习行动' }).getByRole('listitem')).toHaveCount(1);
});

test('慢分桶响应在切换后不会覆盖当前页或计数', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const held = state.holdRead('upcoming');
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await held.started;
  await expect(board(page).getByRole('status', { name: '学习行动加载状态' })).toBeVisible();
  await board(page).getByRole('tab', { name: /^逾期/ }).click();
  await expect(card(page, 'personal', 'past-today')).toBeVisible();
  held.release();
  await held.handled;
  await expect(board(page).getByRole('tab', { name: /^逾期/ })).toHaveAttribute('aria-selected', 'true');
  await expect(card(page, 'exam', 'exam-upcoming')).toHaveCount(0);
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('逾期共 4 项');
});

test('初始失败可重试，空清单仍能安排个人待办和刷新', async ({ page }) => {
  const state = await fixture(page, { items: [], failInitial: true });
  await page.goto('/');
  await expect(board(page).getByText('暂时无法加载学习行动', { exact: true })).toBeVisible();
  await board(page).getByRole('button', { name: '重试加载学习行动', exact: true }).click();
  await expect(board(page).getByText('今天余下时间没有待处理的学习行动。', { exact: true })).toBeVisible();
  await expect(board(page).getByRole('tab', { name: /^今日 0$/ })).toBeVisible();
  await board(page).getByRole('button', { name: '刷新学习行动清单', exact: true }).click();
  await expect(board(page).getByRole('button', { name: '刷新学习行动清单' })).toBeEnabled();
  expect(state.calls.filter((call) => call.path === '/api/planner/actions').length).toBeGreaterThanOrEqual(3);
  await expect(board(page).getByRole('link', { name: /安排个人待办/ })).toHaveAttribute('href', '/planner');
});

test('后台刷新失败保留清单并停用完成，重试恢复后可操作', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  state.failRead();
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await expect(board(page).getByText('暂时无法刷新，正在显示上次加载的清单', { exact: true })).toBeVisible();
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  await expect(
    card(page, 'personal', 'personal-a').getByRole('button', { name: /^标为完成/ }),
  ).toBeDisabled();
  await board(page).getByRole('button', { name: '重试加载学习行动', exact: true }).click();
  await expect(card(page, 'personal', 'personal-a').getByRole('button', { name: /^标为完成/ })).toBeEnabled();
});

test('课程成员或受众撤销导致刷新403时丢弃全部旧行、计数和课程链接，重新授权成功后恢复', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const csrf = state.token();
  state.failRead(403);
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await expect(board(page).getByText('无权访问学习行动清单，请确认当前权限', { exact: true })).toBeVisible();
  await expect(board(page).getByText('暂时无法刷新，正在显示上次加载的清单', { exact: true })).toHaveCount(0);
  await expect(card(page, 'assignment', 'assignment-extension')).toHaveCount(0);
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toHaveCount(0);
  await expect(board(page).locator('a[href^="/assignments/"], a[href^="/exam-attempts/"]')).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^今日 3$/ })).toHaveCount(0);
  expect(state.token()).toBe(csrf);
  await board(page).getByRole('button', { name: '重试加载学习行动', exact: true }).click();
  await expect(card(page, 'assignment', 'assignment-extension')).toBeVisible();
  await expect(board(page).getByRole('tab', { name: /^今日 3$/ })).toBeVisible();
});

test('个人待办 CAS 完成带 revision 和 CSRF，只提交一次并刷新各分桶计数', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const held = state.holdWrite();
  const button = card(page, 'personal', 'personal-a').getByRole('button', { name: '标为完成 复习电路参数' });
  await button.click();
  await held.started;
  await expect(button).toBeDisabled();
  await expect(board(page).getByRole('tab', { name: /^未来7天/ })).toBeDisabled();
  held.release();
  await held.handled;
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^今日 2$/ })).toBeVisible();
  expect(state.calls.filter((call) => call.method === 'PATCH')).toEqual([
    expect.objectContaining({
      path: '/api/planner/tasks/personal-a',
      body: { revision: 3, completed: true },
      csrf: state.token(),
    }),
  ]);
  await expect(page.getByText('个人待办已完成', { exact: true })).toBeVisible();
});

test('并发完成冲突保留清单并刷新最新版本，用户核对后才能再次完成', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  state.change();
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await expect(board(page)).toContainText('待办已在其他页面修改，已刷新清单');
  await expect(card(page, 'personal', 'personal-a')).toContainText('另一窗口更新后的待办');
  expect(state.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  expect(state.calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({
    revision: 4,
    completed: true,
  });
});

test('末页完成后自动回到仍有效的上一页', async ({ page }) => {
  const state = await fixture(page, {
    items: Array.from({ length: 11 }, (_, i) =>
      personal(i === 10 ? 'personal-a' : `task-${i}`, `分页任务 ${i + 1}`),
    ),
  });
  await open(page);
  await board(page).getByTitle('2', { exact: true }).click();
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await expect(card(page, 'personal', 'task-0')).toBeVisible();
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('第 1 页');
  expect(state.calls.filter((call) => call.path === '/api/planner/actions').at(-1)?.page).toBe('1');
});

test('404 完成不自动重试；服务器刷新删除项且显示删除说明', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  state.remove();
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await expect(board(page)).toContainText('待办已删除或不再可访问，已刷新清单');
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  expect(state.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
});

for (const target of ['other', 'space', 'same'] as const) {
  test(`旧 GET 在 ${target} 新登录后不进入当前清单或计数`, async ({ page }) => {
    const state = await fixture(page, { loginTarget: target });
    await open(page);
    const held = state.holdRead();
    await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
    await held.started;
    await changeAccount(page);
    held.release();
    await held.handled;
    await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
    await expect(card(page, 'assignment', 'assignment-extension')).toHaveCount(0);
    await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
    expect(state.errors).toEqual([]);
  });
  test(`旧完成响应在 ${target} 新登录后不发送成功提示或修改新清单`, async ({ page }) => {
    const state = await fixture(page, { loginTarget: target });
    await open(page);
    const held = state.holdWrite();
    await card(page, 'personal', 'personal-a')
      .getByRole('button', { name: /^标为完成/ })
      .click();
    await held.started;
    await changeAccount(page);
    held.release();
    await held.handled;
    await expect(card(page, 'personal', 'new-session')).toBeVisible();
    await expect(page.getByText('个人待办已完成', { exact: true })).toHaveCount(0);
    await expect(board(page)).not.toContainText('另一窗口');
    await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
    expect(state.errors).toEqual([]);
  });
}

test('同一账号重新登录后旧401不会使新会话过期', async ({ page }) => {
  const state = await fixture(page, { loginTarget: 'same' });
  await open(page);
  const held = state.holdWrite(401);
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await held.started;
  await changeAccount(page);
  held.release();
  await held.handled;
  await expect(board(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page, 'personal', 'new-session')).toBeVisible();
});

test('卸载后的完成结果不发提示，重进页面读取新状态', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const held = state.holdWrite();
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await held.started;
  await page.getByRole('link', { name: '学习记录与笔记', exact: true }).click();
  await expect(board(page)).toHaveCount(0);
  held.release();
  await held.handled;
  await expect(page.getByText('个人待办已完成', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '学习工作台', exact: true }).click();
  await expect(board(page)).toBeVisible();
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('卸载后的慢 GET 不覆盖重新进入页面读到的最新待办', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const held = state.holdRead();
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await held.started;
  await page.getByRole('link', { name: '学习记录与笔记', exact: true }).click();
  await expect(board(page)).toHaveCount(0);
  state.change();
  await page.getByRole('link', { name: '学习工作台', exact: true }).click();
  await expect(card(page, 'personal', 'personal-a')).toContainText('另一窗口更新后的待办');
  held.release();
  await held.handled;
  await expect(card(page, 'personal', 'personal-a')).toContainText('另一窗口更新后的待办');
  await expect(board(page).getByRole('heading', { name: '复习电路参数', exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('完成网络失败保持当前待办和版本，不自动重写；显式重试成功后移除', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const held = state.holdWrite(500);
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await held.started;
  held.release();
  await held.handled;
  await expect(board(page)).toContainText('任务操作失败');
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  await expect(card(page, 'personal', 'personal-a').getByRole('button', { name: /^标为完成/ })).toBeEnabled();
  expect(state.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  expect(state.calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({
    revision: 3,
    completed: true,
  });
});

test('旧完成冲突在同账号新会话中不呈现警告或主动刷新当前行', async ({ page }) => {
  const state = await fixture(page, { loginTarget: 'same' });
  await open(page);
  const held = state.holdWrite(409);
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await held.started;
  await changeAccount(page);
  const before = state.calls.filter((call) => call.path === '/api/planner/actions').length;
  held.release();
  await held.handled;
  await expect(card(page, 'personal', 'new-session')).toBeVisible();
  await expect(board(page)).not.toContainText('待办已在其他页面修改');
  expect(state.calls.filter((call) => call.path === '/api/planner/actions')).toHaveLength(before);
});

test('页面未导航时同 owner 新CSRF使旧完成请求失效', async ({ page }) => {
  await page.clock.install({ time: new Date(stamp) });
  const state = await fixture(page, { loginTarget: 'same' });
  await open(page);
  const oldToken = state.token();
  const held = state.holdWrite();
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await held.started;
  state.rotateSession();
  await refreshAuth(page);
  await expect(card(page, 'personal', 'new-session')).toBeVisible();
  held.release();
  await held.handled;
  await expect(page.getByText('个人待办已完成', { exact: true })).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
  expect(state.token()).not.toBe(oldToken);
});

test('页面未导航时同 owner 新CSRF阻止慢读恢复旧课程行和计数', async ({ page }) => {
  await page.clock.install({ time: new Date(stamp) });
  const state = await fixture(page, { loginTarget: 'same' });
  await open(page);
  const held = state.holdRead();
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await held.started;
  state.rotateSession();
  await refreshAuth(page);
  await expect(card(page, 'personal', 'new-session')).toBeVisible();
  held.release();
  await held.handled;
  await expect(card(page, 'assignment', 'assignment-extension')).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
});

test('同 owner/CSRF 撤销 course.read 立即抛弃课程缓存和慢响应，个人待办继续可见', async ({ page }) => {
  await page.clock.install({ time: new Date(stamp) });
  const state = await fixture(page);
  await open(page);
  const csrf = state.token();
  const held = state.holdRead();
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await held.started;
  state.setPermissions(['learning.use']);
  await refreshAuth(page);
  await expect(card(page, 'assignment', 'assignment-extension')).toHaveCount(0);
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  held.release();
  await held.handled;
  await expect(card(page, 'exam', 'exam-active')).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
  expect(state.token()).toBe(csrf);
});

test('同 owner/CSRF 撤销 learning.use 隐藏组件并丢弃迟到完成消息', async ({ page }) => {
  await page.clock.install({ time: new Date(stamp) });
  const state = await fixture(page);
  await open(page);
  const held = state.holdWrite();
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await held.started;
  state.setPermissions(['course.read']);
  await refreshAuth(page);
  await expect(board(page)).toHaveCount(0);
  held.release();
  await held.handled;
  await expect(page.getByText('个人待办已完成', { exact: true })).toHaveCount(0);
});

for (const role of ['TEACHER', 'ADMIN']) {
  test(`${role} 不请求学生行动清单`, async ({ page }) => {
    const state = await fixture(page, { role, mode: 'ORGANIZATION' });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: role === 'TEACHER' ? '教学工作台' : '机构工作台' }),
    ).toBeVisible();
    await expect(board(page)).toHaveCount(0);
    expect(state.calls.filter((call) => call.path === '/api/planner/actions')).toHaveLength(0);
  });
}

test('390px 布局无横向滚动，长标题换行，键盘可切换三个分桶', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, { items: [personal('long', '超长复习标题'.repeat(26)), ...samples()] });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  const today = board(page).getByRole('tab', { name: /^今日/ });
  await today.focus();
  await today.press('ArrowRight');
  const upcoming = board(page).getByRole('tab', { name: /^未来7天/ });
  await expect(upcoming).toBeFocused();
  await expect(upcoming).toHaveAttribute('aria-selected', 'true');
  await upcoming.press('End');
  await expect(board(page).getByRole('tab', { name: /^逾期/ })).toBeFocused();
  await board(page).getByRole('tab', { name: /^逾期/ }).press('Home');
  await expect(today).toBeFocused();
  await expect(card(page, 'personal', 'long').getByRole('button', { name: /^标为完成/ })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('异常课程路径不会生成脚本、跨站或另一类考试入口', async ({ page }) => {
  const entries = samples().filter((item) => item.bucket === 'today');
  entries.find((item) => item.type === 'assignment')!.path = 'javascript:alert(1)';
  entries.find((item) => item.type === 'exam')!.path = '/assignments/wrong-kind';
  await fixture(page, { items: entries });
  await open(page);
  await expect(board(page).locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(card(page, 'assignment', 'assignment-extension').getByRole('link')).toHaveCount(0);
  await expect(card(page, 'exam', 'exam-active').getByRole('link')).toHaveCount(0);
});

test('403 撤销所有已缓存分桶，切换到预加载分桶时必须等待新的成功读取', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await expect(card(page, 'exam', 'exam-upcoming')).toBeVisible();
  await board(page).getByRole('tab', { name: /^今日/ }).click();
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  state.failRead(403);
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await expect(board(page)).toContainText('无权访问学习行动清单');
  const held = state.holdRead('upcoming');
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await held.started;
  await expect(card(page, 'exam', 'exam-upcoming')).toHaveCount(0);
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^未来7天 2$/ })).toHaveCount(0);
  held.release();
  await held.handled;
  await expect(card(page, 'exam', 'exam-upcoming')).toBeVisible();
  await expect(board(page).getByRole('tab', { name: /^未来7天 2$/ })).toBeVisible();
});

test('拒绝前发出的慢成功不能复活旧分桶，后续相同body的新授权响应才可恢复', async ({ page }) => {
  // The server may finish even after cancellation. Ignore transport abort here to
  // prove that the component still checks its captured signal and read generation.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return nativeFetch(input, url.includes('/planner/actions') ? { ...init, signal: undefined } : init);
    };
  });
  const state = await fixture(page);
  await open(page);
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await expect(card(page, 'exam', 'exam-upcoming')).toBeVisible();
  const beforeDenial = state.holdRead('upcoming');
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await beforeDenial.started;
  await board(page).getByRole('tab', { name: /^今日/ }).click();
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  await expect(board(page).getByRole('button', { name: '刷新学习行动清单' })).toBeEnabled();
  state.failRead(403);
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await expect(board(page)).toContainText('无权访问学习行动清单');
  beforeDenial.release();
  await beforeDenial.handled;
  await expect(card(page, 'exam', 'exam-upcoming')).toHaveCount(0);
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toHaveCount(0);
  const fresh = state.holdRead('upcoming');
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await fresh.started;
  await expect(card(page, 'exam', 'exam-upcoming')).toHaveCount(0);
  fresh.release();
  await fresh.handled;
  await expect(card(page, 'exam', 'exam-upcoming')).toBeVisible();
  await expect(board(page).getByRole('tab', { name: /^未来7天 2$/ })).toBeVisible();
});

test('机构学生没有course.read仍可完成个人行动，且不请求legacy dashboard', async ({ page }) => {
  const state = await fixture(page, { mode: 'ORGANIZATION', permissions: ['learning.use'] });
  await open(page);
  await expect(page.getByRole('heading', { name: '学习工作台', exact: true })).toBeVisible();
  await expect(board(page)).toContainText('汇总本人个人待办；当前没有课程查看权限');
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  await expect(card(page, 'assignment', 'assignment-extension')).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
  expect(state.calls.filter((call) => call.path === '/api/dashboard')).toHaveLength(0);
  await card(page, 'personal', 'personal-a')
    .getByRole('button', { name: /^标为完成/ })
    .click();
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^今日 0$/ })).toBeVisible();
});

test('拒绝标记跨卸载保留，回首页的旧缓存分桶慢读或500不得显示旧行，新的同body200才恢复', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await expect(card(page, 'exam', 'exam-upcoming')).toBeVisible();
  await board(page).getByRole('tab', { name: /^今日/ }).click();
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  await expect(board(page).getByRole('button', { name: '刷新学习行动清单' })).toBeEnabled();
  state.failRead(403);
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await expect(board(page)).toContainText('无权访问学习行动清单');
  await page.getByRole('link', { name: '学习记录与笔记', exact: true }).click();
  await expect(board(page)).toHaveCount(0);
  await page.getByRole('link', { name: '学习工作台', exact: true }).click();
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  const held = state.holdRead('upcoming');
  state.failRead(500);
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await held.started;
  await expect(card(page, 'exam', 'exam-upcoming')).toHaveCount(0);
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toHaveCount(0);
  held.release();
  await held.handled;
  await expect(board(page)).toContainText('无权访问学习行动清单');
  await expect(card(page, 'exam', 'exam-upcoming')).toHaveCount(0);
  await expect(board(page).getByRole('tab', { name: /^未来7天 2$/ })).toHaveCount(0);
  await board(page).getByRole('button', { name: '重试加载学习行动', exact: true }).click();
  await expect(card(page, 'exam', 'exam-upcoming')).toBeVisible();
  await expect(board(page).getByRole('tab', { name: /^未来7天 2$/ })).toBeVisible();
});
