import { test, expect, request, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { plannerDay, plannerMonthShift } from '../../apps/web/src/planner-time';

const password = process.env.DEV_SEED_PASSWORD!;
async function login(page: Page, username = 'student') {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录学习平台' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/planner');
  await expect(page.getByRole('heading', { name: '学习计划与日历', exact: true })).toBeVisible();
  await expect(page.locator('main .loading-state')).toHaveCount(0);
  await expect(page.getByText('暂时无法加载', { exact: true })).toHaveCount(0);
}
async function apiLogin() {
  const api = await request.newContext({
    baseURL: process.env.TEST_API_URL || process.env.TEST_BASE_URL || 'http://127.0.0.1:3001',
  });
  const logged = await api.post('/api/auth/login', { data: { username: 'student', password } });
  expect(logged.ok(), await logged.text()).toBeTruthy();
  const { csrfToken } = await logged.json();
  return { api, headers: { 'x-csrf-token': csrfToken } };
}

test.use({ timezoneId: 'America/Los_Angeles' });

test('Planner personal tasks use Beijing time, persist completion, recover conflicts without losing input and delete', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const second = await apiLogin();
  let id: string | undefined;
  const title = '个人复习计划 ' + randomUUID().slice(0, 8);
  const localDue = `${plannerDay()}T18:35`;
  try {
    await login(page);
    await page.locator('.planner-view-controls .ant-select').click();
    await page.locator('.ant-select-item-option-content').filter({ hasText: '个人待办' }).click();
    await page.getByRole('button', { name: '新建个人待办', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('待办标题', { exact: true }).fill(title);
    await dialog.getByLabel('计划时间（北京时间）', { exact: true }).fill(localDue);
    await dialog.getByLabel('备注', { exact: true }).fill('复习第三章；确认北京时间不会受浏览器时区影响。');
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/planner/tasks') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '创建待办', exact: true }).click();
    const created = await saved;
    expect(created.ok(), await created.text()).toBeTruthy();
    expect(created.request().postDataJSON().dueAt).toBe(new Date(`${localDue}:00+08:00`).toISOString());
    const task = await created.json();
    id = task.id;
    expect(task.dueAt).toBe(new Date(`${localDue}:00+08:00`).toISOString());
    await expect(dialog).not.toBeVisible();
    const card = page.getByTestId(`planner-event-${id}`);
    await expect(card.getByText('18:35', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${plannerDay()}，`) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await mkdir('.data', { recursive: true });
    await page.screenshot({ path: '.data/planner-desktop.png', fullPage: false, animations: 'disabled' });
    await card.getByRole('button', { name: `完成 ${title}`, exact: true }).click();
    await expect(card.getByRole('button', { name: `重开 ${title}`, exact: true })).toBeVisible();
    await page.reload();
    await expect(card.getByRole('button', { name: `重开 ${title}`, exact: true })).toBeVisible();
    await card.getByRole('button', { name: `重开 ${title}`, exact: true }).click();
    await expect(card.getByRole('button', { name: `完成 ${title}`, exact: true })).toBeVisible();
    await card.getByRole('button', { name: title, exact: true }).click();
    await expect(dialog.getByLabel('计划时间（北京时间）', { exact: true })).toHaveValue(localDue);
    const editedTitle = `${title}（本次输入）`;
    await dialog.getByLabel('待办标题', { exact: true }).fill(editedTitle);
    const latest = await (await second.api.get(`/api/planner/tasks/${id}`)).json();
    const changed = await second.api.patch(`/api/planner/tasks/${id}`, {
      headers: second.headers,
      data: {
        revision: latest.revision,
        title: `${title}（另一窗口）`,
        dueAt: `${plannerMonthShift(plannerDay().slice(0, 7), 2)}-08T10:00:00+08:00`,
      },
    });
    expect(changed.ok(), await changed.text()).toBeTruthy();
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(
      dialog.getByText('你的输入仍然保留。请刷新版本并核对后重试。', { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel('待办标题', { exact: true })).toHaveValue(editedTitle);
    await dialog.getByRole('button', { name: '保留输入并刷新版本', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '保留输入并刷新版本', exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('待办标题', { exact: true })).toHaveValue(editedTitle);
    await expect(dialog.getByLabel('计划时间（北京时间）', { exact: true })).toHaveValue(localDue);
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.getByRole('button', { name: editedTitle, exact: true })).toBeVisible();
    const persisted = await (await second.api.get(`/api/planner/tasks/${id}`)).json();
    expect(persisted.title).toBe(editedTitle);
    expect(persisted.dueAt).toBe(new Date(`${localDue}:00+08:00`).toISOString());
    await card.getByRole('button', { name: editedTitle, exact: true }).click();
    await dialog.getByRole('button', { name: '删除待办', exact: true }).click();
    await page.getByRole('button', { name: /^删\s*除$/, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card).toHaveCount(0);
    expect((await second.api.get(`/api/planner/tasks/${id}`)).status()).toBe(404);
    id = undefined;
    expect(errors).toEqual([]);
  } finally {
    if (id) {
      const result = await second.api.get(`/api/planner/tasks/${id}`);
      if (result.ok())
        await second.api.delete(`/api/planner/tasks/${id}`, {
          headers: second.headers,
          data: { revision: (await result.json()).revision },
        });
    }
    await second.api.dispose();
  }
});

test('Planner keeps cross-month exams visible in both views and stays usable on a 390px screen', async ({
  page,
}) => {
  const db = new PrismaClient();
  const month = plannerDay().slice(0, 7);
  const title = '跨月考试日历验收 ' + randomUUID().slice(0, 8);
  const fixture = await db.exam.create({
    data: {
      organizationId: 'org-demo',
      courseId: 'course-math',
      creatorId: 'u-teacher',
      title,
      status: 'published',
      startsAt: new Date(`${plannerMonthShift(month, -2)}-25T09:00:00+08:00`),
      endsAt: new Date(`${month}-15T18:00:00+08:00`),
      entryClosesAt: new Date(`${month}-15T17:00:00+08:00`),
      durationMinutes: 60,
      passCents: 60,
      totalCents: 100,
      graderIds: [],
      audience: { create: { userId: 'u-student' } },
    },
  });
  try {
    await login(page);
    await page.getByRole('button', { name: new RegExp(`^${month}-01，`) }).click();
    const card = page.getByTestId(`planner-event-exam:${fixture.id}`);
    await expect(card.getByRole('button', { name: title, exact: true })).toBeVisible();
    const day = page
      .locator('.planner-day-cell')
      .filter({ has: page.getByRole('button', { name: new RegExp(`^${month}-01，`) }) });
    // Other fixtures can fill the two visible chips; the selected day's agenda must still retain this exam.
    await expect(day.getByRole('button', { name: new RegExp(`^${month}-01，`) })).not.toHaveAccessibleName(
      `${month}-01，0 项日程`,
    );
    await page.locator('.planner-view-controls .ant-segmented-item').filter({ hasText: '日程' }).click();
    await expect(card.getByRole('button', { name: title, exact: true })).toBeVisible();
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('link', { name: '查看', exact: true })).toHaveAttribute(
      'href',
      `/exams/${fixture.id}`,
    );
    await card.getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByRole('dialog').getByText('考试开始', { exact: true })).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^关\s*闭$/, exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('region', { name: '本月日程列表', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: title, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    ).toBeTruthy();
    await mkdir('.data', { recursive: true });
    await page.screenshot({ path: '.data/planner-mobile.png', fullPage: false, animations: 'disabled' });
    await page.locator('.planner-view-controls .ant-select').click();
    const filtered = page.waitForResponse(
      (r) =>
        r.url().includes('/api/planner?') &&
        new URL(r.url()).searchParams.get('type') === 'personal' &&
        r.ok(),
    );
    await page.locator('.ant-select-item-option-content').getByText('个人待办', { exact: true }).click();
    await filtered;
    await expect(card).toHaveCount(0);
    await page.locator('.planner-view-controls .ant-segmented-item').filter({ hasText: '月历' }).click();
    await expect(page.getByRole('region', { name: '月历', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    ).toBeTruthy();
    await page.screenshot({
      path: '.data/planner-mobile-month.png',
      fullPage: false,
      animations: 'disabled',
    });
  } finally {
    await db.exam.delete({ where: { id: fixture.id } });
    await db.$disconnect();
  }
});
