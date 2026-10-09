// Browser API-contract fixtures: these tests do not invoke a real compiler or AI provider.
import { test, expect, type Page, type Route } from '@playwright/test';
import { emptyLearningActions } from './empty-learning-actions-fixture';
import { mkdir } from 'node:fs/promises';

test.use({ actionTimeout: 15000 });

const stamp = '2026-10-08T08:00:00.000Z';
const languages = [
  { id: 'cpp', label: 'C++ 17' },
  { id: 'python', label: 'Python 3' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'java', label: 'Java' },
];
const problem = {
  id: 'two-sum',
  number: 1,
  title: '两数之和',
  difficulty: 'easy',
  tags: ['数组', '哈希表'],
  status: 'todo',
  description: '给定一个整数数组和目标值，找出和等于目标值的两个下标。',
  inputFormat: '第一行输入 n 和 target，第二行输入 n 个整数。',
  outputFormat: '输出两个下标，以空格分隔。',
  constraints: '2 ≤ n ≤ 100000；保证有且仅有一组答案。',
  timeLimitMs: 2000,
  memoryLimitMb: 128,
  examples: [{ input: '4 9\n2 7 11 15', output: '0 1', explanation: '2 + 7 = 9。' }],
  starterCode: {
    cpp: '#include <iostream>\nint main() {\n    return 0;\n}',
    python: 'import sys\n\n# 读取输入\n',
    javascript: 'const fs = require("fs");\n',
    java: 'public class Main {\n    public static void main(String[] args) {\n    }\n}',
  },
  draft: null as any,
};
const analysis = {
  id: 'analysis-1',
  mode: 'hint',
  status: 'ready',
  createdAt: stamp,
  content: {
    summary: '使用哈希表记录已经遍历过的数字。',
    approach: ['对于每个数字，寻找目标值与它的差。', '在哈希表中查询这个差是否出现。'],
    complexity: '时间 O(n)，空间 O(n)。',
    pitfalls: ['注意不能重复使用同一个元素。'],
    suggestedCode: '',
  },
};

async function setup(page: Page, configured = true, role = 'STUDENT', professional = false) {
  if (!professional) await page.addInitScript(() => localStorage.setItem('algorithm-editor-mode', 'simple'));
  const submissions: any[] = [];
  const analyses: any[] = [];
  const requests: { path: string; method: string; body: any }[] = [];
  let draft: any = null;
  let nextDraftSave: Promise<void> | null = null;
  let failAnalysis = false;
  let account: string | null = 'algorithm-fixture';
  const user = () => ({
    id: account,
    name: account === 'algorithm-fixture' ? '算法测试学生' : '算法测试学生 B',
    username: account,
    role,
    roles: [role],
    organizationId: 'algorithm-fixture-org',
    permissions: ['learning.use'],
  });
  const emptyLearning = () => ({
    favorite: false,
    reviewStatus: 'none',
    note: '',
    revision: 0,
    updatedAt: null as string | null,
  });
  let learning = emptyLearning();
  let nextLearningSave: Promise<void> | null = null;
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.context().route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.method() !== 'GET' ? request.postDataJSON() : null;
    requests.push({ path: url.pathname + url.search, method: request.method(), body });
    if (path === '/api/auth/me')
      return account
        ? json(route, { user: user(), csrfToken: 'fixture-csrf' })
        : json(route, { message: '已退出登录' }, 401);
    if (path === '/api/auth/logout') {
      account = null;
      return json(route, { ok: true });
    }
    if (path === '/api/auth/login') {
      account = 'algorithm-fixture-b';
      draft = null;
      learning = emptyLearning();
      return json(route, { user: user(), csrfToken: 'fixture-csrf-b' });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/planner/actions')
      return json(route, emptyLearningActions(new URL(route.request().url())));
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/algorithms/status')
      return json(route, {
        judge: { available: configured, reason: configured ? '' : '尚未配置编译评测服务', languages },
        ai: { available: configured, reason: configured ? '' : '尚未配置 AI 服务', model: 'fixture-model' },
      });
    if (path === '/api/algorithms/overview')
      return json(route, {
        dailyProblem: problem,
        recommendation: { ...problem, id: 'binary-search', title: '二分查找' },
        activity: Array.from({ length: 28 }, (_, i) => ({
          date: `2026-09-${String(i + 1).padStart(2, '0')}`,
          submissions: i % 5,
          solved: i % 2,
        })),
        stats: { submitted: 32, accepted: 14, solved: 4, streak: 3 },
        plans: [
          {
            id: 'foundation',
            title: '算法入门路径',
            description: '从数组到哈希表，建立基本解题方法',
            level: '入门',
            estimatedDays: 7,
            total: 2,
            solved: 1,
            nextProblemId: 'two-sum',
            chapters: [
              {
                title: '数组与查找',
                description: '先掌握顺序扫描和快速查找',
                problemIds: ['two-sum', 'binary-search'],
                problems: [problem, { ...problem, id: 'binary-search', title: '二分查找', status: 'solved' }],
              },
            ],
          },
        ],
      });
    if (path.endsWith('/learning')) {
      if (request.method() === 'PATCH') {
        if (body.revision !== learning.revision)
          return json(route, { message: '学习记录已被修改，请刷新后重试' }, 409);
        learning = { ...learning, ...body, revision: learning.revision + 1, updatedAt: stamp };
        const saved = { ...learning };
        const delayed = nextLearningSave;
        nextLearningSave = null;
        if (delayed) await delayed;
        return json(route, saved);
      }
      return json(route, learning);
    }
    if (path.endsWith('/editorial'))
      return json(route, {
        editorial: {
          problemId: 'two-sum',
          introduction: '从两层循环逐步优化到一次遍历，理解时间和空间的取舍。',
          prerequisites: ['数组遍历', '哈希表查询'],
          readingGuide: ['输出的是下标还是数值？', '是否允许使用同一个元素两次？'],
          hints: ['先考虑枚举所有数对。', '目标差值能否快速找到？', '边查询边记录已经出现的数字。'],
          approaches: [
            {
              name: '暴力枚举',
              intuition: '固定第一个元素，再枚举第二个元素。',
              steps: ['枚举第一个位置', '查找右侧所有位置'],
              correctness: '每个不同下标对均会被枚举，因此不会遗漏答案。',
              timeComplexity: 'O(n²)',
              spaceComplexity: 'O(1)',
              tradeoff: '便于理解，但大数组上可能超时。',
            },
            {
              name: '哈希表',
              intuition: '把目标减去当前值，查询差值是否出现。',
              steps: ['初始化哈希表', '查询目标差值，再存入当前下标'],
              correctness: '遍历到答案中较晚出现的下标时，较早下标一定已被记录。',
              timeComplexity: 'O(n)',
              spaceComplexity: 'O(n)',
              tradeoff: '用额外空间换取一次遍历。',
            },
          ],
          walkthrough: {
            input: '4 9\n2 7 11 15',
            steps: [
              { step: 1, state: 'i=0，表={}', explanation: '差值7未出现，记录2的下标。' },
              { step: 2, state: 'i=1，表={2:0}', explanation: '差值2已经存在，得到下标0和1。' },
            ],
            result: '0 1',
          },
          edgeCases: [{ case: '重复元素 3 3', why: '两个相同值来自不同下标。' }],
          mistakes: [{ mistake: '先记录后查询', fix: '可能用到当前元素自身，应该先查再存。' }],
          followUp: ['如果答案不唯一，如何输出所有下标对？'],
          relatedProblemIds: ['binary-search'],
          referenceCode: {
            cpp: '#include <iostream>\nint main() { std::cout << "0 1"; }',
            python: 'print("reference answer")',
            javascript: 'console.log("reference answer");',
            java: 'public class Main { public static void main(String[] args) {} }',
          },
        },
        relatedProblems: [{ ...problem, id: 'binary-search', title: '二分查找', status: 'solved' }],
      });
    if (path === '/api/algorithms/problems') {
      const noResults = url.searchParams.get('q') === '不存在';
      return json(route, {
        items: noResults
          ? []
          : [
              problem,
              {
                ...problem,
                id: 'binary-search',
                number: 2,
                title: '二分查找',
                tags: ['二分查找'],
                status: 'solved',
              },
              {
                ...problem,
                id: 'longest-substring',
                number: 3,
                title: '最长不重复子串',
                difficulty: 'medium',
                tags: ['滑动窗口'],
                status: 'attempted',
              },
            ],
        total: noResults ? 0 : 15,
        page: Number(url.searchParams.get('page') || 1),
        pageSize: 12,
        stats: { total: 15, attempted: 7, solved: 4 },
        tags: ['数组', '哈希表', '二分查找', '滑动窗口'],
      });
    }
    if (path === '/api/algorithms/problems/two-sum') return json(route, { ...problem, draft });
    if (path.endsWith('/draft')) {
      if (body.revision !== (draft?.revision ?? 0))
        return json(route, { message: '草稿已在其他页面更新' }, 409);
      draft = { ...body, revision: body.revision + 1, updatedAt: new Date().toISOString() };
      const saved = { ...draft };
      const hold = nextDraftSave;
      nextDraftSave = null;
      if (hold) await hold;
      return json(route, saved);
    }
    if (path.endsWith('/submissions') && request.method() === 'POST') {
      const custom = Object.hasOwn(body, 'stdin');
      const compileError = body.code.includes('compile-fail');
      const item = {
        id: `submission-${submissions.length + 1}`,
        problemId: problem.id,
        ...body,
        customInput: custom,
        status: compileError ? 'compile_error' : body.code.includes('wrong') ? 'wrong_answer' : 'accepted',
        passed: compileError ? 0 : 1,
        total: body.mode === 'submit' ? 2 : 1,
        runtimeMs: 18,
        memoryKb: 4096,
        compileOutput: compileError && body.mode === 'run' ? 'main.cpp:1: error: expected declaration' : null,
        error: null,
        createdAt: stamp,
        results: compileError
          ? []
          : [
              {
                index: 0,
                status: 'accepted',
                input: custom ? body.stdin : problem.examples[0].input,
                expectedOutput: custom ? undefined : '0 1',
                stdout: '0 1',
                hidden: false,
              },
              ...(body.mode === 'submit' ? [{ index: 1, status: 'wrong_answer', hidden: true }] : []),
            ],
      };
      submissions.unshift(item);
      return json(route, item, 201);
    }
    if (path.endsWith('/submissions'))
      return json(route, { items: submissions, total: submissions.length, page: 1, pageSize: 8 });
    if (path.startsWith('/api/algorithms/submissions/'))
      return json(
        route,
        submissions.find((item) => path.endsWith(item.id)),
      );
    if (path.endsWith('/analysis')) {
      if (failAnalysis) {
        analyses.unshift({
          id: 'failed-analysis',
          mode: body.mode,
          status: 'failed',
          error: 'AI 服务暂时不可用',
          content: null,
          createdAt: stamp,
        });
        return json(route, { message: 'AI 服务暂时不可用，请稍后重试' }, 503);
      }
      const report = { ...analysis, id: `analysis-${analyses.length + 1}`, mode: body.mode };
      analyses.unshift(report);
      return json(route, report);
    }
    if (path.endsWith('/analyses')) return json(route, { items: analyses });
    return json(route, { message: '未定义的算法 UI 契约请求' }, 404);
  });
  return {
    requests,
    submissions,
    failNextAnalysis: () => {
      failAnalysis = true;
    },
    setServerDraft: (value: any) => {
      draft = value;
    },
    serverDraft: () => draft,
    holdNextDraftSave: () => {
      let release!: () => void;
      nextDraftSave = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    concurrentNoteUpdate: () => {
      learning = {
        ...learning,
        note: '另一个窗口保存的笔记',
        revision: learning.revision + 1,
        updatedAt: stamp,
      };
    },
    learningState: () => learning,
    holdNextLearningSave: () => {
      let release!: () => void;
      nextLearningSave = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

async function openFixtureProblem(page: Page) {
  await page.locator('a[href="/algorithms"]').first().click();
  await page.locator('.algo-problem-row[href="/algorithms/two-sum"]').click();
}

async function loginOtherStudent(page: Page) {
  await page.locator('.topbar-account').hover();
  await page.getByText('退出登录', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('账号', { exact: true }).fill('student-b');
  await page.getByLabel('密码', { exact: true }).fill('fixture-only-password');
  await page.getByRole('button', { name: '登录学习平台' }).click();
  await expect(page.getByRole('button', { name: '算法测试学生 B的账号菜单' })).toBeVisible();
  await openFixtureProblem(page);
}

test('题库筛选、分页与真实统计', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms');
  await expect(page.getByRole('heading', { name: '算法练习', exact: true })).toBeVisible();
  await expect(page.getByLabel('算法练习统计')).toContainText('15');
  await expect(page.getByLabel('算法练习统计')).toContainText('7');
  await page.getByLabel('搜索算法题').fill('数组');
  await page.getByLabel('搜索算法题').press('Enter');
  await expect(page).toHaveURL(/q=/);
  await page.getByRole('combobox', { name: '题目难度' }).click();
  await page.getByTitle('中等', { exact: true }).click();
  await expect
    .poll(() => fixture.requests.some((item) => item.path.includes('difficulty=medium')))
    .toBeTruthy();
  await page.getByRole('button', { name: '重置筛选' }).click();
  await page.getByTitle('2', { exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.getByLabel('搜索算法题').fill('不存在');
  await page.getByLabel('搜索算法题').press('Enter');
  await expect(page.getByText('没有找到符合条件的算法题')).toBeVisible();
  await page.getByRole('button', { name: '查看全部题目' }).click();
  await mkdir('test-results/algorithms', { recursive: true });
  await page.screenshot({ path: 'test-results/algorithms/library-desktop.png', fullPage: true });
});

test('编辑、草稿恢复、样例和自定义运行、正式提交及历史恢复', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms/two-sum');
  const editor = page.getByLabel('算法代码编辑器');
  await expect(editor).toContainText('#include');
  await editor.fill('print("0 1")');
  await expect
    .poll(() =>
      fixture.requests.some((item) => item.path.endsWith('/draft') && item.body.code === 'print("0 1")'),
    )
    .toBeTruthy();
  await page.reload();
  await expect(editor).toHaveValue('print("0 1")');
  await page.getByRole('combobox', { name: '编程语言' }).press('ArrowDown');
  await page.getByTitle('Python 3', { exact: true }).click();
  await editor.fill('print("0 1")');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByText('样例通过').first()).toBeVisible();
  expect(fixture.submissions[0].language).toBe('python');
  expect(fixture.submissions[0].mode).toBe('run');
  expect(fixture.submissions[0]).not.toHaveProperty('stdin');
  await page.getByRole('tab', { name: '测试输入' }).click();
  await page.getByRole('combobox', { name: '运行输入方式' }).press('ArrowDown');
  await page.getByTitle('自定义输入', { exact: true }).click();
  await page.getByLabel('标准输入', { exact: true }).fill('4 9\n2 7 11 15');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByText('自定义运行不校验答案，不会将本题标记为已解决。')).toBeVisible();
  expect(fixture.submissions[0].stdin).toBe('4 9\n2 7 11 15');
  await editor.fill('wrong');
  await page.getByRole('button', { name: '提交评测', exact: true }).click();
  await expect(page.getByText('用例 2 · 隐藏')).toBeVisible();
  await page.getByText('用例 2 · 隐藏').click();
  await expect(
    page.getByText('此用例的输入、预期输出和程序输出不公开，请结合数据范围检查边界条件。'),
  ).toBeVisible();
  await page.getByRole('tab', { name: '提交记录' }).click();
  await page.locator('.algo-history-item').last().click();
  await page.getByText('查看此次运行的代码 · Python 3').click();
  await page.getByRole('button', { name: '恢复这份代码' }).click();
  await page.getByRole('button', { name: '恢复代码', exact: true }).click();
  await expect(editor).toHaveValue('print("0 1")');
  await page.getByRole('tab', { name: '题目描述' }).click();
  await expect(page.getByRole('button', { name: '恢复代码', exact: true })).not.toBeVisible();
  await page.screenshot({
    path: 'test-results/algorithms/detail-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('编译日志和 AI 成功、失败、历史', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms/two-sum');
  await page.getByLabel('算法代码编辑器').fill('compile-fail');
  await page.getByRole('button', { name: '提交评测', exact: true }).click();
  await expect(page.getByText('运行样例查看编译日志')).toBeVisible();
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByText('main.cpp:1: error: expected declaration')).toBeVisible();
  await page.getByRole('tab', { name: 'AI 解析' }).click();
  await page.getByRole('button', { name: '思路提示', exact: true }).click();
  await expect(page.locator('.algo-analysis-report')).toContainText('使用哈希表记录已经遍历过的数字。');
  await expect(page.locator('.algo-analysis-report')).toContainText('时间 O(n)，空间 O(n)。');
  fixture.failNextAnalysis();
  await page.getByRole('button', { name: '代码诊断', exact: true }).click();
  await expect(page.getByText('解析生成失败', { exact: true })).toBeVisible();
  await expect(page.locator('.algo-history-item').first()).toContainText('生成失败');
  await page.locator('.algo-history-item').first().click();
  await expect(page.getByText('这次解析未能完成')).toBeVisible();
});

test('未配置服务时保留编辑能力，移动端无页面横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, false);
  await page.goto('/algorithms/two-sum');
  await expect(page.getByText('部分服务尚未就绪')).toBeVisible();
  await expect(page.getByRole('button', { name: '运行代码', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交评测', exact: true })).toBeDisabled();
  await page.getByLabel('算法代码编辑器').fill('本机草稿');
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('本机草稿');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/algorithms/detail-mobile.png', fullPage: true });
  await page.goto('/algorithms');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/algorithms/library-mobile.png', fullPage: true });
});

test('非学生身份不能直接访问算法页面', async ({ page }) => {
  await setup(page, true, 'TEACHER');
  await page.goto('/algorithms');
  await expect(page.getByText('当前工作身份没有此功能权限，请切换已获授权的身份。')).toBeVisible();
  await expect(page.getByRole('link', { name: '算法练习', exact: true })).toHaveCount(0);
});

test('未知版本的旧离线草稿保留本机代码并暂停自动覆盖，用户选择后才同步', async ({ page }) => {
  const fixture = await setup(page);
  fixture.setServerDraft({
    language: 'python',
    code: '其他窗口的新云端代码',
    revision: 0,
    updatedAt: '2026-10-08T08:00:02.000Z',
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'algorithm-draft:algorithm-fixture-org:algorithm-fixture:two-sum',
      JSON.stringify({
        language: 'python',
        codes: { python: '最新未同步代码' },
        updatedAt: '2026-10-08T08:00:01.000Z',
        unsynced: true,
      }),
    );
  });
  await page.goto('/algorithms/two-sum');
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('最新未同步代码');
  await expect(page.getByLabel('冲突中的云端草稿')).toHaveValue('其他窗口的新云端代码');
  await page.waitForTimeout(1400);
  expect(fixture.requests.filter((item) => item.path.endsWith('/draft'))).toHaveLength(0);
  // Reload cannot turn an unversioned legacy cache into permission to overwrite revision 0.
  await page.reload();
  await expect(page.getByLabel('冲突中的本机草稿')).toHaveValue('最新未同步代码');
  await page.getByRole('button', { name: '保留本机并同步', exact: true }).click();
  await expect
    .poll(() =>
      fixture.requests.some((item) => item.path.endsWith('/draft') && item.body.code === '最新未同步代码'),
    )
    .toBeTruthy();
  expect(fixture.requests.find((item) => item.path.endsWith('/draft'))?.body.revision).toBe(0);
  await expect.poll(() => fixture.serverDraft().revision).toBe(1);
});

test('已知旧版本的离线副本不能自动覆盖较新云端，选择本机仍受第二次冲突保护', async ({ page }) => {
  const fixture = await setup(page);
  fixture.setServerDraft({ language: 'python', code: '云端版本2', revision: 2 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'algorithm-draft:algorithm-fixture-org:algorithm-fixture:two-sum',
      JSON.stringify({
        language: 'python',
        codes: { python: '旧离线编辑' },
        unsynced: true,
        baseRevision: 1,
        updatedAt: '2099-01-01',
      }),
    ),
  );
  await page.goto('/algorithms/two-sum');
  await expect(page.getByLabel('冲突中的云端草稿')).toHaveValue('云端版本2');
  await page.waitForTimeout(1400);
  expect(fixture.requests.filter((item) => item.path.endsWith('/draft'))).toHaveLength(0);
  fixture.setServerDraft({ language: 'python', code: '云端版本3', revision: 3 });
  await page.getByRole('button', { name: '保留本机并同步', exact: true }).click();
  await expect(page.getByLabel('冲突中的云端草稿')).toHaveValue('云端版本3');
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('旧离线编辑');
  expect(fixture.serverDraft().code).toBe('云端版本3');
  await page.getByRole('button', { name: '保留本机并同步', exact: true }).click();
  await expect.poll(() => fixture.serverDraft()?.revision).toBe(4);
  expect(
    fixture.requests.filter((item) => item.path.endsWith('/draft')).map((item) => item.body.revision),
  ).toEqual([2, 3]);
});

test('匹配版本的离线编辑正常恢复同步，不以客户端时间决定覆盖权', async ({ page }) => {
  const fixture = await setup(page);
  fixture.setServerDraft({
    language: 'python',
    code: '已同步旧代码',
    revision: 4,
    updatedAt: '2026-10-08T08:00:02.000Z',
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      'algorithm-draft:algorithm-fixture-org:algorithm-fixture:two-sum',
      JSON.stringify({
        language: 'python',
        codes: { python: '本机离线编辑' },
        unsynced: true,
        baseRevision: 4,
        updatedAt: '2025-01-01',
      }),
    ),
  );
  await page.goto('/algorithms/two-sum');
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('本机离线编辑');
  await expect.poll(() => fixture.serverDraft()?.revision).toBe(5);
  expect(fixture.serverDraft().code).toBe('本机离线编辑');
  await expect(page.getByLabel('冲突中的云端草稿')).toHaveCount(0);
});

test('打开期间云端更新返回409，本机编辑保持，采用云端不产生覆盖请求', async ({ page }) => {
  const fixture = await setup(page);
  fixture.setServerDraft({ language: 'cpp', code: '已读取代码', revision: 1 });
  await page.goto('/algorithms/two-sum');
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('已读取代码');
  fixture.setServerDraft({ language: 'python', code: '另一窗口刚保存的代码', revision: 2 });
  await page.getByLabel('算法代码编辑器').fill('我的未同步代码');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByLabel('冲突中的云端草稿')).toHaveValue('另一窗口刚保存的代码');
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('我的未同步代码');
  await page.getByLabel('算法代码编辑器').fill('冲突期间继续修改');
  await page.waitForTimeout(1400);
  expect(fixture.requests.filter((item) => item.path.endsWith('/draft'))).toHaveLength(1);
  expect(fixture.serverDraft().code).toBe('另一窗口刚保存的代码');
  await page.getByRole('button', { name: '采用云端草稿', exact: true }).click();
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('另一窗口刚保存的代码');
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  expect(fixture.requests.filter((item) => item.path.endsWith('/draft'))).toHaveLength(1);
});

test('同账号两个窗口同时编辑时后保存者得到冲突，保留代码并显式选择', async ({ page, context }) => {
  const fixture = await setup(page);
  fixture.setServerDraft({ language: 'cpp', code: '共同读取的草稿', revision: 1 });
  await page.goto('/algorithms/two-sum');
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('共同读取的草稿');
  const second = await context.newPage();
  await second.goto('/algorithms/two-sum');
  await expect(second.getByLabel('算法代码编辑器')).toHaveValue('共同读取的草稿');
  await page.getByLabel('算法代码编辑器').fill('第一个窗口的新代码');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  await second.getByLabel('算法代码编辑器').fill('第二个窗口的本机编辑');
  await second.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(second.getByLabel('冲突中的云端草稿')).toHaveValue('第一个窗口的新代码');
  await expect(second.getByLabel('算法代码编辑器')).toHaveValue('第二个窗口的本机编辑');
  expect(fixture.serverDraft().code).toBe('第一个窗口的新代码');
  await second.getByRole('button', { name: '保留本机并同步', exact: true }).click();
  await expect.poll(() => fixture.serverDraft()?.revision).toBe(3);
  expect(fixture.serverDraft().code).toBe('第二个窗口的本机编辑');
  expect(
    fixture.requests.filter((item) => item.path.endsWith('/draft')).map((item) => item.body.revision),
  ).toEqual([1, 1, 2]);
  await second.close();
});

test('另一窗口迟到保存响应不能清除本窗口未同步副本，刷新仍保留并比较云端', async ({ page, context }) => {
  const fixture = await setup(page);
  fixture.setServerDraft({ language: 'cpp', code: '共同版本', revision: 1 });
  await page.goto('/algorithms/two-sum');
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('共同版本');
  const second = await context.newPage();
  await second.goto('/algorithms/two-sum');
  await expect(second.getByLabel('算法代码编辑器')).toHaveValue('共同版本');
  const release = fixture.holdNextDraftSave();
  await page.getByLabel('算法代码编辑器').fill('已到云端但响应延迟的代码');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => fixture.serverDraft()?.revision).toBe(2);
  await second.getByLabel('算法代码编辑器').fill('刷新后也不能丢的本机编辑');
  release();
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  const shared = await second.evaluate(() =>
    JSON.parse(localStorage.getItem('algorithm-draft:algorithm-fixture-org:algorithm-fixture:two-sum')!),
  );
  expect(shared.codes.cpp).toBe('刷新后也不能丢的本机编辑');
  // A subsequent explicit edit in the first window updates the shared cache;
  // the second window still has its own backup for reload or navigation.
  await page.route('**/api/algorithms/problems/two-sum/draft', (route) => route.abort());
  await page.getByLabel('算法代码编辑器').fill('第一窗口再次编辑');
  await second.reload();
  await expect(second.getByLabel('算法代码编辑器')).toHaveValue('刷新后也不能丢的本机编辑');
  await expect(second.getByLabel('冲突中的云端草稿')).toHaveValue('已到云端但响应延迟的代码');
  await second.getByRole('button', { name: '采用云端草稿', exact: true }).click();
  await expect(second.getByLabel('算法代码编辑器')).toHaveValue('已到云端但响应延迟的代码');
  expect(
    await second.evaluate(() =>
      sessionStorage.getItem('algorithm-draft:algorithm-fixture-org:algorithm-fixture:two-sum:unsynced'),
    ),
  ).toBeNull();
  await second.close();
});

test('退出后迟到的草稿响应和窗口备份不会进入另一账号的代码或版本', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms/two-sum');
  const input = page.getByLabel('算法代码编辑器');
  await expect(input).toHaveValue(problem.starterCode.cpp);
  const release = fixture.holdNextDraftSave();
  await input.fill('上一账号已发送的私有代码');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => fixture.serverDraft()?.revision).toBe(1);
  await input.fill('上一账号窗口内尚未发送的私有代码');
  await loginOtherStudent(page);
  await expect(input).toHaveValue(problem.starterCode.cpp);
  release();
  await input.fill('新账号自己的草稿');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('新账号自己的草稿');
  const drafts = await page.evaluate(() => ({
    local: JSON.parse(
      localStorage.getItem('algorithm-draft:algorithm-fixture-org:algorithm-fixture-b:two-sum')!,
    ),
    window: sessionStorage.getItem(
      'algorithm-draft:algorithm-fixture-org:algorithm-fixture-b:two-sum:unsynced',
    ),
  }));
  expect(drafts.local.codes.cpp).toBe('新账号自己的草稿');
  expect(drafts.local.baseRevision).toBe(1);
  expect(drafts.window).toBeNull();
  expect(
    fixture.requests.filter((item) => item.path.endsWith('/draft')).map((item) => item.body.revision),
  ).toEqual([0, 0]);
});

test('保存中的新编辑排队使用上次成功版本，迟到响应保留最新代码和语言', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms/two-sum');
  const input = page.getByLabel('算法代码编辑器');
  await expect(input).toHaveValue(problem.starterCode.cpp);
  const release = fixture.holdNextDraftSave();
  await input.fill('第一份代码');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => fixture.serverDraft()?.revision).toBe(1);
  await page.getByRole('combobox', { name: '编程语言' }).press('ArrowDown');
  await page.getByTitle('Python 3', { exact: true }).click();
  await input.fill('print("最新代码")');
  release();
  await expect.poll(() => fixture.serverDraft()?.revision).toBe(2);
  await expect(input).toHaveValue('print("最新代码")');
  const writes = fixture.requests.filter((item) => item.path.endsWith('/draft'));
  expect(writes.map((item) => item.body.revision)).toEqual([0, 1]);
  expect(writes.at(-1)?.body.language).toBe('python');
  const local = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('algorithm-draft:algorithm-fixture-org:algorithm-fixture:two-sum')!),
  );
  expect(local.baseRevision).toBe(2);
  expect(local.unsynced).toBe(false);
  expect(local.codes.cpp).toBe('第一份代码');
});

test('专业编辑器使用本地 Monaco、快捷键、主题、全屏和可调分栏', async ({ page }) => {
  const fixture = await setup(page, true, 'STUDENT', true);
  const assetRequests: string[] = [];
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('request', (request) => {
    if (['script', 'stylesheet', 'font'].includes(request.resourceType())) assetRequests.push(request.url());
  });
  await page.goto('/algorithms/two-sum');
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
  const input = page.getByRole('textbox', { name: '算法代码编辑器', exact: true });
  await input.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('int main() { return 0; }');
  await page.keyboard.press('ControlOrMeta+s');
  await expect
    .poll(() =>
      fixture.requests.some(
        (item) => item.path.endsWith('/draft') && item.body.code === 'int main() { return 0; }',
      ),
    )
    .toBeTruthy();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => fixture.submissions.length).toBe(1);
  await expect(page.getByText('样例通过').first()).toBeVisible();
  await input.focus();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  await expect.poll(() => fixture.submissions[0]?.mode).toBe('submit');
  await page.getByRole('combobox', { name: '编程语言' }).press('ArrowDown');
  await page.getByTitle('JavaScript', { exact: true }).click();
  await input.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('const answer = 42;\nconsole.log(answer);');
  await expect.poll(() => workers.some((url) => url.includes('ts.worker'))).toBeTruthy();
  await page.getByRole('combobox', { name: '编辑器主题' }).press('ArrowDown');
  await page.getByTitle('深色', { exact: true }).click();
  await expect(page.locator('.monaco-editor.vs-dark')).toBeVisible();
  await page.getByRole('button', { name: '编辑器全屏', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '全屏代码编辑器' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '全屏代码编辑器' })).toHaveCount(0);
  const separator = page.getByRole('separator', { name: '调整题目与代码区域宽度' });
  await separator.focus();
  await separator.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '46');
  await page.getByRole('button', { name: '查找代码', exact: true }).click();
  await expect(page.locator('.monaco-editor .find-widget')).toBeVisible();
  expect(assetRequests.some((url) => /cdn\.jsdelivr|unpkg|cdnjs/.test(url))).toBeFalsy();
  expect(workers.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/algorithms/monaco-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('详细题解渐进提示、答案门槛、四语言参考代码和确认载入', async ({ page }) => {
  await setup(page);
  await page.goto('/algorithms/two-sum');
  await page.getByLabel('算法代码编辑器').fill('my own solution');
  await page.getByRole('tab', { name: '题解', exact: true }).click();
  await expect(page.getByText('哈希表查询', { exact: true })).toBeVisible();
  await expect(page.getByText('先考虑枚举所有数对。', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '查看第 1 条提示', exact: true }).click();
  await expect(page.getByText('先考虑枚举所有数对。', { exact: true })).toBeVisible();
  await expect(page.getByText('目标差值能否快速找到？', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '展开第 2 条提示', exact: true }).click();
  await expect(page.getByText('目标差值能否快速找到？', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '参考代码', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '显示完整题解与答案', exact: true }).click();
  await expect(page.getByRole('heading', { name: '解法比较', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '跟着样例走一遍', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '参考代码语言' }).press('ArrowDown');
  await page.getByTitle('Python 3', { exact: true }).click();
  await expect(page.locator('.algo-reference-code')).toContainText('print("reference answer")');
  await page.getByRole('button', { name: '载入编辑器', exact: true }).click();
  await page.getByRole('button', { name: /取\s*消/ }).click();
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('my own solution');
  await page.getByRole('button', { name: '载入编辑器', exact: true }).click();
  await page.getByRole('button', { name: '载入参考代码', exact: true }).click();
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('print("reference answer")');
  await expect(page.getByText('载入参考代码前的草稿已备份', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复原草稿', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '恢复原草稿', exact: true }).click();
  await expect(page.getByLabel('算法代码编辑器')).toHaveValue('my own solution');
  await page.screenshot({
    path: 'test-results/algorithms/editorial-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('学习计划、收藏和笔记持久化，版本冲突保留输入', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms');
  await expect(page.getByText('连续 3 天', { exact: true })).toBeVisible();
  await expect(page.getByLabel('最近28天提交活动').locator('> span')).toHaveCount(28);
  await page.getByText('算法入门路径', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '01 数组与查找' })).toBeVisible();
  await page.getByRole('button', { name: '继续学习', exact: true }).click();
  await page.getByRole('button', { name: '收藏题目', exact: true }).click();
  await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  expect(fixture.learningState().favorite).toBeTruthy();
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await page.getByLabel('我的解题笔记').fill('我的第一版笔记 <vector>');
  await page.getByRole('combobox', { name: '复习状态' }).press('ArrowDown');
  await page.getByTitle('需要复习', { exact: true }).click();
  await page.getByRole('button', { name: '保存笔记与状态', exact: true }).click();
  await expect.poll(() => fixture.learningState().note).toBe('我的第一版笔记 <vector>');
  await page.getByLabel('我的解题笔记').fill('保留这份尚未同步的新思路');
  fixture.concurrentNoteUpdate();
  await page.getByRole('button', { name: '保存笔记与状态', exact: true }).click();
  await expect(page.getByText('检测到版本冲突', { exact: true })).toBeVisible();
  await expect(page.getByLabel('我的解题笔记')).toHaveValue('保留这份尚未同步的新思路');
  await page.getByRole('button', { name: '保留我的内容并重新保存', exact: true }).click();
  await page.getByRole('button', { name: '保存我的内容', exact: true }).click();
  await expect.poll(() => fixture.learningState().note).toBe('保留这份尚未同步的新思路');
  await expect(page.getByText('检测到版本冲突', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(page.getByLabel('我的解题笔记')).toHaveValue('保留这份尚未同步的新思路');
});

test('自填预期输出只做本地差异比较', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms/two-sum');
  await page.getByRole('combobox', { name: '运行输入方式' }).press('ArrowDown');
  await page.getByTitle('自定义输入', { exact: true }).click();
  await page.getByLabel('标准输入', { exact: true }).fill('4 9\n2 7 11 15');
  await page.getByLabel('预期输出（可选，用于本机自测）').fill('0 2');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByText('自测比较：存在差异', { exact: true })).toBeVisible();
  const request = fixture.requests.find(
    (item) => item.method === 'POST' && item.path.endsWith('/submissions'),
  )!;
  expect(request.body).not.toHaveProperty('expectedOutput');
  expect(request.body.stdin).toBe('4 9\n2 7 11 15');
});

test('Monaco 多语言草稿保留，退出后另一账号不会复用代码或撤销历史', async ({ page }) => {
  const fixture = await setup(page, true, 'STUDENT', true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/algorithms/two-sum');
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
  const input = page.getByRole('textbox', { name: '算法代码编辑器', exact: true });
  const privateCode = '// USER_A_PRIVATE_CPP\nint main() { return 42; }';
  await input.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(privateCode);
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => fixture.requests.some((item) => item.body?.code === privateCode)).toBeTruthy();
  async function language(label: string) {
    await page.getByRole('combobox', { name: '编程语言' }).press('ArrowDown');
    await page.getByTitle(label, { exact: true }).click();
  }
  await language('Python 3');
  // Selecting a language does not prove Monaco's React effects have changed the model yet.
  // Wait for the new document, then verify both the rendered edit and its saved language.
  const rendered = page.locator('.monaco-editor .view-lines');
  await expect(rendered).toContainText('import sys');
  const localDraft = () =>
    page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('algorithm-draft:algorithm-fixture-org:algorithm-fixture:two-sum') || 'null',
      ),
    );
  await input.focus();
  await page.keyboard.press('ControlOrMeta+A');
  const privatePython = '# USER_A_PRIVATE_PYTHON';
  await page.keyboard.insertText(privatePython);
  await expect(rendered).toContainText(privatePython);
  await expect.poll(async () => (await localDraft())?.codes?.python).toBe(privatePython);
  await page.keyboard.press('ControlOrMeta+s');
  await expect
    .poll(() =>
      fixture.requests.some((item) => item.body?.language === 'python' && item.body?.code === privatePython),
    )
    .toBeTruthy();
  await expect.poll(async () => (await localDraft())?.unsynced).toBe(false);
  await language('C++ 17');
  await expect(rendered).toContainText('USER_A_PRIVATE_CPP');
  await language('Python 3');
  await expect(rendered).toContainText('USER_A_PRIVATE_PYTHON');
  await expect
    .poll(async () => (await localDraft())?.codes)
    .toEqual({ cpp: privateCode, python: privatePython });
  // Keep the same document/Monaco module alive through a real client-side logout/login.
  await loginOtherStudent(page);
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(rendered).toContainText('#include');
  await expect(rendered).not.toContainText('USER_A_PRIVATE');
  await input.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rendered).not.toContainText('USER_A_PRIVATE');
  await language('Python 3');
  await expect(rendered).toContainText('import sys');
  await input.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rendered).not.toContainText('USER_A_PRIVATE');
  await page.getByRole('button', { name: '简易编辑器', exact: true }).click();
  await page.getByRole('button', { name: '使用专业编辑器', exact: true }).click();
  await expect(rendered).toContainText('import sys');
  await input.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rendered).not.toContainText('USER_A_PRIVATE');
  expect(errors).toEqual([]);
});

test('上一账号迟到的笔记保存响应不会写入当前账号缓存', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms/two-sum');
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await page.getByLabel('我的解题笔记').fill('USER_A_PRIVATE_NOTE');
  const release = fixture.holdNextLearningSave();
  await page.getByRole('button', { name: '保存笔记与状态', exact: true }).click();
  await expect.poll(() => fixture.learningState().note).toBe('USER_A_PRIVATE_NOTE');
  await loginOtherStudent(page);
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(page.getByLabel('我的解题笔记')).toHaveValue('');
  await expect(page.getByLabel('我的解题笔记')).toBeEnabled();
  const response = page.waitForResponse(
    (item) => item.request().method() === 'PATCH' && item.url().endsWith('/learning'),
  );
  release();
  await (await response).finished();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(page.getByLabel('我的解题笔记')).toHaveValue('');
  await page.getByRole('tab', { name: '题目描述', exact: true }).click();
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(page.getByLabel('我的解题笔记')).toHaveValue('');
});

test('离开后迟到的笔记保存响应不会清除重新打开后编辑的本机草稿', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/algorithms/two-sum');
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await page.getByLabel('我的解题笔记').fill('older pending note');
  const release = fixture.holdNextLearningSave();
  await page.getByRole('button', { name: '保存笔记与状态', exact: true }).click();
  await expect.poll(() => fixture.learningState().note).toBe('older pending note');
  await openFixtureProblem(page);
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await page.getByLabel('我的解题笔记').fill('new unsynced note must survive');
  const response = page.waitForResponse(
    (item) => item.request().method() === 'PATCH' && item.url().endsWith('/learning'),
  );
  release();
  await (await response).finished();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await openFixtureProblem(page);
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(page.getByLabel('我的解题笔记')).toHaveValue('new unsynced note must survive');
});
