// Mock contracts prove student rendering and asynchronous identity fences only.
// Current SQL eligibility, attempt lifecycles and >500 exact totals need HTTP/live fixtures.
import { expect, test, type Page, type Route } from '@playwright/test';
test.use({ timezoneId: 'America/Los_Angeles', actionTimeout: 15000 });
const stamp = '2026-10-10T08:00:00.000Z';
const overview = (page: Page) => page.getByRole('region', { name: '学生学习概览', exact: true });
const actions = (page: Page) => page.getByRole('region', { name: '我的学习行动清单', exact: true });
const metric = (page: Page, label: string) =>
  overview(page).getByRole('link', { name: `查看${label}`, exact: true });
type Gate = { seen: () => void; wait: Promise<void>; done: () => void; marker: boolean };
type Call = { path: string; method: string; csrf?: string; body?: any };

async function fixture(
  page: Page,
  options: {
    role?: string;
    mode?: 'ORGANIZATION' | 'PERSONAL';
    permissions?: string[];
    loginTarget?: 'same' | 'other' | 'space';
    initialStatus?: number;
    ignoreAbort?: boolean;
    metadata?: boolean;
    metricCount?: number;
    actionStatus?: number;
  } = {},
) {
  let logged = true,
    account = 'a',
    space = 'a',
    session = 1,
    epoch = 0;
  let role = options.role ?? 'STUDENT';
  const rolePermissions = (value: string) =>
    value === 'STUDENT'
      ? ['learning.use', 'course.read', 'analysis.read']
      : value === 'TEACHER'
        ? ['course.read', 'course.manage', 'assessment.manage', 'analysis.read']
        : ['course.admin', 'users.manage', 'org.manage', 'audit.read', 'analytics.view', 'settings.org'];
  let permissions = options.permissions ?? rolePermissions(role);
  let roles = ['STUDENT', 'TEACHER', 'ADMIN'];
  let readStatus = options.initialStatus ?? 200,
    actionStatus = options.actionStatus ?? 200;
  let heldRead: Gate | null = null,
    markerNext = false,
    completed = false;
  const calls: Call[] = [],
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ ignoreAbort }) => {
      const nativeFetch = window.fetch.bind(window);
      (window as any).__overviewArrivals = [];
      (window as any).__overviewExpired = 0;
      (window as any).__holdOverviewJson = false;
      (window as any).__overviewJsonStarted = false;
      (window as any).__overviewJsonDone = false;
      window.addEventListener('auth-expired', () => {
        (window as any).__overviewExpired++;
      });
      window.fetch = async (input, init) => {
        const target =
          typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const isOverview = target.endsWith('/api/dashboard');
        const response = await nativeFetch(
          input,
          isOverview && ignoreAbort ? { ...init, signal: undefined } : init,
        );
        if (isOverview && ignoreAbort) {
          const text = await response.clone().text();
          (window as any).__overviewArrivals.push({ status: response.status, body: text });
        }
        if (isOverview && (window as any).__holdOverviewJson) {
          (window as any).__holdOverviewJson = false;
          const parse = response.json.bind(response);
          const wait = new Promise<void>((resolve) => {
            (window as any).__releaseOverviewJson = resolve;
          });
          response.json = async () => {
            (window as any).__overviewJsonStarted = true;
            await wait;
            try {
              return await parse();
            } finally {
              (window as any).__overviewJsonDone = true;
            }
          };
        }
        return response;
      };
    },
    { ignoreAbort: options.ignoreAbort ?? false },
  );
  const token = () => `overview-csrf-${account}-${space}-${role}-${session}`;
  const user = () => ({
    id: `overview-user-${account}`,
    organizationId: `overview-space-${space}`,
    role,
    roles,
    accountMode: options.mode ?? 'ORGANIZATION',
    permissions,
    username: `overview-${account}`,
    name: account === 'a' ? '概览同学' : '新的概览同学',
  });
  const response = (marker = false) => {
    const fresh = epoch > 0;
    const prefix = marker ? '迟到旧' : fresh ? '当前会话' : '甲';
    const labels =
      role === 'STUDENT'
        ? ['在学课程', '当前待交作业', '当前可作答考试', '已完成课时']
        : role === 'TEACHER'
          ? ['授课课程', '待批改作业', '待阅卷答卷', '未读通知']
          : permissions.includes('org.platform')
            ? ['启用机构', '启用账号', '失败任务', '待处理任务']
            : ['启用账号', '行政班级', '课程总数', '待处理举报'];
    return {
      metrics: labels.map((label, index) => ({
        label,
        value:
          role !== 'STUDENT'
            ? 70 + index
            : index === 1
              ? marker
                ? 9001
                : fresh
                  ? 7
                  : (options.metricCount ?? 503)
              : index === 2
                ? fresh
                  ? 1
                  : 2
                : 3,
        detail:
          role !== 'STUDENT'
            ? '原有教学或管理口径'
            : index === 1
              ? '未交或退回且现在可提交，不限7天'
              : index === 2
                ? '现在可进入或继续作答，尚未开始不计入'
                : '按当前授权范围统计',
        path:
          role === 'STUDENT'
            ? ['/courses', '/assignments', '/exams', '/analytics'][index]
            : role === 'TEACHER'
              ? ['/courses', '/assignments', '/exams', '/notifications'][index]
              : permissions.includes('org.platform')
                ? ['/admin/organizations', '/admin/users', '/admin/audit?tab=jobs', '/admin/audit?tab=jobs'][
                    index
                  ]
                : ['/admin/users', '/admin/organization', '/courses', '/admin/moderation'][index],
      })),
      courses: [
        {
          id: `course-${account}`,
          title: `${prefix}课程`,
          category: '数学',
          totalLessons: 9,
          completedLessons: 3,
          progressPercent: 33,
          studentCount: 18,
        },
      ],
      tasks: [
        {
          id: 'teaching-task',
          title: '原有教学任务',
          type: 'assignment',
          dueAt: stamp,
          courseTitle: '课程',
          path: '/assignments/teaching-task',
        },
      ],
      announcements: [
        {
          id: `announcement-${account}`,
          title: `${prefix}公告`,
          content: `<p>${prefix}公告正文</p>`,
          createdAt: stamp,
        },
      ],
      activity: [{ id: 'activity', title: `${prefix}动态`, detail: '已完成课时', createdAt: stamp }],
      weeklyActivity: [],
      ...(role === 'STUDENT' && options.metadata !== false
        ? { learningOverview: { serverTime: stamp, timezone: 'Asia/Shanghai', scope: 'actionable_now' } }
        : {}),
    };
  };
  const sourceActions = () => [
    ...(completed
      ? []
      : [
          {
            id: 'personal',
            type: 'personal',
            title: epoch ? '当前会话待办' : '整理错题笔记',
            revision: 4,
            bucket: 'today',
            dueAt: '2026-10-10T10:00:00Z',
            status: 'pending',
            action: 'complete_task',
            actionLabel: '标为完成',
            path: '/planner',
            reason: null,
          },
        ]),
    ...(permissions.includes('course.read')
      ? [
          {
            id: 'restored',
            type: 'exam',
            title: '恢复资格后的考试',
            bucket: 'today',
            dueAt: '2026-10-10T11:00:00Z',
            startsAt: '2026-10-10T01:00:00Z',
            status: 'available',
            action: 'start_exam',
            actionLabel: '再次考试',
            path: '/exams/restored',
            reason: null,
          },
          {
            id: 'future',
            type: 'exam',
            title: '明天尚未开始的考试',
            bucket: 'upcoming',
            dueAt: '2026-10-11T01:00:00Z',
            startsAt: '2026-10-11T01:00:00Z',
            status: 'upcoming',
            action: 'wait_exam',
            actionLabel: '查看考试',
            path: '/exams/future',
            reason: 'exam_not_started',
          },
          {
            id: 'closed',
            type: 'assignment',
            title: '只能查看的过期作业',
            bucket: 'overdue',
            dueAt: '2026-10-09T10:00:00Z',
            originalDueAt: '2026-10-09T10:00:00Z',
            status: 'closed',
            action: 'view',
            actionLabel: '查看作业',
            path: '/assignments/closed',
            reason: 'deadline_passed',
          },
        ]
      : []),
  ];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    const body = method === 'GET' ? undefined : request.postDataJSON();
    calls.push({ path, method, body, csrf: request.headers()['x-csrf-token'] });
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
      role = body.role;
      permissions = rolePermissions(role);
      session++;
      epoch++;
      return json(route, { user: user(), csrfToken: token() });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/academics/catalog') return json(route, { subjects: [], majors: [], modules: [] });
    if (path === '/api/academics/me')
      return json(route, {
        accountMode: 'PERSONAL',
        major: null,
        selectedModuleIds: [],
        recommendations: [],
        recentRecords: [],
        revision: 0,
        stats: { records: 0, completed: 0, modulesPracticed: 0 },
      });
    if (path === '/api/academics/goals') return json(route, { items: [] });
    if (path === '/api/dashboard') {
      const held = heldRead,
        status = readStatus,
        data = response(held?.marker || markerNext);
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
          status === 200 ? data : { message: status === 401 ? '旧会话已失效' : '概览读取失败' },
          status,
        );
      } catch {
        /* A real AbortSignal may cancel the intentionally deferred route. */
      } finally {
        held?.done();
      }
      return;
    }
    if (path === '/api/planner/actions') {
      const bucket = url.searchParams.get('bucket') ?? 'today',
        items = sourceActions();
      const counts = Object.fromEntries(
        ['today', 'upcoming', 'overdue'].map((key) => [
          key,
          items.filter((item) => item.bucket === key).length,
        ]),
      );
      const status = actionStatus;
      actionStatus = 200;
      return json(
        route,
        status === 200
          ? {
              items: items
                .filter((item) => item.bucket === bucket)
                .map(({ bucket: _bucket, ...item }) => ({ ...item, overdue: bucket === 'overdue' })),
              total: counts[bucket],
              counts,
              bucket,
              page: 1,
              pageSize: 10,
              timezone: 'Asia/Shanghai',
              serverTime: stamp,
              range: {
                todayStart: '2026-10-09T16:00:00Z',
                tomorrowStart: '2026-10-10T16:00:00Z',
                upcomingEnd: '2026-10-17T16:00:00Z',
              },
            }
          : { message: '行动读取失败' },
        status,
      );
    }
    if (path === '/api/planner/tasks/personal' && method === 'PATCH') {
      completed = true;
      return json(route, { revision: 5, completedAt: stamp });
    }
    return json(route, { items: [], total: 0 });
  });
  return {
    calls,
    errors,
    token,
    failRead(status: number) {
      readStatus = status;
    },
    markNextBody() {
      markerNext = true;
    },
    holdRead(status = 200, marker = false) {
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
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '学习工作台', exact: true })).toBeVisible();
  await expect(actions(page)).toBeVisible();
  await expect(actions(page).getByRole('status', { name: '行动匹配数量' })).toBeVisible();
}
async function refreshAuth(page: Page) {
  await page.clock.fastForward(21001);
  const response = page.waitForResponse((reply) => reply.url().endsWith('/api/auth/me'));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await response;
}
async function loginAgain(page: Page) {
  await page.getByRole('button', { name: '概览同学的账号菜单', exact: true }).click();
  await page.getByText('退出登录', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('账号', { exact: true }).fill('overview-fixture');
  await page.getByLabel('密码', { exact: true }).fill('MockOnly-123!');
  await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
  await expect(overview(page)).toBeVisible();
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('7');
}
async function away(page: Page) {
  await page.getByRole('link', { name: '我的笔记', exact: true }).click();
  await expect(overview(page)).toHaveCount(0);
}
async function back(page: Page) {
  await page.getByRole('link', { name: '学习工作台', exact: true }).click();
  await expect(overview(page)).toBeVisible();
}
async function oldAbsent(page: Page) {
  await expect(overview(page)).not.toContainText('迟到旧');
  await expect(metric(page, '当前待交作业').locator('strong')).not.toHaveText('9001');
}

test('概览唯一使用metrics，503不限7天与状态文案不混淆行动分桶', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
  await expect(metric(page, '当前待交作业')).toContainText('未交或退回且现在可提交，不限7天');
  await expect(metric(page, '当前可作答考试')).toContainText('尚未开始不计入');
  await expect(overview(page).getByRole('status', { name: '概览统计时间' })).toContainText(
    '2026/10/10 16:00:00',
  );
  await expect(actions(page).getByRole('tab', { name: /^今日 2$/ })).toBeVisible();
  await expect(actions(page).getByRole('link', { name: '再次考试' })).toHaveAttribute(
    'href',
    '/exams/restored',
  );
  await actions(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await expect(actions(page)).toContainText('明天尚未开始的考试');
  await expect(metric(page, '当前可作答考试').locator('strong')).toHaveText('2');
  await actions(page).getByRole('tab', { name: /^逾期/ }).click();
  await expect(actions(page)).toContainText('只能查看的过期作业');
  await expect(actions(page).getByRole('link', { name: '查看作业' })).toHaveAttribute(
    'href',
    '/assignments/closed',
  );
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
  expect(state.errors).toEqual([]);
});

test('可选metadata缺失仍渲染原metrics，成功零值不替换成未知', async ({ page }) => {
  await fixture(page, { metadata: false, metricCount: 0 });
  await open(page);
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('0');
  await expect(overview(page).getByRole('status', { name: '概览统计时间' })).toHaveCount(0);
});

test('旧概览首次慢读不阻止个人行动CAS请求和完成界面', async ({ page }) => {
  const state = await fixture(page),
    held = state.holdRead();
  await open(page);
  await held.started;
  await expect(overview(page).getByRole('status', { name: '学习概览加载状态' })).toBeVisible();
  await expect(metric(page, '当前待交作业')).toHaveCount(0);
  await actions(page).getByRole('button', { name: '标为完成 整理错题笔记', exact: true }).click();
  await expect(actions(page).getByTestId('learning-action-personal-personal')).toHaveCount(0);
  expect(state.calls.filter((call) => call.method === 'PATCH')).toEqual([
    expect.objectContaining({
      path: '/api/planner/tasks/personal',
      body: { revision: 4, completed: true },
      csrf: state.token(),
    }),
  ]);
  held.release();
  await held.handled;
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
});

test('旧概览首次500不隐藏行动清单和完成操作，恢复后正常显示', async ({ page }) => {
  const state = await fixture(page, { initialStatus: 500 });
  await open(page);
  await expect(overview(page)).toContainText('暂时无法加载学习概览');
  await expect(metric(page, '当前待交作业')).toHaveCount(0);
  await actions(page).getByRole('button', { name: '标为完成 整理错题笔记', exact: true }).click();
  await expect(actions(page).getByTestId('learning-action-personal-personal')).toHaveCount(0);
  await overview(page).getByRole('button', { name: '重试加载学习概览' }).click();
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
  expect(state.errors).toEqual([]);
});

test('行动端点失败不隐藏独立概览课程或计数', async ({ page }) => {
  await fixture(page, { actionStatus: 500 });
  await page.goto('/');
  await expect(actions(page)).toContainText('暂时无法加载学习行动');
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
  await expect(overview(page).getByRole('link', { name: /甲课程/ })).toBeVisible();
});

for (const permission of ['course.read', 'learning.use'])
  test(`缺少 ${permission} 不请求legacy概览或复用私有卡片`, async ({ page }) => {
    const state = await fixture(page, {
      permissions: permission === 'course.read' ? ['learning.use'] : ['course.read'],
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '学习工作台', exact: true })).toBeVisible();
    await expect(overview(page)).toHaveCount(0);
    expect(state.calls.filter((call) => call.path === '/api/dashboard')).toHaveLength(0);
    if (permission === 'course.read')
      await expect(actions(page).getByRole('status', { name: '行动匹配数量' })).toContainText('今日共 1 项');
    else await expect(actions(page)).toHaveCount(0);
  });

test('403立即撤回课程/公告/指标，普通500不能恢复，相同body新200可恢复', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
  state.failRead(403);
  await overview(page).getByRole('button', { name: '刷新学习概览' }).click();
  await expect(overview(page)).toContainText('无权查看学习概览');
  await expect(overview(page).getByRole('link')).toHaveCount(0);
  await expect(overview(page)).not.toContainText('甲课程');
  await expect(overview(page)).not.toContainText('甲公告');
  await expect(overview(page)).not.toContainText('甲动态');
  await expect(actions(page)).toBeVisible();
  state.failRead(500);
  const failed = page.waitForResponse(
    (reply) => reply.url().endsWith('/api/dashboard') && reply.status() === 500,
  );
  await overview(page).getByRole('button', { name: '重试加载学习概览' }).click();
  await failed;
  await expect(overview(page).getByRole('button', { name: '刷新学习概览' })).toBeEnabled();
  await expect(overview(page).getByRole('link')).toHaveCount(0);
  await overview(page).getByRole('button', { name: '重试加载学习概览' }).click();
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
});

test('403标记跨卸载保留，回到概览的旧缓存不先泄露，500仍不复活', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await expect(metric(page, '当前待交作业')).toBeVisible();
  state.failRead(403);
  await overview(page).getByRole('button', { name: '刷新学习概览' }).click();
  await expect(overview(page).getByRole('link')).toHaveCount(0);
  await away(page);
  const held = state.holdRead(500);
  await back(page);
  await held.started;
  await expect(overview(page).getByRole('link')).toHaveCount(0);
  held.release();
  await held.handled;
  await expect(overview(page).getByRole('link')).toHaveCount(0);
  await overview(page).getByRole('button', { name: '重试加载学习概览' }).click();
  await expect(metric(page, '当前待交作业')).toBeVisible();
});

test('普通500明确保留已授权旧快照，重试成功去掉提示', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await expect(metric(page, '当前待交作业')).toBeVisible();
  state.failRead(500);
  await overview(page).getByRole('button', { name: '刷新学习概览' }).click();
  await expect(overview(page)).toContainText('正在显示上次载入的学习概览');
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
  await overview(page).getByRole('button', { name: '重试加载学习概览' }).click();
  await expect(overview(page)).not.toContainText('正在显示上次载入的学习概览');
});

for (const target of ['same', 'other', 'space'] as const)
  for (const status of [200, 401])
    test(`忽略native abort后旧${status}确实到达，${target}新登录不被覆盖或驱逐`, async ({ page }) => {
      const state = await fixture(page, { loginTarget: target, ignoreAbort: true });
      await open(page);
      await expect(metric(page, '当前待交作业')).toBeVisible();
      const oldToken = state.token(),
        held = state.holdRead(status, true);
      await overview(page).getByRole('button', { name: '刷新学习概览' }).click();
      await held.started;
      await loginAgain(page);
      expect(state.token()).not.toBe(oldToken);
      const before = await page.evaluate(() => (window as any).__overviewExpired);
      held.release();
      await held.handled;
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).__overviewArrivals.some(
              (entry: any) => entry.status === 401 || entry.body.includes('迟到旧'),
            ),
          ),
        )
        .toBe(true);
      await oldAbsent(page);
      await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('7');
      expect(await page.evaluate(() => (window as any).__overviewExpired)).toBe(before);
      await expect(page).toHaveURL(/\/$/);
      expect(state.errors).toEqual([]);
    });

for (const change of ['csrf', 'permission', 'roles'] as const)
  for (const status of [200, 401])
    test(`body解析等待中同owner ${change}变化挡旧${status}而新scope可恢复`, async ({ page }) => {
      await page.clock.install();
      const state = await fixture(page, { ignoreAbort: true });
      await open(page);
      await expect(metric(page, '当前待交作业')).toBeVisible();
      state.failRead(status);
      state.markNextBody();
      await page.evaluate(() => {
        (window as any).__holdOverviewJson = true;
      });
      await overview(page).getByRole('button', { name: '刷新学习概览' }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__overviewJsonStarted)).toBe(true);
      const oldToken = state.token();
      if (change === 'csrf') state.rotate();
      else if (change === 'permission') state.permissions(['learning.use', 'course.read']);
      else state.roles(['STUDENT']);
      await refreshAuth(page);
      await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('7');
      if (change !== 'csrf') expect(state.token()).toBe(oldToken);
      await page.evaluate(() => (window as any).__releaseOverviewJson());
      await expect.poll(() => page.evaluate(() => (window as any).__overviewJsonDone)).toBe(true);
      await oldAbsent(page);
      expect(await page.evaluate(() => (window as any).__overviewExpired)).toBe(0);
      await expect(page).toHaveURL(/\/$/);
      expect(state.errors).toEqual([]);
    });

test('同CSRF撤课权限后个人行动仍可用，恢复权限的旧快照必须等待新body', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await open(page);
  await expect(metric(page, '当前待交作业')).toBeVisible();
  const token = state.token();
  state.permissions(['learning.use']);
  await refreshAuth(page);
  await expect(overview(page)).toHaveCount(0);
  await expect(actions(page).getByRole('status', { name: '行动匹配数量' })).toContainText('今日共 1 项');
  const held = state.holdRead();
  state.permissions(['learning.use', 'course.read', 'analysis.read']);
  await refreshAuth(page);
  await held.started;
  await expect(overview(page).getByRole('link')).toHaveCount(0);
  expect(state.token()).toBe(token);
  held.release();
  await held.handled;
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('7');
});

test('卸载后迟到旧body确实送达但不得覆盖重新载入的当前概览', async ({ page }) => {
  const state = await fixture(page, { ignoreAbort: true });
  await open(page);
  await expect(metric(page, '当前待交作业')).toBeVisible();
  const held = state.holdRead(200, true);
  await overview(page).getByRole('button', { name: '刷新学习概览' }).click();
  await held.started;
  await away(page);
  await back(page);
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
  held.release();
  await held.handled;
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__overviewArrivals.some((entry: any) => entry.body.includes('迟到旧')),
      ),
    )
    .toBe(true);
  await oldAbsent(page);
  expect(state.errors).toEqual([]);
});

test('切换教师角色保留教学指标与待办，学生慢读不能回写', async ({ page }) => {
  const state = await fixture(page, { ignoreAbort: true });
  await open(page);
  await expect(metric(page, '当前待交作业')).toBeVisible();
  const held = state.holdRead(200, true);
  await overview(page).getByRole('button', { name: '刷新学习概览' }).click();
  await held.started;
  const roleControl = page.getByRole('combobox', { name: '切换角色', exact: true });
  await roleControl.focus();
  await roleControl.press('Enter');
  await expect(roleControl).toHaveAttribute('aria-expanded', 'true');
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: /^教师$/ })
    .click();
  await expect(page.getByRole('heading', { name: '教学工作台', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看待批改作业', exact: true })).toContainText('71');
  await expect(actions(page)).toHaveCount(0);
  held.release();
  await held.handled;
  await expect(page.locator('main')).not.toContainText('迟到旧');
});

for (const role of ['TEACHER', 'ADMIN'])
  test(`${role} 保留现有指标和路径，不请求学生概览或行动领域`, async ({ page }) => {
    const state = await fixture(page, { role });
    await page.goto('/');
    const label = role === 'TEACHER' ? '待批改作业' : '行政班级';
    await expect(page.getByRole('link', { name: `查看${label}`, exact: true })).toContainText('71');
    await expect(overview(page)).toHaveCount(0);
    await expect(actions(page)).toHaveCount(0);
    expect(state.calls.filter((call) => call.path === '/api/planner/actions')).toHaveLength(0);
    if (role === 'ADMIN')
      await expect(page.getByRole('link', { name: /安全审计/ })).toHaveAttribute('href', '/admin/audit');
  });

test('个人空间不请求机构概览，仍显示既有专业首页与行动', async ({ page }) => {
  const state = await fixture(page, { mode: 'PERSONAL' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '我的学习空间', exact: true })).toBeVisible();
  await expect(actions(page)).toBeVisible();
  await expect(overview(page)).toHaveCount(0);
  expect(state.calls.filter((call) => call.path === '/api/dashboard')).toHaveLength(0);
});

test('当前401仅触发一次登录失效，不再展示旧指标或课程', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await expect(metric(page, '当前待交作业')).toBeVisible();
  state.failRead(401);
  await overview(page).getByRole('button', { name: '刷新学习概览' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(overview(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__overviewExpired)).toBe(1);
});

test('390px概览文案换行，无页面横向滚动，行动键盘入口可独立操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await open(page);
  await expect(metric(page, '当前待交作业').locator('strong')).toHaveText('503');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const tab = actions(page).getByRole('tab', { name: /^今日/ });
  await tab.focus();
  await tab.press('ArrowRight');
  await expect(actions(page).getByRole('tab', { name: /^未来7天/ })).toBeFocused();
  await metric(page, '当前待交作业').focus();
  await expect(metric(page, '当前待交作业')).toBeFocused();
});

test('平台管理员仍使用原指标与后台任务入口，不进入学生领域', async ({ page }) => {
  const state = await fixture(page, {
    role: 'SUPER_ADMIN',
    permissions: ['org.platform', 'course.admin', 'users.manage', 'org.manage', 'audit.read'],
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '平台工作台', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看启用机构', exact: true })).toHaveAttribute(
    'href',
    '/admin/organization',
  );
  await expect(page.getByRole('link', { name: '查看失败任务', exact: true })).toHaveAttribute(
    'href',
    '/admin/audit?tab=jobs',
  );
  await expect(overview(page)).toHaveCount(0);
  await expect(actions(page)).toHaveCount(0);
  expect(state.calls.filter((call) => call.path === '/api/planner/actions')).toHaveLength(0);
});
