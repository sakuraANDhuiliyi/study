import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, permissions: string[]) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/api/auth/me'
        ? {
            user: {
              id: 'split-teacher',
              organizationId: 'split-org',
              username: 'teacher',
              name: '拆分验证教师',
              role: 'TEACHER',
              roles: ['TEACHER'],
              accountMode: 'ORGANIZATION',
              permissions,
            },
            csrfToken: 'split-fixture-csrf',
          }
        : path === '/api/platform'
          ? { name: '知学' }
          : { items: [], total: 0 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}
const pages = [
  ['questions', 'Questions', '题库与试卷'],
  ['assignments', 'Assignments', '作业管理'],
  ['practice', 'Practice', '练习中心'],
  ['exams', 'Exams', '考试管理'],
  ['appeals', 'Appeals', '成绩复核'],
] as const;
const allModules = [
  'Questions',
  'Assignments',
  'AssignmentDetail',
  'Practice',
  'PracticeSession',
  'Exams',
  'ExamDetail',
  'ExamAttempt',
  'Grading',
  'Appeals',
];
const loadedModule = (path: string, module: string) =>
  path.endsWith('/assessments/' + module + '.tsx') ||
  (path.startsWith('/assets/' + module + '-') && path.endsWith('.js'));
for (const [path, module, title] of pages) {
  test(`首次打开${title}只加载对应评测页面及共享组件`, async ({ page }) => {
    await fixture(page, [
      'question.manage',
      'assessment.manage',
      'assessment.grade',
      'learning.use',
      'course.read',
    ]);
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/' + path);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(requests.some((p) => loadedModule(p, module))).toBe(true);
    for (const other of allModules.filter((m) => m !== module))
      expect(requests.some((p) => loadedModule(p, other))).toBe(false);
    expect(errors).toEqual([]);
  });
}
test('缺少题库权限时不加载题库业务模块和私有接口', async ({ page }) => {
  await fixture(page, ['course.read']);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.goto('/questions');
  await expect(
    page.getByText('当前工作身份没有此功能权限，请切换已获授权的身份。', { exact: true }),
  ).toBeVisible();
  expect(requests.some((p) => loadedModule(p, 'Questions'))).toBe(false);
  expect(requests.some((p) => p.startsWith('/api/questions'))).toBe(false);
});
