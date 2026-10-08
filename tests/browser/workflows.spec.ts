import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const password = process.env.DEV_SEED_PASSWORD!;
const unique = () => randomUUID().slice(0, 8);
async function apiLogin(username: string) {
  const api = await playwrightRequest.newContext({
    baseURL: process.env.TEST_API_URL || 'http://127.0.0.1:3001',
  });
  const response = await api.post('/api/auth/login', { data: { username, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { csrfToken } = await response.json();
  return { api, headers: { 'x-csrf-token': csrfToken } };
}
async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录学习平台' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
async function post(api: APIRequestContext, headers: Record<string, string>, path: string, data: any) {
  const response = await api.post(`/api${path}`, { headers, data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
const localTime = (offset: number) => new Date(Date.now() + offset + 8 * 3600000).toISOString().slice(0, 16);

test('Teacher creates exam from saved paper, edits its schedule and cancels with a reason', async ({
  page,
}) => {
  const { api, headers } = await apiLogin('teacher');
  const q = await post(api, headers, '/questions', {
    courseId: 'course-math',
    type: 'single',
    stem: '可复用试卷验收 ' + unique(),
    answer: 'A',
    options: [
      { id: 'A', text: '正确选项' },
      { id: 'B', text: '干扰项' },
    ],
    scoreCents: 500,
  });
  const paper = await post(api, headers, '/papers', {
    courseId: 'course-math',
    title: '浏览器试卷 ' + unique(),
    questionVersionIds: [q.versions[0].id],
  });
  const title = '浏览器配置验收 ' + unique();
  await login(page, 'teacher');
  await page.goto('/exams');
  await page.getByRole('button', { name: '创建考试', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('所属课程', { exact: true }).fill('高等数学');
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: '高等数学 · 从理解到应用' })
    .click();
  await dialog.getByLabel('考试名称', { exact: true }).fill(title);
  await dialog.getByLabel('考试说明与须知', { exact: true }).fill('按照说明独立作答');
  await dialog.getByLabel('考试开始时间', { exact: true }).fill(localTime(3600000));
  await dialog.getByLabel('考试窗口结束时间', { exact: true }).fill(localTime(10800000));
  await dialog.getByLabel('最晚允许进入时间', { exact: true }).fill(localTime(7200000));
  await dialog.getByText('套用已有试卷', { exact: true }).click();
  await dialog.getByLabel('已有固定版本试卷', { exact: true }).fill(paper.title);
  await page.locator('.ant-select-item-option-content').filter({ hasText: paper.title }).click();
  await expect(dialog.getByText(/已载入 1 题/)).toBeVisible();
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/exams') && r.request().method() === 'POST' && r.ok(),
  );
  await dialog.getByRole('button', { name: '保存草稿' }).click();
  const exam = await (await created).json();
  await page.goto(`/exams/${exam.id}`);
  await page.getByRole('button', { name: '编辑考试', exact: true }).click();
  await dialog.getByLabel('考试说明与须知', { exact: true }).fill('已修订的考试须知');
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('main').getByText('已修订的考试须知', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消考试', exact: true }).click();
  await dialog.getByPlaceholder('填写至少 3 字的取消原因').fill('教学安排调整，重新发布考试');
  await dialog.getByRole('button', { name: '确认取消考试', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await api.get(`/api/exams/${exam.id}`)).json()).status).toBe('cancelled');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/teacher-exam-management.png', fullPage: true });
  await api.dispose();
});

test('Practice position and review flags restore after page reload, and students can open appeal history', async ({
  page,
}) => {
  const teacher = await apiLogin('teacher');
  const student = await apiLogin('student');
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const q = await post(teacher.api, teacher.headers, '/questions', {
      courseId: 'course-math',
      type: 'boolean',
      stem: `练习恢复 ${unique()} ${i}`,
      answer: true,
      practiceEnabled: true,
      scoreCents: 100,
    });
    ids.push(q.id);
  }
  const practice = await post(student.api, student.headers, '/practice', {
    courseId: 'course-math',
    count: 2,
    mode: 'random',
    questionIds: ids,
  });
  await login(page, 'student');
  await page.goto(`/practice/${practice.id}`);
  await page.getByRole('button', { name: '第 2 题', exact: true }).click();
  await page.getByRole('button', { name: '稍后复习', exact: true }).click();
  await expect(page.getByText('已保存练习位置', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '第 2 题', exact: true })).toHaveClass(/current/);
  await expect(page.getByRole('button', { name: '取消标记', exact: true })).toBeVisible();
  await page.goto('/appeals');
  await expect(page.getByRole('heading', { name: '成绩复核', exact: true })).toBeVisible();
  await expect(page.getByText('当前工作身份没有此功能权限')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '处理复核' })).toHaveCount(0);
  await teacher.api.dispose();
  await student.api.dispose();
});

test('Teacher grades a subjective answer by question using a persisted real submission', async ({ page }) => {
  const teacher = await apiLogin('teacher');
  const student = await apiLogin('student');
  const q = await post(teacher.api, teacher.headers, '/questions', {
    courseId: 'course-math',
    type: 'short',
    stem: '<p>请说明<strong>事务一致性</strong>。</p>',
    answer: '事务前后数据约束保持成立',
    scoreCents: 200,
  });
  const exam = await post(teacher.api, teacher.headers, '/exams', {
    courseId: 'course-math',
    title: '逐题阅卷 ' + unique(),
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 1800000).toISOString(),
    entryClosesAt: new Date(Date.now() + 1200000).toISOString(),
    durationMinutes: 10,
    passCents: 100,
    graderIds: ['u-teacher'],
    questionVersionIds: [q.versions[0].id],
  });
  await post(teacher.api, teacher.headers, `/exams/${exam.id}/publish`, {});
  const attempt = await post(student.api, student.headers, `/exams/${exam.id}/start`, {});
  const saved = await student.api.put(`/api/attempts/${attempt.id}/answers`, {
    headers: student.headers,
    data: {
      revision: attempt.revision,
      answers: [{ questionVersionId: q.versions[0].id, value: '保持约束成立' }],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await post(student.api, student.headers, `/attempts/${attempt.id}/submit`, {
    idempotencyKey: randomUUID(),
  });
  await login(page, 'teacher');
  await page.goto(`/exams/${exam.id}`);
  await page.getByRole('tab', { name: '按题阅卷', exact: true }).click();
  await expect(page.locator('.question-stem strong').filter({ hasText: '事务一致性' })).toBeVisible();
  await page.getByRole('spinbutton', { name: '林同学的本题得分' }).fill('1.5');
  await page.getByRole('button', { name: '保存本题评分', exact: true }).click();
  await expect(page.getByText('本题评分已保存，其他题目评分保留', { exact: true })).toBeVisible();
  const result = await teacher.api.get(`/api/attempts/${attempt.id}`);
  expect(result.ok()).toBeTruthy();
  const body = await result.json();
  expect(body.scoreCents).toBe(150);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/teacher-question-grading.png', fullPage: true });
  await page.goto(`/grading/exam/${attempt.id}`);
  await page.getByPlaceholder('总体批阅意见').fill('总体反馈：论述方向正确，请补充完整条件。');
  await page.getByPlaceholder('题目批注').fill('本题批注：注意事务前后的约束。');
  await page.getByRole('button', { name: '保存阅卷', exact: true }).click();
  await expect(page.getByText('批阅已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder('总体批阅意见')).toHaveValue('总体反馈：论述方向正确，请补充完整条件。');
  // Only this unique fixture's clock is advanced, so publication can be verified without real-time waits.
  const db = new PrismaClient();
  try {
    await db.exam.update({
      where: { id: exam.id },
      data: {
        endsAt: new Date(Date.now() - 1000),
        entryClosesAt: new Date(Date.now() - 2000),
        scoreReleaseAt: new Date(Date.now() - 1000),
        commentReleaseAt: new Date(Date.now() + 600000),
      },
    });
    await post(teacher.api, teacher.headers, `/exams/${exam.id}/release`, {});
    await page.context().clearCookies();
    await login(page, 'student');
    await page.goto(`/exam-attempts/${attempt.id}`);
    await expect(page.getByRole('heading', { name: '我的答卷', exact: true })).toBeVisible();
    await expect(page.getByText('总体反馈：论述方向正确，请补充完整条件。', { exact: true })).toHaveCount(0);
    await expect(page.getByText('本题批注：注意事务前后的约束。', { exact: true })).toHaveCount(0);
    await db.exam.update({ where: { id: exam.id }, data: { commentReleaseAt: new Date(Date.now() - 500) } });
    await page.reload();
    await expect(page.getByText('总体反馈：论述方向正确，请补充完整条件。', { exact: true })).toBeVisible();
    await expect(page.getByText('本题批注：注意事务前后的约束。', { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'test-results/student-graded-feedback.png', fullPage: true });
  } finally {
    await db.$disconnect();
  }

  await teacher.api.dispose();
  await student.api.dispose();
});

test('Administrator and super administrator pages render with current authorization', async ({ page }) => {
  await login(page, 'admin');
  for (const path of [
    '/admin/users',
    '/admin/organization',
    '/admin/settings',
    '/admin/audit',
    '/admin/moderation',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('服务器处理失败，请稍后重试')).toHaveCount(0);
  }
  await page.goto('/admin/settings');
  await page
    .getByRole('row')
    .filter({ hasText: '课程分类与年级字典' })
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByLabel('课程分类', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('年级 / 部门', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto('/admin/audit?tab=jobs');
  await expect(page.getByRole('tab', { name: '后台任务', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.context().clearCookies();
  await login(page, 'superadmin');
  await page.goto('/admin/organization');
  await page.getByRole('tab', { name: '机构管理', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: '机构名称', exact: true })).toBeVisible();
  await page.goto('/admin/roles');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/superadmin-permissions.png', fullPage: true });
});
