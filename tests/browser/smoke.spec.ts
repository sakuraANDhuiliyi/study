import { test, expect, request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const password = process.env.DEV_SEED_PASSWORD!;
async function login(page: any, username: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录学习平台' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}
test('Desktop student and administrative pages render with real API data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'student');
  for (const route of [
    '/courses',
    '/assignments',
    '/practice',
    '/exams',
    '/analytics',
    '/communication',
    '/notifications',
    '/profile',
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.locator('main .loading-state')).toHaveCount(0);
    await expect(page.getByText('暂时无法加载', { exact: true })).toHaveCount(0);
    await expect(page.getByText('服务器处理失败，请稍后重试')).toHaveCount(0);
  }
  await page.goto('/communication');
  await page.getByRole('combobox', { name: '讨论作者', exact: true }).fill('林同学');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/communication/posts?') &&
        new URL(response.url()).searchParams.get('authorId') === 'u-student' &&
        response.ok(),
    ),
    page.locator('.ant-select-item-option-content').filter({ hasText: '林同学（我）' }).click(),
  ]);
  await expect(page.locator('main .loading-state')).toHaveCount(0);
  await page.getByRole('tab', { name: '师生与班级交流', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  const contactPicker = page.getByRole('dialog').getByRole('combobox').first();
  await contactPicker.fill('周');
  await expect(page.locator('.ant-select-item-option-content').filter({ hasText: '周老师' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '继续学习', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '最近七天学习活动次数' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/student-dashboard.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('Small mobile viewport retains usable content without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'student');
  for (const route of ['/', '/courses', '/assignments', '/exams']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.locator('main .loading-state')).toHaveCount(0);
    await expect(page.getByText('暂时无法加载', { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      route,
    ).toBeTruthy();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/mobile-exams.png', fullPage: true });
});
test('Exam offline edits are marked unsynchronized then restored and persisted after reconnect', async ({
  page,
  context,
}) => {
  const api = await playwrightRequest.newContext({
    baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:3001',
  });
  const logged = await api.post('/api/auth/login', { data: { username: 'teacher', password } });
  expect(logged.ok()).toBeTruthy();
  const data = await logged.json();
  const headers = { 'x-csrf-token': data.csrfToken };
  const question = await api.post('/api/questions', {
    headers,
    data: {
      courseId: 'course-math',
      type: 'single',
      stem: '浏览器可靠性验收：请选择一个选项',
      answer: 'A',
      options: [
        { id: 'A', text: '选项甲' },
        { id: 'B', text: '选项乙' },
      ],
      scoreCents: 100,
    },
  });
  expect(question.ok()).toBeTruthy();
  const q = await question.json();
  const created = await api.post('/api/exams', {
    headers,
    data: {
      courseId: 'course-math',
      title: '浏览器离线验收-' + randomUUID().slice(0, 8),
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 1800000).toISOString(),
      entryClosesAt: new Date(Date.now() + 1200000).toISOString(),
      durationMinutes: 15,
      passCents: 60,
      questionVersionIds: [q.versions[0].id],
    },
  });
  expect(created.ok()).toBeTruthy();
  const exam = await created.json();
  expect((await api.post(`/api/exams/${exam.id}/publish`, { headers, data: {} })).ok()).toBeTruthy();
  await login(page, 'student');
  await page.goto(`/exams/${exam.id}`);
  await page.getByText('我已阅读并理解考试须知', { exact: true }).click();
  await page.getByRole('button', { name: '开始考试', exact: true }).click();
  await expect(page).toHaveURL(/exam-attempts/);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/answers') && r.request().method() === 'PUT' && r.ok()),
    page.getByRole('radio').first().check(),
  ]);
  await expect(page.getByText('全部答案已同步', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('radio').nth(1).check();
  await expect(page.getByText('未同步，请重试', { exact: true })).toBeVisible({ timeout: 12000 });
  await context.setOffline(false);
  await expect(page.getByText('全部答案已同步', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(page.getByRole('radio').nth(1)).toBeChecked();
  await expect(page.getByText('全部答案已同步', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/exam-restored.png', fullPage: true });
  await api.dispose();
});
