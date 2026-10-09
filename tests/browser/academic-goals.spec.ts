// UI contract tests use controlled API responses. Real progress aggregation is
// verified separately against PostgreSQL in academic-goals-live.spec.ts.
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { LearningGoal } from '../../apps/web/src/components/academics/types';
import { plannerDay } from '../../apps/web/src/planner-time';
import { emptyLearningActions } from './empty-learning-actions-fixture';

test.use({ actionTimeout: 15000 });
const modules = [
  { id: 'circuit-lab', title: '电阻网络与RC响应', kind: 'calculator', description: '比较串联与并联电阻。' },
  {
    id: 'algorithms',
    title: '算法题与在线编译',
    kind: 'algorithm',
    description: '正式提交后统计不同通过题目。',
  },
].map((module) => ({
  ...module,
  subjectIds: ['engineering'],
  tags: [],
  estimatedMinutes: 20,
  fields: [{ key: 'voltage', label: '电源电压', type: 'number', required: true }],
  defaultValues: { voltage: 12 },
  learningObjectives: ['通过实际练习理解原理'],
  concepts: [],
  instructions: ['先阅读再练习'],
  examples: [],
  resources: [],
}));
const goal = (overrides: Partial<LearningGoal> = {}): LearningGoal => ({
  id: 'goal-1',
  moduleId: 'circuit-lab',
  title: '三次电路对照实验',
  targetCount: 3,
  dueDate: null,
  archived: false,
  revision: 0,
  createdAt: '2026-10-09T08:00:00Z',
  updatedAt: '2026-10-09T08:00:00Z',
  progressCount: 0,
  completed: false,
  unit: '次',
  overdue: false,
  ...overrides,
});
async function setup(page: Page, initial: LearningGoal[] = []) {
  const records = new Map<string, LearningGoal[]>([
    ['A', structuredClone(initial)],
    ['B', []],
  ]);
  let current = 'A';
  let authenticated = true;
  let conflict = false;
  let listError = false;
  let creationError = false;
  let releaseCreate: (() => void) | undefined;
  let creationGate: Promise<void> | undefined;
  const requests: { path: string; method: string; body: any; owner: string }[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = () => ({
    id: `goal-user-${current}`,
    name: `目标同学${current}`,
    username: current,
    role: 'STUDENT',
    roles: ['STUDENT'],
    permissions: ['learning.use'],
    organizationId: `personal-${current}`,
    accountMode: 'PERSONAL',
    majorId: null,
    major: null,
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.method() === 'GET' ? undefined : request.postDataJSON();
    const owner = current;
    requests.push({ path: path + url.search, method: request.method(), body, owner });
    if (path === '/api/auth/me')
      return authenticated
        ? json(route, { user: user(), csrfToken: 'fixture-token' })
        : json(route, { message: '请登录' }, 401);
    if (path === '/api/auth/logout') {
      authenticated = false;
      return json(route, { ok: true });
    }
    if (path === '/api/auth/login') {
      current = body.username === 'B' ? 'B' : 'A';
      authenticated = true;
      return json(route, { user: user(), csrfToken: 'fixture-token' });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/planner/actions') return json(route, emptyLearningActions(new URL(request.url())));
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/academics/catalog') return json(route, { subjects: [], majors: [], modules });
    if (path === '/api/academics/me')
      return json(route, {
        accountMode: 'PERSONAL',
        revision: 0,
        majorId: null,
        major: null,
        selectedModuleIds: [],
        stats: { records: 0, completed: 0, modulesPracticed: 0 },
        recentRecords: [],
        recommendations: [],
      });
    if (path === '/api/academics/records') return json(route, { items: [], total: 0, page: 1, pageSize: 6 });
    if (path.startsWith('/api/academics/modules/'))
      return json(
        route,
        modules.find((module) => path.endsWith(module.id)),
      );
    if (path === '/api/academics/goals' && request.method() === 'GET') {
      if (listError) return json(route, { message: '目标服务暂时不可用' }, 503);
      const status = url.searchParams.get('status');
      return json(route, {
        items: records
          .get(owner)!
          .filter((item) => status === 'all' || item.archived === (status === 'archived')),
      });
    }
    if (path === '/api/academics/goals' && request.method() === 'POST') {
      if (creationError)
        return json(route, { message: '当前空间已达到100个目标，请删除不需要的目标后再创建' }, 409);
      const created = goal({
        id: `goal-${records.get(owner)!.length + 1}`,
        ...body,
        dueDate: body.dueDate || null,
        unit: body.moduleId === 'algorithms' ? '题' : '次',
      });
      records.get(owner)!.push(created);
      if (creationGate) await creationGate;
      return json(route, created, 201);
    }
    if (path.startsWith('/api/academics/goals/')) {
      const items = records.get(owner)!;
      const found = items.find((item) => path.endsWith('/' + item.id));
      if (!found) return json(route, { message: '学习目标不存在' }, 404);
      if (conflict) {
        conflict = false;
        found.revision++;
        found.title = '另一窗口更新的目标';
      }
      if (body.revision !== found.revision) return json(route, { message: '目标已在其他窗口更新' }, 409);
      if (request.method() === 'DELETE') {
        records.set(
          owner,
          items.filter((item) => item.id !== found.id),
        );
        return json(route, { ok: true });
      }
      Object.assign(found, body, { revision: found.revision + 1 });
      found.completed = found.progressCount >= found.targetCount;
      return json(route, found);
    }
    return json(route, { items: [] });
  });
  return {
    requests,
    items: (owner = 'A') => records.get(owner)!,
    conflictNext: () => {
      conflict = true;
    },
    failList: (value: boolean) => {
      listError = value;
    },
    failCreate: () => {
      creationError = true;
    },
    remove: (id: string) =>
      records.set(
        current,
        records.get(current)!.filter((item) => item.id !== id),
      ),
    delayCreate: () => {
      creationGate = new Promise<void>((resolve) => {
        releaseCreate = resolve;
      });
    },
    expire: () => {
      authenticated = false;
    },
    releaseCreate: () => releaseCreate?.(),
  };
}
const panel = (page: Page) => page.getByRole('region', { name: '我的学习目标', exact: true });
async function chooseModule(page: Page, label = modules[0].title) {
  await page.getByRole('dialog').getByRole('combobox', { name: '学习模块', exact: true }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: label }).click();
}
async function filterGoals(page: Page, label: string) {
  await panel(page).getByRole('combobox', { name: '学习目标状态' }).press('ArrowDown');
  await page.locator('.ant-select-item-option').getByText(label, { exact: true }).click();
}

test('创建模块目标，显示真实计数且超额完成不截断；刷新读取进度下降', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics');
  await expect(panel(page).getByText('还没有学习目标。选一个模块，设定一个小目标开始吧。')).toBeVisible();
  await panel(page).getByRole('button', { name: '创建学习目标' }).click();
  await chooseModule(page);
  const dialog = page.getByRole('dialog', { name: '创建学习目标' });
  await expect(dialog.getByLabel('目标标题', { exact: true })).toHaveValue('电阻网络与RC响应学习目标');
  await expect(dialog.getByLabel('目标数量', { exact: true })).toHaveValue('3');
  await dialog.getByRole('button', { name: '创建目标', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(
    fixture.requests.find((item) => item.method === 'POST' && item.path.endsWith('/goals'))!.body,
  ).toEqual({ moduleId: 'circuit-lab', title: '电阻网络与RC响应学习目标', targetCount: 3, dueDate: null });
  const card = page.getByTestId('academic-goal-goal-1');
  await expect(card.getByText('0 / 3 次', { exact: true })).toBeVisible();
  fixture.items()[0].progressCount = 5;
  fixture.items()[0].completed = true;
  await panel(page).getByRole('button', { name: '刷新目标', exact: true }).click();
  await expect(card.getByText('5 / 3 次', { exact: true })).toBeVisible();
  await expect(card.getByText('已达到目标', { exact: true })).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
  fixture.items()[0].progressCount = 1;
  fixture.items()[0].completed = false;
  await panel(page).getByRole('button', { name: '刷新目标', exact: true }).click();
  await expect(card.getByText('1 / 3 次', { exact: true })).toBeVisible();
  await expect(card.getByText('还需 2 次', { exact: true })).toBeVisible();
});

test('模块工作台预选当前模块，算法目标清晰说明正式通过题数', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/circuit-lab');
  await page.getByRole('button', { name: '创建本模块目标' }).click();
  await expect(page.getByRole('dialog').locator('.ant-select-selection-item')).toHaveText(modules[0].title);
  await page.getByRole('button', { name: '创建目标', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(fixture.items()[0].moduleId).toBe('circuit-lab');
  await page.goto('/academics');
  await panel(page).getByRole('button', { name: '创建学习目标' }).click();
  await chooseModule(page, modules[1].title);
  await expect(page.getByRole('dialog')).toContainText('同一道题重复通过只计一次');
  await page.getByRole('button', { name: '创建目标', exact: true }).click();
  const card = page.getByTestId('academic-goal-goal-2');
  await expect(card.getByText('0 / 3 题', { exact: true })).toBeVisible();
  await expect(card.getByRole('link')).toHaveAttribute('href', '/algorithms');
});

test('409保留表单，读取最新版本后需再次明确确认，不自动覆盖', async ({ page }) => {
  const fixture = await setup(page, [goal()]);
  await page.goto('/academics');
  await page.getByRole('button', { name: '编辑目标 三次电路对照实验', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑学习目标' });
  await expect(dialog.getByRole('combobox', { name: '学习模块' })).toBeDisabled();
  await dialog.getByLabel('目标标题', { exact: true }).fill('保留我的五次实验');
  await dialog.getByLabel('目标数量', { exact: true }).fill('5');
  await dialog.getByLabel('截止日期（北京时间，可选）', { exact: true }).fill('2030-01-03');
  fixture.conflictNext();
  await dialog.getByRole('button', { name: '保存目标', exact: true }).click();
  await expect(dialog).toContainText('你的输入仍然保留');
  await dialog.getByRole('button', { name: '保留输入并刷新版本', exact: true }).click();
  await expect(dialog.getByText('另一窗口更新的目标', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('目标标题', { exact: true })).toHaveValue('保留我的五次实验');
  await expect(dialog.getByLabel('目标数量', { exact: true })).toHaveValue('5');
  await expect(dialog.getByLabel('截止日期（北京时间，可选）', { exact: true })).toHaveValue('2030-01-03');
  expect(fixture.requests.filter((item) => item.method === 'PATCH')).toHaveLength(1);
  await dialog.getByRole('button', { name: '按最新版本保存我的输入' }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '确认保存' }).click();
  await expect(dialog).toBeHidden();
  expect(fixture.items()[0]).toMatchObject({
    title: '保留我的五次实验',
    targetCount: 5,
    revision: 2,
    dueDate: '2030-01-03',
    progressCount: 0,
  });
  expect(fixture.requests.filter((item) => item.method === 'PATCH').at(-1)!.body).toEqual({
    revision: 1,
    title: '保留我的五次实验',
    targetCount: 5,
    dueDate: '2030-01-03',
  });
});

test('冲突目标已被删除时仍保留输入且不重建目标', async ({ page }) => {
  const fixture = await setup(page, [goal()]);
  await page.goto('/academics');
  await page.getByRole('button', { name: '编辑目标 三次电路对照实验', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('目标标题', { exact: true }).fill('需要保留的编辑');
  fixture.conflictNext();
  await dialog.getByRole('button', { name: '保存目标', exact: true }).click();
  await expect(dialog).toContainText('你的输入仍然保留');
  fixture.remove('goal-1');
  await dialog.getByRole('button', { name: '保留输入并刷新版本', exact: true }).click();
  await expect(dialog).toContainText('这个目标已被删除');
  await expect(dialog.getByLabel('目标标题', { exact: true })).toHaveValue('需要保留的编辑');
  await expect(dialog.getByRole('button', { name: '按最新版本保存我的输入' })).toHaveCount(0);
  expect(fixture.requests.filter((item) => item.method === 'POST')).toHaveLength(0);
});

test('归档、恢复和删除携带最新版本，删除前确认且不更改学习进度', async ({ page }) => {
  const fixture = await setup(page, [goal({ progressCount: 2 })]);
  await page.goto('/academics');
  const card = page.getByTestId('academic-goal-goal-1');
  await card.getByRole('button', { name: '归档目标 三次电路对照实验', exact: true }).click();
  await expect(card).toHaveCount(0);
  await filterGoals(page, '已归档');
  await expect(card.getByText('2 / 3 次', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '恢复目标 三次电路对照实验', exact: true }).click();
  await expect(card).toHaveCount(0);
  await filterGoals(page, '当前目标');
  await card.getByRole('button', { name: '删除目标 三次电路对照实验', exact: true }).click();
  expect(fixture.requests.filter((item) => item.method === 'DELETE')).toHaveLength(0);
  await page.getByRole('tooltip').getByRole('button', { name: '删除目标', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(fixture.requests.filter((item) => item.method === 'PATCH').map((item) => item.body)).toEqual([
    { revision: 0, archived: true },
    { revision: 1, archived: false },
  ]);
  expect(fixture.requests.find((item) => item.method === 'DELETE')!.body).toEqual({ revision: 2 });
});

test('表单边界和服务错误不显示虚假创建成功', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics');
  await panel(page).getByRole('button', { name: '创建学习目标' }).click();
  await chooseModule(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('目标数量', { exact: true })).toHaveAttribute('aria-valuemin', '1');
  await expect(dialog.getByLabel('目标数量', { exact: true })).toHaveAttribute('aria-valuemax', '1000');
  await dialog.getByLabel('目标数量', { exact: true }).fill('');
  await dialog.getByRole('button', { name: '创建目标', exact: true }).click();
  await expect(dialog.getByText('请填写目标数量', { exact: true })).toBeVisible();
  expect(fixture.requests.filter((item) => item.method === 'POST')).toHaveLength(0);
  await dialog.getByLabel('目标数量', { exact: true }).fill('3');
  fixture.failCreate();
  await dialog.getByRole('button', { name: '创建目标', exact: true }).click();
  await expect(dialog).toContainText('当前空间已达到100个目标');
  await expect(dialog.getByLabel('目标标题', { exact: true })).toHaveValue('电阻网络与RC响应学习目标');
  await dialog.locator('.ant-modal-close').click();
  fixture.failList(true);
  await panel(page).getByRole('button', { name: '刷新目标', exact: true }).click();
  await expect(
    panel(page).getByText('连接暂时不可用，正在显示上次已加载的内容', { exact: true }),
  ).toBeVisible();
  fixture.failList(false);
  await panel(page).getByRole('button', { name: '刷新目标', exact: true }).click();
  await expect(panel(page).getByText('还没有学习目标。选一个模块，设定一个小目标开始吧。')).toBeVisible();
  await expect(
    panel(page).getByText('连接暂时不可用，正在显示上次已加载的内容', { exact: true }),
  ).toHaveCount(0);
});

test('目标首次加载失败时展示真实错误，重试后展示服务器记录', async ({ page }) => {
  const fixture = await setup(page, [goal()]);
  fixture.failList(true);
  await page.goto('/academics');
  await expect(panel(page).getByText('目标服务暂时不可用', { exact: true })).toBeVisible();
  await expect(page.getByTestId('academic-goal-goal-1')).toHaveCount(0);
  fixture.failList(false);
  await panel(page).getByRole('button', { name: '刷新目标', exact: true }).click();
  await expect(page.getByTestId('academic-goal-goal-1')).toBeVisible();
});

test('北京时间期限提醒和390px目标面板及表单不会横向溢出', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page, [
    goal({ dueDate: plannerDay() }),
    goal({ id: 'expired', title: '已过期的练习目标', dueDate: '2020-01-01', overdue: true }),
    goal({
      id: 'completed',
      title: '已经完成的算法目标',
      moduleId: 'algorithms',
      unit: '题',
      dueDate: '2020-01-01',
      progressCount: 4,
      completed: true,
    }),
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/academics');
  await expect(page.getByTestId('academic-goal-goal-1')).toContainText('今天到期（北京时间）');
  await expect(page.getByTestId('academic-goal-expired').getByText('已过期', { exact: true })).toBeVisible();
  await expect(
    page.getByTestId('academic-goal-completed').getByText('已完成', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await mkdir('test-results/academic-goals', { recursive: true });
  await page.screenshot({
    path: 'test-results/academic-goals/goals-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await panel(page).getByRole('button', { name: '创建学习目标' }).click();
  await chooseModule(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.ant-select-dropdown')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await page.screenshot({ path: 'test-results/academic-goals/create-mobile.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('账号切换后迟到的创建响应不会写入另一个账号的目标缓存', async ({ page }) => {
  const fixture = await setup(page);
  fixture.delayCreate();
  await page.goto('/academics');
  await panel(page).getByRole('button', { name: '创建学习目标' }).click();
  await chooseModule(page);
  await page.getByLabel('目标标题', { exact: true }).fill('A的私有学习目标');
  await page.getByRole('button', { name: '创建目标', exact: true }).click();
  await expect.poll(() => fixture.items().length).toBe(1);
  try {
    fixture.expire();
    // Session expiry unmounts the editor without replacing the browser document,
    // so its in-flight response can genuinely arrive after B has signed in.
    await page.evaluate(() => window.dispatchEvent(new Event('auth-expired')));
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('账号', { exact: true }).fill('B');
    await page.getByLabel('密码', { exact: true }).fill('mock-password-only');
    await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
    await expect(panel(page)).toBeVisible();
    const finished = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/api/academics/goals'),
    );
    fixture.releaseCreate();
    await finished;
    await panel(page).getByRole('button', { name: '刷新目标', exact: true }).click();
    await expect(panel(page)).not.toContainText('A的私有学习目标');
    expect(fixture.items('B')).toHaveLength(0);
  } finally {
    fixture.releaseCreate();
  }
});
