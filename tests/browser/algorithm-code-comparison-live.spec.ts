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
  'Live code comparison requires loopback web/API and a review database',
);
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15000,
  viewport: { width: 390, height: 844 },
});
type Client = { api: APIRequestContext; csrf: string; user: any };
type Historical = { id: string; code: string; language: string; mode: string; label: string };

async function register(api: APIRequestContext, username: string, password: string): Promise<Client> {
  const response = await api.post(`${web}/api/auth/register`, {
    headers: { Origin: web },
    data: { username, password, name: '代码对比验收同学' },
  });
  expect(response.status(), 'Independent fixture registration must succeed').toBe(201);
  const body = await response.json();
  return { api, csrf: body.csrfToken, user: body.user };
}
async function get(client: Client, path: string, status = 200) {
  const response = await client.api.get(`${web}/api${path}`, {
    headers: { Origin: web, 'x-csrf-token': client.csrf },
  });
  expect(response.status(), `GET ${path} must return ${status}`).toBe(status);
  return response.json();
}

test('真实历史代码对比保持只读快照，确认恢复草稿且隔离别题与账号', async ({ page }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const usernames = [`compare_live_${suffix}`, `compare_other_${suffix}`];
  const password = `Compare-${randomBytes(24).toString('base64url')}!`;
  const currentCode = `// CURRENT_UNSYNCED_${suffix}\n#include <iostream>\nint main() {\n  std::cout << "current <vector>";\n  return 7;\n}\n`;
  const serverCode = `// LAST_SERVER_DRAFT_${suffix}\nint main() { return 0; }\n`;
  const pythonDraft = `# PRIVATE_PYTHON_DRAFT_${suffix}\nprint("keep my other language")\n`;
  const formalCode = `// HISTORICAL_FORMAL_${suffix}\n#include <iostream>\nint main() {\n  std::cout << "0 1";\n  return 0;\n}\n`;
  const sampleCode = `// HISTORICAL_SAMPLE_${suffix}\nint main() { return 3; }\n`;
  const pythonCode = `# HISTORICAL_PYTHON_${suffix}\nprint("0 1")\n`;
  const otherCode = `// OTHER_USER_${suffix}`;
  const foreignCode = `// OTHER_SPACE_${suffix}`;
  const wrongProblemCode = `// DIFFERENT_PROBLEM_${suffix}`;
  let personal: Client;
  let otherContext: APIRequestContext | undefined;
  let foreignSpace: string | undefined;
  let storageKey = '';
  let holdWrites = true;
  const held: (() => void)[] = [];
  const errors: string[] = [];
  const workers: string[] = [];
  const scripts: string[] = [];
  const executionRequests: string[] = [];
  const dialog = page.getByRole('dialog', { name: '代码对比', exact: true });
  const editor = page.getByRole('textbox', { name: '算法代码编辑器', exact: true });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('request', (item) => {
    if (item.resourceType() === 'script') scripts.push(item.url());
    if (
      item.method() === 'POST' &&
      /\/algorithms\/problems\/[^/]+\/(?:submissions|analysis)$/.test(new URL(item.url()).pathname)
    )
      executionRequests.push(new URL(item.url()).pathname);
  });
  page.on('console', (event) => {
    if (
      event.type() === 'error' &&
      /content security policy|violat.*policy|worker.*(?:fail|error)|refused to (?:load|execute|create)/i.test(
        event.text(),
      )
    )
      errors.push(event.text());
  });
  const localDraft = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), storageKey);
  const releaseWrites = () => {
    holdWrites = false;
    for (const release of held.splice(0)) release();
  };
  async function layout() {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
      .toBe(true);
  }
  async function history(item: Historical, status = 200) {
    await page.getByRole('tab', { name: '提交记录', exact: true }).click();
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/algorithms/submissions/${item.id}`) &&
        response.request().method() === 'GET',
    );
    await page.getByTestId(`algorithm-submission-${item.id}`).click();
    const fetched = await response;
    expect(fetched.status()).toBe(status);
    const body = await fetched.json();
    if (status === 200)
      expect(body).toMatchObject({ id: item.id, code: item.code, language: item.language, mode: item.mode });
    return body;
  }
  async function compare(item: Historical) {
    await history(item);
    const open = page.getByRole('button', { name: '与当前代码对比', exact: true });
    if (!(await open.isVisible()))
      await page
        .getByText(`查看此次${item.mode === 'submit' ? '提交' : '运行'}的代码 · ${item.label}`, {
          exact: true,
        })
        .click();
    await open.click();
    await expect(dialog).toBeVisible();
  }
  async function completeText(historical: string, current: string) {
    await dialog.getByText('完整文本', { exact: true }).click();
    const historicalText = dialog.getByRole('textbox', { name: '历史提交完整代码', exact: true });
    const currentText = dialog.getByRole('textbox', { name: '当前草稿完整代码', exact: true });
    await expect(historicalText).toHaveValue(historical);
    await expect(currentText).toHaveValue(current);
    await expect(historicalText).toHaveJSProperty('readOnly', true);
    await expect(currentText).toHaveJSProperty('readOnly', true);
  }
  async function close() {
    await dialog.getByRole('button', { name: '关闭代码对比', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  async function language(label: string, expected: string) {
    const dropdown = page.getByRole('combobox', { name: '编程语言', exact: true });
    await dropdown.press('ArrowDown');
    await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden):visible')
      .getByTitle(label, { exact: true })
      .click();
    await expect(dropdown).toHaveAttribute('aria-expanded', 'false');
    await expect(editor).toHaveValue(expected);
  }
  try {
    personal = await register(page.request, usernames[0], password);
    otherContext = await request.newContext();
    const other = await register(otherContext, usernames[1], password);
    storageKey = `algorithm-draft:${personal.user.organizationId}:${personal.user.id}:two-sum-indices`;
    const service = await get(personal, '/algorithms/status');
    expect(service.judge.available).toBe(false);
    expect(service.ai.available).toBe(false);
    const scope = { userId: personal.user.id, organizationId: personal.user.organizationId };
    const seed = async (
      code: string,
      language: string,
      mode: string,
      offset: number,
      extra: Record<string, string> = {},
    ) =>
      db.algorithmSubmission.create({
        data: {
          ...scope,
          problemId: 'two-sum-indices',
          code,
          language,
          mode,
          status: mode === 'submit' ? 'accepted' : 'wrong_answer',
          passed: mode === 'submit' ? 2 : 0,
          total: 2,
          results: [],
          createdAt: new Date(Date.now() + offset),
          ...extra,
        },
      });
    const formal = { ...(await seed(formalCode, 'cpp', 'submit', -3000)), label: 'C++ 17' };
    const sample = { ...(await seed(sampleCode, 'cpp', 'run', -2000)), label: 'C++ 17' };
    const python = { ...(await seed(pythonCode, 'python', 'submit', -1000)), label: 'Python 3' };
    const wrongProblem = await seed(wrongProblemCode, 'cpp', 'submit', -4000, {
      problemId: 'first-position',
    });
    const otherSubmission = await seed(otherCode, 'cpp', 'submit', -5000, {
      userId: other.user.id,
      organizationId: other.user.organizationId,
    });
    foreignSpace = (await db.organization.create({ data: { name: `对比隔离空间-${suffix}` } })).id;
    const foreignSubmission = await seed(foreignCode, 'cpp', 'submit', -6000, {
      organizationId: foreignSpace,
    });
    await db.algorithmDraft.create({
      data: { ...scope, problemId: 'two-sum-indices', language: 'cpp', code: serverCode },
    });
    const ownCount = await db.algorithmSubmission.count({ where: { userId: personal.user.id } });

    await test.step('真实DTO按账号空间和题目列表过滤，手机从未同步本机代码开始', async () => {
      const listed = await get(personal, '/algorithms/problems/two-sum-indices/submissions?pageSize=8');
      expect(listed.items.map((item: any) => item.id).sort()).toEqual(
        [formal.id, sample.id, python.id].sort(),
      );
      await get(personal, `/algorithms/submissions/${otherSubmission.id}`, 404);
      await get(other, `/algorithms/submissions/${formal.id}`, 404);
      await get(personal, `/algorithms/submissions/${foreignSubmission.id}`, 404);
      // Own other-problem details are valid API reads; their workspace list remains separate.
      expect((await get(personal, `/algorithms/submissions/${wrongProblem.id}`)).problemId).toBe(
        'first-position',
      );
      await page.goto(`${web}/algorithms`);
      await page.evaluate(
        ({ key, cpp, python }) => {
          localStorage.setItem('algorithm-editor-mode', 'simple');
          localStorage.setItem(
            key,
            JSON.stringify({
              language: 'cpp',
              codes: { cpp, python },
              updatedAt: new Date().toISOString(),
              unsynced: true,
            }),
          );
        },
        { key: storageKey, cpp: currentCode, python: pythonDraft },
      );
      await page.route('**/api/algorithms/problems/two-sum-indices/draft', async (route) => {
        if (route.request().method() === 'PUT' && holdWrites)
          await new Promise<void>((resolve) => held.push(resolve));
        await route.continue().catch(() => {});
      });
      await page.goto(`${web}/algorithms/two-sum-indices`);
      await expect(editor).toHaveValue(currentCode);
      await expect(page.locator('.algo-code-editor textarea')).toBeVisible();
      await expect(page.locator('.monaco-editor')).toHaveCount(0);
      await expect.poll(async () => (await localDraft())?.unsynced).toBe(true);
      await layout();
    });

    await test.step('只读差异与完整文本均使用打开时快照，关闭不改草稿或产生提交', async () => {
      await compare(formal);
      await dialog.getByText('差异视图', { exact: true }).click();
      await expect(dialog.locator('.monaco-diff-editor')).toBeVisible({ timeout: 30000 });
      await expect.poll(() => workers.length, { timeout: 30000 }).toBeGreaterThan(0);
      await expect(dialog.getByRole('button', { name: '下一处差异', exact: true })).toBeEnabled({
        timeout: 15000,
      });
      await dialog.getByRole('button', { name: '下一处差异', exact: true }).click();
      await dialog.getByRole('button', { name: '上一处差异', exact: true }).click();
      await expect(dialog).toContainText('含未同步修改');
      const modified = dialog.locator('.monaco-diff-editor .editor.modified textarea').first();
      await expect(modified).toHaveJSProperty('readOnly', true);
      await modified.focus();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText('FORBIDDEN_READONLY_EDIT');
      await expect(dialog.locator('.monaco-diff-editor .editor.modified')).not.toContainText(
        'FORBIDDEN_READONLY_EDIT',
      );
      await completeText(formalCode, currentCode);
      // Real late server data cannot mutate an already-open comparison snapshot.
      await db.algorithmSubmission.update({
        where: { id: formal.id },
        data: { code: `${formalCode}// LATE_SERVER` },
      });
      expect((await get(personal, `/algorithms/submissions/${formal.id}`)).code).toContain('LATE_SERVER');
      await completeText(formalCode, currentCode);
      await db.algorithmSubmission.update({ where: { id: formal.id }, data: { code: formalCode } });
      await layout();
      await close();
      await expect(editor).toHaveValue(currentCode);
      expect((await localDraft()).codes).toEqual({ cpp: currentCode, python: pythonDraft });
      expect(
        (
          await db.algorithmDraft.findUniqueOrThrow({
            where: { organizationId_userId_problemId: { ...scope, problemId: 'two-sum-indices' } },
          })
        ).code,
      ).toBe(serverCode);
      expect(await db.algorithmSubmission.count({ where: { userId: personal.user.id } })).toBe(ownCount);
    });

    await test.step('样例和异语言正式历史读取准确，对比不会切换主语言', async () => {
      await compare(sample);
      await completeText(sampleCode, currentCode);
      await close();
      await compare(python);
      await completeText(pythonCode, currentCode);
      await expect(dialog).toContainText('语言不同，仅比较文本差异，不判断语义等价或代码正确性。');
      await close();
      await expect(editor).toHaveValue(currentCode);
      await expect(page.locator('.algo-editor-file')).toContainText('main.cpp');
      expect((await localDraft()).codes.python).toBe(pythonDraft);
    });

    await test.step('二次确认恢复历史代码，真实持久化且其他语言草稿仍保留', async () => {
      await compare(formal);
      await dialog.getByRole('button', { name: '恢复历史代码', exact: true }).click();
      const confirmation = page.locator('.ant-popconfirm:visible');
      await expect(confirmation).toBeVisible();
      expect((await localDraft()).codes.cpp).toBe(currentCode);
      await confirmation.getByRole('button', { name: '确认恢复历史代码', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(editor).toHaveValue(formalCode);
      releaseWrites();
      await expect
        .poll(
          async () =>
            (
              await db.algorithmDraft.findUniqueOrThrow({
                where: { organizationId_userId_problemId: { ...scope, problemId: 'two-sum-indices' } },
              })
            ).code,
        )
        .toBe(formalCode);
      await expect.poll(async () => (await localDraft())?.unsynced).toBe(false);
      expect((await localDraft()).codes.python).toBe(pythonDraft);
      await language('Python 3', pythonDraft);
      await language('C++ 17', formalCode);
      await expect.poll(async () => (await localDraft())?.unsynced).toBe(false);
    });

    await test.step('真实404与别题详情不会继续展示旧来源，切题关闭对比', async () => {
      await history(formal);
      // Keep the real loaded list stale, then remove one record on the server.
      await db.algorithmSubmission.delete({ where: { id: sample.id } });
      await history(sample, 404);
      await expect(page.locator('.algo-submitted-code')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '与当前代码对比', exact: true })).toHaveCount(0);
      await db.algorithmSubmission.update({
        where: { id: python.id },
        data: { problemId: 'first-position' },
      });
      await history(python);
      await expect(page.locator('.algo-submitted-code')).toHaveCount(0);
      await expect(dialog).toBeHidden();
      await db.algorithmSubmission.update({
        where: { id: python.id },
        data: { problemId: 'two-sum-indices' },
      });
      await compare(formal);
      await page.goto(`${web}/algorithms/first-position`);
      await expect(dialog).toBeHidden();
      await expect(editor).not.toHaveValue(formalCode);
      await expect(page.locator('body')).not.toContainText(`HISTORICAL_FORMAL_${suffix}`);
      await expect(page.locator('body')).not.toContainText(`OTHER_USER_${suffix}`);
      await expect(page.locator('body')).not.toContainText(`OTHER_SPACE_${suffix}`);
      expect(executionRequests).toEqual([]);
      expect(await db.algorithmSubmission.count({ where: { userId: personal.user.id } })).toBe(ownCount - 1);
      expect(await db.algorithmOperation.count({ where: { userId: personal.user.id } })).toBe(0);
      expect(await db.algorithmAnalysis.count({ where: { userId: personal.user.id } })).toBe(0);
      expect(workers.every((url) => new URL(url).origin === new URL(web).origin)).toBe(true);
      expect(
        scripts
          .filter((url) => /^https?:/.test(url))
          .every((url) => new URL(url).origin === new URL(web).origin),
      ).toBe(true);
      expect(errors).toEqual([]);
      await layout();
    });
  } finally {
    releaseWrites();
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
