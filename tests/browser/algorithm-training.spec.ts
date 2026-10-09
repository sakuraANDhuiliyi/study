// Local API contracts only; no compiler, AI provider or real user records are used.
import { expect, test, type Page, type Route } from '@playwright/test';
import { emptyLearningActions } from './empty-learning-actions-fixture';

test.use({ actionTimeout: 15000 });
const stamp = '2026-10-09T12:00:00.000Z';
const catalog = [
  { id: 'sum-of-two', number: 1, title: '两数相加', difficulty: 'easy', tags: ['输入输出'] },
  { id: 'array-maximum', number: 2, title: '寻找最高分', difficulty: 'easy', tags: ['数组'] },
  { id: 'range-sum', number: 5, title: '静态区间求和', difficulty: 'medium', tags: ['前缀和'] },
];
const statuses: Record<string, string> = { 'sum-of-two': 'solved', 'array-maximum': 'attempted' };
function dto(plan: any) {
  const problems = plan.problemIds.map((id: string) => ({
    ...catalog.find((problem) => problem.id === id),
    status: statuses[id] ?? 'todo',
  }));
  return {
    ...plan,
    problems,
    total: problems.length,
    solved: problems.filter((problem: any) => problem.status === 'solved').length,
    nextProblemId: problems.find((problem: any) => problem.status !== 'solved')?.id ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
async function fixture(page: Page, options: { empty?: boolean; full?: boolean; twoPlans?: boolean } = {}) {
  await page.addInitScript(() => localStorage.setItem('algorithm-editor-mode', 'simple'));
  let plans: any[] = options.empty
    ? []
    : [
        {
          id: 'plan-one',
          title: '本周训练',
          description: '按自己的顺序练习',
          revision: 0,
          archived: false,
          problemIds: ['array-maximum', 'sum-of-two', 'range-sum'],
        },
      ];
  if (options.full)
    plans = Array.from({ length: 20 }, (_, index) => ({
      ...plans[0],
      id: `plan-${index}`,
      title: `训练 ${index + 1}`,
    }));
  if (options.twoPlans) plans.push({ ...plans[0], id: 'plan-two', title: '另一份训练计划' });
  let account = 'a';
  let nextRead: { seen: () => void; wait: Promise<void> } | null = null;
  let nextWrite: { seen: () => void; wait: Promise<void> } | null = null;
  const calls: { path: string; method: string; account: string }[] = [];
  const user = () => ({
    id: `training-user-${account}`,
    organizationId: `training-space-${account}`,
    accountMode: 'PERSONAL',
    name: account === 'a' ? '练习学生' : '另一位学生',
    username: `training-${account}`,
    role: 'STUDENT',
    roles: ['STUDENT'],
    permissions: ['learning.use'],
  });
  const requests: { path: string; method: string; body: any; csrf?: string }[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    const body = method === 'GET' ? null : request.postDataJSON();
    const requestAccount = account;
    calls.push({ path, method, account: requestAccount });
    if (method !== 'GET') requests.push({ path, method, body, csrf: request.headers()['x-csrf-token'] });
    if (path === '/api/auth/me')
      return json(route, {
        csrfToken: 'training-csrf',
        user: user(),
      });
    if (path === '/api/auth/login') {
      account = 'b';
      return json(route, { user: user(), csrfToken: 'training-csrf-b' }, 201);
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/planner/actions')
      return json(route, emptyLearningActions(new URL(route.request().url())));
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
    if (path === '/api/algorithms/training-plans') {
      if (method === 'GET') {
        const response = {
          items: requestAccount === 'a' ? plans.map(dto) : [],
          catalog,
          limits: { maxPlans: 20, maxProblems: 50 },
        };
        if (nextRead) {
          const held = nextRead;
          nextRead = null;
          held.seen();
          await held.wait;
        }
        return json(route, response).catch(() => {});
      }
      const plan = { id: `plan-${plans.length + 1}`, ...body, revision: 0, archived: false };
      plans.push(plan);
      if (nextWrite) {
        const held = nextWrite;
        nextWrite = null;
        held.seen();
        await held.wait;
      }
      return json(route, dto(plan), 201);
    }
    const match = /^\/api\/algorithms\/training-plans\/([^/]+)$/.exec(path);
    if (match) {
      const plan = plans.find((item) => item.id === match[1]);
      if (!plan) return json(route, { message: '训练计划不存在' }, 404);
      if (plan.revision !== body.revision) return json(route, { message: '训练计划已更新' }, 409);
      if (method === 'DELETE') {
        plans = plans.filter((item) => item.id !== plan.id);
        return json(route, { ok: true });
      }
      Object.assign(plan, body, { revision: plan.revision + 1 });
      return json(route, dto(plan));
    }
    if (path === '/api/algorithms/status')
      return json(route, {
        judge: { available: false, reason: '契约测试', languages: [] },
        ai: { available: false, reason: '契约测试' },
      });
    if (path === '/api/algorithms/overview')
      return json(route, {
        dailyProblem: { ...catalog[0], status: 'solved' },
        recommendation: { ...catalog[1], status: 'attempted' },
        activity: [],
        stats: { submitted: 1, accepted: 1, solved: 1, streak: 1 },
        plans: [],
      });
    if (path === '/api/algorithms/problems')
      return json(route, {
        items: catalog.map((problem) => ({ ...problem, status: statuses[problem.id] ?? 'todo' })),
        total: 3,
        page: 1,
        pageSize: 12,
        stats: { total: 3, attempted: 2, solved: 1 },
        tags: ['数组'],
      });
    const problem = /^\/api\/algorithms\/problems\/([^/]+)$/.exec(path);
    if (problem) {
      const summary = catalog.find((entry) => entry.id === problem[1]) ?? catalog[0];
      return json(route, {
        ...summary,
        status: statuses[summary.id] ?? 'todo',
        description: '读入整数并计算',
        inputFormat: '整数输入',
        outputFormat: '整数结果',
        constraints: '合法整数',
        timeLimitMs: 1000,
        memoryLimitMb: 128,
        examples: [{ input: '1 2', output: '3' }],
        starterCode: {
          cpp: 'int main() {}',
          python: 'print(0)',
          javascript: 'console.log(0)',
          java: 'class Main {}',
        },
        draft: null,
        navigation: { previousProblemId: 'global-previous', nextProblemId: 'global-next' },
      });
    }
    if (path.endsWith('/learning'))
      return json(route, { favorite: false, reviewStatus: 'none', note: '', revision: 0, updatedAt: null });
    if (path.endsWith('/submissions') || path.endsWith('/analyses'))
      return json(route, { items: [], total: 0, page: 1, pageSize: 10 });
    return json(route, { items: [], total: 0 });
  });
  return {
    requests,
    calls,
    holdRead() {
      let seen!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        seen = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      nextRead = { seen, wait };
      return { started, release };
    },
    holdWrite() {
      let seen!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        seen = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      nextWrite = { seen, wait };
      return { started, release };
    },
    plans: () => plans,
    change(planId = 'plan-one') {
      const plan = plans.find((item) => item.id === planId);
      plan.title = '另一窗口的新名称';
      plan.revision++;
    },
  };
}
async function choose(page: Page, text: string) {
  const select = page.getByRole('combobox', { name: '选择训练题目' });
  await select.click();
  await select.fill(text);
  await page.getByRole('option').filter({ hasText: text }).click();
  await select.press('Escape');
}

test('create an ordered personal plan with explicit selection, CSRF and actual completion progress', async ({
  page,
}) => {
  const state = await fixture(page, { empty: true });
  await page.goto('/algorithms');
  await page.getByRole('button', { name: '新建训练计划' }).click();
  await page.getByLabel('计划名称', { exact: true }).fill('数组基础训练');
  await page.getByLabel('学习说明（可选）', { exact: true }).fill('先做数组，再复习输入输出');
  await choose(page, '寻找最高分');
  await choose(page, '两数相加');
  await page.getByRole('button', { name: '上移第 2 题' }).click();
  await page.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByRole('heading', { name: '数组基础训练' })).toBeVisible();
  const creation = state.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/training-plans'),
  )!;
  expect(creation.csrf).toBe('training-csrf');
  expect(creation.body.problemIds).toEqual(['sum-of-two', 'array-maximum']);
  await expect(page.getByRole('article', { name: '数组基础训练' })).toContainText('1 / 2 题通过');
});

test('stale plan edits keep input and require choosing the latest revision before saving', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/algorithms');
  await page
    .getByRole('article', { name: '本周训练' })
    .getByRole('button', { name: /^编\s*辑$/ })
    .click();
  await page.getByLabel('计划名称', { exact: true }).fill('我保留的修改');
  state.change();
  await page.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByText('计划已更新，当前输入仍保留', { exact: true })).toBeVisible();
  await expect(page.getByLabel('计划名称', { exact: true })).toHaveValue('我保留的修改');
  await expect(page.getByRole('button', { name: '保存计划' })).toBeDisabled();
  await page.getByRole('button', { name: '基于最新版本继续编辑' }).click();
  await page.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByRole('heading', { name: '我保留的修改' })).toBeVisible();
  const changes = state.requests.filter((request) => request.method === 'PATCH');
  expect(changes.map((request) => request.body.revision)).toEqual([0, 1]);
});

test('archive, restore and explicit delete preserve the independent practice records', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/algorithms');
  await page
    .getByRole('article', { name: '本周训练' })
    .getByRole('button', { name: /^归\s*档$/ })
    .click();
  await expect(page.getByRole('article', { name: '本周训练' })).toHaveCount(0);
  await page.getByRole('combobox', { name: '显示训练计划' }).press('ArrowDown');
  await page.getByRole('option', { name: '已归档', exact: true }).click();
  await page.getByRole('article', { name: '本周训练' }).getByRole('button', { name: '恢复计划' }).click();
  await page.getByRole('combobox', { name: '显示训练计划' }).press('ArrowDown');
  await page.getByRole('option', { name: '进行中的计划', exact: true }).click();
  await page
    .getByRole('article', { name: '本周训练' })
    .getByRole('button', { name: /^删\s*除$/ })
    .click();
  await expect(page.getByText('已保存的代码、笔记和提交记录仍会保留。')).toBeVisible();
  await page.getByRole('button', { name: '删除计划', exact: true }).click();
  await expect(page.getByRole('article', { name: '本周训练' })).toHaveCount(0);
  expect(state.plans()).toHaveLength(0);
  expect(
    state.requests.filter((request) => request.method === 'DELETE').map((request) => request.path),
  ).toEqual(['/api/algorithms/training-plans/plan-one']);
});

test('continue training preserves the chosen plan order inside the problem workspace', async ({ page }) => {
  await fixture(page);
  await page.goto('/algorithms');
  await page.getByRole('article', { name: '本周训练' }).getByRole('button', { name: '继续训练' }).click();
  await expect(page).toHaveURL(/algorithms\/array-maximum\?plan=plan-one$/);
  const navigation = page.getByRole('region', { name: '训练计划导航' });
  await expect(navigation).toContainText('第 1 / 3 题');
  await expect(navigation.getByRole('link', { name: '计划上一题' })).toHaveCount(0);
  await navigation.getByRole('link', { name: '计划下一题' }).click();
  await expect(page).toHaveURL(/algorithms\/sum-of-two\?plan=plan-one$/);
  await expect(navigation).toContainText('第 2 / 3 题');
  await expect(page.getByRole('link', { name: '下一题', exact: true })).toHaveCount(0);
});

test('plan capacity includes archived plans and a missing foreign plan does not replace ordinary practice', async ({
  page,
}) => {
  await fixture(page, { full: true });
  await page.goto('/algorithms');
  await expect(page.getByRole('button', { name: '新建训练计划' })).toBeDisabled();
  await page.goto('/algorithms/sum-of-two?plan=foreign-plan');
  await expect(page.getByText('训练计划不存在或当前学习空间不可访问')).toBeVisible();
  await expect(page.getByRole('heading', { name: '两数相加', exact: true })).toBeVisible();
});

test('390px plans and ordered editor remain readable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/algorithms');
  await page
    .getByRole('article', { name: '本周训练' })
    .getByRole('button', { name: /^编\s*辑$/ })
    .click();
  await expect(page.getByRole('list', { name: '训练题目顺序' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '.data/current-audit/training-plan-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('a delayed conflict reread cannot replace another plan editor', async ({ page }) => {
  const state = await fixture(page, { twoPlans: true });
  await page.goto('/algorithms');
  await page
    .getByRole('article', { name: '本周训练' })
    .getByRole('button', { name: /^编\s*辑$/ })
    .click();
  state.change();
  await page.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByText('计划已更新，当前输入仍保留', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '基于最新版本继续编辑' })).toBeVisible();
  const read = state.holdRead();
  await page.getByRole('button', { name: '重新读取最新计划' }).click();
  await read.started;
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^取\s*消$/ })
    .click();
  await page
    .getByRole('article', { name: '另一份训练计划' })
    .getByRole('button', { name: /^编\s*辑$/ })
    .click();
  await page.getByLabel('计划名称', { exact: true }).fill('第二份计划自己的输入');
  read.release();
  await expect(page.getByLabel('计划名称', { exact: true })).toHaveValue('第二份计划自己的输入');
  await expect(page.getByText('计划已更新，当前输入仍保留', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByRole('heading', { name: '第二份计划自己的输入' })).toBeVisible();
  expect(state.requests.filter((request) => request.method === 'PATCH').at(-1)?.path).toBe(
    '/api/algorithms/training-plans/plan-two',
  );
});

test('late save completion after account expiry does not refetch or notify for the old owner', async ({
  page,
}) => {
  const state = await fixture(page, { empty: true });
  await page.goto('/algorithms');
  await page.getByRole('button', { name: '新建训练计划' }).click();
  await page.getByLabel('计划名称', { exact: true }).fill('旧账号的私人训练');
  await choose(page, '两数相加');
  const write = state.holdWrite();
  await page.getByRole('button', { name: '保存计划' }).click();
  await write.started;
  await page.evaluate(() => window.dispatchEvent(new Event('auth-expired')));
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('账号', { exact: true }).fill('training-b');
  await page.getByLabel('密码', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page.getByRole('heading', { name: /学习/ }).first()).toBeVisible();
  const marker = state.calls.length;
  write.release();
  await page.getByRole('link', { name: '算法练习', exact: true }).click();
  await expect(page.getByRole('region', { name: '我的训练计划' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '旧账号的私人训练' })).toHaveCount(0);
  await expect(page.getByText('训练计划已创建', { exact: true })).toHaveCount(0);
  expect(
    state.calls.slice(marker).filter((call) => call.path === '/api/algorithms/training-plans'),
  ).toHaveLength(1);
});
