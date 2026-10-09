// Every API request is mocked; these tests do not touch a database or providers.
import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { emptyLearningActions } from './empty-learning-actions-fixture';

const files = [
  { path: 'index.html', content: '<h1>原项目</h1>' },
  { path: 'docs/notes.md', content: '多文件说明\n' },
];
const bundle = () => ({
  format: 'zhixue-programming',
  version: 1,
  title: '项目备份',
  templateId: 'starter',
  files: structuredClone(files),
});
type Options = {
  count?: number;
  saveFailure?: number;
  importFailure?: number;
  backupFailure?: number;
  hold?: 'save' | 'duplicate' | 'backup' | 'import';
};
async function fixture(page: Page, options: Options = {}) {
  const stamp = '2026-10-09T00:00:00.000Z';
  const original = {
    id: 'original',
    title: '原项目',
    templateId: 'starter',
    revision: 4,
    files: structuredClone(files),
    createdAt: stamp,
    updatedAt: stamp,
  };
  const projects = new Map<string, typeof original>([['original', original]]);
  const requests: { method: string; path: string; body?: any; csrf?: string }[] = [];
  let release!: () => void;
  let observed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = method === 'GET' ? undefined : request.postDataJSON();
    requests.push({ method, path, body, csrf: request.headers()['x-csrf-token'] });
    if (
      (options.hold === 'save' && method === 'PATCH') ||
      (options.hold !== 'save' && options.hold && path.endsWith(`/${options.hold}`))
    ) {
      observed();
      await gate;
    }
    if (options.backupFailure && path.endsWith('/backup'))
      return json(route, { message: '旧会话已失效' }, options.backupFailure);
    if (path === '/api/auth/me')
      return json(route, {
        csrfToken: 'portability-csrf',
        user: {
          id: 'student',
          name: '学生',
          username: 'fixture',
          role: 'STUDENT',
          roles: ['STUDENT'],
          organizationId: 'fixture-org',
          accountMode: 'PERSONAL',
          permissions: ['learning.use'],
        },
      });
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/planner/actions') return json(route, emptyLearningActions(new URL(request.url())));
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/programming/status')
      return json(route, {
        ai: { available: false, reason: 'fixture', model: 'fixture' },
        preview: { available: false, reason: 'fixture', origin: '' },
        limits: {
          maxProjects: 20,
          maxFiles: 24,
          maxFileBytes: 65536,
          maxProjectBytes: 262144,
          maxVersions: 30,
          maxAiDrafts: 20,
          dailyRequests: 20,
        },
        deployment: { available: false, reason: '本地工作区' },
      });
    if (path === '/api/programming/templates') return json(route, { items: [] });
    if (path === '/api/programming/projects')
      return json(route, {
        items: [...projects.values()].map((project) => ({
          ...project,
          files: undefined,
          fileCount: project.files.length,
        })),
        total: options.count ?? projects.size,
        page: 1,
        pageSize: 9,
      });
    if (path === '/api/programming/projects/import') {
      if (options.importFailure)
        return json(
          route,
          {
            message:
              options.importFailure === 409
                ? '最多保存 20 个项目，请先下载并删除旧项目'
                : '创意项目备份必须完整保留对应 NOTICE.txt 中的来源归属与许可',
          },
          options.importFailure,
        );
      const imported = {
        ...original,
        id: 'imported',
        title: body.title,
        templateId: body.templateId,
        revision: 0,
        files: structuredClone(body.files),
      };
      projects.set(imported.id, imported);
      return json(route, imported, 201);
    }
    const match = /^\/api\/programming\/projects\/([^/]+)(.*)$/.exec(path);
    if (match) {
      const project = projects.get(match[1]);
      if (!project) return json(route, { message: '项目不存在' }, 404);
      if (!match[2] && method === 'GET') return json(route, project);
      if (!match[2] && method === 'PATCH') {
        if (options.saveFailure) {
          if (options.saveFailure === 409) project.revision++;
          return json(
            route,
            {
              message:
                options.saveFailure === 409 ? '项目已在其他页面更新，请刷新后重试' : '暂时无法保存项目',
            },
            options.saveFailure,
          );
        }
        expect(body.revision).toBe(project.revision);
        project.files = structuredClone(body.files);
        project.title = body.title;
        project.revision++;
        return json(route, project);
      }
      if (match[2] === '/duplicate') {
        expect(body.revision).toBe(project.revision);
        const copy = { ...structuredClone(project), id: 'copy', title: body.title, revision: 0 };
        projects.set(copy.id, copy);
        return json(route, copy, 201);
      }
      if (match[2] === '/backup')
        return json(route, {
          format: 'zhixue-programming',
          version: 1,
          title: project.title,
          templateId: project.templateId,
          files: project.files,
        });
      if (['/versions', '/ai-drafts'].includes(match[2])) return json(route, { items: [] });
    }
    return json(route, { message: `Unhandled fixture ${method} ${path}` }, 404);
  });
  return { requests, projects, reached, release };
}
async function edit(page: Page, content: string) {
  await expect(page.getByRole('heading', { name: '编程工作区', exact: true })).toBeVisible();
  const toggle = page.getByRole('button', { name: '简易编辑器', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('textbox', { name: '项目代码编辑器', exact: true }).fill(content);
}
async function selectBackup(page: Page, value: unknown) {
  await page.getByLabel('选择 JSON 备份', { exact: true }).setInputFiles({
    name: 'project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  });
}

test('复制先保存当前编辑，用新修订创建独立副本', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/programming/original');
  await edit(page, '<h1>复制前编辑</h1>');
  await page.getByRole('button', { name: '复制项目', exact: true }).click();
  await page.getByLabel('副本名称', { exact: true }).fill('新独立副本');
  await page.getByRole('button', { name: '创建副本', exact: true }).click();
  await expect(page).toHaveURL(/\/programming\/copy$/);
  const writes = state.requests.filter((request) => request.method !== 'GET');
  expect(writes.map((request) => request.path)).toEqual([
    '/api/programming/projects/original',
    '/api/programming/projects/original/duplicate',
  ]);
  expect(writes[0].body.files[0].content).toBe('<h1>复制前编辑</h1>');
  expect(writes[1].body).toEqual({ revision: 5, title: '新独立副本' });
  expect(writes.every((request) => request.csrf === 'portability-csrf')).toBeTruthy();
  expect(state.projects.get('copy')?.files[0].content).toBe('<h1>复制前编辑</h1>');
  await expect(page.getByText('已保存 · 修订 0', { exact: true })).toBeVisible();
});

test('JSON备份先保存当前源码，下载内容可在项目列表检查并重新导入', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/programming/original');
  await edit(page, '<h1>最新备份源码</h1>');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 备份', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('原项目.json');
  const downloaded = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(Object.keys(downloaded).sort()).toEqual(['files', 'format', 'templateId', 'title', 'version']);
  expect(downloaded.files[0].content).toBe('<h1>最新备份源码</h1>');
  const saveAt = state.requests.findIndex((request) => request.method === 'PATCH');
  const backupAt = state.requests.findIndex((request) => request.path.endsWith('/backup'));
  expect(backupAt).toBeGreaterThan(saveAt);
  await page.getByRole('button', { name: '项目列表', exact: true }).click();
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).click();
  await selectBackup(page, downloaded);
  await expect(page.getByText(/2 个文件 · .* KiB 源码/)).toBeVisible();
  await expect(page.getByRole('list', { name: '备份文件列表' })).toContainText('docs/notes.md');
  expect(state.requests.filter((request) => request.path.endsWith('/import'))).toHaveLength(0);
  await page.getByLabel('导入后的项目名称', { exact: true }).fill('重新导入的项目');
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page).toHaveURL(/\/programming\/imported$/);
  const imported = state.requests.find((request) => request.path.endsWith('/import'))!;
  expect(imported.body).toEqual({ ...downloaded, title: '重新导入的项目' });
  expect(imported.csrf).toBe('portability-csrf');
});

for (const action of ['复制项目', 'JSON 备份']) {
  for (const status of [409, 503]) {
    test(`${action}遇到保存${status}立即停止并保留本地编辑`, async ({ page }) => {
      const state = await fixture(page, { saveFailure: status });
      await page.goto('/programming/original');
      await edit(page, '<h1>必须保留的本地源码</h1>');
      await page.getByRole('button', { name: action, exact: true }).click();
      if (action === '复制项目') await page.getByRole('button', { name: '创建副本', exact: true }).click();
      await expect(page.locator('.ant-message-error')).toContainText(
        status === 409 ? '项目已在其他页面更新' : '暂时无法保存项目',
      );
      expect(
        state.requests.filter(
          (request) => request.path.endsWith('/backup') || request.path.endsWith('/duplicate'),
        ),
      ).toHaveLength(0);
      if (action === '复制项目') await page.getByRole('button', { name: /取\s*消/ }).click();
      await expect(page.getByRole('textbox', { name: '项目代码编辑器', exact: true })).toHaveValue(
        '<h1>必须保留的本地源码</h1>',
      );
      await expect(page).toHaveURL(/\/programming\/original$/);
    });
  }
}

test('导入本地拒绝坏JSON、未知字段及超额内容，服务端错误保留摘要', async ({ page }) => {
  const state = await fixture(page, { importFailure: 400 });
  await page.goto('/programming');
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).click();
  await selectBackup(page, '{ incomplete');
  await expect(page.getByText('无法读取 JSON，请检查文件内容是否完整。', { exact: true })).toBeVisible();
  await selectBackup(page, { ...bundle(), userId: 'injected' });
  await expect(page.getByText(/备份包含不支持的字段/)).toBeVisible();
  await selectBackup(page, { ...bundle(), files: [{ path: 'index.html', content: '学'.repeat(21846) }] });
  await expect(page.getByText('文件 index.html 超过 64 KiB。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  expect(state.requests.filter((request) => request.path.endsWith('/import'))).toHaveLength(0);
  await selectBackup(page, bundle());
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByText(/创意项目备份必须完整保留对应 NOTICE/)).toBeVisible();
  await expect(page.getByLabel('导入后的项目名称', { exact: true })).toHaveValue('项目备份');
  await expect(page.getByRole('list', { name: '备份文件列表' })).toBeVisible();
});

test('手机可检查长文件路径且没有横向溢出，20项目禁用复制及导入', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/programming');
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).click();
  await selectBackup(page, {
    ...bundle(),
    files: [...files, { path: `${'long-folder-'.repeat(10)}/notes.md`, content: 'notes' }],
  });
  await expect(page.getByRole('list', { name: '备份文件列表' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await page.getByRole('button', { name: /取\s*消/ }).click();
  await page.unroute('**/api/**');
  await fixture(page, { count: 20 });
  await page.reload();
  await expect(page.getByRole('button', { name: '导入 JSON 备份', exact: true })).toBeDisabled();
  await page.goto('/programming/original');
  await expect(page.getByRole('button', { name: '复制项目', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'JSON 备份', exact: true })).toBeEnabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
});

for (const action of ['duplicate', 'backup', 'save'] as const) {
  test(`离开工作区后迟到的${action}结果不触发导航、下载、提示或旧查询`, async ({ page }) => {
    const state = await fixture(page, { hold: action, ...(action === 'save' ? { saveFailure: 409 } : {}) });
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await page.goto('/programming');
    await page.getByRole('link', { name: /原项目.*打开工作区/ }).click();
    await expect(page.getByRole('heading', { name: '编程工作区', exact: true })).toBeVisible();
    if (action === 'save') await edit(page, '<h1>未保存的编辑</h1>');
    await page
      .getByRole('button', { name: action === 'backup' ? 'JSON 备份' : '复制项目', exact: true })
      .click();
    if (action !== 'backup') await page.getByRole('button', { name: '创建副本', exact: true }).click();
    await state.reached;
    await page.goBack();
    await expect(page.getByRole('heading', { name: '编程工作室', exact: true })).toBeVisible();
    const detailReads = state.requests.filter(
      (request) => request.method === 'GET' && request.path === '/api/programming/projects/original',
    ).length;
    state.release();
    await expect
      .poll(
        () =>
          state.requests.filter(
            (request) => request.method === 'GET' && request.path === '/api/programming/projects/original',
          ).length,
      )
      .toBe(detailReads);
    await page.waitForTimeout(200);
    await expect(page).toHaveURL(/\/programming$/);
    await expect(page.locator('.ant-message-notice')).toHaveCount(0);
    expect(downloads).toEqual([]);
    if (action === 'save')
      expect(state.requests.some((request) => request.path.endsWith('/duplicate'))).toBeFalsy();
  });
}

test('离开导入页面后的迟到结果不会跳转新项目或显示全局成功提示', async ({ page }) => {
  const state = await fixture(page, { hold: 'import' });
  await page.goto('/programming/original');
  await page.getByRole('button', { name: '项目列表', exact: true }).click();
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).click();
  await selectBackup(page, bundle());
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await state.reached;
  await page.goBack();
  await expect(page.getByRole('heading', { name: '编程工作区', exact: true })).toBeVisible();
  state.release();
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(/\/programming\/original$/);
  await expect(page.locator('.ant-message-notice')).toHaveCount(0);
});

test('取消读取并选择新备份后，旧文件的迟到内容不会覆盖新摘要', async ({ page }) => {
  await fixture(page);
  await page.goto('/programming');
  await page.evaluate(() => {
    const nativeText = File.prototype.text;
    File.prototype.text = function () {
      const content = nativeText.call(this);
      if (this.name !== 'slow.json') return content;
      return new Promise<string>((resolve) => {
        (window as any).releaseBackupRead = () => content.then(resolve);
      });
    };
  });
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).click();
  await page.getByLabel('选择 JSON 备份', { exact: true }).setInputFiles({
    name: 'slow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...bundle(), title: '迟到旧备份' })),
  });
  await expect(page.getByRole('status')).toContainText('正在读取备份');
  await page.getByRole('button', { name: /取\s*消/ }).click();
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).click();
  await selectBackup(page, { ...bundle(), title: '新选备份' });
  await expect(page.getByLabel('导入后的项目名称', { exact: true })).toHaveValue('新选备份');
  await page.evaluate(() => (window as any).releaseBackupRead());
  await expect(page.getByLabel('导入后的项目名称', { exact: true })).toHaveValue('新选备份');
});

test('旧备份的迟到401不清除后来登录的新身份', async ({ page }) => {
  const state = await fixture(page, { hold: 'backup', backupFailure: 401 });
  let signedIn = true;
  let identity: 'A' | 'B' = 'A';
  const authBody = () => ({
    csrfToken: `csrf-${identity}`,
    user: {
      id: `student-${identity}`,
      name: `学生 ${identity}`,
      username: `student-${identity}`,
      role: 'STUDENT',
      roles: ['STUDENT'],
      organizationId: `org-${identity}`,
      accountMode: 'PERSONAL',
      permissions: ['learning.use'],
    },
  });
  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me')
      return route.fulfill({
        status: signedIn ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(signedIn ? authBody() : { message: '未登录' }),
      });
    if (path === '/api/auth/logout') {
      signedIn = false;
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
    if (path === '/api/auth/login') {
      identity = 'B';
      signedIn = true;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(authBody()),
      });
    }
    return route.fallback();
  });
  await page.goto('/programming/original');
  await page.evaluate(() => {
    (window as any).portabilityExpiredEvents = 0;
    window.addEventListener('auth-expired', () => {
      ++(window as any).portabilityExpiredEvents;
    });
  });
  await page.getByRole('button', { name: 'JSON 备份', exact: true }).click();
  await state.reached;
  await page.getByRole('button', { name: '学生 A的账号菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录你的账号', exact: true })).toBeVisible();
  await page.getByLabel('账号', { exact: true }).fill('student-B');
  await page.getByLabel('密码', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
  await expect(page.getByRole('button', { name: '学生 B的账号菜单', exact: true })).toBeVisible();
  const lateResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/programming/projects/original/backup') && response.status() === 401,
  );
  state.release();
  await lateResponse;
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: '学生 B的账号菜单', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login$/);
  expect(await page.evaluate(() => (window as any).portabilityExpiredEvents)).toBe(0);
});
