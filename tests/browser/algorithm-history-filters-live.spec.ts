import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const api = process.env.TEST_BASE_URL;
const web = process.env.WEB_BASE_URL || 'http://localhost:5173';
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/none');
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
test.skip(
  process.env.NODE_ENV === 'production' ||
    !api ||
    !loopback(new URL(api).hostname) ||
    !loopback(new URL(web).hostname) ||
    !loopback(database.hostname) ||
    !/review/i.test(database.pathname),
  'Live history filters require loopback web/API and a review database',
);
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15000,
  viewport: { width: 390, height: 844 },
});
const problemId = 'two-sum-indices';
const historyPath = `/api/algorithms/problems/${problemId}/submissions`;
type Filter = { kind?: string; language?: string; status?: string };
type Row = { id: string; code: string; language: string; mode: string; customInput: boolean; status: string };

test('真实提交历史组合筛选、分页重置、只读对比与确认恢复保持私人草稿隔离', async ({ page }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const usernames = [`history_live_${suffix}`, `history_other_${suffix}`];
  const password = `History-${randomBytes(24).toString('base64url')}!`;
  const draft = `// PRIVATE_CPP_DRAFT_${suffix}\nint main() { return 0; }\n`;
  const pythonDraft = `# PRIVATE_PYTHON_DRAFT_${suffix}\nprint("keep")\n`;
  const rows: Row[] = [];
  let own: any, foreignSpace: string | undefined, otherContext: APIRequestContext | undefined;
  let storageKey = '';
  const errors: string[] = [],
    executions: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (event) => {
    if (
      event.type() === 'error' &&
      /content security policy|violat.*policy|refused to (?:load|execute|create)/i.test(event.text())
    )
      errors.push(event.text());
  });
  page.on('request', (item) => {
    if (
      item.method() === 'POST' &&
      /\/algorithms\/problems\/[^/]+\/(?:submissions|analysis)$/.test(new URL(item.url()).pathname)
    )
      executions.push(new URL(item.url()).pathname);
  });
  const editor = page.getByRole('textbox', { name: '算法代码编辑器', exact: true });
  const cards = page.locator('.algo-history-item');
  const matched = page.getByRole('status', { name: '提交记录匹配数量', exact: true });
  const refreshButton = page
    .getByRole('tabpanel', { name: '提交记录', exact: true })
    .getByRole('button', { name: /^(?:loading )?刷新提交记录$/ });
  const dialog = page.getByRole('dialog', { name: '代码对比', exact: true });
  const localDraft = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), storageKey);
  async function register(context: APIRequestContext, username: string) {
    const response = await context.post(`${web}/api/auth/register`, {
      headers: { Origin: web },
      data: { username, password, name: '历史筛选验收同学' },
    });
    expect(response.status(), 'Independent fixture registration must succeed').toBe(201);
    return (await response.json()).user;
  }
  async function get(path: string, context = page.request, status = 200) {
    const response = await context.get(`${web}/api${path}`);
    expect(response.status(), `GET ${path}`).toBe(status);
    return response.json();
  }
  const selected = (filter: Filter) =>
    rows
      .filter((row) => {
        const kind = row.mode === 'submit' ? 'submit' : row.customInput ? 'custom' : 'examples';
        return (
          (!filter.kind || filter.kind === kind) &&
          (!filter.language || filter.language === row.language) &&
          (!filter.status || filter.status === row.status)
        );
      })
      .slice()
      .sort((a, b) => (a.id < b.id ? 1 : -1));
  function pending(filter: Filter, pageNumber: number) {
    return page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (response.request().method() !== 'GET' || url.pathname !== historyPath) return false;
      return (
        url.searchParams.get('page') === String(pageNumber) &&
        url.searchParams.get('pageSize') === '8' &&
        ['kind', 'language', 'status'].every(
          (key) => url.searchParams.get(key) === (filter[key as keyof Filter] || null),
        )
      );
    });
  }
  async function assertList(filter: Filter, pageNumber = 1) {
    const expected = selected(filter);
    await expect(matched).toHaveText(`匹配 ${expected.length} 条`);
    await expect
      .poll(async () => cards.evaluateAll((items) => items.map((item) => item.getAttribute('data-testid'))))
      .toEqual(
        expected.slice((pageNumber - 1) * 8, pageNumber * 8).map((item) => `algorithm-submission-${item.id}`),
      );
    if (expected.length > 8)
      await expect(page.locator('.ant-pagination-item-active')).toHaveAttribute('title', String(pageNumber));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
      .toBe(true);
  }
  async function refresh(filter: Filter, pageNumber = 1) {
    // Ant Design's loading icon participates in the accessible name, including
    // its exit animation. Locate the same button in both states, then wait for
    // its actual loading class to clear before issuing the explicit refresh.
    await expect(refreshButton).not.toHaveClass(/ant-btn-loading/);
    const wait = pending(filter, pageNumber);
    await refreshButton.click();
    const response = await wait;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ page: pageNumber, pageSize: 8, ...filter });
    await assertList(filter, pageNumber);
    return body;
  }
  async function choose(name: string, label: string, filter: Filter) {
    const control = page.getByRole('combobox', { name, exact: true });
    await control.press('ArrowDown');
    await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden):visible')
      .getByTitle(label, { exact: true })
      .click();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await assertList(filter);
    // A recently used query may be served from the legitimate 20-second cache.
    // Explicit refresh exercises the real filtered endpoint in either case.
    await refresh(filter);
  }
  async function nextPage(filter: Filter) {
    await page.locator('.ant-pagination').getByTitle('2', { exact: true }).click();
    await assertList(filter, 2);
    await refresh(filter, 2);
  }
  async function reset(button: '重置筛选' | '清除筛选') {
    await page.getByRole('button', { name: button, exact: true }).click();
    await assertList({});
    const body = await refresh({});
    expect(Object.keys(body).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
  }
  async function unchanged(expectedResult?: Row) {
    await expect(editor).toHaveValue(draft);
    await expect(page.locator('.algo-editor-file')).toContainText('main.cpp');
    expect((await localDraft()).codes).toEqual({ cpp: draft, python: pythonDraft });
    const stored = await db.algorithmDraft.findUniqueOrThrow({
      where: {
        organizationId_userId_problemId: { userId: own.id, organizationId: own.organizationId, problemId },
      },
    });
    expect(stored.code).toBe(draft);
    expect(stored.language).toBe('cpp');
    if (expectedResult)
      await expect(page.locator('.algo-submitted-code pre')).toHaveText(expectedResult.code);
  }
  async function compare() {
    await page.getByRole('button', { name: '与当前代码对比', exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByText('完整文本', { exact: true }).click();
  }
  try {
    own = await register(page.request, usernames[0]);
    otherContext = await request.newContext();
    const other = await register(otherContext, usernames[1]);
    const scope = { userId: own.id, organizationId: own.organizationId };
    storageKey = `algorithm-draft:${own.organizationId}:${own.id}:${problemId}`;
    const service = await get('/algorithms/status');
    expect(service.judge.available).toBe(false);
    expect(service.ai.available).toBe(false);
    const seed = async (mode: string, customInput: boolean, language: string, status: string) => {
      const id = `history-live-${suffix}-${String(rows.length).padStart(3, '0')}`;
      const row = await db.algorithmSubmission.create({
        data: {
          ...scope,
          id,
          problemId,
          mode,
          customInput,
          language,
          status,
          code:
            language === 'python' ? `# HISTORY_${id}\nprint(42)\n` : `// HISTORY_${id}\nconsole.log(42);\n`,
          total: 1,
          passed: status === 'accepted' ? 1 : 0,
          results: [
            {
              index: 1,
              hidden: mode === 'submit',
              status,
              ...(mode === 'run' ? { input: '4 9\n2 7 3 5\n', stdout: '0 1\n' } : {}),
            },
          ],
          createdAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      });
      rows.push(row);
      return row;
    };
    for (let i = 0; i < 12; i++) await seed('run', true, 'javascript', 'accepted');
    for (let i = 0; i < 4; i++) await seed('submit', false, 'cpp', 'accepted');
    for (let i = 0; i < 4; i++) await seed('run', false, 'python', 'wrong_answer');
    for (let i = 0; i < 4; i++) await seed('run', true, 'java', 'compile_error');
    for (let i = 0; i < 4; i++) await seed('submit', false, 'javascript', 'wrong_answer');
    for (const status of ['runtime_error', 'time_limit', 'memory_limit', 'system_error', 'running'])
      await seed('run', false, 'cpp', status);
    foreignSpace = (await db.organization.create({ data: { name: `历史筛选隔离-${suffix}` } })).id;
    const privateRows = [];
    for (const extra of [
      { organizationId: other.organizationId, userId: other.id },
      { organizationId: foreignSpace },
      { problemId: 'first-position' },
    ]) {
      privateRows.push(
        await db.algorithmSubmission.create({
          data: {
            ...scope,
            problemId,
            mode: 'run',
            customInput: true,
            language: 'javascript',
            status: 'accepted',
            code: 'OTHER_SCOPE_PRIVATE_SOURCE',
            results: [],
            ...extra,
          },
        }),
      );
    }
    await get(`/algorithms/submissions/${privateRows[0].id}`, page.request, 404);
    await get(`/algorithms/submissions/${privateRows[1].id}`, page.request, 404);
    await db.algorithmDraft.create({ data: { ...scope, problemId, language: 'cpp', code: draft } });
    const baselineCount = await db.algorithmSubmission.count({ where: { userId: own.id } });
    const baselineSolved = (await get('/algorithms/overview')).stats.solved;
    await page.goto(`${web}/algorithms`);
    await page.evaluate(
      ({ key, cpp, python }) => {
        localStorage.setItem('algorithm-editor-mode', 'simple');
        localStorage.setItem(
          key,
          JSON.stringify({
            language: 'cpp',
            codes: { cpp, python },
            unsynced: false,
            updatedAt: new Date().toISOString(),
          }),
        );
      },
      { key: storageKey, cpp: draft, python: pythonDraft },
    );
    const initial = pending({}, 1);
    await page.goto(`${web}/algorithms/${problemId}`);
    expect((await initial).status()).toBe(200);
    await page.getByRole('tab', { name: '提交记录', exact: true }).click();
    await assertList({});
    await unchanged();

    await test.step('同时间戳的真实混合历史分页准确，三个筛选逐次重置到第一页', async () => {
      await nextPage({});
      await choose('提交记录类型', '自定义运行', { kind: 'custom' });
      await nextPage({ kind: 'custom' });
      await choose('提交记录语言', 'JavaScript', { kind: 'custom', language: 'javascript' });
      await nextPage({ kind: 'custom', language: 'javascript' });
      await choose('提交记录结果', '执行完成', {
        kind: 'custom',
        language: 'javascript',
        status: 'accepted',
      });
      await unchanged();
      expect(selected({ kind: 'custom', language: 'javascript', status: 'accepted' }).length).toBe(12);
      expect(await db.algorithmSubmission.count({ where: { userId: own.id } })).toBe(baselineCount);
      expect((await get('/algorithms/overview')).stats.solved).toBe(baselineSolved);
    });
    const picked = selected({ kind: 'custom', language: 'javascript', status: 'accepted' })[0];
    await test.step('过滤后的真实详情可只读对比，后续筛选空集仍保留所选结果和主编辑器', async () => {
      const detail = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/algorithms/submissions/${picked.id}` &&
          response.request().method() === 'GET',
      );
      await page.getByTestId(`algorithm-submission-${picked.id}`).click();
      expect(await (await detail).json()).toMatchObject({
        id: picked.id,
        code: picked.code,
        customInput: true,
        mode: 'run',
      });
      await page.getByText('查看此次运行的代码 · JavaScript', { exact: true }).click();
      await compare();
      await expect(dialog.getByRole('textbox', { name: '历史提交完整代码', exact: true })).toHaveValue(
        picked.code,
      );
      await expect(dialog.getByRole('textbox', { name: '当前草稿完整代码', exact: true })).toHaveValue(draft);
      await expect(dialog.getByRole('textbox', { name: '历史提交完整代码', exact: true })).toHaveJSProperty(
        'readOnly',
        true,
      );
      await dialog.getByRole('button', { name: '关闭代码对比', exact: true }).click();
      await expect(dialog).toBeHidden();
      await unchanged(picked);
      await choose('提交记录结果', '编译错误', {
        kind: 'custom',
        language: 'javascript',
        status: 'compile_error',
      });
      await expect(page.getByText('没有符合当前条件的记录', { exact: true })).toBeVisible();
      await unchanged(picked);
      await reset('清除筛选');
      await unchanged(picked);
      await choose('提交记录类型', '样例运行', { kind: 'examples' });
      await choose('提交记录语言', 'Python 3', { kind: 'examples', language: 'python' });
      await choose('提交记录结果', '答案错误', {
        kind: 'examples',
        language: 'python',
        status: 'wrong_answer',
      });
      await unchanged(picked);
      await reset('重置筛选');
    });
    await test.step('筛选刷新末页变短自动纠正页码且保留全部筛选条件', async () => {
      await choose('提交记录类型', '自定义运行', { kind: 'custom' });
      await choose('提交记录语言', 'JavaScript', { kind: 'custom', language: 'javascript' });
      await choose('提交记录结果', '执行完成', {
        kind: 'custom',
        language: 'javascript',
        status: 'accepted',
      });
      await nextPage({ kind: 'custom', language: 'javascript', status: 'accepted' });
      const removeIds = selected({ kind: 'custom', language: 'javascript', status: 'accepted' })
        .slice(6)
        .map((item) => item.id);
      await db.algorithmSubmission.deleteMany({ where: { id: { in: removeIds }, ...scope } });
      for (let i = rows.length - 1; i >= 0; i--) if (removeIds.includes(rows[i].id)) rows.splice(i, 1);
      const corrected = pending({ kind: 'custom', language: 'javascript', status: 'accepted' }, 1);
      await expect(refreshButton).not.toHaveClass(/ant-btn-loading/);
      await refreshButton.click();
      expect((await corrected).status()).toBe(200);
      await assertList({ kind: 'custom', language: 'javascript', status: 'accepted' });
      await unchanged(picked);
      expect(await db.algorithmSubmission.count({ where: { userId: own.id } })).toBe(
        baselineCount - removeIds.length,
      );
    });
    await test.step('仅显式二次确认恢复代码才改变当前草稿，其他语言本机代码仍保留', async () => {
      await compare();
      await dialog.getByRole('button', { name: '恢复历史代码', exact: true }).click();
      const confirm = page.locator('.ant-popconfirm:visible');
      await expect(confirm).toBeVisible();
      await unchanged(picked);
      await confirm.getByRole('button', { name: '确认恢复历史代码', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(editor).toHaveValue(picked.code);
      await expect(page.locator('.algo-editor-file')).toContainText('main.js');
      await expect
        .poll(async () => {
          const row = await db.algorithmDraft.findUniqueOrThrow({
            where: { organizationId_userId_problemId: { ...scope, problemId } },
          });
          return { code: row.code, language: row.language };
        })
        .toEqual({ code: picked.code, language: 'javascript' });
      await expect(page.getByRole('status').filter({ hasText: '草稿已同步' })).toBeVisible();
      expect((await localDraft()).codes.python).toBe(pythonDraft);
      expect((await localDraft()).codes.cpp).toBe(draft);
      expect(await db.algorithmOperation.count({ where: { userId: own.id } })).toBe(0);
      expect(await db.algorithmAnalysis.count({ where: { userId: own.id } })).toBe(0);
      expect((await get('/algorithms/overview')).stats.solved).toBe(baselineSolved);
      expect(executions).toEqual([]);
      expect(errors).toEqual([]);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
        .toBe(true);
    });
  } finally {
    await page.close().catch(() => {});
    await otherContext?.dispose();
    const users = await db.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true, personalOrganizationId: true },
    });
    const userIds = users.map((user) => user.id);
    const organizationIds = [foreignSpace, ...users.map((user) => user.personalOrganizationId)].filter(
      (id): id is string => !!id,
    );
    try {
      await db.$transaction([
        db.algorithmAnalysis.deleteMany({ where: { userId: { in: userIds } } }),
        db.algorithmOperation.deleteMany({ where: { userId: { in: userIds } } }),
        db.algorithmSubmission.deleteMany({ where: { userId: { in: userIds } } }),
        db.algorithmDraft.deleteMany({ where: { userId: { in: userIds } } }),
        db.algorithmLearningState.deleteMany({ where: { userId: { in: userIds } } }),
        db.passwordRecovery.deleteMany({ where: { userId: { in: userIds } } }),
        db.session.deleteMany({ where: { userId: { in: userIds } } }),
        db.sensitiveGrant.deleteMany({ where: { userId: { in: userIds } } }),
        db.notification.deleteMany({ where: { organizationId: { in: organizationIds } } }),
        db.backgroundJob.deleteMany({ where: { organizationId: { in: organizationIds } } }),
        db.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } }),
        db.userRole.deleteMany({ where: { userId: { in: userIds } } }),
        db.user.deleteMany({ where: { id: { in: userIds } } }),
        db.organization.deleteMany({ where: { id: { in: organizationIds } } }),
      ]);
    } finally {
      await db.$disconnect();
    }
  }
});
