// Controlled API contracts: server serialization and ownership are verified by
// separate integration/live tests. These tests verify downloaded bytes survive
// the browser flow, filter semantics, cancellation, and session isolation.
import { test, expect, type Download, type Page, type Route } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import type { LearningRecord } from '../../apps/web/src/components/academics/types';
import { emptyLearningActions } from './empty-learning-actions-fixture';

test.use({ actionTimeout: 15000 });
const modules = [
  { id: 'circuit-lab', title: '电阻网络与RC响应', kind: 'calculator' },
  { id: 'study-notebook', title: '自由学习笔记', kind: 'workspace' },
].map((item) => ({ ...item, description: '', subjectIds: [], tags: [], estimatedMinutes: 20 }));
function records(): LearningRecord[] {
  return Array.from({ length: 28 }, (_, index) => ({
    id: `record-${index + 1}`,
    moduleId: index < 26 ? 'circuit-lab' : 'study-notebook',
    title: `电路实验${String(index + 1).padStart(2, '0')}`,
    notes: `服务器笔记${index + 1}：电压为"12V"\n第二行思考 🔬`,
    values: { voltage: 12, resistance: [100, 200], body: '自由笔记原文 <vector>' },
    result: {
      summary: '总电阻 300 Ω，电压为"12V"\n第二行观察 🔬',
      metrics: [{ label: '总电阻', value: 300, unit: 'Ω' }],
      sections: [],
      tables: [],
    },
    status: index < 26 ? 'COMPLETED' : 'DRAFT',
    revision: 0,
    createdAt: '2026-10-09T08:00:00Z',
    updatedAt: '2026-10-09T08:00:00Z',
  }));
}
function controlledCsv(items: LearningRecord[]) {
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  return (
    '\ufeff"记录ID","模块ID","模块名称","标题","状态","创建时间","更新时间","修订版本","结果摘要","有笔记"\r\n' +
    items
      .map((item) =>
        [
          item.id,
          item.moduleId,
          modules.find((module) => module.id === item.moduleId)!.title,
          item.title,
          item.status,
          item.createdAt,
          item.updatedAt,
          String(item.revision),
          item.result.summary,
          item.notes ? '是' : '否',
        ]
          .map(quote)
          .join(','),
      )
      .join('\r\n')
  );
}
function controlledMarkdown(items: LearningRecord[]) {
  return (
    '# 专业练习记录\n\n' +
    items
      .map(
        (item) =>
          `## ${item.title}\n\n### 输入\n\n\`\`\`json\n${JSON.stringify(item.values)}\n\`\`\`\n\n### 结果\n\n${item.result.summary}\n\n### 已保存笔记\n\n${item.notes}\n`,
      )
      .join('\n')
  );
}
async function bytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).toBeTruthy();
  return readFile(path!);
}
async function setup(page: Page, initial = records()) {
  let items = structuredClone(initial);
  let current = 'A';
  let authenticated = true;
  let failure: { status: number; message: string } | null = null;
  let conflict = false;
  let disposition: string | undefined;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let handled: Promise<void> | undefined;
  let finish: (() => void) | undefined;
  const requests: { path: string; method: string; body: any; csrf?: string }[] = [];
  const files: string[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = () => ({
    id: `export-user-${current}`,
    name: `学习同学${current}`,
    username: current,
    role: 'STUDENT',
    roles: ['STUDENT'],
    permissions: ['learning.use'],
    organizationId: `personal-${current}`,
    accountMode: 'PERSONAL',
    majorId: null,
    major: null,
  });
  const filtered = (moduleId?: string | null, status?: string | null) =>
    current === 'A'
      ? items.filter(
          (item) =>
            (!moduleId || item.moduleId === moduleId) &&
            (!status || status === 'all' || item.status === status),
        )
      : [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.method() === 'GET' ? undefined : request.postDataJSON();
    requests.push({
      path: path + url.search,
      method: request.method(),
      body,
      csrf: request.headers()['x-csrf-token'],
    });
    if (path === '/api/auth/me')
      return authenticated
        ? json(route, { user: user(), csrfToken: 'export-fixture-token' })
        : json(route, { message: '请登录' }, 401);
    if (path === '/api/auth/login') {
      current = body.username;
      authenticated = true;
      return json(route, { user: user(), csrfToken: 'export-fixture-token' });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/planner/actions')
      return json(route, emptyLearningActions(new URL(route.request().url())));
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/academics/catalog') return json(route, { modules, subjects: [], majors: [] });
    if (path === '/api/academics/me')
      return json(route, {
        accountMode: 'PERSONAL',
        revision: 0,
        majorId: null,
        major: null,
        selectedModuleIds: [],
        stats: { records: 0, completed: 0, modulesPracticed: 0 },
        recentRecords: [],
        recommendations: [],
      });
    if (path === '/api/academics/records/export') {
      if (failure?.status === 0) return route.abort('failed');
      if (failure) return json(route, { message: failure.message }, failure.status);
      const matched = filtered(body.moduleId, body.status);
      const selected = matched.slice(0, body.limit);
      const content = body.format === 'csv' ? controlledCsv(selected) : controlledMarkdown(selected);
      files.push(content);
      if (gate) await gate;
      try {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type':
              body.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
            'content-disposition': disposition || `attachment; filename="academic-records.${body.format}"`,
            'x-export-matched-count': String(matched.length),
            'x-export-record-count': String(selected.length),
            'x-export-truncated': String(selected.length < matched.length),
          },
          body: Buffer.from(content),
        });
      } finally {
        finish?.();
      }
      return;
    }
    if (path === '/api/academics/records') {
      const all = filtered(url.searchParams.get('moduleId'), url.searchParams.get('status'));
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('pageSize') || 12);
      return json(route, {
        items: all.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        total: all.length,
        page: pageNumber,
        pageSize,
      });
    }
    if (path.startsWith('/api/academics/records/')) {
      const item = items.find((item) => path.endsWith('/' + item.id));
      if (!item) return json(route, { message: '学习记录不存在' }, 404);
      if (request.method() === 'GET') return json(route, item);
      if (conflict) {
        conflict = false;
        Object.assign(item, { status: 'DRAFT', revision: 1, notes: '其他窗口保存的新笔记' });
      }
      if (body.revision !== item.revision) return json(route, { message: '记录版本冲突' }, 409);
      Object.assign(item, body, { revision: item.revision + 1 });
      return json(route, item);
    }
    return json(route, { items: [] });
  });
  return {
    requests,
    files,
    setItems: (next: LearningRecord[]) => {
      items = next;
    },
    fail: (value: typeof failure) => {
      failure = value;
    },
    conflict: () => {
      conflict = true;
    },
    filename: (value: string) => {
      disposition = value;
    },
    expire: () => {
      authenticated = false;
    },
    delay: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      handled = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { release: () => release?.(), handled };
    },
  };
}
const dialog = (page: Page) => page.getByRole('dialog', { name: '导出学习记录' });
async function chooseStatus(page: Page, value: string) {
  await page.getByRole('combobox', { name: '筛选记录状态', exact: true }).press('ArrowDown');
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .getByText(value, { exact: true })
    .click();
}
async function openExport(page: Page) {
  await page.getByRole('button', { name: '导出记录', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function download(page: Page) {
  const file = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: '下载文件', exact: true }).click();
  return file;
}

test('状态与模块保留在 URL，第二页导出全部匹配 CSV 且保留 BOM 和摘要字节', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/records?moduleId=circuit-lab');
  await chooseStatus(page, '已完成');
  await expect(page).toHaveURL(/moduleId=circuit-lab&status=COMPLETED/);
  await page.locator('.ant-pagination-item-2').click();
  await expect(page.getByRole('heading', { name: '电路实验13', exact: true })).toBeVisible();
  await openExport(page);
  await expect(dialog(page)).toContainText('当前筛选共 26 条记录，预计导出 26 条');
  await expect(dialog(page)).toContainText('仅包含服务器已保存的内容');
  const file = await download(page);
  expect(file.suggestedFilename()).toBe('academic-records.csv');
  const content = await bytes(file);
  expect([...content.subarray(0, 3)]).toEqual([239, 187, 191]);
  expect(content.toString('utf8')).toBe(fixture.files[0]);
  expect(content.toString('utf8')).toContain('电路实验01');
  expect(content.toString('utf8')).toContain('电路实验26');
  expect(content.toString('utf8')).toContain('电压为""12V""\n第二行观察 🔬');
  expect(content.toString('utf8')).toContain('"有笔记"');
  expect(content.toString('utf8')).not.toContain('服务器笔记');
  expect(fixture.requests.find((item) => item.path.endsWith('/export'))).toMatchObject({
    method: 'POST',
    csrf: 'export-fixture-token',
    body: { format: 'csv', moduleId: 'circuit-lab', status: 'COMPLETED', limit: 5000 },
  });
  await expect(dialog(page)).toContainText('已导出 26 / 26 条匹配记录');
  await dialog(page).getByRole('button', { name: '关闭', exact: true }).click();
  await chooseStatus(page, '继续研究');
  await expect(page).toHaveURL(/moduleId=circuit-lab&status=DRAFT/);
  await expect
    .poll(() => fixture.requests.some((item) => item.path.includes('status=DRAFT&page=1')))
    .toBe(true);
  await page.reload();
  await expect(page.locator('.academic-filter-bar').getByTitle('继续研究', { exact: true })).toBeVisible();
});

test('Markdown 默认最新20条、可改数量，下载实际数据和服务器变化后的计数', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/records?moduleId=circuit-lab');
  await openExport(page);
  await dialog(page).getByRole('radio', { name: 'Markdown 详细笔记', exact: true }).check();
  await expect(dialog(page).getByRole('spinbutton', { name: '导出数量' })).toHaveValue('20');
  await expect(dialog(page)).toContainText('本次仅导出最新 20 条记录');
  await dialog(page).getByRole('spinbutton', { name: '导出数量' }).fill('3');
  // The list is a preview. The server response is authoritative if records change.
  fixture.setItems(records().slice(0, 24));
  const file = await download(page);
  expect(file.suggestedFilename()).toBe('academic-records.md');
  const content = (await bytes(file)).toString('utf8');
  expect(content).toBe(fixture.files[0]);
  expect(content).toContain('"resistance":[100,200]');
  expect(content).toContain('自由笔记原文 <vector>');
  expect(content).toContain('服务器笔记3');
  expect(content).not.toContain('电路实验04');
  expect(fixture.requests.find((item) => item.path.endsWith('/export'))?.body).toEqual({
    format: 'md',
    moduleId: 'circuit-lab',
    status: 'all',
    limit: 3,
  });
  await expect(dialog(page)).toContainText('已导出 3 / 24 条匹配记录');
  await expect(dialog(page)).toContainText('本次仅包含最新 3 条记录');
});

test('无记录和空数量禁止下载，网络/超限/限流失败保留格式数量后重试', async ({ page }) => {
  const fixture = await setup(page, []);
  await page.goto('/academics/records');
  await openExport(page);
  await expect(dialog(page)).toContainText('当前筛选下没有可导出的记录');
  await expect(dialog(page).getByRole('button', { name: '下载文件', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: '关闭', exact: true }).click();
  fixture.setItems(records());
  await page.getByRole('button', { name: '刷新记录' }).click();
  await expect(page.getByText('共 28 条', { exact: true })).toBeVisible();
  await openExport(page);
  await dialog(page).getByRole('radio', { name: 'Markdown 详细笔记', exact: true }).check();
  await dialog(page).getByRole('spinbutton', { name: '导出数量' }).fill('');
  await expect(dialog(page).getByRole('button', { name: '下载文件', exact: true })).toBeDisabled();
  await dialog(page).getByRole('spinbutton', { name: '导出数量' }).fill('5');
  for (const failure of [
    { status: 0, message: '网络连接中断，请检查连接后重新下载' },
    { status: 503, message: '导出服务暂时不可用' },
    { status: 413, message: '导出文件超过8MiB，请缩小范围' },
    { status: 429, message: '导出过于频繁，请稍后重试' },
  ]) {
    fixture.fail(failure);
    await dialog(page).getByRole('button', { name: '下载文件', exact: true }).click();
    await expect(dialog(page)).toContainText(failure.message);
    await expect(dialog(page).getByRole('radio', { name: 'Markdown 详细笔记', exact: true })).toBeChecked();
    await expect(dialog(page).getByRole('spinbutton', { name: '导出数量' })).toHaveValue('5');
  }
  fixture.fail(null);
  fixture.filename("attachment; filename*=UTF-8''%ZZbroken");
  const file = await download(page);
  expect(file.suggestedFilename()).toBe('academic-records.md');
  expect((await bytes(file)).toString('utf8')).toBe(fixture.files[0]);
  await expect(dialog(page).getByText('下载未完成', { exact: true })).toHaveCount(0);
});

test('状态变化让记录离开当前列表时，冲突刷新按ID取回最新版本并保留输入', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/records?status=COMPLETED');
  await page.getByRole('button', { name: '查看与编辑', exact: true }).first().click();
  const detail = page.getByRole('dialog', { name: '学习记录详情' });
  await detail.getByRole('textbox', { name: '学习记录笔记', exact: true }).fill('需要保留的本机编辑');
  fixture.conflict();
  await detail.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
  await expect(detail).toContainText('其他窗口保存的新笔记');
  await expect(detail.getByRole('textbox', { name: '学习记录笔记', exact: true })).toHaveValue(
    '需要保留的本机编辑',
  );
  expect(
    fixture.requests.some((item) => item.path === '/api/academics/records/record-1' && item.method === 'GET'),
  ).toBe(true);
  await detail.getByRole('button', { name: '保留我的输入并重新保存', exact: true }).click();
  await page.getByRole('button', { name: '保存我的内容', exact: true }).click();
  await expect(detail.getByText('记录版本冲突', { exact: true })).toHaveCount(0);
  expect(fixture.requests.filter((item) => item.method === 'PATCH').at(-1)?.body).toMatchObject({
    revision: 1,
    notes: '需要保留的本机编辑',
  });
});

test('关闭下载弹窗取消在途请求，重新打开可下载，不留下旧结果', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/records');
  await openExport(page);
  const delayed = fixture.delay();
  const downloads: Download[] = [];
  page.on('download', (file) => downloads.push(file));
  await dialog(page).getByRole('button', { name: '下载文件', exact: true }).click();
  await expect.poll(() => fixture.files.length).toBe(1);
  await expect(dialog(page).getByRole('radio', { name: 'Markdown 详细笔记', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: '取消下载并关闭', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  delayed.release();
  await delayed.handled;
  await openExport(page);
  const file = await download(page);
  expect((await bytes(file)).toString('utf8')).toBe(fixture.files[1]);
  expect(downloads).toHaveLength(1);
});

test('A退出后迟到的文件不能在B会话触发下载', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/records');
  await openExport(page);
  const delayed = fixture.delay();
  const downloads: Download[] = [];
  page.on('download', (file) => downloads.push(file));
  await dialog(page).getByRole('button', { name: '下载文件', exact: true }).click();
  await expect.poll(() => fixture.files.length).toBe(1);
  try {
    fixture.expire();
    await page.evaluate(() => window.dispatchEvent(new Event('auth-expired')));
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('账号', { exact: true }).fill('B');
    await page.getByLabel('密码', { exact: true }).fill('mock-password-only');
    await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
    await expect(page.getByRole('heading', { name: '我的学习空间' })).toBeVisible();
    // Keep the same browser document so A's response really arrives after login.
    const noDownload = page.waitForEvent('download', { timeout: 750 }).then(
      () => true,
      () => false,
    );
    delayed.release();
    await delayed.handled;
    expect(await noDownload).toBe(false);
    expect(downloads).toHaveLength(0);
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    delayed.release();
  }
});

test('401转到登录，390px筛选及导出结果无横向溢出或脚本错误', async ({ page }) => {
  const fixture = await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (entry.type() === 'error' && /content security|violates.*policy|worker/i.test(entry.text()))
      errors.push(entry.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/academics/records?moduleId=circuit-lab&status=COMPLETED');
  await expect(page.getByRole('heading', { name: '学习记录与笔记', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await mkdir('test-results/academic-records-export', { recursive: true });
  await page.screenshot({
    path: 'test-results/academic-records-export/records-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await openExport(page);
  await dialog(page).getByRole('radio', { name: 'Markdown 详细笔记', exact: true }).check();
  const file = await download(page);
  expect((await bytes(file)).toString('utf8')).toBe(fixture.files[0]);
  await expect(dialog(page)).toContainText('已导出 20 / 26 条匹配记录');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  const downloadButton = await dialog(page)
    .getByRole('button', { name: '下载文件', exact: true })
    .boundingBox();
  expect(downloadButton).toBeTruthy();
  expect(downloadButton!.y + downloadButton!.height).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: 'test-results/academic-records-export/export-mobile.png',
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
  fixture.fail({ status: 401, message: '登录已失效，请重新登录' });
  await dialog(page).getByRole('button', { name: '下载文件', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
