import 'dotenv/config';
import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createInsightsFixture } from '../exam-insights.fixture';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(process.env.DEV_SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录学习平台' }).click();
  await expect(page).toHaveURL(/\/$/);
}
test('Teacher sees real item analysis and option frequencies at desktop and 320px; students cannot see internal analysis', async ({
  page,
  browser,
}) => {
  const db = new PrismaClient();
  const f = await createInsightsFixture(db).finally(() => db.$disconnect());
  await login(page, 'teacher');
  await page.goto(`/exams/${f.exam.id}`);
  await page.getByRole('tab', { name: '题目分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '考试题目分析', exact: true })).toBeVisible();
  const panel = page.getByRole('tabpanel', { name: '题目分析', exact: true });
  await expect(panel.getByText('有效参考人数 2', { exact: true })).toBeVisible();
  await expect(panel.getByText('已交卷次数 3', { exact: true })).toBeVisible();
  await expect(
    panel.getByText('小样本：不足 5 人，结果仅作描述，不用于判定题目质量。', { exact: true }),
  ).toBeVisible();
  const row = panel.locator('tr').filter({ hasText: `single统计题-${f.suffix}` });
  await expect(row).toContainText('50%');
  await expect(row).toContainText('20%');
  await expect(row).toContainText('2 / 10');
  await row.locator('button.ant-table-row-expand-icon').click();
  await expect(panel.getByText('选项频次以 2 位参考学生为分母。', { exact: true })).toBeVisible();
  await expect(panel.getByText(/A\. 选项甲 · 1 人（50%）/)).toBeVisible();
  await expect(panel.getByText(/B\. 选项乙 · 0 人（0%）/)).toBeVisible();
  await page.screenshot({ path: 'test-results/exam-item-analysis-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(panel.getByRole('button', { name: '刷新分析' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await page.screenshot({ path: 'test-results/exam-item-analysis-mobile.png', fullPage: true });

  const studentContext = await browser.newContext({
    baseURL: process.env.WEB_BASE_URL || new URL(page.url()).origin,
  });
  const studentPage = await studentContext.newPage();
  await login(studentPage, 'student');
  await studentPage.goto(`/exams/${f.exam.id}`);
  await expect(studentPage.getByRole('heading', { name: f.exam.title, exact: true })).toBeVisible();
  await expect(studentPage.getByRole('tab', { name: '题目分析', exact: true })).toHaveCount(0);
  expect(
    await studentPage.evaluate(
      async (id) => (await fetch(`/api/exams/${id}/item-analysis`)).status,
      f.exam.id,
    ),
  ).toBe(403);
  await studentContext.close();

  await f.teacher.call('POST', `/exams/${f.exam.id}/cancel`, { reason: '取消浏览器统计验收考试' });
  await panel.getByRole('button', { name: '刷新分析' }).click();
  await expect(
    panel.getByText('考试已取消：以下仅为历史交卷的描述性数据，不代表当前有效测验结果。', { exact: true }),
  ).toBeVisible();
});
