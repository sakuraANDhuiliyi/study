import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const isolated =
  !!process.env.TEST_API_URL &&
  /review/i.test(new URL(process.env.DATABASE_URL || 'postgresql://localhost/none').pathname);
test.skip(
  !isolated || process.env.NODE_ENV === 'production',
  'Notes browser checks require the isolated review environment',
);
const db = new PrismaClient();
const marker = '笔记浏览器-' + randomUUID().slice(0, 8);
let courseId: string;
let lessonId: string;
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill('student');
  await page.getByLabel('密码', { exact: true }).fill(process.env.DEV_SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录学习平台' }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function openNote(page: Page) {
  await page.goto(`/courses/${courseId}?lesson=${lessonId}`);
  await page.getByRole('button', { name: '我的课时笔记', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '笔记内容', exact: true })).toBeVisible();
}
test.beforeAll(async () => {
  if (!isolated) return;
  const teacher = await db.user.findUniqueOrThrow({ where: { username: 'teacher' } });
  const student = await db.user.findUniqueOrThrow({ where: { username: 'student' } });
  const course = await db.course.create({
    data: {
      organizationId: student.organizationId,
      teacherId: teacher.id,
      title: marker,
      status: 'PUBLISHED',
    },
  });
  courseId = course.id;
  await db.teachingAssignment.create({ data: { courseId, userId: teacher.id } });
  await db.enrollment.create({ data: { courseId, userId: student.id } });
  const chapter = await db.chapter.create({ data: { courseId, title: '笔记验收章节' } });
  await db.lesson.create({ data: { courseId, chapterId: chapter.id, title: '第一课时', sortOrder: 0 } });
  const lesson = await db.lesson.create({
    data: {
      courseId,
      chapterId: chapter.id,
      title: '第二课时：深入理解',
      content: '<p>独立思考，形成自己的理解。</p>',
      sortOrder: 1,
    },
  });
  lessonId = lesson.id;
});
test.afterAll(async () => {
  if (courseId) {
    await db.lessonNote.deleteMany({ where: { courseId } });
    await db.lesson.deleteMany({ where: { courseId } });
    await db.chapter.deleteMany({ where: { courseId } });
    await db.enrollment.deleteMany({ where: { courseId } });
    await db.teachingAssignment.deleteMany({ where: { courseId } });
    await db.course.delete({ where: { id: courseId } });
  }
  await db.$disconnect();
});

test('学生能从课时保存私人笔记、跨课搜索置顶并返回原课时', async ({ page }) => {
  await login(page);
  await openNote(page);
  await expect(page.getByRole('dialog').getByText('第二课时：深入理解', { exact: false })).toBeVisible();
  const text = `${marker} 我的课程理解\n<img src=x onerror=alert(1)> 应作为普通文本显示`;
  await page.getByRole('textbox', { name: '笔记内容' }).fill(text);
  await page.getByRole('checkbox', { name: '置顶这条笔记' }).check();
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto('/notes');
  await page.getByPlaceholder('搜索笔记、课时或课程', { exact: true }).fill(marker);
  await page.getByPlaceholder('搜索笔记、课时或课程', { exact: true }).press('Enter');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-card')).toContainText('置顶');
  await expect(page.locator('.note-preview')).toContainText('<img src=x');
  await expect(page.locator('.note-preview img')).toHaveCount(0);
  await page.screenshot({ path: '.data/ui-tabler/notes-desktop.png', fullPage: true });
  await page.getByRole('link', { name: '返回课时' }).click();
  await expect(page).toHaveURL(new RegExp(`lesson=${lessonId}`));
  await expect(page.locator('.lesson-view h2')).toContainText('第二课时：深入理解');
});

test('两个页面同时编辑时冲突保留输入，并且手机笔记页不溢出', async ({ page, context }) => {
  await login(page);
  await openNote(page);
  const other = await context.newPage();
  await openNote(other);
  const newer = `${marker} 第一页保存的最新版`;
  await page.getByRole('textbox', { name: '笔记内容' }).fill(newer);
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  const unsaved = '第二页未保存内容必须保留';
  await other.getByRole('textbox', { name: '笔记内容' }).fill(unsaved);
  await other.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(other.getByText('笔记版本冲突，当前输入已保留', { exact: true })).toBeVisible();
  await expect(other.getByRole('textbox', { name: '笔记内容' })).toHaveValue(unsaved);
  await other.getByRole('button', { name: '载入最新版本', exact: true }).click();
  await other.getByRole('button', { name: '载入最新', exact: true }).click();
  await expect(other.getByRole('textbox', { name: '笔记内容' })).toHaveValue(newer);
  await other.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await other.setViewportSize({ width: 390, height: 844 });
  await other.goto('/notes');
  await expect(other.locator('.note-card').first()).toBeVisible();
  expect(await other.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await other.screenshot({ path: '.data/ui-tabler/notes-mobile.png', fullPage: true });
  await other.close();
});
