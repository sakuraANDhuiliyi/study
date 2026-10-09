// Mocked API contract tests. Every /api request and preview URL is fulfilled locally;
// these checks do not call DeepSeek, use real accounts, or exercise a database.
import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.use({ actionTimeout: 15000 });

const stamp = '2026-10-09T09:00:00.000Z';
const previewOrigin = process.env.PROGRAMMING_PREVIEW_ORIGIN || 'http://127.0.0.1:4173';
const initialFiles = [
  {
    path: 'index.html',
    content:
      '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>我的计数器</h1><script src="app.js"></script></body></html>',
  },
  { path: 'style.css', content: 'body { color: #206bc4; }' },
  { path: 'app.js', content: 'console.log("counter ready");' },
];
type FixtureOptions = {
  role?: string;
  permissions?: string[];
  available?: boolean;
  failed?: boolean;
  unsafePreview?: boolean;
  conflictSave?: boolean;
  conflictApply?: boolean;
  initialDraft?: 'ready' | 'pending';
};
async function fixture(page: Page, options: FixtureOptions = {}) {
  const writes: { path: string; body: any; csrf?: string }[] = [];
  const reads: string[] = [];
  let project = {
    id: 'project-one',
    title: '契约计数器',
    templateId: 'counter',
    revision: 0,
    files: structuredClone(initialFiles),
    createdAt: stamp,
    updatedAt: stamp,
  };
  let currentDraft: any = options.initialDraft
    ? {
        id: 'draft-one',
        projectId: project.id,
        baseRevision: 0,
        status: options.initialDraft,
        prompt: '已有候选任务',
        summary: '大源码候选',
        plan: ['加载后审阅'],
        teaching: ['按需读取'],
        files:
          options.initialDraft === 'pending'
            ? []
            : [
                { path: 'index.html', content: `<h1>大候选</h1>${' '.repeat(60000)}` },
                ...Array.from({ length: 3 }, (_, i) => ({
                  path: `large-${i}.js`,
                  content: ' '.repeat(60000),
                })),
              ],
        model: 'fixture',
        error: null,
        createdAt: stamp,
        updatedAt: stamp,
      }
    : null;
  let detailGate: Promise<void> | undefined;
  let releaseDetail: (() => void) | undefined;
  const versions: any[] = [
    {
      id: 'version-1',
      number: 1,
      note: '创建项目',
      createdAt: stamp,
      files: structuredClone(initialFiles),
      title: project.title,
    },
  ];
  let conflictSave = !!options.conflictSave;
  let conflictApply = !!options.conflictApply;
  const json = (route: Route, data: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  await page.route(`${previewOrigin}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>隔离预览</h1><script>parent.postMessage({type:"programming-preview-log",nonce:"contract-preview-nonce",level:"log",text:"preview ready"},"*");</script></body></html>',
    }),
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === 'GET') reads.push(path);
    if (!['GET', 'HEAD'].includes(method))
      writes.push({ path, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
    if (path === '/api/auth/me')
      return json(route, {
        csrfToken: 'programming-contract-csrf',
        user: {
          id: 'contract-student',
          name: '契约学生',
          username: 'fixture',
          role: options.role || 'STUDENT',
          roles: [options.role || 'STUDENT'],
          accountMode: 'PERSONAL',
          permissions: options.permissions ?? ['learning.use'],
          organizationId: 'fixture-org',
        },
      });
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/programming/status')
      return json(route, {
        ai: {
          available: options.available !== false,
          reason: '未配置模型密钥',
          model: 'contract-fixture-model',
        },
        preview: { available: true, reason: '', origin: previewOrigin },
        limits: {
          maxProjects: 20,
          maxFiles: 24,
          maxFileBytes: 65536,
          maxProjectBytes: 262144,
          maxVersions: 30,
          maxAiDrafts: 20,
          dailyRequests: 20,
        },
        deployment: { available: false, reason: '当前仅本地预览，未配置公开域名。' },
      });
    if (path === '/api/programming/templates')
      return json(route, {
        items: ['starter', 'counter', 'todo'].map((id, index) => ({
          id,
          title: ['基础网页', '交互计数器', '待办清单'][index],
          description: ['熟悉网页结构与样式', '学习事件与状态', '学习列表操作'][index],
          files: structuredClone(initialFiles),
        })),
      });
    if (path === '/api/programming/projects' && method === 'GET')
      return json(route, {
        items: [{ ...project, files: undefined, fileCount: project.files.length }],
        total: 1,
        page: 1,
        pageSize: 9,
      });
    if (path === '/api/programming/projects' && method === 'POST') {
      const body = request.postDataJSON();
      project = { ...project, title: body.title, templateId: body.templateId };
      versions[0].title = project.title;
      return json(route, project, 201);
    }
    if (path === '/api/programming/projects/project-one') {
      if (method === 'GET') return json(route, project);
      if (method === 'DELETE') return json(route, { ok: true });
      if (method === 'PATCH') {
        if (conflictSave) {
          conflictSave = false;
          project.revision++;
          return json(route, { message: '项目已在其他页面更新，请刷新后重试' }, 409);
        }
        const body = request.postDataJSON();
        project = { ...project, title: body.title, files: body.files, revision: project.revision + 1 };
        return json(route, project);
      }
    }
    const base = '/api/programming/projects/project-one';
    if (path === `${base}/preview`)
      return json(route, {
        url: options.unsafePreview
          ? 'https://malicious.invalid/preview'
          : `${previewOrigin}/p/fixture/index.html`,
        nonce: 'contract-preview-nonce',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
    if (path === `${base}/export`)
      return route.fulfill({
        status: 200,
        contentType: 'application/zip',
        body: Buffer.from('fixture-zip-source'),
      });
    if (path === `${base}/versions` && method === 'GET')
      return json(route, { items: [...versions].reverse().map((v) => ({ ...v, files: undefined })) });
    if (path === `${base}/versions` && method === 'POST') {
      const version = {
        id: `version-${versions.length + 1}`,
        number: versions.length + 1,
        note: request.postDataJSON().note,
        createdAt: stamp,
        files: structuredClone(project.files),
        title: project.title,
      };
      versions.push(version);
      project.revision++;
      return json(route, { project, version }, 201);
    }
    if (path.startsWith(`${base}/versions/`))
      return json(
        route,
        versions.find((v) => v.id === path.split('/').at(-1)),
      );
    if (path === `${base}/restore`) {
      const version = versions.find((v) => v.id === request.postDataJSON().versionId);
      project = {
        ...project,
        files: structuredClone(version.files),
        title: version.title,
        revision: project.revision + 1,
      };
      return json(route, project);
    }
    if (path === `${base}/ai-drafts` && method === 'GET') {
      const summary =
        currentDraft &&
        Object.fromEntries(
          Object.entries(currentDraft).filter(([key]) => !['files', 'plan', 'teaching'].includes(key)),
        );
      return json(route, { items: summary ? [summary] : [] });
    }
    if (path === `${base}/ai-drafts` && method === 'POST') {
      const body = request.postDataJSON();
      currentDraft = {
        id: 'draft-one',
        projectId: project.id,
        baseRevision: body.revision,
        status: options.failed ? 'failed' : 'ready',
        prompt: body.prompt,
        summary: '<img src=x onerror=alert(1)> 候选仅作文字展示',
        plan: ['将按钮事件和状态分离', '调整布局'],
        teaching: ['学习 addEventListener'],
        files: options.failed
          ? []
          : [
              {
                path: 'index.html',
                content: '<!doctype html><html><body><h1>AI 改进网页</h1></body></html>',
              },
              { path: 'app.js', content: 'console.log("AI ready");' },
              { path: 'theme.css', content: 'body { background: #f8fafc; }' },
            ],
        model: 'contract-fixture-model',
        error: options.failed ? '模型暂不可用，项目源码已保留。' : null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      return json(route, currentDraft, 201);
    }
    if (path === `${base}/ai-drafts/draft-one` && method === 'GET') {
      await detailGate;
      return json(route, currentDraft);
    }
    if (path === `${base}/ai-drafts/draft-one/apply`) {
      if (conflictApply) {
        conflictApply = false;
        project.revision++;
        return json(route, { message: '项目已在 AI 生成后编辑，请查看差异并重新生成' }, 409);
      }
      versions.push({
        id: 'version-ai-original',
        number: versions.length + 1,
        note: 'AI 应用前源码',
        files: structuredClone(project.files),
        title: project.title,
        createdAt: stamp,
      });
      project = { ...project, files: structuredClone(currentDraft.files), revision: project.revision + 1 };
      currentDraft = { ...currentDraft, status: 'applied', appliedVersionId: 'version-ai-original' };
      return json(route, { project, draft: currentDraft });
    }
    return json(route, { message: `Unmocked ${method} ${path}` }, 404);
  });
  return {
    writes,
    reads,
    getProject: () => project,
    finishDraft() {
      currentDraft = {
        ...currentDraft,
        status: 'ready',
        updatedAt: '2026-10-09T09:01:00.000Z',
        files: [{ path: 'index.html', content: '<h1>生成完成</h1>' }],
      };
    },
    holdDetail() {
      detailGate = new Promise<void>((resolve) => {
        releaseDetail = resolve;
      });
    },
    releaseDetail() {
      releaseDetail?.();
      detailGate = undefined;
    },
  };
}

async function simpleEditor(page: Page) {
  const toggle = page.getByRole('button', { name: '简易编辑器', exact: true });
  await toggle.click();
  return page.getByRole('textbox', { name: '项目代码编辑器', exact: true });
}
async function screenshot(page: Page, name: string) {
  await mkdir('.data', { recursive: true });
  await expect(page.locator('.ant-message-notice')).toHaveCount(0, { timeout: 5000 });
  await page.locator('#main-content').focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `.data/programming-${name}.png`, fullPage: true });
}

test('ready 大源码候选列表停止轮询，选中时才加载详情并可应用', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page, { initialDraft: 'ready' });
  const listPath = '/api/programming/projects/project-one/ai-drafts';
  const detailPath = `${listPath}/draft-one`;
  await page.goto('/programming/project-one');
  await expect(page.getByRole('button', { name: /已有候选任务/ })).toBeVisible();
  expect(state.reads.filter((path) => path === listPath)).toHaveLength(1);
  expect(state.reads.filter((path) => path === detailPath)).toHaveLength(0);
  await page.clock.fastForward(16000);
  expect(state.reads.filter((path) => path === listPath)).toHaveLength(1);
  state.holdDetail();
  await page.getByRole('button', { name: /已有候选任务/ }).click();
  await expect(page.getByRole('status')).toContainText('正在载入候选详情与源码');
  await expect(page.getByRole('button', { name: '审核完成，应用候选代码', exact: true })).toHaveCount(0);
  state.releaseDetail();
  await expect(page.getByRole('heading', { name: '候选代码审阅', exact: true })).toBeVisible();
  expect(state.reads.filter((path) => path === detailPath)).toHaveLength(1);
  await page.getByRole('button', { name: '审核完成，应用候选代码', exact: true }).click();
  await page.getByRole('button', { name: '确认应用', exact: true }).click();
  await expect(
    page.getByText('候选代码已应用到项目。原源码已保留在版本记录中。', { exact: true }),
  ).toBeVisible();
});

test('只在 pending 时轮询摘要，选中的任务完成后只加载一次详情并停止轮询', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page, { initialDraft: 'pending' });
  const listPath = '/api/programming/projects/project-one/ai-drafts';
  const detailPath = `${listPath}/draft-one`;
  await page.goto('/programming/project-one');
  await page.getByRole('button', { name: /已有候选任务/ }).click();
  await expect(page.getByText('任务正在生成，完成后可查看候选代码。', { exact: true })).toBeVisible();
  state.finishDraft();
  await page.clock.fastForward(5500);
  await expect(page.getByRole('button', { name: '审核完成，应用候选代码', exact: true })).toBeEnabled();
  expect(state.reads.filter((path) => path === detailPath)).toHaveLength(2);
  const listCount = state.reads.filter((path) => path === listPath).length;
  expect(listCount).toBeGreaterThan(1);
  await page.clock.fastForward(16000);
  expect(state.reads.filter((path) => path === listPath)).toHaveLength(listCount);
  expect(state.reads.filter((path) => path === detailPath)).toHaveLength(2);
});

test('个人学生可创建模板项目、编辑多文件、保存版本、隔离预览并下载源码', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/programming');
  await expect(page.getByRole('heading', { name: '编程工作室', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '编程工作室', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('我的练习网页');
  await page.getByRole('button', { name: '交互计数器 学习事件与状态' }).click();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编程工作区', exact: true })).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15000 });
  const editor = await simpleEditor(page);
  await editor.fill('<!doctype html><html><body><h1>已编辑的学习网页</h1></body></html>');
  await expect(page.getByText('未保存修改', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载源码', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await page.getByLabel('文件路径').fill('../secrets.js');
  await expect(page.getByRole('button', { name: '创建文件', exact: true })).toBeDisabled();
  await page.getByLabel('文件路径').fill('scripts/helpers.js');
  await page.getByRole('button', { name: '创建文件', exact: true }).click();
  await editor.fill('console.log("helper");');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('已保存 · 修订 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  const frame = page.locator('iframe[title="项目运行预览"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame).not.toHaveAttribute('srcdoc');
  await expect(page.getByRole('log')).toContainText('preview ready');
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'programming-preview-log',
        nonce: 'contract-preview-nonce',
        level: 'error',
        text: 'FORGED HOST MESSAGE',
      },
      '*',
    ),
  );
  await expect(page.getByRole('log')).not.toContainText('FORGED HOST MESSAGE');
  const previewFrame = page.frames().find((item) => item.url().startsWith(`${previewOrigin}/`))!;
  await previewFrame.evaluate(() => {
    parent.postMessage(
      { type: 'programming-preview-log', nonce: 'wrong-nonce', level: 'error', text: 'FORGED NONCE MESSAGE' },
      '*',
    );
    parent.postMessage(
      {
        type: 'programming-preview-log',
        nonce: 'contract-preview-nonce',
        level: 'unknown',
        text: 'FORGED LEVEL MESSAGE',
      },
      '*',
    );
    parent.postMessage(
      {
        type: 'programming-preview-log',
        nonce: 'contract-preview-nonce',
        level: 'log',
        text: 'x'.repeat(2001),
      },
      '*',
    );
    for (let index = 0; index < 205; index++)
      parent.postMessage(
        {
          type: 'programming-preview-log',
          nonce: 'contract-preview-nonce',
          level: 'log',
          text: `line-${index}`,
        },
        '*',
      );
  });
  await expect(page.getByRole('log').locator(':scope > div')).toHaveCount(200);
  await expect(page.getByRole('log')).not.toContainText('FORGED NONCE MESSAGE');
  await expect(page.getByRole('log')).not.toContainText('FORGED LEVEL MESSAGE');
  await expect(page.getByRole('log')).not.toContainText('line-0\n');
  await screenshot(page, 'workspace-desktop');
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(frame).toHaveCount(0);
  await page.getByRole('button', { name: '版本记录', exact: true }).click();
  await page.getByLabel('版本说明').fill('完成基础布局');
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  await expect(page.getByText('版本 2 · 完成基础布局', { exact: true })).toBeVisible();
  await page
    .locator('.programming-versions-modal .ant-list-item')
    .filter({ hasText: '版本 2 · 完成基础布局' })
    .getByRole('button', { name: '查看源码', exact: true })
    .click();
  await expect(page.locator('.programming-source-view')).toContainText('已编辑的学习网页');
  await page
    .locator('.programming-source-modal')
    .getByRole('button', { name: /关\s*闭/ })
    .last()
    .click();
  await page
    .locator('.programming-versions-modal .ant-list-item')
    .filter({ hasText: '版本 1 · 创建项目' })
    .getByRole('button', { name: '恢复版本', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '恢复版本 1？', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByText('已保存 · 修订 3', { exact: true })).toBeVisible();
  await page
    .locator('.programming-versions-modal')
    .getByRole('button', { name: /关\s*闭/ })
    .last()
    .click();
  await expect(editor).toHaveValue(initialFiles[0].content);
  await expect(page.getByRole('button', { name: 'scripts/helpers.js', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '删除文件 app.js', exact: true }).click();
  await page.getByRole('button', { name: /^删\s*除$/ }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('已保存 · 修订 4', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载源码', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('我的练习网页.zip');
  expect(state.writes.every((write) => write.csrf === 'programming-contract-csrf')).toBe(true);
  expect(state.writes.find((write) => write.path === '/api/programming/projects')?.body).toEqual({
    title: '我的练习网页',
    templateId: 'counter',
  });
  expect(state.writes.find((write) => write.path.endsWith('/preview'))?.body.files).toHaveLength(4);
  expect(state.writes.find((write) => write.path.endsWith('/restore'))?.body).toEqual({
    revision: 2,
    versionId: 'version-1',
  });
});

test('AI 候选不自动覆盖，删除文件差异可审阅，未保存代码阻止应用', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/programming/project-one');
  const editor = await simpleEditor(page);
  await editor.fill('<h1>我的手动修改</h1>');
  await page.getByLabel('你想做什么？').fill('改进页面布局并解释事件处理。');
  await expect(page.getByRole('button', { name: '生成候选代码', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('已保存 · 修订 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '生成候选代码', exact: true }).click();
  await expect(page.getByRole('heading', { name: '候选代码审阅', exact: true })).toBeVisible();
  await expect(editor).toHaveValue('<h1>我的手动修改</h1>');
  await expect(page.locator('.programming-candidate')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.programming-candidate img')).toHaveCount(0);
  await page.locator('.programming-change-list').getByRole('button', { name: '删除 style.css 查看' }).click();
  await expect(page.locator('.programming-diff-sources')).toContainText('body { color: #206bc4; }');
  await expect(page.locator('.programming-diff-sources')).toContainText('候选方案将删除此文件');
  await page.getByRole('button', { name: '继续审阅', exact: true }).click();
  await editor.fill('<h1>尚未保存的手动源码</h1>');
  await expect(page.getByRole('button', { name: '审核完成，应用候选代码', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重新载入项目', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '重新载入', exact: true }).click();
  await expect(editor).toHaveValue('<h1>我的手动修改</h1>');
  await screenshot(page, 'candidate-desktop');
  await page.getByRole('button', { name: '审核完成，应用候选代码', exact: true }).click();
  await page.getByRole('button', { name: '确认应用', exact: true }).click();
  await expect(editor).toHaveValue('<!doctype html><html><body><h1>AI 改进网页</h1></body></html>');
  await expect(page.getByText('已保存 · 修订 2', { exact: true })).toBeVisible();
  await expect(
    page.getByText('候选代码已应用到项目。原源码已保留在版本记录中。', { exact: true }),
  ).toBeVisible();
  expect(state.writes.find((write) => write.path.endsWith('/ai-drafts'))?.body).toEqual({
    revision: 1,
    prompt: '改进页面布局并解释事件处理。',
  });
  expect(state.writes.find((write) => write.path.endsWith('/apply'))?.body).toEqual({ revision: 1 });
  expect(state.getProject().files.some((file) => file.path === 'style.css')).toBe(false);
});

test('409 保存冲突保留本地代码；AI 项目修订冲突需重新生成', async ({ page }) => {
  await fixture(page, { conflictSave: true, conflictApply: true });
  await page.goto('/programming/project-one');
  const editor = await simpleEditor(page);
  await editor.fill('本地尚未保存的源代码');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(
    page.getByText('服务器上的项目已变化，本地内容已保留。请复制需要保留的源码后重新载入。', { exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue('本地尚未保存的源代码');
  await page.getByRole('button', { name: '重新载入项目', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '重新载入', exact: true }).click();
  await page.getByLabel('你想做什么？').fill('添加一个重置按钮');
  await page.getByRole('button', { name: '生成候选代码', exact: true }).click();
  await page.getByRole('button', { name: '审核完成，应用候选代码', exact: true }).click();
  await page.getByRole('button', { name: '确认应用', exact: true }).click();
  await expect(page.getByText('项目已在 AI 生成后编辑，请查看差异并重新生成', { exact: true })).toBeVisible();
  await expect(editor).toHaveValue(initialFiles[0].content);
  await page.getByRole('button', { name: '重新载入项目', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '重新载入', exact: true }).click();
  await expect(
    page.getByText('项目修订已变化，不能直接应用这份候选代码。请以当前源码重新生成。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '审核完成，应用候选代码', exact: true })).toBeDisabled();
});

test('手机工作区可编辑，AI 失败不覆盖代码，页面无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { failed: true });
  await page.goto('/programming/project-one');
  const editor = page.getByRole('textbox', { name: '项目代码编辑器', exact: true });
  await expect(editor).toHaveValue(initialFiles[0].content);
  await page.getByLabel('你想做什么？').fill('生成简单的学习卡片页面');
  await page.getByRole('button', { name: '生成候选代码', exact: true }).click();
  await expect(page.locator('.programming-candidate')).toContainText('生成失败');
  await expect(editor).toHaveValue(initialFiles[0].content);
  await expect(page.getByRole('button', { name: '审核完成，应用候选代码', exact: true })).toHaveCount(0);
  const widths = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await screenshot(page, 'workspace-mobile');
});

test('不可用 AI 提示配置；异常预览 URL 不创建 iframe', async ({ page }) => {
  await fixture(page, { available: false, unsafePreview: true });
  await page.goto('/programming/project-one');
  await expect(page.getByText('AI 暂不可用', { exact: true })).toBeVisible();
  await page.getByLabel('你想做什么？').fill('创建新网页');
  await expect(page.getByRole('button', { name: '生成候选代码', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  await expect(page.getByText('预览地址无效，请检查预览服务配置。', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

for (const [name, options] of [
  ['教师身份', { role: 'TEACHER' }],
  ['缺少学习权限', { permissions: [] }],
] as const) {
  test(`${name}不能进入编程工作室`, async ({ page }) => {
    const state = await fixture(page, options);
    await page.goto('/programming');
    await expect(
      page.getByText('当前工作身份没有此功能权限，请切换已获授权的身份。', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '编程工作室', exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  });
}
