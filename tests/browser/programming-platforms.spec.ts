import { test, expect } from '@playwright/test';
async function fixture(page: import('@playwright/test').Page, state = { csrf: 'fixture-csrf' }) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [], total: 0 };
    if (path === '/api/auth/me')
      body = {
        user: {
          id: 'platform-student',
          username: 'student',
          name: '学生',
          organizationId: 'test-org',
          accountMode: 'ORGANIZATION',
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['learning.use', 'course.read'],
        },
        csrfToken: state.csrf,
      };
    else if (path === '/api/platform') body = { name: '知学' };
    else if (path === '/api/programming/status')
      body = {
        ai: { available: false, reason: '未配置AI' },
        preview: { available: true, origin: 'http://127.0.0.1:4183' },
        limits: {
          maxProjects: 20,
          maxFiles: 24,
          maxFileBytes: 65536,
          maxProjectBytes: 262144,
          maxVersions: 40,
          maxAiDrafts: 20,
          dailyRequests: 20,
        },
        deployment: { available: false, reason: '私有' },
      };
    else if (path === '/api/programming/android/status') body = { available: true };
    else if (path === '/api/programming/android/workbench/index.html')
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>Android App 工作台</h1>' });
    else if (path === '/api/programming/projects/site-1')
      body = {
        id: 'site-1',
        revision: 2,
        title: '网站',
        files: [{ path: 'index.html', content: '<h1>运行页面</h1>' }],
      };
    else if (path === '/api/programming/projects/site-1/preview')
      body = { url: 'http://127.0.0.1:4183/preview/' + 'a'.repeat(64) + '/index.html' };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}
test('编程首页提供网站与Android两个入口', async ({ page }) => {
  await fixture(page);
  await page.goto('/programming');
  await expect(page.getByRole('heading', { name: '编程工作室', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Android App 工作室', exact: true })).toHaveAttribute(
    'href',
    '/programming/android',
  );
  await page.getByRole('link', { name: 'Android App 工作室', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Android App 工作室', exact: true })).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Android Agent 工作台"]')
      .getByRole('heading', { name: 'Android App 工作台' }),
  ).toBeVisible();
});
test('网站子目录读取保存版本并使用隔离框架运行', async ({ page }) => {
  await fixture(page);
  await page.route('http://127.0.0.1:4183/**', (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>运行页面</h1>' }),
  );
  await page.goto('/programming/sites/site-1');
  await expect(page.getByRole('heading', { name: '网站运行', exact: true })).toBeVisible();
  const frame = page.locator('iframe[title="生成的网站"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-downloads');
  await expect(
    page.frameLocator('iframe[title="生成的网站"]').getByRole('heading', { name: '运行页面' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '编辑网站' })).toHaveAttribute('href', '/programming/site-1');
});
test('Android服务未启动时明确显示状态并保留网站入口', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/programming/android/status', (r) =>
    r.fulfill({ json: { available: false, reason: 'Android 构建服务尚未启动' } }),
  );
  await page.goto('/programming/android');
  await expect(page.getByText('Android 构建服务尚未启动', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '返回网站工作室' })).toHaveAttribute('href', '/programming');
});

test('Android已连通但未配置AI时保留工作台和人工构建入口说明', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/programming/android/status', (r) =>
    r.fulfill({
      json: {
        available: true,
        reason: '',
        ai: { available: false, reason: 'AI 生成尚未配置，仍可编辑、构建和下载项目' },
      },
    }),
  );
  await page.goto('/programming/android');
  await expect(page.getByText('AI 生成尚未配置，仍可编辑、构建和下载项目', { exact: true })).toBeVisible();
  await expect(page.locator('iframe[title="Android Agent 工作台"]')).toBeVisible();
});
test('Android连接恢复后手动刷新进入工作台并更新AI配置提示', async ({ page }) => {
  await fixture(page);
  let ready = false;
  await page.route('**/api/programming/android/status', (r) =>
    r.fulfill({
      json: ready
        ? { available: true, reason: '', ai: { available: true, reason: '' } }
        : { available: false, reason: 'Android 工作室暂时无法连接，请稍后重试' },
    }),
  );
  await page.goto('/programming/android');
  await expect(page.getByText('Android 工作室暂时无法连接，请稍后重试', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  ready = true;
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(page.locator('iframe[title="Android Agent 工作台"]')).toBeVisible();
  await expect(page.getByText('AI 生成尚未配置，仍可编辑、构建和下载项目')).toHaveCount(0);
});
test('旧会话状态正文迟到401不能退出新会话或移除新工作台', async ({ page }) => {
  await page.clock.install();
  const state = { csrf: 'fixture-csrf' };
  await fixture(page, state);
  await page.addInitScript(() => {
    const native = window.fetch.bind(window);
    let first = true;
    (window as any).__studioExpired = 0;
    window.addEventListener('auth-expired', () => {
      (window as any).__studioExpired++;
    });
    window.fetch = async (input, init) => {
      const r = await native(
        input,
        String(input).includes('/programming/android/status') ? { ...init, signal: undefined } : init,
      );
      if (first && !init?.signal?.aborted && String(input).includes('/programming/android/status')) {
        first = false;
        const parse = r.json.bind(r);
        r.json = async () => {
          (window as any).__studioHeld = true;
          await new Promise<void>((done) => {
            (window as any).__studioRelease = done;
          });
          const body = await parse();
          (window as any).__studioArrived = true;
          return body;
        };
      }
      return r;
    };
  });
  let oldSession = true;
  await page.route('**/api/programming/android/status', (r) => {
    const old = oldSession;
    return r.fulfill({
      status: old ? 401 : 200,
      json: old
        ? { message: '旧会话' }
        : { available: true, reason: '', ai: { available: true, reason: '' } },
    });
  });
  await page.goto('/programming/android');
  await expect.poll(() => page.evaluate(() => (window as any).__studioHeld)).toBe(true);
  oldSession = false;
  state.csrf = 'new-studio-session';
  await page.clock.fastForward(21001);
  const refreshed = page.waitForResponse((r) => r.url().endsWith('/api/auth/me'));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refreshed;
  await expect(page.locator('iframe[title="Android Agent 工作台"]')).toBeVisible();
  await page.evaluate(() => (window as any).__studioRelease());
  await expect.poll(() => page.evaluate(() => (window as any).__studioArrived)).toBe(true);
  expect(await page.evaluate(() => (window as any).__studioExpired)).toBe(0);
  await expect(page.locator('iframe[title="Android Agent 工作台"]')).toBeVisible();
});
