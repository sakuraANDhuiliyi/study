// These UI contracts use the real repository catalog, teaching content and plans.
// API state and judging are mocked; executable reference correctness is verified separately.
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { algorithmProblems } from '../../apps/api/src/algorithms/algorithms.catalog';
import { getAlgorithmEditorial } from '../../apps/api/src/algorithms/algorithms.editorials';
import { algorithmPlans } from '../../apps/api/src/algorithms/algorithms.learning';
import type { Language } from '../../apps/web/src/components/algorithms/types';

test.use({ actionTimeout: 15000 });
const id = 'minimum-spanning-tree';
const problem = algorithmProblems.find((item) => item.id === id)!;
const teaching = getAlgorithmEditorial(id)!;
const graphPlan = algorithmPlans.find((plan) => plan.id === 'trees-graphs')!;
const stamp = '2026-10-09T08:00:00Z';
const languages = [
  { id: 'cpp', label: 'C++ 17' },
  { id: 'python', label: 'Python 3' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'java', label: 'Java' },
];
async function setup(page: Page) {
  const solved = new Set(
    graphPlan.chapters.flatMap((chapter) => chapter.problemIds).filter((item) => item !== id),
  );
  const drafts = new Map<string, { language: Language; code: string; updatedAt: string }>();
  const submissions: any[] = [];
  const requests: { path: string; method: string; body: any }[] = [];
  const cards = () =>
    algorithmProblems.map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      difficulty: item.difficulty,
      tags: item.tags,
      status: solved.has(item.id) ? 'solved' : 'todo',
      favorite: false,
      reviewStatus: 'none',
    }));
  const learning = { favorite: false, reviewStatus: 'none', note: '', revision: 0, updatedAt: null };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.addInitScript(() => localStorage.setItem('algorithm-editor-mode', 'simple'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.method() === 'GET' ? undefined : request.postDataJSON();
    requests.push({ path: path + url.search, method: request.method(), body });
    if (path === '/api/auth/me')
      return json(route, {
        user: {
          id: 'mst-student',
          name: '图算法学习同学',
          username: 'mst-fixture',
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['learning.use'],
          organizationId: 'mst-personal',
          accountMode: 'PERSONAL',
          majorId: null,
          major: null,
        },
        csrfToken: 'mst-fixture-token',
      });
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/algorithms/status')
      return json(route, {
        judge: { available: true, reason: '', languages },
        ai: { available: false, reason: '课堂测试未配置 AI 服务', model: '' },
      });
    if (path === '/api/algorithms/overview') {
      const summaries = cards();
      return json(route, {
        dailyProblem: summaries.find((item) => item.id === id),
        recommendation: summaries.find((item) => item.id === id),
        activity: Array.from({ length: 28 }, (_, i) => ({
          date: `2026-09-${String(i + 1).padStart(2, '0')}`,
          submissions: 0,
          solved: 0,
        })),
        stats: {
          submitted: 5 + submissions.filter((item) => item.mode === 'submit').length,
          accepted: 5 + submissions.filter((item) => item.mode === 'submit').length,
          solved: solved.size,
          streak: 1,
        },
        plans: algorithmPlans.map((plan) => {
          const ids = [...new Set(plan.chapters.flatMap((chapter) => chapter.problemIds))];
          return {
            ...plan,
            total: ids.length,
            solved: ids.filter((item) => solved.has(item)).length,
            nextProblemId: ids.find((item) => !solved.has(item)) || null,
            chapters: plan.chapters.map((chapter) => ({
              ...chapter,
              problems: chapter.problemIds.map((key) => summaries.find((item) => item.id === key)),
            })),
          };
        }),
      });
    }
    if (path === '/api/algorithms/problems') {
      const items = cards();
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const filtered = items.filter(
        (item) =>
          (!q || `${item.number} ${item.title} ${item.tags.join(' ')}`.toLowerCase().includes(q)) &&
          (!url.searchParams.get('difficulty') || item.difficulty === url.searchParams.get('difficulty')),
      );
      const page = Number(url.searchParams.get('page') || 1),
        pageSize = Number(url.searchParams.get('pageSize') || 12);
      return json(route, {
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        total: filtered.length,
        page,
        pageSize,
        stats: { total: items.length, attempted: solved.size, solved: solved.size },
        tags: [...new Set(items.flatMap((item) => item.tags))],
      });
    }
    const match = path.match(
      /^\/api\/algorithms\/problems\/([^/]+)(?:\/(editorial|draft|learning|submissions|analyses))?$/,
    );
    if (match) {
      const selected = algorithmProblems.find((item) => item.id === decodeURIComponent(match[1]));
      if (!selected) return json(route, { message: '算法题不存在' }, 404);
      if (!match[2]) {
        const position = algorithmProblems.indexOf(selected);
        // Deliberately publish only the student DTO, never private cases/solution/hints.
        return json(route, {
          id: selected.id,
          number: selected.number,
          title: selected.title,
          difficulty: selected.difficulty,
          tags: selected.tags,
          description: selected.description,
          inputFormat: selected.inputFormat,
          outputFormat: selected.outputFormat,
          constraints: selected.constraints,
          examples: selected.examples,
          timeLimitMs: selected.timeLimitMs,
          memoryLimitMb: selected.memoryLimitMb,
          starterCode: selected.starterCode,
          draft: drafts.get(selected.id) || null,
          learningState: learning,
          navigation: {
            previousProblemId: algorithmProblems[position - 1]?.id || null,
            nextProblemId: algorithmProblems[position + 1]?.id || null,
          },
        });
      }
      if (match[2] === 'editorial') {
        const editorial = getAlgorithmEditorial(selected.id)!;
        return json(route, {
          editorial,
          relatedProblems: cards().filter((item) => editorial.relatedProblemIds.includes(item.id)),
        });
      }
      if (match[2] === 'draft') {
        drafts.set(selected.id, { ...body, updatedAt: stamp });
        return json(route, drafts.get(selected.id));
      }
      if (match[2] === 'learning') return json(route, learning);
      if (match[2] === 'analyses') return json(route, { items: [] });
      if (request.method() === 'GET')
        return json(route, {
          items: submissions.filter((item) => item.problemId === selected.id),
          total: submissions.length,
          page: 1,
          pageSize: 8,
        });
      const customInput = body.mode === 'run' && Object.hasOwn(body, 'stdin');
      const cases = customInput
        ? [{ input: body.stdin, output: '8\n', hidden: false }]
        : body.mode === 'run'
          ? selected.examples.map((example) => ({ ...example, hidden: false }))
          : selected.testCases;
      const submission = {
        id: `mst-submission-${submissions.length + 1}`,
        problemId: selected.id,
        ...body,
        customInput,
        status: 'accepted',
        passed: cases.length,
        total: cases.length,
        runtimeMs: 1,
        memoryKb: 1024,
        compileOutput: '',
        error: null,
        createdAt: stamp,
        results: cases.map((entry, index) => ({
          index: index + 1,
          status: 'accepted',
          hidden: entry.hidden,
          runtimeMs: 1,
          ...(entry.hidden ? {} : { input: entry.input, expectedOutput: entry.output, stdout: entry.output }),
        })),
      };
      submissions.unshift(submission);
      if (body.mode === 'submit' && !customInput) solved.add(selected.id);
      return json(route, submission, 201);
    }
    if (path.startsWith('/api/algorithms/submissions/'))
      return json(
        route,
        submissions.find((item) => path.endsWith('/' + item.id)),
      );
    return json(route, { items: [] });
  });
  return { requests, solved, drafts, submissions };
}
const editor = (page: Page) => page.getByRole('textbox', { name: '算法代码编辑器', exact: true });
const planPanel = (page: Page) =>
  page.locator('.ant-collapse-item').filter({ has: page.getByText('树与图专题', { exact: true }) });
async function editorial(page: Page, reveal = false) {
  await page.getByRole('tab', { name: '题解', exact: true }).click();
  if (reveal) await page.getByRole('button', { name: '显示完整题解与答案', exact: true }).click();
}
async function referenceLanguage(page: Page, label: string) {
  const field = page.getByRole('combobox', { name: '参考代码语言', exact: true });
  await field.press('ArrowDown');
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  await dropdown.getByText(label, { exact: true }).click();
  await expect(dropdown).toBeHidden();
}
async function restoreBackup(page: Page) {
  await page.getByRole('button', { name: '恢复原草稿', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '恢复原草稿', exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeHidden();
}

test('第19题分页与搜索可见，树图第三章5/6继续学习指向新题', async ({ page }) => {
  await setup(page);
  await page.goto('/algorithms');
  await expect(page.getByLabel('算法练习统计')).toContainText('19');
  await expect(page.locator('.algo-problem-row')).toHaveCount(12);
  await page.getByTitle('2', { exact: true }).click();
  await expect(page.locator('.algo-problem-row')).toHaveCount(7);
  await expect(page.locator('.algo-problem-row').filter({ hasText: '最小生成树总权' })).toContainText('019');
  await page.getByRole('searchbox', { name: '搜索算法题' }).fill('19');
  await page.getByRole('searchbox', { name: '搜索算法题' }).press('Enter');
  await expect(page.locator('.algo-problem-row')).toHaveCount(1);
  await expect(page.locator('.algo-problem-row')).toContainText('最小生成树总权');
  await page.getByText('树与图专题', { exact: true }).click();
  await expect(planPanel(page)).toContainText('5 / 6 题');
  await expect(planPanel(page).locator('.algo-plan-chapter')).toHaveCount(3);
  await expect(
    planPanel(page).getByRole('heading', { name: '03 全图连接与贪心', exact: true }),
  ).toBeVisible();
  await expect(planPanel(page).getByRole('link', { name: /最小生成树总权/ })).toHaveAttribute(
    'href',
    `/algorithms/${id}`,
  );
  await planPanel(page).getByRole('button', { name: '继续学习', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/algorithms/${id}$`));
  await expect(page.getByRole('heading', { name: '最小生成树总权', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '下一题' })).toHaveCount(0);
});

test('原创题面明确三公开答案、负权与树限制，三级提示逐次展开且完整答案默认隐藏', async ({ page }) => {
  await setup(page);
  await page.goto(`/algorithms/${id}`);
  await expect(page.getByText(problem.description, { exact: true })).toBeVisible();
  expect(problem.examples.map((example) => example.output.trim())).toEqual(['8', 'IMPOSSIBLE', '-1']);
  await expect(page.locator('.algo-example')).toHaveCount(3);
  await editorial(page);
  await expect(page.getByText('无向图、连通分量与生成树', { exact: true })).toBeVisible();
  await expect(page.locator('.algo-reading-checklist .ant-checkbox-wrapper')).toHaveCount(
    teaching.readingGuide.length,
  );
  await expect(page.locator('.algo-hint')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '参考代码', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '解法比较', exact: true })).toHaveCount(0);
  for (let index = 0; index < 3; index++) {
    await page
      .getByRole('button', { name: index ? `展开第 ${index + 1} 条提示` : '查看第 1 条提示', exact: true })
      .click();
    await expect(page.locator('.algo-hint')).toHaveCount(index + 1);
    await expect(page.getByText(teaching.hints[index], { exact: true })).toBeVisible();
    if (index < 2) await expect(page.getByText(teaching.hints[index + 1], { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: '已展开全部提示', exact: true })).toBeDisabled();
  await expect(page.locator('.algo-reference-code')).toHaveCount(0);
});

test('三解法、等权交换证明与真实六步推演完整呈现，关联题导航有效', async ({ page }) => {
  await setup(page);
  await page.goto(`/algorithms/${id}`);
  await editorial(page, true);
  const comparison = page.locator('.algo-learning-table').first();
  await expect(comparison.getByRole('row')).toHaveCount(4);
  for (const [index, approach] of teaching.approaches.entries()) {
    await page.getByRole('tab', { name: `${index + 1}. ${approach.name}`, exact: true }).click();
    await expect(page.getByText(approach.correctness, { exact: true })).toBeVisible();
    await expect(page.getByText(approach.intuition, { exact: true })).toBeVisible();
    await expect(page.locator('.algo-approach-content:visible ol li')).toHaveCount(approach.steps.length);
  }
  const walkthrough = page
    .locator('.algo-editorial > section')
    .filter({ has: page.getByRole('heading', { name: '跟着样例走一遍', exact: true }) });
  await expect(walkthrough.locator('.algo-code-block')).toHaveText(problem.examples[0].input);
  await expect(walkthrough.getByRole('row')).toHaveCount(7);
  await expect(
    walkthrough.getByRole('cell', { name: '跳过 (1,3,3)；used=2，total=4', exact: true }),
  ).toBeVisible();
  await expect(
    walkthrough.getByRole('cell', { name: /从1出发的最短路径树选权2、3、4，总权9/ }),
  ).toBeVisible();
  await expect(page.locator('.algo-walkthrough-result')).toContainText('8');
  await expect(page.locator('.algo-mistake-note')).toHaveCount(teaching.mistakes.length);
  for (const related of ['connected-components', 'shortest-path'])
    await expect(page.locator(`.algo-related-problems a[href="/algorithms/${related}"]`)).toBeVisible();
  await page.locator('.algo-related-problems a[href="/algorithms/connected-components"]').click();
  await expect(page).toHaveURL(/\/algorithms\/connected-components$/);
  await expect(
    page.getByRole('heading', {
      name: algorithmProblems.find((item) => item.id === 'connected-components')!.title,
      exact: true,
    }),
  ).toBeVisible();
});

test('四语言真实参考代码逐一确认载入，取消保留草稿且可恢复原备份', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/algorithms/${id}`);
  const ownCode = '// My own MST reasoning\nint main() { return 0; }\n';
  await editor(page).fill(ownCode);
  await editorial(page, true);
  for (const language of languages) {
    await referenceLanguage(page, language.label);
    await expect(page.locator('.algo-reference-code')).toHaveText(
      teaching.referenceCode[language.id as Language],
    );
    await page.getByRole('button', { name: '载入编辑器', exact: true }).click();
    await page
      .getByRole('tooltip')
      .getByRole('button', { name: /取\s*消/ })
      .click();
    await expect(page.getByRole('tooltip')).toBeHidden();
    await expect(editor(page)).toHaveValue(ownCode);
    await page.getByRole('button', { name: '载入编辑器', exact: true }).click();
    await page.getByRole('tooltip').getByRole('button', { name: '载入参考代码', exact: true }).click();
    await expect(page.getByRole('tooltip')).toBeHidden();
    await expect(editor(page)).toHaveValue(teaching.referenceCode[language.id as Language]);
    await expect(page.locator('.algo-editor-file')).toContainText(
      { cpp: 'main.cpp', python: 'main.py', javascript: 'main.js', java: 'Main.java' }[language.id]!,
    );
    await expect(page.getByText('载入参考代码前的草稿已备份', { exact: true })).toBeVisible();
    await restoreBackup(page);
    await expect(editor(page)).toHaveValue(ownCode);
    await expect(page.locator('.algo-editor-file')).toContainText('main.cpp');
  }
  expect(fixture.requests.filter((entry) => entry.method === 'POST')).toHaveLength(0);
});

test('样例与自定义运行不完成计划，只有正式通过后由服务端状态显示6/6', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/algorithms/${id}`);
  await editor(page).fill(teaching.referenceCode.cpp);
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.locator('.algo-result-heading').getByText('样例通过', { exact: true })).toBeVisible();
  expect(fixture.solved.has(id)).toBe(false);
  await page.getByRole('tab', { name: '测试输入', exact: true }).click();
  await page.getByRole('combobox', { name: '运行输入方式', exact: true }).press('ArrowDown');
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByText('自定义输入', { exact: true })
    .click();
  await page.getByRole('textbox', { name: '标准输入', exact: true }).fill(problem.examples[0].input);
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.locator('.algo-result-heading').getByText('执行完成', { exact: true })).toBeVisible();
  expect(fixture.solved.has(id)).toBe(false);
  await page.goto('/algorithms');
  await expect(planPanel(page)).toContainText('5 / 6 题');
  await page.goto(`/algorithms/${id}`);
  await page.getByRole('button', { name: '提交评测', exact: true }).click();
  await expect(page.locator('.algo-result-heading').getByText('通过', { exact: true })).toBeVisible();
  expect(fixture.solved.has(id)).toBe(true);
  await page.goto('/algorithms');
  await expect(planPanel(page)).toContainText('6 / 6 题');
  await page.getByText('树与图专题', { exact: true }).click();
  await expect(planPanel(page).getByText('已完成此计划', { exact: true })).toBeVisible();
  await expect(planPanel(page).getByRole('button', { name: '继续学习', exact: true })).toHaveCount(0);
  expect(fixture.submissions.map((item) => [item.mode, item.customInput])).toEqual([
    ['submit', false],
    ['run', true],
    ['run', false],
  ]);
});

test('桌面和390px第三章、详细题解表格与代码内部滚动且无页面溢出', async ({ page }) => {
  await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security|violates.*policy|worker/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto(`/algorithms/${id}`);
  await editorial(page, true);
  await page.getByRole('tab', { name: '2. Kruskal：排序与并查集（推荐）', exact: true }).click();
  await expect(page.getByText(teaching.approaches[1].correctness, { exact: true })).toBeVisible();
  await mkdir('test-results/minimum-spanning-tree', { recursive: true });
  await page.getByRole('heading', { name: '解法比较', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/minimum-spanning-tree/desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/algorithms');
  await page.getByText('树与图专题', { exact: true }).click();
  await expect(
    planPanel(page).getByRole('heading', { name: '03 全图连接与贪心', exact: true }),
  ).toBeVisible();
  await planPanel(page)
    .getByRole('link', { name: /最小生成树总权/ })
    .click();
  await editorial(page, true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    .toBe(true);
  const scrolls = await page.locator('.algo-editorial .algo-table-scroll').evaluateAll((elements) =>
    elements.map((element) => {
      const node = element as HTMLElement;
      const overflow = node.scrollWidth > node.clientWidth;
      node.scrollLeft = node.scrollWidth;
      const moved = node.scrollLeft > 0;
      node.scrollLeft = 0;
      return { width: node.clientWidth, overflow, moved };
    }),
  );
  expect(scrolls).toHaveLength(3);
  expect(scrolls.every((entry) => entry.width <= 390 && (!entry.overflow || entry.moved))).toBe(true);
  await page.getByRole('heading', { name: '跟着样例走一遍', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/minimum-spanning-tree/mobile.png', animations: 'disabled' });
  await expect(page.locator('.algo-reference-code')).toBeVisible();
  expect(await page.locator('.algo-reference-code').evaluate((element) => element.clientWidth <= 390)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
