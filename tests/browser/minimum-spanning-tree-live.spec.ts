import { test, expect, type Page } from '@playwright/test';
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
  'Live MST requires loopback web/API and a review database',
);
// Credentials are random and memory-only. No credential-bearing browser artifacts are retained.
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15000,
  viewport: { width: 390, height: 844 },
});
const problemId = 'minimum-spanning-tree';
async function layout(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), {
      message: '390px page must not overflow horizontally',
    })
    .toBe(true);
}

// External providers stay disabled. Opening educational references cannot solve the problem.
test('第19题最小生成树真实检索、第三章、分级题解与四语言参考草稿保存', async ({ page }) => {
  test.setTimeout(150000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex'),
    username = `mst_live_${suffix}`;
  const password = `Mst-${randomBytes(24).toString('base64url')}!`;
  const note = `生成树需选n-1条边且连接全部节点；负总权-1合法，自环不能选。\nPRIVATE_NOTE_${suffix}\n<script>window.__mstInjected=true</script>`;
  const ownCode = `# MY_MST_DRAFT_${suffix}\n# Next step: sort edges and maintain connected components.\n`;
  let user: any;
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
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/algorithms\/problems\/[^/]+\/(?:submissions|analysis)$/.test(new URL(request.url()).pathname)
    )
      executions.push(new URL(request.url()).pathname);
  });
  await page.addInitScript(() => {
    localStorage.setItem('algorithm-editor-mode', 'simple');
    (window as any).__mstInjected = false;
  });
  const editor = page.getByRole('textbox', { name: '算法代码编辑器', exact: true });
  async function get(path: string) {
    const response = await page.request.get(`${web}/api${path}`);
    expect(response.status(), `GET ${path} must succeed`).toBe(200);
    return response.json();
  }
  async function choose(name: string, label: string) {
    await page.getByRole('combobox', { name, exact: true }).press('ArrowDown');
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
      .click();
    await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
  }
  async function persisted(code: string, language: string) {
    await expect
      .poll(async () => {
        const row = await db.algorithmDraft.findUnique({
          where: {
            organizationId_userId_problemId: {
              organizationId: user.organizationId,
              userId: user.id,
              problemId,
            },
          },
        });
        return row ? { code: row.code, language: row.language } : null;
      })
      .toEqual({ code, language });
    await expect(page.getByRole('status').filter({ hasText: '草稿已同步' })).toBeVisible();
  }
  try {
    const registration = await page.request.post(`${web}/api/auth/register`, {
      headers: { Origin: web },
      data: { username, password, name: '生成树验收同学' },
    });
    expect(registration.status(), 'Independent fixture registration must succeed').toBe(201);
    user = (await registration.json()).user;
    expect(user.accountMode).toBe('PERSONAL');
    const status = await get('/algorithms/status');
    expect(status.judge.available).toBe(false);
    expect(status.ai.available).toBe(false);
    const catalog = await get('/algorithms/problems?pageSize=50');
    expect(catalog.total).toBe(19);
    expect(catalog.stats.solved).toBe(0);
    const editorial = (await get(`/algorithms/problems/${problemId}/editorial`)).editorial;
    expect(Object.keys(editorial.referenceCode).sort()).toEqual(['cpp', 'java', 'javascript', 'python']);
    await page.goto(`${web}/algorithms`);
    await expect(page.getByRole('heading', { name: '算法练习', exact: true })).toBeVisible();
    const search = page.getByPlaceholder('搜索题号、题目或关键词');
    await search.fill('最小生成树');
    await search.press('Enter');
    await expect(page.locator('.algo-problem-row')).toHaveCount(1);
    await expect(page.locator('.algo-problem-row')).toContainText('最小生成树总权');
    await expect(page.locator('.algo-problem-row')).toContainText('019');
    await page.getByText('树与图专题', { exact: true }).click();
    const chapter = page
      .locator('.algo-plan-chapter')
      .filter({ has: page.getByRole('heading', { name: /全图连接与贪心/ }) });
    await expect(chapter).toContainText('03');
    await expect(page.locator('.algo-plan-meta')).toContainText('16');
    await layout(page);
    await chapter.getByRole('link', { name: /最小生成树总权/ }).click();
    await expect(page).toHaveURL(new RegExp(`/algorithms/${problemId}$`));
    await expect(page.getByRole('heading', { name: '最小生成树总权', exact: true })).toBeVisible();
    await expect(page.locator('.algo-statement')).toContainText('IMPOSSIBLE');
    await expect(page.locator('.algo-statement')).toContainText('-1');
    await expect(editor).toBeEnabled();
    await expect(page.getByRole('button', { name: '运行代码', exact: true })).toBeDisabled();
    await layout(page);

    await page.getByRole('tab', { name: '题解', exact: true }).click();
    await expect(page.getByRole('heading', { name: '参考代码', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '查看第 1 条提示', exact: true }).click();
    await expect(page.locator('.algo-hint')).toHaveCount(1);
    await page.getByRole('button', { name: '展开第 2 条提示', exact: true }).click();
    await expect(page.locator('.algo-hint')).toHaveCount(2);
    await page.getByRole('button', { name: '展开第 3 条提示', exact: true }).click();
    await expect(page.locator('.algo-hint')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: '参考代码', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '显示完整题解与答案', exact: true }).click();
    await expect(page.getByRole('heading', { name: '解法比较', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Kruskal：排序与并查集/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Prim：最小堆扩展一棵树/ })).toBeVisible();
    await page.getByRole('tab', { name: /Prim：最小堆扩展一棵树/ }).click();
    await expect(page.getByRole('heading', { name: '参考代码', exact: true })).toBeVisible();
    await layout(page);
    const confirm = page.locator('.ant-popconfirm:visible');
    for (const [language, label] of [
      ['python', 'Python 3'],
      ['javascript', 'JavaScript'],
    ]) {
      await choose('参考代码语言', label);
      await expect(page.locator('.algo-reference-code')).toHaveText(editorial.referenceCode[language]);
      const previous = await editor.inputValue();
      await page.getByRole('button', { name: '载入编辑器', exact: true }).click();
      await expect(confirm).toContainText('载入参考代码并替换当前编辑器内容？');
      await expect(editor).toHaveValue(previous);
      await confirm.getByRole('button', { name: '载入参考代码', exact: true }).click();
      await expect(confirm).toHaveCount(0);
      await expect(editor).toHaveValue(editorial.referenceCode[language]);
      await persisted(editorial.referenceCode[language], language);
    }
    await choose('编程语言', 'Python 3');
    await expect(editor).toHaveValue(editorial.referenceCode.python);
    await editor.fill(ownCode);
    await persisted(ownCode, 'python');
    await page.getByRole('tab', { name: '笔记', exact: true }).click();
    await page.getByLabel('我的解题笔记', { exact: true }).fill(note);
    await choose('复习状态', '需要复习');
    const savedNote = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/${problemId}/learning`) && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存笔记与状态', exact: true }).click();
    expect((await savedNote).status()).toBe(200);
    await expect(page.getByRole('button', { name: '保存笔记与状态', exact: true })).toBeDisabled();
    expect((await get(`/algorithms/problems/${problemId}/learning`)).note).toBe(note);
    // Clear local drafts so the next read proves real server persistence.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(editor).toHaveValue(ownCode);
    await page.getByRole('tab', { name: '笔记', exact: true }).click();
    await expect(page.getByLabel('我的解题笔记', { exact: true })).toHaveValue(note);
    expect(await page.evaluate(() => (window as any).__mstInjected)).toBe(false);
    const current = await get('/algorithms/problems?q=最小生成树');
    expect(current.items[0].status).toBe('todo');
    expect(current.stats.solved).toBe(0);
    expect(
      (await get('/algorithms/overview')).plans.find((item: any) => item.id === 'trees-graphs').solved,
    ).toBe(0);
    expect(await db.algorithmSubmission.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.algorithmOperation.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.algorithmAnalysis.count({ where: { userId: user.id } })).toBe(0);
    expect(executions).toEqual([]);
    expect(errors).toEqual([]);
    await layout(page);
  } finally {
    await page.close().catch(() => {});
    const users = await db.user.findMany({
      where: { username },
      select: { id: true, personalOrganizationId: true },
    });
    const userIds = users.map((item) => item.id),
      organizationIds = users.map((item) => item.personalOrganizationId).filter((id): id is string => !!id);
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
