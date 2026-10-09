// Controlled API records only; these tests never call a compiler or AI provider.
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { emptyLearningActions } from './empty-learning-actions-fixture';

test.use({ actionTimeout: 15000 });
type Language = 'cpp' | 'python' | 'javascript' | 'java';
type Kind = 'submit' | 'examples' | 'custom';
type Submission = {
  id: string;
  problemId: string;
  language: Language;
  code: string;
  mode: 'submit' | 'run';
  customInput: boolean;
  status: string;
  passed: number;
  total: number;
  runtimeMs: number;
  memoryKb: number;
  compileOutput: null;
  error: null;
  createdAt: string;
  results: unknown[];
};
const stamp = '2026-10-09T08:00:00.000Z';
const draft = '// CURRENT_CPP_DRAFT\nint main() { return 0; }';
const languages = [
  { id: 'cpp', label: 'C++ 17' },
  { id: 'python', label: 'Python 3' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'java', label: 'Java' },
];
const problem = {
  id: 'two-sum',
  number: 1,
  title: '两数相加',
  difficulty: 'easy',
  tags: ['输入输出'],
  status: 'attempted',
  description: '读入两个整数，输出它们的和。',
  inputFormat: '输入两个整数。',
  outputFormat: '输出相加结果。',
  constraints: '整数范围内计算。',
  timeLimitMs: 1000,
  memoryLimitMb: 128,
  examples: [{ input: '1 2', output: '3' }],
  starterCode: { cpp: draft, python: 'print(0)', javascript: 'console.log(0)', java: 'class Main {}' },
};
function submission(
  id: string,
  kind: Kind,
  language: Language,
  status: string,
  problemId = 'two-sum',
): Submission {
  return {
    id,
    problemId,
    language,
    status,
    code: `// HISTORY_${id}\n`,
    mode: kind === 'submit' ? 'submit' : 'run',
    customInput: kind === 'custom',
    passed: status === 'accepted' ? 1 : 0,
    total: 1,
    runtimeMs: 12,
    memoryKb: 1024,
    compileOutput: null,
    error: null,
    createdAt: stamp,
    results: [
      {
        index: 1,
        status,
        hidden: kind === 'submit',
        ...(kind === 'submit' ? {} : { input: '1 2', stdout: '3', expectedOutput: '3' }),
      },
    ],
  };
}
function records() {
  return [
    ...Array.from({ length: 10 }, (_, index) =>
      submission(`formal-cpp-wa-${String(index).padStart(2, '0')}`, 'submit', 'cpp', 'wrong_answer'),
    ),
    submission('formal-python-wa', 'submit', 'python', 'wrong_answer'),
    submission('formal-cpp-ac', 'submit', 'cpp', 'accepted'),
    submission('examples-python-ac', 'examples', 'python', 'accepted'),
    submission('custom-python-ac', 'custom', 'python', 'accepted'),
    submission('examples-js-ce', 'examples', 'javascript', 'compile_error'),
    submission('formal-java-re', 'submit', 'java', 'runtime_error'),
    submission('formal-java-tle', 'submit', 'java', 'time_limit'),
    submission('custom-java-mle', 'custom', 'java', 'memory_limit'),
    submission('formal-js-se', 'submit', 'javascript', 'system_error'),
    submission('formal-python-running', 'submit', 'python', 'running'),
    submission('next-problem-only', 'submit', 'cpp', 'wrong_answer', 'binary-search'),
  ];
}
function gate() {
  let release!: () => void, finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { release, ready, finished, finish };
}
async function setup(page: Page, empty = false) {
  await page.addInitScript(() => localStorage.setItem('algorithm-editor-mode', 'simple'));
  let account: 'a' | 'b' | null = 'a';
  const history = {
    a: empty ? [] : records(),
    b: [submission('account-b-only', 'submit', 'cpp', 'accepted')],
  };
  const requests: { path: string; method: string; body: any; account: string | null }[] = [];
  const held: { match: (url: URL) => boolean; control: ReturnType<typeof gate> }[] = [];
  const details = new Map<string, ReturnType<typeof gate>>();
  let failure: ((url: URL) => boolean) | null = null;
  let inconsistent = false;
  const user = () => ({
    id: `history-${account}`,
    name: `筛选学生 ${account?.toUpperCase()}`,
    username: `history-${account}`,
    role: 'STUDENT',
    roles: ['STUDENT'],
    permissions: ['learning.use'],
    organizationId: `history-space-${account}`,
    accountMode: 'PERSONAL',
    majorId: null,
    major: null,
  });
  const json = (route: Route, value: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    const body = method === 'GET' ? null : request.postDataJSON();
    const owner = account;
    requests.push({ path: path + url.search, method, body, account: owner });
    if (path === '/api/auth/me')
      return owner
        ? json(route, { user: user(), csrfToken: 'fixture-csrf' })
        : json(route, { message: '已退出' }, 401);
    if (path === '/api/auth/logout') {
      account = null;
      return json(route, { ok: true });
    }
    if (path === '/api/auth/login') {
      account = 'b';
      return json(route, { user: user(), csrfToken: 'fixture-csrf-b' });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/planner/actions')
      return json(route, emptyLearningActions(new URL(route.request().url())));
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/academics/catalog') return json(route, { subjects: [], majors: [], modules: [] });
    if (path === '/api/academics/me')
      return json(route, {
        accountMode: 'PERSONAL',
        major: null,
        majorId: null,
        selectedModuleIds: [],
        recommendations: [],
        recentRecords: [],
        revision: 0,
        stats: { records: 0, completed: 0, modulesPracticed: 0 },
      });
    if (path === '/api/academics/goals') return json(route, { items: [] });
    if (path === '/api/algorithms/status')
      return json(route, {
        judge: { available: true, reason: '', languages },
        ai: { available: false, reason: '测试不启用 AI', model: '' },
      });
    if (path === '/api/algorithms/overview')
      return json(route, {
        dailyProblem: problem,
        recommendation: null,
        activity: [],
        stats: { submitted: 20, accepted: 1, solved: 1, streak: 0 },
        plans: [],
      });
    if (path === '/api/algorithms/problems')
      return json(route, {
        items: [problem],
        total: 1,
        page: 1,
        pageSize: 12,
        tags: ['输入输出'],
        stats: { total: 1, attempted: 1, solved: 1 },
      });
    if (path.endsWith('/learning'))
      return json(route, { favorite: false, reviewStatus: 'none', note: '', revision: 0, updatedAt: null });
    if (path.endsWith('/analyses')) return json(route, { items: [] });
    const problemMatch = /^\/api\/algorithms\/problems\/([^/]+)$/.exec(path);
    if (problemMatch)
      return json(route, {
        ...problem,
        id: problemMatch[1],
        title: problemMatch[1] === 'two-sum' ? problem.title : '二分查找',
        draft: {
          language: 'cpp',
          code: owner === 'b' ? '// ACCOUNT_B_DRAFT' : draft,
          revision: 0,
          updatedAt: stamp,
        },
        navigation: {
          previousProblemId: problemMatch[1] === 'two-sum' ? null : 'two-sum',
          nextProblemId: problemMatch[1] === 'two-sum' ? 'binary-search' : null,
        },
      });
    if (path.endsWith('/draft'))
      return json(route, { ...body, revision: body.revision + 1, updatedAt: stamp });
    const listMatch = /^\/api\/algorithms\/problems\/([^/]+)\/submissions$/.exec(path);
    if (listMatch && method === 'POST' && owner) {
      const item = submission(
        'new-execution',
        body.mode === 'submit' ? 'submit' : body.stdin === undefined ? 'examples' : 'custom',
        body.language,
        'accepted',
        listMatch[1],
      );
      item.code = body.code;
      history[owner].unshift(item);
      return json(route, item, 201);
    }
    if (listMatch && method === 'GET') {
      const pageNumber = Number(url.searchParams.get('page') || 1),
        pageSize = Number(url.searchParams.get('pageSize') || 20);
      const kind = url.searchParams.get('kind'),
        language = url.searchParams.get('language'),
        status = url.searchParams.get('status');
      const selected = (owner ? history[owner] : [])
        .filter(
          (item) =>
            item.problemId === listMatch[1] &&
            (!language || item.language === language) &&
            (!status || item.status === status) &&
            (!kind ||
              (kind === 'submit' && item.mode === 'submit') ||
              (kind === 'examples' && item.mode === 'run' && !item.customInput) ||
              (kind === 'custom' && item.mode === 'run' && item.customInput)),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const payload = structuredClone({
        items: inconsistent ? [] : selected.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        total: selected.length,
        page: pageNumber,
        pageSize,
        ...(kind ? { kind } : {}),
        ...(language ? { language } : {}),
        ...(status ? { status } : {}),
      });
      const failed = !!failure?.(url);
      const index = held.findIndex((entry) => entry.match(url));
      const control = index < 0 ? null : held.splice(index, 1)[0].control;
      if (control) await control.ready;
      try {
        return await json(route, failed ? { message: '历史列表暂时不可用' } : payload, failed ? 503 : 200);
      } finally {
        control?.finish();
      }
    }
    const detailMatch = /^\/api\/algorithms\/submissions\/([^/]+)$/.exec(path);
    if (detailMatch) {
      const found = owner
        ? structuredClone(history[owner].find((item) => item.id === detailMatch[1]))
        : undefined;
      const control = details.get(detailMatch[1]);
      details.delete(detailMatch[1]);
      if (control) await control.ready;
      try {
        return await json(route, found || { message: '记录不存在' }, found ? 200 : 404);
      } finally {
        control?.finish();
      }
    }
    return json(route, {});
  });
  return {
    history,
    requests,
    lists: () =>
      requests.filter((item) => item.method === 'GET' && /\/problems\/[^/]+\/submissions\?/.test(item.path)),
    writes: () => requests.filter((item) => item.method !== 'GET' && !item.path.startsWith('/api/auth/')),
    fail: (match: ((url: URL) => boolean) | null) => {
      failure = match;
    },
    inconsistent: (value: boolean) => {
      inconsistent = value;
    },
    hold: (match: (url: URL) => boolean) => {
      const control = gate();
      held.push({ match, control });
      return control;
    },
    holdDetail: (id: string) => {
      const control = gate();
      details.set(id, control);
      return control;
    },
  };
}

const panel = (page: Page) => page.getByRole('tabpanel', { name: '提交记录', exact: true });
const rows = (page: Page) => panel(page).locator('.algo-history-item');
const count = (page: Page) => page.getByLabel('提交记录匹配数量', { exact: true });
const editor = (page: Page) => page.getByRole('textbox', { name: '算法代码编辑器', exact: true });
async function refreshHistory(page: Page) {
  // Ant Design's exiting loading icon can remain in the accessible name after
  // fetching ends. Keep the same button locator while waiting until it is usable.
  const button = panel(page).getByRole('button', { name: /^(?:loading )?刷新提交记录$/ });
  await expect(button).toBeVisible();
  await expect(button).not.toHaveClass(/ant-btn-loading/);
  await expect(button).toBeEnabled();
  await button.click();
}
async function open(page: Page) {
  await page.goto('/algorithms/two-sum');
  const tab = page.getByRole('tab', { name: /提交记录/ });
  await tab.focus();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('group', { name: '提交记录筛选', exact: true })).toBeVisible();
}
async function choose(page: Page, name: string, option: string) {
  const control = page.getByRole('combobox', { name, exact: true });
  await control.scrollIntoViewIfNeeded();
  await control.press('ArrowDown');
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  const active = dropdown.locator('.ant-select-item-option-active');
  await expect(active).toHaveCount(1);
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  // Opening restores the selected option in a scheduled render. Let that settle
  // before sending navigation keys, then observe each key's DOM transition.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  // Navigate the actual virtualized Select by keyboard; an offscreen option can
  // exist in the DOM without being a clickable visible row.
  for (let step = 0; step < 12; step++) {
    const previous = await active.getAttribute('title');
    if (previous === option) break;
    expect(previous).not.toBeNull();
    await control.press('ArrowDown');
    await expect(active).not.toHaveAttribute('title', previous!);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  }
  await expect(active).toHaveAttribute('title', option);
  await control.press('Enter');
  await expect(dropdown).toHaveCount(0);
}
async function narrow(page: Page) {
  await choose(page, '提交记录类型', '正式提交');
  await choose(page, '提交记录语言', 'C++ 17');
  await choose(page, '提交记录结果', '答案错误');
  await expect(count(page)).toHaveText('匹配 10 条');
}
async function screenshot(page: Page, name: string) {
  await page
    .getByRole('group', { name: '提交记录筛选', exact: true })
    .evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(rows(page).first()).toBeVisible();
  await mkdir('test-results/algorithm-history-filters', { recursive: true });
  await page.screenshot({
    path: `test-results/algorithm-history-filters/${name}.png`,
    animations: 'disabled',
  });
}

test('组合条件先筛后分页，改变条件原子回第一页，重置省略所有筛选参数', async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  await expect(count(page)).toHaveText('匹配 20 条');
  await narrow(page);
  await expect(rows(page)).toHaveCount(8);
  await panel(page).getByTitle('2', { exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute('data-testid', 'algorithm-submission-formal-cpp-wa-01');
  const before = fixture.lists().length;
  await choose(page, '提交记录语言', 'Python 3');
  await expect(count(page)).toHaveText('匹配 1 条');
  await expect(rows(page).first()).toHaveAttribute('data-testid', 'algorithm-submission-formal-python-wa');
  const changed = fixture
    .lists()
    .slice(before)
    .map((item) => new URL(item.path, 'http://fixture').searchParams);
  expect(changed.length).toBeGreaterThan(0);
  for (const query of changed) {
    expect(query.get('page')).toBe('1');
    expect(query.get('kind')).toBe('submit');
    expect(query.get('language')).toBe('python');
    expect(query.get('status')).toBe('wrong_answer');
  }
  await panel(page).getByRole('button', { name: '重置筛选', exact: true }).click();
  await expect(count(page)).toHaveText('匹配 20 条');
  const finalQuery = new URL(fixture.lists().at(-1)!.path, 'http://fixture').searchParams;
  // A cached unfiltered query may be reused: force refresh to inspect its request.
  if (finalQuery.has('kind')) await refreshHistory(page);
  await expect
    .poll(() => fixture.lists().at(-1)!.path)
    .toBe('/api/algorithms/problems/two-sum/submissions?page=1&pageSize=8');
  await expect(editor(page)).toHaveValue(draft);
  expect(fixture.writes()).toEqual([]);
  await screenshot(page, 'desktop');
});

test('三类成功含义准确，全部值不上传，有条件空集可清除且不会伪造已解决', async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  await choose(page, '提交记录结果', '通过／执行完成');
  await expect(count(page)).toHaveText('匹配 3 条');
  for (const [kind, accepted, rowLabel] of [
    ['正式提交', '正式通过', '通过'],
    ['样例运行', '样例通过', '样例通过'],
    ['自定义运行', '执行完成', '执行完成'],
  ]) {
    await choose(page, '提交记录类型', kind);
    await expect(count(page)).toHaveText('匹配 1 条');
    await expect(
      page
        .getByRole('combobox', { name: '提交记录结果', exact: true })
        .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]'),
    ).toContainText(accepted);
    await expect(rows(page).first().locator('.ant-tag')).toHaveText(rowLabel);
  }
  await choose(page, '提交记录语言', 'Java');
  await expect(count(page)).toHaveText('匹配 0 条');
  await expect(page.getByText('没有符合当前条件的记录', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(count(page)).toHaveText('匹配 20 条');
  await expect(editor(page)).toHaveValue(draft);
  await expect(
    page
      .getByRole('combobox', { name: '编程语言', exact: true })
      .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]'),
  ).toContainText('C++ 17');
  expect(fixture.writes()).toEqual([]);
});

test('迟到的旧条件响应不覆盖新条件，加载中不误报零条', async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  const held = fixture.hold((url) => url.searchParams.get('language') === 'python');
  try {
    await choose(page, '提交记录语言', 'Python 3');
    await expect(count(page)).toHaveText('正在加载匹配记录…');
    await choose(page, '提交记录语言', 'Java');
    await expect(count(page)).toHaveText('匹配 3 条');
    held.release();
    await held.finished;
    await expect(count(page)).toHaveText('匹配 3 条');
    await expect(rows(page)).toHaveCount(3);
    for (const row of await rows(page).all()) await expect(row).toContainText('Java ·');
    await expect(editor(page)).toHaveValue(draft);
    expect(fixture.writes()).toEqual([]);
  } finally {
    held.release();
  }
});

test('刷新后末页缩小自动移至有效页且保留三条件，不一致空页不循环请求', async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  await narrow(page);
  await panel(page).getByTitle('2', { exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  fixture.history.a = fixture.history.a.filter((item) => !/^formal-cpp-wa-0[2-9]$/.test(item.id));
  await refreshHistory(page);
  await expect(count(page)).toHaveText('匹配 2 条');
  await expect
    .poll(() => new URL(fixture.lists().at(-1)!.path, 'http://fixture').searchParams.get('page'))
    .toBe('1');
  await expect(rows(page)).toHaveCount(2);
  const query = new URL(fixture.lists().at(-1)!.path, 'http://fixture').searchParams;
  expect(Object.fromEntries(query)).toEqual({
    page: '1',
    pageSize: '8',
    kind: 'submit',
    language: 'cpp',
    status: 'wrong_answer',
  });
  fixture.inconsistent(true);
  await refreshHistory(page);
  await expect(page.getByText('记录正在更新', { exact: true })).toBeVisible();
  const before = fixture.lists().length;
  await page.getByRole('button', { name: '刷新记录', exact: true }).focus();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.getByText('记录正在更新', { exact: true })).toBeVisible();
  expect(fixture.lists()).toHaveLength(before);
  fixture.inconsistent(false);
  await page.getByRole('button', { name: '刷新记录', exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
});

test('网络失败保留条件可重试，已有缓存的失败明确标为上次加载', async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  fixture.fail((url) => url.searchParams.get('status') === 'compile_error');
  await choose(page, '提交记录结果', '编译错误');
  await expect(panel(page).getByText('历史列表暂时不可用', { exact: true })).toBeVisible();
  await expect(count(page)).toHaveText('匹配数量暂不可用');
  fixture.fail(null);
  await panel(page)
    .getByRole('button', { name: /^重\s*试$/ })
    .click();
  await expect(count(page)).toHaveText('匹配 1 条');
  await expect(rows(page).first()).toContainText('编译错误');
  fixture.fail((url) => url.searchParams.get('status') === 'compile_error');
  await refreshHistory(page);
  await expect(count(page)).toHaveText('上次加载匹配 1 条');
  await expect(
    panel(page).getByText('连接暂时不可用，正在显示上次已加载的内容', { exact: true }),
  ).toBeVisible();
  fixture.fail(null);
  await panel(page).getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(count(page)).toHaveText('匹配 1 条');
  expect(new URL(fixture.lists().at(-1)!.path, 'http://fixture').searchParams.get('status')).toBe(
    'compile_error',
  );
  expect(fixture.writes()).toEqual([]);
});

test('筛选期间原inspection继续显示原代码，列表迟到刷新不改变已打开的对比快照', async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  await narrow(page);
  const id = 'formal-cpp-wa-09',
    detail = fixture.holdDetail(id);
  const list = fixture.hold((url) => url.searchParams.get('language') === 'python');
  try {
    await page.getByTestId(`algorithm-submission-${id}`).click();
    await expect(page.getByText('正在读取提交记录…', { exact: true })).toBeVisible();
    await choose(page, '提交记录语言', 'Python 3');
    await expect(count(page)).toHaveText('正在加载匹配记录…');
    detail.release();
    await detail.finished;
    await expect(page.locator('.algo-submitted-code')).toBeVisible();
    await page.locator('.algo-submitted-code .ant-collapse-header').click();
    await page.getByRole('button', { name: '与当前代码对比', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '代码对比', exact: true });
    await modal
      .locator('label.ant-radio-button-wrapper')
      .filter({ hasText: /^完整文本$/ })
      .click();
    await expect(modal.getByRole('textbox', { name: '历史提交完整代码', exact: true })).toHaveValue(
      `// HISTORY_${id}\n`,
    );
    list.release();
    await list.finished;
    await expect(modal.getByRole('textbox', { name: '历史提交完整代码', exact: true })).toHaveValue(
      `// HISTORY_${id}\n`,
    );
    await expect(modal.getByRole('textbox', { name: '当前草稿完整代码', exact: true })).toHaveValue(draft);
    await modal.getByRole('button', { name: '关闭代码对比', exact: true }).click();
    await expect(count(page)).toHaveText('匹配 1 条');
    await expect(page.locator('.algo-submitted-code pre')).toHaveText(`// HISTORY_${id}\n`);
    await expect(editor(page)).toHaveValue(draft);
    expect(fixture.writes()).toEqual([]);
  } finally {
    detail.release();
    list.release();
  }
});

test('新的运行只回到筛选第一页，不清除条件或把样例成功当成正式匹配', async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  await narrow(page);
  await panel(page).getByTitle('2', { exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.locator('.algo-result-heading')).toContainText('样例通过');
  await expect(rows(page)).toHaveCount(8);
  await expect(count(page)).toHaveText('匹配 10 条');
  expect(Object.fromEntries(new URL(fixture.lists().at(-1)!.path, 'http://fixture').searchParams)).toEqual({
    page: '1',
    pageSize: '8',
    kind: 'submit',
    language: 'cpp',
    status: 'wrong_answer',
  });
  expect(fixture.writes().filter((item) => item.path.endsWith('/submissions'))).toHaveLength(1);
  expect(fixture.writes().filter((item) => item.path.endsWith('/analysis'))).toHaveLength(0);
  await expect(editor(page)).toHaveValue(draft);
});

test('切题和退出换空间丢弃旧筛选，迟到列表不会进入新的用户记录', async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  await narrow(page);
  await page.getByRole('link', { name: '下一题', exact: true }).click();
  await page.getByRole('tab', { name: '提交记录', exact: true }).click();
  await expect(count(page)).toHaveText('匹配 1 条');
  await expect(rows(page).first()).toHaveAttribute('data-testid', 'algorithm-submission-next-problem-only');
  await page.getByRole('link', { name: '上一题', exact: true }).click();
  await page.getByRole('tab', { name: '提交记录', exact: true }).click();
  await expect(count(page)).toHaveText('匹配 20 条');
  const held = fixture.hold((url) => url.searchParams.get('language') === 'python');
  try {
    await choose(page, '提交记录语言', 'Python 3');
    await expect(count(page)).toHaveText('正在加载匹配记录…');
    await page.locator('.topbar-account').hover();
    await page.getByText('退出登录', { exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('账号', { exact: true }).fill('history-b');
    await page.getByLabel('密码', { exact: true }).fill('fixture-only-password');
    await page.getByRole('button', { name: '登录学习平台' }).click();
    await expect(page.getByRole('button', { name: '筛选学生 B的账号菜单', exact: true })).toBeVisible();
    await page.locator('a[href="/algorithms"]').first().click();
    await page.locator('.algo-problem-row[href="/algorithms/two-sum"]').click();
    await page.getByRole('tab', { name: '提交记录', exact: true }).click();
    held.release();
    await held.finished;
    await expect(count(page)).toHaveText('匹配 1 条');
    await expect(rows(page).first()).toHaveAttribute('data-testid', 'algorithm-submission-account-b-only');
    await expect(editor(page)).toHaveValue('// ACCOUNT_B_DRAFT');
    expect(
      fixture
        .lists()
        .filter((item) => item.account === 'b')
        .every((item) => !new URL(item.path, 'http://fixture').searchParams.has('language')),
    ).toBe(true);
  } finally {
    held.release();
  }
});

test('390像素筛选逐行排列、可清除且无外溢，未提交时保留原空态', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /content security|content-security|refused to|worker/i.test(message.text())
    )
      errors.push(message.text());
  });
  await open(page);
  await narrow(page);
  const boxes = [];
  for (const label of ['提交记录类型', '提交记录语言', '提交记录结果']) {
    const box = await page.getByRole('combobox', { name: label, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box!);
  }
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height);
  expect(boxes[2].y).toBeGreaterThan(boxes[1].y + boxes[1].height);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    .toBe(true);
  await screenshot(page, 'mobile');
  await panel(page).getByRole('button', { name: '重置筛选', exact: true }).click();
  fixture.history.a = [];
  await refreshHistory(page);
  await expect(page.getByText('还没有提交记录，先运行一次样例吧', { exact: true })).toBeVisible();
  await expect(count(page)).toHaveText('匹配 0 条');
  expect(fixture.writes()).toEqual([]);
  expect(errors).toEqual([]);
});
