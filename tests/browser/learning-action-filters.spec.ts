// MOCK filtering/picker/CAS/auth contracts only; no real SQL/course qualification or lifecycle proof.
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
type Gate = {
  seen: () => void;
  done: () => void;
  wait: Promise<void>;
  bucket?: Bucket;
  status?: number;
  marker?: boolean;
};
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
    ignoreAbort?: boolean;
  } = {},
) {
  let logged = true;
  let account = 'a';
  let space = 'a';
  let session = 1,
    epoch = 0;
  let roles = ['STUDENT', 'TEACHER'],
    selectedRole = options.role ?? 'STUDENT';
  let permissions = options.permissions ?? ['learning.use', 'course.read'];
  let items = options.items ?? samples();
  let nextRead: Gate | null = null;
  let nextWrite: Gate | null = null;
  let nextPicker: Gate | null = null,
    pickerStatus = 200;
  let readStatus: number | undefined = options.failInitial ? 500 : undefined;
  const calls: {
    method: string;
    path: string;
    account: string;
    bucket?: string | null;
    page?: string | null;
    body?: any;
    csrf?: string;
    query: Record<string, string>;
  }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ ignoreAbort }) => {
      const nativeFetch = window.fetch.bind(window);
      (window as any).__filterArrivals = [];
      (window as any).__filterExpiry = 0;
      (window as any).__holdFilterJsonPath = '';
      (window as any).__filterJsonStarted = false;
      (window as any).__filterJsonDone = false;
      (window as any).__trackFilterGc = false;
      (window as any).__filterGcFired = 0;
      const nativeTimer = window.setTimeout.bind(window);
      window.setTimeout = ((callback: any, delay?: number, ...args: any[]) => {
        const tracked = delay === 300000 && (window as any).__trackFilterGc;
        return nativeTimer(
          typeof callback === 'function'
            ? () => {
                if (tracked) (window as any).__filterGcFired++;
                callback.apply(window, args);
              }
            : callback,
          delay,
        );
      }) as typeof window.setTimeout;
      window.addEventListener('auth-expired', () => (window as any).__filterExpiry++);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const path = new URL(url, location.href).pathname;
        const target = path.startsWith('/api/planner/actions');
        const response = await nativeFetch(
          input,
          target && ignoreAbort ? { ...init, signal: undefined } : init,
        );
        if (target && ignoreAbort)
          (window as any).__filterArrivals.push({
            path,
            status: response.status,
            body: await response.clone().text(),
          });
        if (target && (window as any).__holdFilterJsonPath === path) {
          (window as any).__holdFilterJsonPath = '';
          const parse = response.json.bind(response);
          const wait = new Promise<void>((resolve) => ((window as any).__releaseFilterJson = resolve));
          response.json = async () => {
            (window as any).__filterJsonStarted = true;
            await wait;
            try {
              return await parse();
            } finally {
              (window as any).__filterJsonDone = true;
            }
          };
        }
        return response;
      };
    },
    { ignoreAbort: options.ignoreAbort ?? false },
  );
  const user = () => ({
    id: `action-user-${account}`,
    organizationId: `action-space-${space}`,
    accountMode: options.mode ?? 'ORGANIZATION',
    role: selectedRole,
    roles,
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
      query: Object.fromEntries(url.searchParams),
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
      epoch++;
      if (options.loginTarget === 'space') space = 'b';
      else if (options.loginTarget !== 'same') {
        account = 'b';
        space = 'b';
      }
      return json(route, { user: user(), csrfToken: token() }, 201);
    }
    if (path === '/api/auth/role') {
      selectedRole = body.role;
      permissions =
        selectedRole === 'TEACHER' ? ['course.read', 'assessment.manage'] : ['learning.use', 'course.read'];
      session++;
      epoch++;
      return json(route, { user: user(), csrfToken: token() }, 201);
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], unreadCount: 0, total: 0 });
    if (path === '/api/dashboard')
      return json(route, {
        metrics: [
          {
            label: '当前待交作业',
            value: 503,
            detail: '未交或退回且现在可提交，不限7天',
            path: '/assignments',
          },
        ],
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
    if (path === '/api/planner/actions/courses') {
      const search = url.searchParams.get('search') ?? '',
        number = Number(url.searchParams.get('page') ?? 1),
        size = Number(url.searchParams.get('pageSize') ?? 20);
      const catalog = [
        { id: 'course-a', title: '00 数学课程' },
        { id: 'course-b', title: '01 物理课程' },
        ...Array.from({ length: 18 }, (_, index) => ({
          id: 'course-' + (index + 3),
          title: String(index + 2).padStart(2, '0') + ' 授权课程',
        })),
        { id: 'course-21', title: '20 百分%_\\字面课程' },
        { id: 'course-empty', title: '21 零行动课程' },
      ].map((item) => ({ ...item, title: epoch ? '当前会话 ' + item.title : item.title }));
      const matched = catalog.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()));
      const data = {
        items: matched.slice((number - 1) * size, number * size),
        total: matched.length,
        page: number,
        pageSize: size,
      };
      const held = nextPicker,
        status = pickerStatus;
      nextPicker = null;
      pickerStatus = 200;
      if (held?.marker && data.items.length) data.items[0].title = 'LATE_COURSE_BODY';
      if (held) {
        held.seen();
        await held.wait;
      }
      try {
        await json(route, status === 200 ? data : { message: '课程选项拒绝或故障' }, status);
      } catch {
        /* Domain guard can abort non-ignored transport. */
      } finally {
        held?.done();
      }
      return;
    }
    if (path === '/api/planner/actions') {
      const bucket = (url.searchParams.get('bucket') ?? 'today') as Bucket;
      const type = url.searchParams.get('type') ?? 'all',
        courseId = url.searchParams.get('courseId');
      const page = Number(url.searchParams.get('page') ?? 1),
        pageSize = Number(url.searchParams.get('pageSize') ?? 10);
      const source =
        requestAccount === 'a' && space === 'a' && session === 1 && epoch === 0
          ? items
          : [personal('new-session', '当前会话个人待办')];
      const visible = source.filter(
        (item) =>
          !item.completed &&
          (item.type === 'personal' || permissions.includes('course.read')) &&
          (type === 'all' || item.type === type) &&
          (!courseId || item.courseId === courseId),
      );
      const counts = Object.fromEntries(
        ['today', 'upcoming', 'overdue'].map((key) => [
          key,
          options.counts?.[key as Bucket] ?? visible.filter((item) => item.bucket === key).length,
        ]),
      );
      const response = {
        filters: { type, courseId: courseId ?? null },
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
        if (held.marker && response.items.length) response.items[0].title = 'LATE_ACTION_BODY';
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
  function gate(kind: 'read' | 'write' | 'picker', bucket?: Bucket, status?: number, marker = false) {
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
    if (kind === 'read') {
      readStatus = status;
      nextRead = { seen, wait, done, bucket, marker };
    } else if (kind === 'picker') {
      pickerStatus = status ?? 200;
      nextPicker = { seen, wait, done, marker };
    } else nextWrite = { seen, wait, done, status };
    return { started, release, handled };
  }
  return {
    calls,
    errors,
    token,
    holdRead: (bucket?: Bucket, status = 200, marker = false) => gate('read', bucket, status, marker),
    holdPicker: (status = 200, marker = false) => gate('picker', undefined, status, marker),
    failPicker: (status = 500) => {
      pickerStatus = status;
    },
    setRoles: (value: string[]) => {
      roles = value;
      epoch++;
    },
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
      epoch++;
    },
    rotateSession() {
      session++;
      epoch++;
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

const picker = (page: Page) => board(page).getByRole('region', { name: '授权课程选择', exact: true });
const actionCalls = (state: Awaited<ReturnType<typeof fixture>>) =>
  state.calls.filter((call) => call.path === '/api/planner/actions');
async function showPicker(page: Page) {
  await board(page).getByRole('button', { name: '选择课程', exact: true }).click();
  await expect(picker(page).getByRole('status', { name: '课程选项匹配数量' })).toBeVisible();
}
async function selectCourse(page: Page, id: string) {
  await showPicker(page);
  await board(page).getByRole('combobox', { name: '学习行动课程', exact: true }).selectOption(id);
}
async function applyFilters(page: Page) {
  const reply = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/planner/actions',
  );
  await board(page).getByRole('button', { name: '应用学习筛选', exact: true }).click();
  await reply;
  await expect(board(page).getByRole('button', { name: '刷新学习行动清单', exact: true })).toBeEnabled();
}
async function lookup(page: Page, text: string) {
  await picker(page).getByRole('textbox', { name: '查找授权课程' }).fill(text);
  const reply = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/planner/actions/courses' &&
      (new URL(response.url()).searchParams.get('search') ?? '') === text,
  );
  await picker(page).getByRole('button', { name: '查找课程', exact: true }).click();
  await reply;
  await expect(picker(page).getByRole('button', { name: '刷新课程选项', exact: true })).toBeEnabled();
}
async function noLate(page: Page) {
  await expect(board(page)).not.toContainText('LATE_ACTION_BODY');
  await expect(board(page)).not.toContainText('LATE_COURSE_BODY');
}
async function arrived(page: Page, endpoint: 'actions' | 'courses', status: number, from: number) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ endpoint, status, from }) =>
          (window as any).__filterArrivals
            .slice(from)
            .some(
              (item: any) =>
                item.path ===
                  (endpoint === 'actions' ? '/api/planner/actions' : '/api/planner/actions/courses') &&
                item.status === status &&
                (status === 401 ||
                  item.body.includes(endpoint === 'actions' ? 'LATE_ACTION_BODY' : 'LATE_COURSE_BODY')),
            ),
        { endpoint, status, from },
      ),
    )
    .toBe(true);
}

test('默认三桶/入口保持，picker按需加载，筛选不改全量overview503', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await expect(board(page).getByRole('tab', { name: /^今日 3$/ })).toBeVisible();
  await expect(card(page, 'exam', 'exam-active').getByRole('link', { name: '继续答卷' })).toHaveAttribute(
    'href',
    '/exam-attempts/actual-attempt',
  );
  expect(state.calls.some((call) => call.path === '/api/planner/actions/courses')).toBe(false);
  await board(page).getByRole('combobox', { name: '学习行动来源' }).selectOption('personal');
  await applyFilters(page);
  await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
  await expect(
    page.getByRole('link', { name: '查看当前待交作业', exact: true }).locator('strong'),
  ).toHaveText('503');
});

test('course/type草稿不发actions，personal只清draft课程而不提前改变已应用范围', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await selectCourse(page, 'course-a');
  const before = actionCalls(state).length;
  await expect(board(page).getByLabel('已应用的学习筛选')).toContainText('全部课程及个人待办');
  expect(actionCalls(state)).toHaveLength(before);
  await applyFilters(page);
  await expect(board(page).getByRole('tab', { name: /^今日 2$/ })).toBeVisible();
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  await board(page).getByRole('combobox', { name: '学习行动来源' }).selectOption('personal');
  await expect(board(page).getByRole('combobox', { name: '学习行动课程' })).toHaveValue('');
  await expect(board(page).getByRole('combobox', { name: '学习行动课程' })).toBeDisabled();
  await expect(board(page).getByLabel('已应用的学习筛选')).toContainText('00 数学课程');
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  expect(actionCalls(state)).toHaveLength(before + 1);
  await applyFilters(page);
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
  expect(actionCalls(state).at(-1)?.query).toMatchObject({ type: 'personal', bucket: 'today', page: '1' });
  expect(actionCalls(state).at(-1)?.query).not.toHaveProperty('courseId');
});

test('选课程加exam精确交集保留续答入口与未来未开始状态，切桶保留筛选', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await selectCourse(page, 'course-a');
  await board(page).getByRole('combobox', { name: '学习行动来源' }).selectOption('exam');
  await applyFilters(page);
  await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
  await expect(card(page, 'assignment', 'assignment-extension')).toHaveCount(0);
  await expect(card(page, 'exam', 'exam-active')).toBeVisible();
  await board(page)
    .getByRole('tab', { name: /^未来7天/ })
    .click();
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('未来7天共 0 项');
  expect(actionCalls(state).at(-1)?.query).toMatchObject({
    courseId: 'course-a',
    type: 'exam',
    bucket: 'upcoming',
    page: '1',
  });
});

test('页2应用与重置都回page1保留bucket，刷新取已应用条件而非draft', async ({ page }) => {
  const many = [
    ...samples(),
    ...Array.from({ length: 21 }, (_, index) => ({
      ...samples()[1],
      id: 'assignment-extra-' + index,
      path: '/assignments/assignment-extra-' + index,
      title: '第' + index + '题',
    })),
  ];
  const state = await fixture(page, { items: many });
  await open(page);
  await board(page).locator('.ant-pagination-item-2').click();
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('第 2 页');
  await selectCourse(page, 'course-a');
  await applyFilters(page);
  expect(actionCalls(state).at(-1)?.query).toMatchObject({ courseId: 'course-a', page: '1' });
  await expect(board(page).getByRole('tab', { name: /^今日 23$/ })).toBeVisible();
  await board(page).getByRole('combobox', { name: '学习行动来源' }).selectOption('exam');
  const before = actionCalls(state).length;
  await board(page).getByRole('button', { name: '刷新学习行动清单', exact: true }).click();
  await expect.poll(() => actionCalls(state).length).toBe(before + 1);
  expect(actionCalls(state).at(-1)?.query.type).toBe('all');
  const reset = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/planner/actions' &&
      !new URL(response.url()).searchParams.has('courseId'),
  );
  await board(page).getByRole('button', { name: '重置学习筛选' }).click();
  await reset;
  await expect(board(page).getByRole('combobox', { name: '学习行动来源' })).toHaveValue('all');
  expect(actionCalls(state).at(-1)?.query).toMatchObject({ type: 'all', page: '1', bucket: 'today' });
});

test('picker真实服务器分页可选第21门课程，无行动课程成功0而非错误', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await showPicker(page);
  await expect(picker(page).getByRole('status', { name: '课程选项匹配数量' })).toContainText('22 门');
  await expect(board(page).getByRole('option', { name: /百分/ })).toHaveCount(0);
  await picker(page).getByRole('button', { name: '课程下一页' }).click();
  await expect(picker(page).getByRole('status', { name: '课程选项匹配数量' })).toContainText('第 2 页');
  await board(page).getByRole('combobox', { name: '学习行动课程' }).selectOption('course-21');
  await applyFilters(page);
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('今日共 0 项');
  await board(page).getByRole('combobox', { name: '学习行动课程' }).selectOption('course-empty');
  await applyFilters(page);
  await expect(board(page).getByLabel('已应用的学习筛选')).toContainText('零行动课程');
  await expect(board(page).getByRole('status', { name: '行动匹配数量' })).toContainText('今日共 0 项');
  expect(state.errors).toEqual([]);
});

for (const text of ['%', '_', '\\', '  '])
  test('课程搜索字面保留 ' + JSON.stringify(text) + '，选项编辑不改变actions', async ({ page }) => {
    const state = await fixture(page);
    await open(page);
    await showPicker(page);
    const before = actionCalls(state).length;
    await lookup(page, text);
    expect(actionCalls(state)).toHaveLength(before);
    expect(
      state.calls.filter((call) => call.path === '/api/planner/actions/courses').at(-1)?.query.search,
    ).toBe(text);
    await expect(picker(page).getByRole('status', { name: '课程选项匹配数量' })).toContainText(
      text === '  ' ? '0 门' : '1 门',
    );
  });

for (const mode of ['ORGANIZATION', 'PERSONAL'] as const)
  test(mode + '无course.read只有personal/default，且完全不请求picker或课程来源', async ({ page }) => {
    const state = await fixture(page, { mode, permissions: ['learning.use'] });
    await open(page);
    await expect(board(page).getByRole('combobox', { name: '学习行动课程' })).toHaveCount(0);
    await expect(board(page).getByRole('option', { name: '作业', exact: true })).toHaveCount(0);
    await expect(board(page).getByRole('option', { name: '考试', exact: true })).toHaveCount(0);
    await expect(board(page).getByLabel('已应用的学习筛选')).toContainText('当前无课程查看权限');
    expect(state.calls.some((call) => call.path === '/api/planner/actions/courses')).toBe(false);
    await card(page, 'personal', 'personal-a').getByRole('button', { name: '标为完成 复习电路参数' }).click();
    await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  });

test('慢picker不挡默认个人CAS，pending禁用所有筛选/桶/页且完成刷新', async ({ page }) => {
  const state = await fixture(page),
    read = state.holdPicker(),
    write = state.holdWrite();
  await open(page);
  await board(page).getByRole('button', { name: '选择课程', exact: true }).click();
  await read.started;
  await expect(picker(page).getByRole('status', { name: '课程选项加载状态' })).toBeVisible();
  await card(page, 'personal', 'personal-a').getByRole('button', { name: '标为完成 复习电路参数' }).click();
  await write.started;
  await expect(board(page).getByRole('combobox', { name: '学习行动来源' })).toBeDisabled();
  await expect(board(page).getByRole('button', { name: '应用学习筛选' })).toBeDisabled();
  await expect(board(page).getByRole('tab', { name: /^未来7天/ })).toBeDisabled();
  write.release();
  await write.handled;
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  expect(state.calls.filter((call) => call.method === 'PATCH')).toEqual([
    expect.objectContaining({
      path: '/api/planner/tasks/personal-a',
      body: { revision: 3, completed: true },
      csrf: state.token(),
    }),
  ]);
  await expect(board(page).getByRole('combobox', { name: '学习行动来源' })).toBeEnabled();
  await expect(picker(page).getByRole('status', { name: '课程选项加载状态' })).toBeVisible();
  read.release();
  await read.handled;
});

test('picker500不伪造0或阻止个人CAS，retry仍能选择课程', async ({ page }) => {
  const state = await fixture(page);
  state.failPicker();
  await open(page);
  await board(page).getByRole('button', { name: '选择课程', exact: true }).click();
  await expect(picker(page)).toContainText('暂时无法加载授权课程');
  await expect(picker(page).getByRole('status', { name: '课程选项匹配数量' })).toHaveCount(0);
  await card(page, 'personal', 'personal-a').getByRole('button', { name: '标为完成 复习电路参数' }).click();
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  await expect(board(page).getByRole('combobox', { name: '学习行动来源' })).toBeEnabled();
  await picker(page).getByRole('button', { name: '重试课程选项' }).click();
  await expect(picker(page).getByRole('status', { name: '课程选项匹配数量' })).toContainText('22 门');
});

test('personal筛选CAS保持冲突版本刷新和成功后所有filter/bucket计数', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await board(page).getByRole('combobox', { name: '学习行动来源' }).selectOption('personal');
  await applyFilters(page);
  state.change();
  await card(page, 'personal', 'personal-a').getByRole('button').click();
  await expect(board(page)).toContainText('待办已在其他页面修改');
  await expect(card(page, 'personal', 'personal-a')).toContainText('另一窗口更新后的待办');
  await card(page, 'personal', 'personal-a').getByRole('button').click();
  await expect(card(page, 'personal', 'personal-a')).toHaveCount(0);
  await board(page).getByRole('button', { name: '重置学习筛选' }).click();
  await expect(board(page).getByRole('tab', { name: /^今日 2$/ })).toBeVisible();
  const writes = state.calls.filter((call) => call.method === 'PATCH');
  expect(writes.map((call) => call.body.revision)).toEqual([3, 4]);
});

test('403跨filter/桶/路由撤回旧行及名称，500不复活，同body新200可恢复', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await selectCourse(page, 'course-a');
  await applyFilters(page);
  state.failRead(403);
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await expect(board(page)).toContainText('无权访问学习行动清单');
  await expect(board(page).getByTestId(/^learning-action-/)).toHaveCount(0);
  await expect(board(page).getByLabel('已应用的学习筛选')).not.toContainText('00 数学课程');
  await expect(board(page).getByRole('combobox', { name: '学习行动课程' })).toHaveValue('course-a');
  await page.getByRole('link', { name: '我的笔记', exact: true }).click();
  await expect(board(page)).toHaveCount(0);
  state.failRead(500);
  await page.getByRole('link', { name: '学习工作台', exact: true }).click();
  await expect(board(page).getByTestId(/^learning-action-/)).toHaveCount(0);
  await expect(board(page).getByRole('button', { name: '刷新学习行动清单' })).toBeEnabled();
  await board(page).getByRole('button', { name: '重试加载学习行动' }).click();
  await expect(card(page, 'personal', 'personal-a')).toBeVisible();
});

test('retained课程snapshot在inactivequery实际GC后403仍隐藏name且不扩成全部', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await open(page);
  await selectCourse(page, 'course-a');
  await applyFilters(page);
  await page.evaluate(() => ((window as any).__trackFilterGc = true));
  await lookup(page, '物理');
  await page.clock.fastForward(300001);
  await expect.poll(() => page.evaluate(() => (window as any).__filterGcFired)).toBeGreaterThan(0);
  await expect(board(page).getByRole('button', { name: '刷新学习行动清单' })).toBeEnabled();
  state.failRead(403);
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await expect(board(page)).toContainText('无权访问学习行动清单');
  await expect(board(page).getByLabel('已应用的学习筛选')).not.toContainText('00 数学课程');
  await expect(board(page).getByRole('combobox', { name: '学习行动课程' })).toHaveValue('course-a');
  expect(actionCalls(state).at(-1)?.query.courseId).toBe('course-a');
});

for (const endpoint of ['actions', 'courses'] as const)
  for (const status of [200, 401])
    test(
      endpoint + '忽略transportabort旧' + status + '实际到达，同账号新CSRF会话不受污染',
      async ({ page }) => {
        const state = await fixture(page, { loginTarget: 'same', ignoreAbort: true });
        await open(page);
        const held =
          endpoint === 'actions' ? state.holdRead(undefined, status, true) : state.holdPicker(status, true);
        if (endpoint === 'actions')
          await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
        else await board(page).getByRole('button', { name: '选择课程', exact: true }).click();
        await held.started;
        const oldToken = state.token(),
          from = await page.evaluate(() => (window as any).__filterArrivals.length);
        await changeAccount(page);
        expect(state.token()).not.toBe(oldToken);
        const expiry = await page.evaluate(() => (window as any).__filterExpiry);
        held.release();
        await held.handled;
        await arrived(page, endpoint, status, from);
        await noLate(page);
        await expect(card(page, 'personal', 'new-session')).toBeVisible();
        expect(await page.evaluate(() => (window as any).__filterExpiry)).toBe(expiry);
        expect(state.errors).toEqual([]);
      },
    );

for (const endpoint of ['actions', 'courses'] as const)
  for (const change of ['permissions', 'roles'] as const)
    for (const status of [200, 401])
      test(
        endpoint + 'JSON等待中sameCSRF ' + change + '变化挡旧' + status + '且新scope可用',
        async ({ page }) => {
          await page.clock.install();
          const state = await fixture(page, { ignoreAbort: true });
          await open(page);
          if (endpoint === 'courses') await showPicker(page);
          const from = await page.evaluate(() => (window as any).__filterArrivals.length),
            token = state.token();
          await page.evaluate(
            (path) => ((window as any).__holdFilterJsonPath = path),
            endpoint === 'actions' ? '/api/planner/actions' : '/api/planner/actions/courses',
          );
          const held =
            endpoint === 'actions' ? state.holdRead(undefined, status, true) : state.holdPicker(status, true);
          const refresh =
            endpoint === 'actions'
              ? board(page).getByRole('button', { name: '刷新学习行动清单' })
              : picker(page).getByRole('button', { name: '刷新课程选项' });
          await refresh.click();
          await held.started;
          held.release();
          await held.handled;
          await expect.poll(() => page.evaluate(() => (window as any).__filterJsonStarted)).toBe(true);
          if (change === 'roles') state.setRoles(['STUDENT']);
          else state.setPermissions(['learning.use', 'course.read', 'analysis.read']);
          await refreshAuth(page);
          await expect(card(page, 'personal', 'new-session')).toBeVisible();
          expect(state.token()).toBe(token);
          await page.evaluate(() => (window as any).__releaseFilterJson());
          await expect.poll(() => page.evaluate(() => (window as any).__filterJsonDone)).toBe(true);
          await arrived(page, endpoint, status, from);
          await noLate(page);
          expect(await page.evaluate(() => (window as any).__filterExpiry)).toBe(0);
        },
      );

test('当前picker403撤回旧metadata与counts，500不复活，fresh200再恢复', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await selectCourse(page, 'course-a');
  await applyFilters(page);
  state.failPicker(403);
  await picker(page).getByRole('button', { name: '刷新课程选项' }).click();
  await expect(picker(page)).toContainText('当前无权查看课程选项');
  await expect(picker(page).getByRole('status', { name: '课程选项匹配数量' })).toHaveCount(0);
  await expect(board(page).getByLabel('已应用的学习筛选')).not.toContainText('00 数学课程');
  await expect(board(page).getByTestId(/^learning-action-/)).toHaveCount(0);
  state.failPicker(500);
  const failed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/planner/actions/courses' && response.status() === 500,
  );
  await picker(page).getByRole('button', { name: '重试课程选项' }).click();
  await failed;
  await expect(picker(page).getByRole('button', { name: '刷新课程选项' })).toBeEnabled();
  await expect(board(page).getByLabel('已应用的学习筛选')).not.toContainText('00 数学课程');
  await picker(page).getByRole('button', { name: '重试课程选项' }).click();
  await expect(board(page).getByLabel('已应用的学习筛选')).toContainText('00 数学课程');
  await board(page).getByRole('button', { name: '重试加载学习行动' }).click();
  await expect(card(page, 'assignment', 'assignment-extension')).toBeVisible();
});

test('当前401只驱逐一次，390px筛选/picker可键盘操作无页面横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await open(page);
  await showPicker(page);
  const source = board(page).getByRole('combobox', { name: '学习行动来源' });
  await source.focus();
  await expect(source).toBeFocused();
  await source.selectOption('personal');
  await board(page).getByRole('button', { name: '应用学习筛选' }).focus();
  await page.keyboard.press('Enter');
  await expect(board(page).getByRole('tab', { name: /^今日 1$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  state.failRead(401);
  await board(page).getByRole('button', { name: '刷新学习行动清单' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(board(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__filterExpiry)).toBe(1);
});

test('sameCSRF撤课权限隐藏picker/课程行，恢复旧签名必须等待freshbody', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await open(page);
  await selectCourse(page, 'course-a');
  await applyFilters(page);
  const token = state.token();
  state.setPermissions(['learning.use']);
  await refreshAuth(page);
  await expect(board(page).getByRole('combobox', { name: '学习行动课程' })).toHaveCount(0);
  await expect(card(page, 'personal', 'new-session')).toBeVisible();
  const held = state.holdRead();
  state.setPermissions(['learning.use', 'course.read']);
  await refreshAuth(page);
  await held.started;
  expect(state.token()).toBe(token);
  await expect(board(page).getByTestId(/^learning-action-/)).toHaveCount(0);
  held.release();
  await held.handled;
  await expect(card(page, 'personal', 'new-session')).toBeVisible();
});

test('卸载picker旧200实际到达不能污染重新打开的选项缓存', async ({ page }) => {
  const state = await fixture(page, { ignoreAbort: true });
  await open(page);
  const held = state.holdPicker(200, true),
    from = await page.evaluate(() => (window as any).__filterArrivals.length);
  await board(page).getByRole('button', { name: '选择课程', exact: true }).click();
  await held.started;
  await page.getByRole('link', { name: '我的笔记', exact: true }).click();
  await expect(board(page)).toHaveCount(0);
  await page.getByRole('link', { name: '学习工作台', exact: true }).click();
  await expect(board(page)).toBeVisible();
  await showPicker(page);
  held.release();
  await held.handled;
  await arrived(page, 'courses', 200, from);
  await expect(picker(page).getByRole('status', { name: '课程选项匹配数量' })).toContainText('22 门');
  await noLate(page);
});

for (const target of ['other', 'space'] as const)
  test('新' + target + '身份后旧picker401实到也不失效或暴露旧名称', async ({ page }) => {
    const state = await fixture(page, { loginTarget: target, ignoreAbort: true });
    await open(page);
    const held = state.holdPicker(401, true),
      from = await page.evaluate(() => (window as any).__filterArrivals.length);
    await board(page).getByRole('button', { name: '选择课程', exact: true }).click();
    await held.started;
    await changeAccount(page);
    const expiry = await page.evaluate(() => (window as any).__filterExpiry);
    held.release();
    await held.handled;
    await arrived(page, 'courses', 401, from);
    await expect(card(page, 'personal', 'new-session')).toBeVisible();
    await noLate(page);
    expect(await page.evaluate(() => (window as any).__filterExpiry)).toBe(expiry);
  });

test('真实教师角色切换隐藏学生筛选，旧picker401实际到达不驱逐教师', async ({ page }) => {
  const state = await fixture(page, { ignoreAbort: true });
  await open(page);
  const held = state.holdPicker(401, true);
  const from = await page.evaluate(() => (window as any).__filterArrivals.length);
  await board(page).getByRole('button', { name: '选择课程', exact: true }).click();
  await held.started;
  const role = page.getByRole('combobox', { name: '切换角色', exact: true });
  await role.focus();
  await role.press('Enter');
  await expect(role).toHaveAttribute('aria-expanded', 'true');
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: /^教师$/ })
    .click();
  await expect(page.getByRole('heading', { name: '教学工作台', exact: true })).toBeVisible();
  await expect(board(page)).toHaveCount(0);
  const expiry = await page.evaluate(() => (window as any).__filterExpiry);
  held.release();
  await held.handled;
  await arrived(page, 'courses', 401, from);
  await expect(page.getByRole('heading', { name: '教学工作台', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__filterExpiry)).toBe(expiry);
  await expect(page.locator('main')).not.toContainText('LATE_COURSE_BODY');
});
