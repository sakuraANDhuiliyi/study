// UI contract fixtures only: code comparison never invokes a compiler, AI provider or real API.
import { test, expect, type Page, type Route, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.use({ actionTimeout: 15000 });
type Language = 'cpp' | 'python' | 'javascript' | 'java';
const stamp = '2026-10-10T08:00:00.000Z';
const languages = [
  { id: 'cpp', label: 'C++ 17' },
  { id: 'python', label: 'Python 3' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'java', label: 'Java' },
];
const starterCode = {
  cpp: '// CPP_STARTER\nint main() { return 0; }',
  python: '# PYTHON_STARTER\nprint(0)',
  javascript: '// JAVASCRIPT_STARTER\nconsole.log(0);',
  java: 'class Main { public static void main(String[] args) {} }',
};
const sampleProblem = {
  id: 'two-sum',
  number: 1,
  title: '两数之和',
  difficulty: 'easy',
  tags: ['数组'],
  status: 'todo',
  description: '读取两个整数，输出它们的和。',
  inputFormat: '输入两个整数。',
  outputFormat: '输出和。',
  constraints: '整数范围内计算。',
  timeLimitMs: 1000,
  memoryLimitMb: 128,
  examples: [{ input: '1 2', output: '3', explanation: '1+2=3。' }],
  starterCode,
};
type Submission = {
  id: string;
  problemId: string;
  language: Language;
  code: string;
  mode: 'run' | 'submit';
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
const submission = (
  id: string,
  code: string,
  language: Language = 'cpp',
  problemId = 'two-sum',
): Submission => ({
  id,
  problemId,
  language,
  code,
  mode: 'submit',
  customInput: false,
  status: 'wrong_answer',
  passed: 0,
  total: 1,
  runtimeMs: 10,
  memoryKb: 1024,
  compileOutput: null,
  error: null,
  createdAt: stamp,
  results: [{ index: 1, status: 'wrong_answer', hidden: true }],
});
const dialog = (page: Page) => page.getByRole('dialog', { name: '代码对比', exact: true });
const editor = (page: Page) => page.getByRole('textbox', { name: '算法代码编辑器', exact: true });
const originalText = (page: Page) =>
  dialog(page).getByRole('textbox', { name: '历史提交完整代码', exact: true });
const currentText = (page: Page) =>
  dialog(page).getByRole('textbox', { name: '当前草稿完整代码', exact: true });

async function setup(
  page: Page,
  options: {
    professional?: boolean;
    code?: string;
    language?: Language;
    history?: Submission[];
  } = {},
) {
  await page.addInitScript((professional) => {
    localStorage.setItem('algorithm-editor-mode', professional ? 'professional' : 'simple');
    (window as any).__comparisonCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as any).__comparisonCspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  }, !!options.professional);
  const requests: { path: string; method: string; body: any; account: string | null }[] = [];
  const finishedDetails: string[] = [];
  let account: 'a' | 'b' | null = 'a';
  const histories = {
    a: options.history ?? [
      submission('history-a', 'const answer = 1;\nconsole.log(answer);'),
      submission('history-b', '// HISTORY_B\nint main() { return 2; }'),
    ],
    b: [submission('history-owner-b', '// ACCOUNT_B_HISTORY\nint main() { return 3; }')],
  };
  const drafts = new Map<string, { language: Language; code: string; updatedAt: string }>([
    [
      'a:two-sum',
      {
        language: options.language ?? 'cpp',
        code: options.code ?? '// CURRENT_DRAFT\nint main() { return 0; }',
        updatedAt: stamp,
      },
    ],
    ['a:binary-search', { language: 'cpp', code: '// SECOND_PROBLEM_DRAFT', updatedAt: stamp }],
    ['b:two-sum', { language: 'cpp', code: '// ACCOUNT_B_DRAFT', updatedAt: stamp }],
  ]);
  const delayed = new Map<string, Promise<void>>();
  const failures = new Map<string, number>();
  let nextDraft: Promise<void> | null = null;
  let nextExecution: { ready: Promise<void>; status: number; record: Submission } | null = null;
  let finishedExecutions = 0;
  const user = () => ({
    id: `comparison-user-${account}`,
    username: `comparison-${account}`,
    name: `对比学生 ${account?.toUpperCase()}`,
    role: 'STUDENT',
    roles: ['STUDENT'],
    permissions: ['learning.use'],
    organizationId: `comparison-space-${account}`,
    accountMode: 'PERSONAL',
    majorId: null,
    major: null,
  });
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = method === 'GET' ? null : request.postDataJSON();
    const owner = account;
    requests.push({ path: path + url.search, method, body, account: owner });
    if (path === '/api/auth/me')
      return account
        ? json(route, { user: user(), csrfToken: 'comparison-csrf' })
        : json(route, { message: '已退出登录' }, 401);
    if (path === '/api/auth/logout') {
      account = null;
      return json(route, { ok: true });
    }
    if (path === '/api/auth/login') {
      account = 'b';
      return json(route, { user: user(), csrfToken: 'comparison-csrf-b' });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
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
        ai: { available: true, reason: '', model: 'fixture-model' },
      });
    if (path === '/api/algorithms/overview')
      return json(route, {
        dailyProblem: sampleProblem,
        recommendation: null,
        activity: [],
        stats: { submitted: 0, accepted: 0, solved: 0, streak: 0 },
        plans: [],
      });
    if (path === '/api/algorithms/problems')
      return json(route, {
        items: [sampleProblem, { ...sampleProblem, id: 'binary-search', title: '二分查找' }],
        total: 2,
        page: 1,
        pageSize: 12,
        tags: ['数组'],
        stats: { total: 2, attempted: 0, solved: 0 },
      });
    if (path.endsWith('/learning'))
      return json(route, { favorite: false, reviewStatus: 'none', note: '', revision: 0, updatedAt: null });
    const problemMatch = path.match(/^\/api\/algorithms\/problems\/([^/]+)$/);
    if (problemMatch) {
      const id = problemMatch[1];
      return json(route, {
        ...sampleProblem,
        id,
        title: id === 'two-sum' ? sampleProblem.title : '二分查找',
        draft: drafts.get(`${owner}:${id}`) ?? null,
        navigation: {
          previousProblemId: id === 'binary-search' ? 'two-sum' : null,
          nextProblemId: id === 'two-sum' ? 'binary-search' : null,
        },
      });
    }
    const draftMatch = path.match(/^\/api\/algorithms\/problems\/([^/]+)\/draft$/);
    if (draftMatch) {
      if (body.code.length > 16000 || Buffer.byteLength(body.code, 'utf8') > 48000)
        return json(route, { message: '代码过长' }, 400);
      const saved = { ...body, updatedAt: new Date().toISOString() };
      drafts.set(`${owner}:${draftMatch[1]}`, saved);
      const hold = nextDraft;
      nextDraft = null;
      if (hold) await hold;
      return json(route, saved);
    }
    const historyMatch = path.match(/^\/api\/algorithms\/problems\/([^/]+)\/submissions$/);
    if (historyMatch && method === 'GET') {
      const items = owner ? histories[owner].filter((item) => item.problemId === historyMatch[1]) : [];
      return json(route, { items, total: items.length, page: 1, pageSize: 8 });
    }
    if (historyMatch && method === 'POST' && nextExecution) {
      const execution = nextExecution;
      nextExecution = null;
      await execution.ready;
      try {
        return await (execution.status >= 400
          ? json(route, { message: '旧执行请求失败' }, execution.status)
          : json(route, execution.record, execution.status));
      } finally {
        finishedExecutions++;
      }
    }
    const detailMatch = path.match(/^\/api\/algorithms\/submissions\/([^/]+)$/);
    if (detailMatch) {
      const id = detailMatch[1];
      const captured = owner ? structuredClone(histories[owner].find((item) => item.id === id)) : null;
      const failure = failures.get(id);
      failures.delete(id);
      const hold = delayed.get(id);
      delayed.delete(id);
      if (hold) await hold;
      try {
        return await (!captured || failure
          ? json(route, { message: '提交记录不存在' }, failure || 404)
          : json(route, captured));
      } finally {
        finishedDetails.push(id);
      }
    }
    if (path.endsWith('/submissions') || path.endsWith('/analysis'))
      return json(route, { message: '对比测试不允许调用执行服务' }, 503);
    if (path.endsWith('/analyses')) return json(route, { items: [] });
    return json(route, {});
  });
  return {
    histories,
    requests,
    finishedDetails,
    mutations: () =>
      requests.filter((request) => request.method !== 'GET' && !request.path.startsWith('/api/auth/')),
    draftWrites: () => requests.filter((request) => request.path.endsWith('/draft')),
    finishedExecutions: () => finishedExecutions,
    holdExecution: (record: Submission, status = 201) => {
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      nextExecution = { ready, status, record };
      return release;
    },
    holdDetail: (id: string) => {
      let release!: () => void;
      delayed.set(
        id,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return release;
    },
    failDetail: (id: string, status = 404) => failures.set(id, status),
    holdDraft: () => {
      let release!: () => void;
      nextDraft = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

async function inspect(page: Page, index = 0) {
  await page.getByRole('tab', { name: '提交记录', exact: true }).click();
  await page.locator('.algo-history-item').nth(index).click();
  await expect(page.locator('.algo-submitted-code')).toBeVisible();
}
async function expandCode(page: Page) {
  const entry = page.getByRole('button', { name: '与当前代码对比', exact: true });
  if (!(await entry.isVisible())) await page.locator('.algo-submitted-code .ant-collapse-header').click();
  await expect(entry).toBeVisible();
}
async function openComparison(page: Page) {
  await expandCode(page);
  await page.getByRole('button', { name: '与当前代码对比', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function fullText(page: Page) {
  await dialog(page)
    .locator('label.ant-radio-button-wrapper')
    .filter({ hasText: /^完整文本$/ })
    .click();
  await expect(dialog(page).getByRole('radio', { name: '完整文本', exact: true })).toBeChecked();
  await expect(originalText(page)).toBeVisible();
  await expect(currentText(page)).toBeVisible();
}
async function closeComparison(page: Page) {
  await dialog(page).getByRole('button', { name: '关闭代码对比', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
}
async function language(page: Page, label: string) {
  await page.getByRole('combobox', { name: '编程语言' }).press('ArrowDown');
  await page.getByTitle(label, { exact: true }).click();
}
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function readonly(field: Locator, expected: string) {
  await expect(field).toHaveAttribute('readonly', '');
  await expect(field).toHaveValue(expected);
  await field.focus();
  await field.press('ControlOrMeta+A');
  await field.press('Backspace');
  await expect(field).toHaveValue(expected);
}

test('改增删差异可导航，两侧快照只读，打开切换关闭不产生草稿或执行写入', async ({ page }) => {
  const oldCode = [
    '// BEFORE',
    'const changed = 1;',
    '// keep-a',
    '// remove-me',
    '// keep-b',
    'console.log(changed);',
  ].join('\n');
  const newCode = [
    '// BEFORE',
    'const changed = 2;',
    '// keep-a',
    '// keep-b',
    'console.log(changed);',
    '// added-at-end',
  ].join('\n');
  const fixture = await setup(page, {
    code: newCode,
    history: [submission('history-a', oldCode, 'javascript')],
    language: 'javascript',
  });
  await page.goto('/algorithms/two-sum');
  await expect(editor(page)).toHaveValue(newCode);
  await inspect(page);
  await openComparison(page);
  await expect(dialog(page).locator('.monaco-diff-editor')).toBeVisible({ timeout: 30000 });
  const next = dialog(page).getByRole('button', { name: '下一处差异', exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await dialog(page).getByRole('button', { name: '上一处差异', exact: true }).click();
  await expect(dialog(page).locator('.line-insert').first()).toBeVisible();
  await expect(dialog(page).locator('.line-delete').first()).toBeVisible();
  await expect(dialog(page).getByRole('status')).toHaveText(/原始代码不同，已显示 \d+ 处差异。/);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await mkdir('test-results/algorithm-code-comparison', { recursive: true });
  await page.screenshot({
    path: 'test-results/algorithm-code-comparison/desktop.png',
    fullPage: false,
    animations: 'disabled',
  });
  await fullText(page);
  await readonly(originalText(page), oldCode);
  await readonly(currentText(page), newCode);
  await closeComparison(page);
  await expect(editor(page)).toHaveValue(newCode);
  expect(fixture.mutations()).toEqual([]);
});

test('相同代码和空草稿都可完整查看，不隐式修剪空格或替换为空模板', async ({ page }) => {
  const code = '# 中文说明\nif True:\n\tprint("中文")\n    # 四空格缩进\n';
  const fixture = await setup(page, {
    language: 'python',
    code,
    history: [submission('history-a', code, 'python')],
  });
  await page.goto('/algorithms/two-sum');
  await inspect(page);
  await openComparison(page);
  await expect(dialog(page).locator('.monaco-diff-editor')).toBeVisible({ timeout: 30000 });
  await expect(dialog(page).getByRole('button', { name: '下一处差异', exact: true })).toBeDisabled();
  await fullText(page);
  await readonly(originalText(page), code);
  await readonly(currentText(page), code);
  await closeComparison(page);
  await editor(page).fill('');
  await editor(page).press('ControlOrMeta+s');
  await expect.poll(() => fixture.draftWrites().at(-1)?.body.code).toBe('');
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  const before = fixture.mutations().length;
  await openComparison(page);
  await fullText(page);
  await readonly(originalText(page), code);
  await readonly(currentText(page), '');
  await closeComparison(page);
  await expect(editor(page)).toHaveValue('');
  expect(fixture.mutations()).toHaveLength(before);
});

test('未同步快照不被迟到草稿保存或执行结果轮询改写', async ({ page }) => {
  const historical = submission('history-a', '// SAVED_RUN_CODE');
  historical.status = 'running';
  const fixture = await setup(page, { history: [historical] });
  await page.goto('/algorithms/two-sum');
  await inspect(page);
  const release = fixture.holdDraft();
  const unsynced = '// UNSYNCED_SNAPSHOT\nint main() { return 17; }';
  await editor(page).fill(unsynced);
  await editor(page).press('ControlOrMeta+s');
  await expect.poll(() => fixture.draftWrites().length).toBe(1);
  await openComparison(page);
  await expect(dialog(page).getByText('含未同步修改', { exact: true })).toBeVisible();
  await fullText(page);
  await expect(currentText(page)).toHaveValue(unsynced);
  const reads = fixture.requests.filter(
    (item) => item.path === '/api/algorithms/submissions/history-a',
  ).length;
  historical.status = 'accepted';
  historical.passed = 1;
  release();
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  await expect
    .poll(
      () => fixture.requests.filter((item) => item.path === '/api/algorithms/submissions/history-a').length,
    )
    .toBeGreaterThan(reads);
  await expect(currentText(page)).toHaveValue(unsynced);
  await expect(originalText(page)).toHaveValue('// SAVED_RUN_CODE');
  await expect(dialog(page).getByText('含未同步修改', { exact: true })).toBeVisible();
  await closeComparison(page);
  expect(fixture.mutations()).toHaveLength(1);
  expect(fixture.mutations()[0].path).toMatch(/\/draft$/);
});

test('跨语言仅提示文本差异，不切换主编辑器语言或写入代码', async ({ page }) => {
  const python = 'if True:\n\tprint("中文")\n    # 保留四空格';
  const fixture = await setup(page, {
    code: python,
    language: 'python',
    history: [submission('history-a', '#include <iostream>\nint main() { return 0; }')],
  });
  await page.goto('/algorithms/two-sum');
  await inspect(page);
  await openComparison(page);
  await expect(
    dialog(page).getByText('语言不同，仅比较文本差异，不判断语义等价或代码正确性。', { exact: true }),
  ).toBeVisible();
  await fullText(page);
  await expect(currentText(page)).toHaveValue(python);
  await expect(originalText(page)).toHaveValue(fixture.histories.a[0].code);
  await closeComparison(page);
  await expect(page.locator('.algo-editor-toolbar .ant-select-selection-item')).toHaveText('Python 3');
  await expect(editor(page)).toHaveValue(python);
  expect(fixture.mutations()).toEqual([]);
});

test('专业主编辑器的Undo与查找保留，对比模型不会替换原文档', async ({ page }) => {
  const initial = 'ORIGINAL_MODEL';
  const fixture = await setup(page, { professional: true, code: initial });
  await page.goto('/algorithms/two-sum');
  await expect(page.locator('.algo-monaco-surface .monaco-editor')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.algo-monaco-surface .view-lines')).toContainText(initial);
  await editor(page).focus();
  await editor(page).press('ControlOrMeta+A');
  await page.keyboard.insertText('UNDO_THIS_CHANGE');
  await editor(page).press('ControlOrMeta+s');
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  await inspect(page);
  await openComparison(page);
  await expect(dialog(page).locator('.monaco-diff-editor')).toBeVisible({ timeout: 30000 });
  await closeComparison(page);
  await expect(page.locator('.algo-monaco-surface .view-lines')).toContainText('UNDO_THIS_CHANGE');
  await page.getByRole('button', { name: '查找代码', exact: true }).click();
  await expect(page.locator('.algo-monaco-surface .find-widget')).toBeVisible();
  await page.keyboard.press('Escape');
  await editor(page).focus();
  await editor(page).press('ControlOrMeta+z');
  await expect(page.locator('.algo-monaco-surface .view-lines')).not.toContainText('UNDO_THIS_CHANGE');
  await expect(page.locator('.algo-monaco-surface .view-lines')).toContainText('ORIGINAL_MODEL');
  await page.getByRole('button', { name: '简易编辑器', exact: true }).click();
  await expect(editor(page)).toHaveValue(initial);
  expect(
    fixture.requests.filter((item) => item.method === 'POST' && /\/(submissions|analysis)$/.test(item.path)),
  ).toEqual([]);
});

test('390px简单编辑器首次加载本地差异资源，移动端不溢出并可看完整文本', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assets: string[] = [],
    workers: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (['script', 'font'].includes(request.resourceType())) assets.push(request.url());
  });
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  const code = '# 移动端草稿\nif True:\n    print("这是当前版本")\n';
  const fixture = await setup(page, {
    code,
    language: 'python',
    history: [submission('history-a', '# 移动端历史\nif True:\n\tprint("旧版")\n', 'python')],
  });
  const response = await page.goto('/algorithms/two-sum');
  const csp = response?.headers()['content-security-policy'];
  if (csp) expect(csp).toContain("script-src 'self'");
  await expect(editor(page)).toHaveValue(code);
  expect(await page.locator('.monaco-editor').count()).toBe(0);
  await inspect(page);
  await openComparison(page);
  await expect(dialog(page).locator('.monaco-diff-editor')).toBeVisible({ timeout: 30000 });
  await expect(dialog(page).getByRole('button', { name: '下一处差异', exact: true })).toBeEnabled();
  await expect(dialog(page).getByRole('status')).toHaveText(/原始代码不同，已显示 \d+ 处差异。/);
  await expect.poll(() => workers.length).toBeGreaterThan(0);
  expect(workers.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBeTruthy();
  expect(assets.some((url) => /cdn\.jsdelivr|unpkg|cdnjs/.test(url))).toBeFalsy();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  expect(await page.evaluate(() => (window as any).__comparisonCspViolations)).toEqual([]);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await mkdir('test-results/algorithm-code-comparison', { recursive: true });
  await page.screenshot({
    path: 'test-results/algorithm-code-comparison/mobile.png',
    fullPage: false,
    animations: 'disabled',
  });
  await fullText(page);
  await readonly(currentText(page), code);
  await closeComparison(page);
  expect(fixture.mutations()).toEqual([]);
  expect(errors).toEqual([]);
});

test('差异组件加载失败时完整文本仍可只读查看，不覆盖当前草稿', async ({ page }) => {
  const code = '// FALLBACK_CURRENT\n\t中文内容';
  const fixture = await setup(page, { code });
  let blocked = 0;
  await page.route(/(?:CodeDiffSurface|MonacoDiffSurface)[^/]*\.(?:tsx|js)(?:\?.*)?$/, (route) => {
    blocked++;
    return route.abort('failed');
  });
  await page.goto('/algorithms/two-sum');
  await inspect(page);
  await openComparison(page);
  await expect.poll(() => blocked).toBeGreaterThan(0);
  await fullText(page);
  await readonly(originalText(page), fixture.histories.a[0].code);
  await readonly(currentText(page), code);
  await closeComparison(page);
  await expect(editor(page)).toHaveValue(code);
  expect(fixture.mutations()).toEqual([]);
});

test('对比后取消恢复保持代码，确认恢复正确且保留其它语言本机草稿', async ({ page }) => {
  const cpp = '// CPP_DRAFT_TO_KEEP';
  const py = '# PYTHON_DRAFT_TO_KEEP\nprint(19)';
  const restored = '// HISTORICAL_CPP\nint main() { return 5; }';
  const fixture = await setup(page, { code: cpp, history: [submission('history-a', restored)] });
  await page.goto('/algorithms/two-sum');
  await language(page, 'Python 3');
  await editor(page).fill(py);
  await editor(page).press('ControlOrMeta+s');
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  await inspect(page);
  await openComparison(page);
  await dialog(page).getByRole('button', { name: '恢复历史代码', exact: true }).click();
  await page.getByRole('button', { name: /取\s*消/ }).click();
  await expect(editor(page)).toHaveValue(py);
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: '恢复历史代码', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复历史代码', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(editor(page)).toHaveValue(restored);
  await language(page, 'Python 3');
  await expect(editor(page)).toHaveValue(py);
  expect(
    fixture.requests.filter((item) => item.method === 'POST' && /\/(submissions|analysis)$/.test(item.path)),
  ).toEqual([]);
});

test('快速A到B乱序只展示最后选择，404不留旧来源且可重试', async ({ page }) => {
  const fixture = await setup(page);
  const release = fixture.holdDetail('history-a');
  await page.goto('/algorithms/two-sum');
  await page.getByRole('tab', { name: '提交记录', exact: true }).click();
  await page.locator('.algo-history-item').nth(0).click();
  await expect
    .poll(() => fixture.requests.some((item) => item.path.endsWith('/submissions/history-a')))
    .toBeTruthy();
  await page.locator('.algo-history-item').nth(1).click();
  await expect(page.locator('.algo-submitted-code')).toBeVisible();
  release();
  await expect.poll(() => fixture.finishedDetails).toContain('history-a');
  await settle(page);
  await openComparison(page);
  await fullText(page);
  await expect(originalText(page)).toHaveValue(fixture.histories.a[1].code);
  await closeComparison(page);
  fixture.failDetail('history-a');
  await page.locator('.algo-history-item').nth(0).click();
  await expect(page.getByText('提交记录不存在', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '与当前代码对比', exact: true })).not.toBeVisible();
  await inspect(page, 0);
  await openComparison(page);
  await fullText(page);
  await expect(originalText(page)).toHaveValue(fixture.histories.a[0].code);
  expect(fixture.mutations()).toEqual([]);
});

test('旧执行成功或失败迟到均不覆盖后来选定的历史对比来源', async ({ page }) => {
  const selected = submission('history-a', '// USER_SELECTED_HISTORY');
  const fixture = await setup(page, { history: [selected] });
  await page.goto('/algorithms/two-sum');
  for (const status of [201, 503]) {
    const stale = submission(`execution-${status}`, '// STALE_EXECUTION_SOURCE');
    stale.mode = 'run';
    const release = fixture.holdExecution(stale, status);
    const before = fixture.finishedExecutions();
    await page.getByRole('button', { name: '运行代码', exact: true }).click();
    await expect
      .poll(
        () =>
          fixture.requests.filter((item) => item.method === 'POST' && item.path.endsWith('/submissions'))
            .length,
      )
      .toBe(before + 1);
    await page.getByRole('tab', { name: '提交记录', exact: true }).click();
    await page.getByTestId('algorithm-submission-history-a').click();
    await expect
      .poll(() => fixture.finishedDetails.filter((id) => id === selected.id).length)
      .toBe(before + 1);
    release();
    await expect.poll(() => fixture.finishedExecutions()).toBe(before + 1);
    await expect(page.locator('.algo-submitted-code')).toBeVisible();
    await openComparison(page);
    await fullText(page);
    await expect(originalText(page)).toHaveValue(selected.code);
    await expect(page.getByText('旧执行请求失败', { exact: true })).toHaveCount(0);
    await closeComparison(page);
  }
  expect(fixture.requests.filter((item) => item.path.endsWith('/analysis'))).toEqual([]);
});

test('切题后迟到的旧题详情不能成为当前题的对比来源', async ({ page }) => {
  const secret = '// OLD_PROBLEM_PRIVATE_SOURCE';
  const fixture = await setup(page, {
    history: [
      submission('history-a', secret),
      submission('history-next', '// SECOND_PROBLEM_HISTORY', 'cpp', 'binary-search'),
    ],
  });
  const release = fixture.holdDetail('history-a');
  await page.goto('/algorithms/two-sum');
  await page.getByRole('tab', { name: '提交记录', exact: true }).click();
  await page.locator('.algo-history-item').first().click();
  await expect
    .poll(() => fixture.requests.some((item) => item.path.endsWith('/submissions/history-a')))
    .toBeTruthy();
  await page.getByRole('link', { name: '下一题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '二分查找', exact: true })).toBeVisible();
  release();
  await expect.poll(() => fixture.finishedDetails).toContain('history-a');
  await settle(page);
  await expect(page.locator('.algo-submitted-code')).toHaveCount(0);
  await expect(editor(page)).toHaveValue('// SECOND_PROBLEM_DRAFT');
  await inspect(page);
  await openComparison(page);
  await fullText(page);
  await expect(originalText(page)).toHaveValue('// SECOND_PROBLEM_HISTORY');
  await expect(currentText(page)).toHaveValue('// SECOND_PROBLEM_DRAFT');
  expect(await dialog(page).textContent()).not.toContain(secret);
  expect(fixture.mutations()).toEqual([]);
});

test('退出换账号后迟到旧详情及旧差异模型均不泄露到新账号', async ({ page }) => {
  const secret = '// ACCOUNT_A_PRIVATE_SOURCE';
  const fixture = await setup(page, { history: [submission('history-a', secret)] });
  await page.goto('/algorithms/two-sum');
  await inspect(page);
  await openComparison(page);
  await expect(dialog(page).locator('.monaco-diff-editor')).toBeVisible({ timeout: 30000 });
  await closeComparison(page);
  const release = fixture.holdDetail('history-a');
  await page.locator('.algo-history-item').first().click();
  await expect
    .poll(() => fixture.requests.filter((item) => item.path.endsWith('/submissions/history-a')).length)
    .toBe(2);
  await page.locator('.topbar-account').hover();
  await page.getByText('退出登录', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('账号', { exact: true }).fill('comparison-b');
  await page.getByLabel('密码', { exact: true }).fill('fixture-only-password');
  await page.getByRole('button', { name: '登录学习平台' }).click();
  await expect(page.getByRole('button', { name: '对比学生 B的账号菜单' })).toBeVisible();
  await page.locator('a[href="/algorithms"]').first().click();
  await page.locator('.algo-problem-row[href="/algorithms/two-sum"]').click();
  release();
  await expect.poll(() => fixture.finishedDetails.filter((id) => id === 'history-a').length).toBe(2);
  await settle(page);
  await expect(editor(page)).toHaveValue('// ACCOUNT_B_DRAFT');
  await expect(page.locator('.algo-submitted-code')).toHaveCount(0);
  await inspect(page);
  await openComparison(page);
  await fullText(page);
  await expect(originalText(page)).toHaveValue('// ACCOUNT_B_HISTORY\nint main() { return 3; }');
  await expect(currentText(page)).toHaveValue('// ACCOUNT_B_DRAFT');
  expect(await dialog(page).textContent()).not.toContain(secret);
  await closeComparison(page);
  await page.getByRole('button', { name: '使用专业编辑器', exact: true }).click();
  await expect(page.locator('.algo-monaco-surface .monaco-editor')).toBeVisible();
  await editor(page).focus();
  await editor(page).press('ControlOrMeta+z');
  await expect(page.locator('.algo-monaco-surface .view-lines')).not.toContainText('ACCOUNT_A_PRIVATE');
});

test('超长草稿拒绝比较而保留内容，CRLF与LF原始不同不误报完全相同', async ({ page }) => {
  const historical = 'print("line-endings")\r\n';
  const current = 'print("line-endings")\n';
  const fixture = await setup(page, {
    language: 'python',
    code: current,
    history: [submission('history-a', historical, 'python')],
  });
  await page.goto('/algorithms/two-sum');
  await inspect(page);
  await expandCode(page);
  const oversized = '#'.repeat(16001);
  await editor(page).fill(oversized);
  await page.getByRole('button', { name: '与当前代码对比', exact: true }).click();
  await expect(
    page.getByText('代码对比支持每份最多16000字符、48000字节，请先缩短当前代码。', { exact: true }),
  ).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(editor(page)).toHaveValue(oversized);
  expect(fixture.histories.a[0].code).toBe(historical);
  await expect(page.locator('.algo-submitted-code pre')).toHaveText(historical);
  await editor(page).fill(current);
  await editor(page).press('ControlOrMeta+s');
  await expect(page.getByText('草稿已同步', { exact: true })).toBeVisible();
  await openComparison(page);
  await expect(
    dialog(page).getByText('原始文本存在差异，但未生成可定位的行差异，请查看完整文本。', { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(dialog(page).getByText('代码内容完全相同。', { exact: true })).toHaveCount(0);
  await fullText(page);
  // Native textareas normalize line endings; the original API snapshot above retains CRLF.
  await expect(originalText(page)).toHaveValue(current);
  await expect(currentText(page)).toHaveValue(current);
  await closeComparison(page);
  await expect(editor(page)).toHaveValue(current);
  expect(
    fixture.requests.filter((item) => item.method === 'POST' && /\/(submissions|analysis)$/.test(item.path)),
  ).toEqual([]);
});
