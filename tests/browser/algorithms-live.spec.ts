import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.use({ actionTimeout: 10000 });

test('algorithm library and draft persistence use the real student API on desktop and mobile', async ({
  page,
}) => {
  expect(new URL(process.env.DATABASE_URL!).pathname).toContain('review');
  const errors: string[] = [];
  async function capture(path: string) {
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
    // Finish finite layout animations before Playwright measures full-page dimensions.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => {
            const timing = animation.effect?.getComputedTiming();
            return timing && Number.isFinite(Number(timing.endTime));
          })
          .map((animation) => animation.finished.catch(() => undefined)),
      );
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill('student');
  await page.getByLabel('密码', { exact: true }).fill(process.env.DEV_SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录学习平台' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/algorithms');
  await expect(page.getByRole('heading', { name: '算法练习', exact: true })).toBeVisible();
  await expect(page.locator('.algo-problem-row')).toHaveCount(12);
  await expect(page.getByRole('heading', { name: '按计划稳步进阶' })).toBeVisible();
  await expect(page.getByLabel('最近28天提交活动').locator('> span')).toHaveCount(28);
  await page.getByText('树与图专题', { exact: true }).click();
  await expect(page.getByRole('heading', { name: /遍历与连通性/ })).toBeVisible();
  await expect(
    page.locator('.algo-plan-chapter').getByRole('link', { name: /二叉树的最大深度/ }),
  ).toBeVisible();
  await mkdir('test-results', { recursive: true });
  await capture('test-results/algorithms-live-library.png');
  await page.getByPlaceholder('搜索题号、题目或关键词').fill('回文');
  await page.getByPlaceholder('搜索题号、题目或关键词').press('Enter');
  await expect(page.locator('.algo-problem-row')).toHaveCount(1);
  await expect(page.locator('.algo-problem-row')).toContainText('回文单词');
  await page.goto('/algorithms/maximum-subarray');
  await expect(page.getByRole('heading', { name: '最佳连续区间', exact: true })).toBeVisible();
  async function simpleEditor() {
    await expect(page.getByText('代码编辑器', { exact: true })).toBeVisible();
    const toggle = page.getByRole('button', { name: '简易编辑器', exact: true });
    if (await toggle.isVisible()) await toggle.click();
    await expect(page.locator('.algo-code-editor textarea')).toBeVisible();
    await expect(page.locator('.algo-code-editor textarea')).toBeEnabled();
  }
  await simpleEditor();
  const editor = page.getByRole('textbox', { name: '算法代码编辑器' });
  await expect(editor).toBeEnabled();
  await page.getByRole('combobox', { name: '编程语言' }).press('ArrowDown');
  await page.locator('.ant-select-item-option[title="Python 3"]').click();
  const draft = `# real browser persistence ${Date.now()}\nimport sys\na = list(map(int, sys.stdin.read().split()))[1:]\nbest = current = a[0]\nfor x in a[1:]:\n    current = max(x, current + x)\n    best = max(best, current)\nprint(best)\n`;
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith('/algorithms/problems/maximum-subarray/draft') &&
      response.ok(),
  );
  await editor.fill(draft);
  await saved;
  await expect(page.getByRole('status').filter({ hasText: '草稿已同步' })).toBeVisible();
  // Remove the browser cache so this specifically verifies the persisted server draft.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await simpleEditor();
  await expect(editor).toHaveValue(draft);
  await expect(page.locator('.algo-editor-file')).toContainText('main.py');
  await page.getByRole('button', { name: '使用专业编辑器' }).click();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('import sys');
  await capture('test-results/algorithms-live-detail.png');
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  const note = `真实API持久化检查 ${Date.now()}：连续子数组必须非空，全负数时取最大元素。`;
  await page.getByLabel('我的解题笔记').fill(note);
  await page.getByRole('combobox', { name: '复习状态' }).press('ArrowDown');
  await page.locator('.ant-select-item-option[title="需要复习"]').click();
  const savedNote = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith('/maximum-subarray/learning') &&
      response.ok(),
  );
  await page.getByRole('button', { name: '保存笔记与状态' }).click();
  await savedNote;
  await expect(page.getByRole('button', { name: '保存笔记与状态', exact: true })).toBeDisabled();
  const favorite = page.getByRole('button', { name: '收藏题目', exact: true });
  if (await favorite.isVisible()) await favorite.click();
  await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(page.getByLabel('我的解题笔记')).toHaveValue(note);
  await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '题解', exact: true }).click();
  await expect(page.getByRole('heading', { name: '参考代码', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '查看第 1 条提示' }).click();
  await expect(page.locator('.algo-hint')).toHaveCount(1);
  await page.getByRole('button', { name: '显示完整题解与答案' }).click();
  await expect(page.getByRole('heading', { name: '解法比较', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '参考代码', exact: true })).toBeVisible();
  await capture('test-results/algorithms-live-editorial.png');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/algorithms', '/algorithms/maximum-subarray']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.locator('main .loading-state')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
      route,
    ).toBeTruthy();
  }
  await simpleEditor();
  await expect(editor).toHaveValue(draft);
  await capture('test-results/algorithms-live-mobile.png');
  await page.getByRole('tab', { name: '题解', exact: true }).click();
  await page.getByRole('button', { name: '显示完整题解与答案' }).click();
  await expect(page.getByRole('heading', { name: '参考代码', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBeTruthy();
  const tableScroll = await page.locator('.algo-table-scroll').evaluateAll((elements) =>
    elements.map((element) => {
      const wrapper = element as HTMLElement;
      const overflows = wrapper.scrollWidth > wrapper.clientWidth;
      wrapper.scrollLeft = 1;
      const canScroll = wrapper.scrollLeft > 0;
      wrapper.scrollLeft = 0;
      return { width: wrapper.getBoundingClientRect().width, overflows, canScroll };
    }),
  );
  expect(tableScroll.length).toBeGreaterThan(0);
  expect(tableScroll.every((item) => item.width <= 390 && (!item.overflows || item.canScroll))).toBeTruthy();
  await capture('test-results/algorithms-live-editorial-mobile.png');
  expect(errors).toEqual([]);
});
