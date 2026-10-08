// UI/API contract tests use explicit in-browser fixtures. They do not verify a live AI or search provider.
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

test.use({ actionTimeout: 15000 });
const stamp = '2026-10-08T08:00:00.000Z';
const analysis = {
  summary: '固定契约测试报告：优先检查概念边界，再把计算过程写完整。',
  patterns: [
    {
      label: '概念边界混淆',
      evidence: '两道题都忽略了前提条件。',
      advice: '先列出适用条件再代入。',
      mistakeIds: ['m1', 'm11'],
    },
  ],
  items: ['m1', 'm11'].map((mistakeId) => ({
    mistakeId,
    diagnosis: '遗漏了题目的限定条件。',
    reasoning: '先识别变量，再检查适用条件。',
    correction: '写出条件并重新代入计算。',
    knowledgePoints: ['概念辨析'],
    confidence: 'high',
  })),
  reviewPlan: ['今天：重做两道题并写清条件。', '三天后：完成一道同类变式题。'],
  searchQueries: ['概念辨析 学习方法', '适用条件 练习'],
};
function report(id = 'report-fixture') {
  return {
    id,
    status: 'ready',
    createdAt: stamp,
    updatedAt: stamp,
    error: null,
    reflection: '先凭直觉选答案。',
    mistakes: ['m1', 'm11'].map((mistakeId, i) => ({
      mistakeId,
      questionId: `q${i}`,
      questionVersionId: `v${i}`,
      courseId: 'course-math',
      courseTitle: '契约测试课程',
      stem: `<p>契约错题 ${i ? 11 : 1}：请选择正确的前提。</p>`,
      type: 'single',
      options: [
        { id: 'A', text: '满足前提' },
        { id: 'B', text: '忽略前提' },
      ],
      studentAnswer: 'B',
      correctAnswer: 'A',
      explanation: '<p>先确认前提。</p>',
      knowledgePoints: ['概念辨析'],
      wrongCount: 2,
      answeredAt: stamp,
      scoreCents: 0,
      maxScoreCents: 100,
    })),
    analysis,
    search: null as any,
    searchError: null as any,
  };
}
async function login(page: Page, username = 'student') {
  const role = username === 'teacher' ? 'TEACHER' : 'STUDENT';
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: `fixture-${username}`,
          name: username === 'teacher' ? '契约教师' : '契约学生',
          username,
          role,
          roles: [role],
          organizationId: 'fixture-org',
          permissions:
            role === 'STUDENT'
              ? ['learning.use']
              : ['learning.use', 'course.manage', 'question.manage', 'assessment.manage'],
        },
        csrfToken: 'ui-contract-fixture',
      }),
    }),
  );
  await page.goto('/ai-study');
  await expect(page.locator('main')).toBeVisible();
}
async function fixtures(page: Page, configured = true) {
  let current = report();
  let generated = 0;
  let searched = 0;
  let failNext = false;
  const bodies: any[] = [];
  const sourceRequests: { method: string; csrf?: string }[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // Catch every other API request so this contract suite never reads or mutates a real account.
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/platform') return json(route, { name: '知学' });
    if (url.pathname === '/api/courses')
      return json(route, {
        items: [{ id: 'course-math', title: '契约测试课程' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    if (url.pathname === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    return json(route, { message: '未定义的 UI 契约请求' }, 404);
  });
  await page.route('**/api/mistakes?**', async (route) => {
    const page = Number(new URL(route.request().url()).searchParams.get('page') || 1);
    const start = page === 1 ? 1 : 11;
    return json(route, {
      items: Array.from({ length: page === 1 ? 10 : 2 }, (_, i) => ({
        id: `m${start + i}`,
        available: start + i !== 2,
        courseId: 'course-math',
        wrongCount: 2,
        mastered: false,
        question:
          start + i === 2
            ? null
            : {
                stem: `<p>契约错题 ${start + i}：请选择正确的前提。</p>`,
                type: 'single',
                knowledgePoints: ['概念辨析'],
              },
      })),
      total: 12,
      page,
      pageSize: 10,
    });
  });
  await page.route('**/api/ai-study/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/status'))
      return json(route, {
        analysis: { available: configured, reason: configured ? '' : '尚未填写 API key' },
        search: { available: configured, reason: configured ? '' : '尚未配置搜索服务' },
        model: 'fixture-model',
        searchProvider: 'openai',
        limits: { maxMistakes: 10, dailyRequests: 20, maxDownloadMb: 10 },
      });
    if (url.pathname.endsWith('/export'))
      return route.fulfill({
        status: 200,
        contentType: url.searchParams.get('format') === 'json' ? 'application/json' : 'text/markdown',
        headers: {
          'content-disposition': `attachment; filename="fixture-report.${url.searchParams.get('format')}"`,
        },
        body:
          url.searchParams.get('format') === 'json'
            ? JSON.stringify(current)
            : '# 固定契约测试报告\n仅用于界面验收。',
      });
    if (url.pathname.endsWith('/download')) {
      sourceRequests.push({ method: request.method(), csrf: request.headers()['x-csrf-token'] });
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        headers: { 'content-disposition': 'attachment; filename="fixture-source.txt"' },
        body: '固定契约测试网页纯文本，无真实联网调用。',
      });
    }
    if (url.pathname.endsWith('/search')) {
      searched++;
      bodies.push(request.postDataJSON());
      const summary = '🔎先核对概念，再完成迁移练习。';
      current.search = {
        query: request.postDataJSON().query,
        summary,
        provider: 'openai',
        searchedAt: stamp,
        sources: [
          {
            id: 's1',
            title: '固定契约测试来源',
            url: 'https://example.org/learning/concepts',
            snippet: '来源摘要仅用于契约测试。',
          },
          {
            id: 'unsafe',
            title: '不安全来源地址',
            url: 'javascript:alert(1)',
            snippet: '<img src=x onerror=alert(1)>',
          },
        ],
        citations: [
          { start: summary.indexOf('核对概念'), end: summary.indexOf('核对概念') + 4, sourceId: 's1' },
        ],
      };
      return json(route, current);
    }
    if (url.pathname.endsWith('/reports') && request.method() === 'POST') {
      generated++;
      bodies.push(request.postDataJSON());
      if (failNext) {
        failNext = false;
        return json(route, { message: '契约测试：AI 服务暂时不可用' }, 503);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      current = report();
      return json(route, current, 201);
    }
    if (url.pathname.endsWith('/reports'))
      return json(route, {
        items: [
          {
            id: current.id,
            status: 'ready',
            createdAt: stamp,
            summary: current.analysis.summary,
            error: null,
            mistakeCount: 2,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      });
    if (request.method() === 'DELETE') return json(route, { deleted: true });
    return json(route, current);
  });
  return {
    bodies,
    sourceRequests,
    generated: () => generated,
    searched: () => searched,
    failOnce: () => {
      failNext = true;
    },
  };
}

test('Mocked API contract: missing configuration is explicit and non-students cannot access AI study', async ({
  page,
}) => {
  await fixtures(page, false);
  await login(page);
  await page.goto('/ai-study');
  await expect(page.getByRole('heading', { name: 'AI 错题复盘', exact: true })).toBeVisible();
  await expect(page.getByText('AI 分析服务暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '复盘课程筛选', exact: true })).toBeVisible();
  await expect(
    page.getByRole('alert').getByText(/请联系管理员在服务器 config.yaml 中填写服务配置与密钥。/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '生成错题复盘', exact: true })).toBeDisabled();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '选择错题 m2', exact: true })).toBeDisabled();
  await page.context().clearCookies();
  await login(page, 'teacher');
  await page.goto('/ai-study');
  await expect(
    page.getByText('当前工作身份没有此功能权限，请切换已获授权的身份。', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'AI 错题复盘', exact: true }),
  ).toHaveCount(0);
});

test('Mocked API contract: selected mistakes survive pagination and errors; reports, citations and downloads work', async ({
  page,
}) => {
  const fixture = await fixtures(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.goto('/ai-study?mistake=m1');
  await expect(page.getByText('已选 1 / 10 道', { exact: true })).toBeVisible();
  await page.getByRole('listitem', { name: '下一页', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择错题 契约错题 11：请选择正确的前提。', exact: true }).check();
  await expect(page.getByText('已选 2 / 10 道', { exact: true })).toBeVisible();
  await page.getByLabel('我的解题思路', { exact: true }).fill('先凭直觉选答案。');
  await mkdir('.data', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.data/ai-study-compose-desktop.png', animations: 'disabled' });
  fixture.failOnce();
  await page.getByRole('button', { name: '生成错题复盘', exact: true }).click();
  await expect(
    page.locator('.ai-alert').getByText('契约测试：AI 服务暂时不可用', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('我的解题思路', { exact: true })).toHaveValue('先凭直觉选答案。');
  await expect(page.getByText('已选 2 / 10 道', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '生成错题复盘', exact: true }).click();
  await expect(page).toHaveURL(/report=report-fixture/);
  await expect(page.getByRole('heading', { name: '逐题诊断与订正', exact: true })).toBeVisible();
  expect(fixture.generated()).toBe(2);
  expect(fixture.bodies[0]).toEqual({ mistakeIds: ['m1', 'm11'], reflection: '先凭直觉选答案。' });
  expect(fixture.searched()).toBe(0);
  await page.getByLabel('搜索关键词', { exact: true }).fill('概念辨析 官方课程资料');
  await page.getByRole('button', { name: '联网搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '参考来源 · 2 条', exact: true })).toBeVisible();
  const citation = page.locator('.ai-inline-citation');
  await expect(citation).toHaveText('核对概念[1]');
  await expect(citation).toHaveAttribute('href', 'https://example.org/learning/concepts');
  await expect(citation).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('.ai-sources img')).toHaveCount(0);
  expect(fixture.bodies.at(-1)).toEqual({ query: '概念辨析 官方课程资料' });
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Markdown', exact: true }).click();
  const md = await download;
  expect(md.suggestedFilename()).toBe('fixture-report.md');
  expect(await readFile((await md.path())!, 'utf8')).toContain('固定契约测试报告');
  download = page.waitForEvent('download');
  await page.locator('.ai-source').first().getByRole('button', { name: '下载资料', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('fixture-source.txt');
  expect(fixture.sourceRequests).toEqual([{ method: 'POST', csrf: 'ui-contract-fixture' }]);
  await page.locator('.ai-search-results').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.data/ai-study-sources-desktop.png', animations: 'disabled' });
  await page.getByRole('tab', { name: '历史报告', exact: true }).click();
  await page.getByRole('button', { name: /2 道错题复盘/ }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '共同错因与改进方向', exact: true })).toBeVisible();
  await expect(page.locator('.ai-inline-citation')).toHaveText('核对概念[1]');
  await mkdir('.data', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.data/ai-study-report-desktop.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('Mocked API contract: AI study is usable at 390px and download failures remain recoverable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page);
  await login(page);
  await page.goto('/ai-study');
  await expect(page.getByRole('heading', { name: 'AI 错题复盘', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
  ).toBeTruthy();
  await mkdir('.data', { recursive: true });
  await page.screenshot({ path: '.data/ai-study-compose-mobile.png', animations: 'disabled' });
  await page.goto('/ai-study?report=report-fixture');
  await expect(page.getByRole('heading', { name: '逐题诊断与订正', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
  ).toBeTruthy();
  await page.route('**/api/ai-study/reports/*/export?**', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ message: '契约测试：下载暂时失败，请重试' }),
    }),
  );
  await page.getByRole('button', { name: '下载 JSON', exact: true }).click();
  await expect(
    page.locator('.ai-alert').getByText('契约测试：下载暂时失败，请重试', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /下载 JSON$/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /下载 JSON$/ })).not.toHaveClass(/ant-btn-loading/);
  await page.getByRole('button', { name: '联网搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '参考来源 · 2 条', exact: true })).toBeVisible();
  await page.route('**/api/ai-study/reports/*/sources/*/download', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ message: '契约测试：来源下载失败，可重试' }),
    }),
  );
  const sourceDownload = page
    .locator('.ai-source')
    .first()
    .getByRole('button', { name: /下载资料$/ });
  await sourceDownload.click();
  await expect(
    page.locator('.ai-alert').getByText('契约测试：来源下载失败，可重试', { exact: true }),
  ).toBeVisible();
  await expect(sourceDownload).toBeEnabled();
  await expect(sourceDownload).not.toHaveClass(/ant-btn-loading/);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.data/ai-study-report-mobile.png', animations: 'disabled' });
});

test('Mocked API contract: pending reports refresh and failed reports offer a recoverable retry', async ({
  page,
}) => {
  await fixtures(page);
  let checks = 0;
  await page.route('**/api/ai-study/reports/report-pending', (route) => {
    const result = report('report-pending');
    checks++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(checks === 1 ? { ...result, status: 'pending', analysis: null } : result),
    });
  });
  await page.route('**/api/ai-study/reports/report-failed', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...report('report-failed'),
        status: 'failed',
        analysis: null,
        error: '契约测试：模型未返回完整报告',
      }),
    }),
  );
  await login(page);
  await page.goto('/ai-study?report=report-pending');
  await expect(page.getByRole('heading', { name: '正在生成分析', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '逐题诊断与订正', exact: true })).toBeVisible({
    timeout: 12000,
  });
  await expect(page.getByLabel('搜索关键词', { exact: true })).toHaveValue('概念辨析 学习方法');
  await page.goto('/ai-study?report=report-failed');
  await expect(page.getByText('契约测试：模型未返回完整报告', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回选题重试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1. 选择需要复盘的错题', exact: true })).toBeVisible();
});
