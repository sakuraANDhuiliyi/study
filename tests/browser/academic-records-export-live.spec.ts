import { test, expect, request, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const api = process.env.TEST_BASE_URL;
const web = process.env.WEB_BASE_URL || 'http://localhost:5173';
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/none');
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
test.skip(
  process.env.NODE_ENV === 'production' ||
    !api ||
    !loopback(new URL(api).hostname) ||
    !loopback(new URL(web).hostname) ||
    !loopback(database.hostname) ||
    !/review/i.test(database.pathname),
  'Live record exports require loopback web/API and a review database',
);
test.use({ screenshot: 'off', trace: 'off', video: 'off', actionTimeout: 15000 });
type Client = { api: APIRequestContext; csrf: string; user: any };
type StoredRecord = {
  id: string;
  moduleId: string;
  title: string;
  status: string;
  notes: string;
  revision: number;
  values: any;
  result: any;
  createdAt: string;
  updatedAt: string;
};

async function call(client: Client, path: string, method = 'GET', data?: unknown) {
  const response = await client.api.fetch(`${web}/api${path}`, {
    method,
    headers: { Origin: web, 'x-csrf-token': client.csrf },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path} must succeed`).toBe(true);
  return response.json();
}
async function register(context: APIRequestContext, username: string, password: string): Promise<Client> {
  const response = await context.post(`${web}/api/auth/register`, {
    headers: { Origin: web },
    data: { username, password, name: '导出验收同学' },
  });
  expect(response.status(), 'Independent fixture registration must succeed').toBe(201);
  const body = await response.json();
  return { api: context, csrf: body.csrfToken, user: body.user };
}

// Independent RFC 4180 reader: quoted commas/newlines and doubled quotes must form one cell.
function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  expect(quoted, 'CSV must not end inside a quoted cell').toBe(false);
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
const csvText = (value: string) => (/^[\t\r\n]|^\s*[=+\-@]/.test(value) ? `'${value}` : value);
function verifyCsv(bytes: Buffer, expected: StoredRecord[]) {
  expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'CSV includes its UTF-8 BOM').toBe(
    true,
  );
  const [header, ...rows] = csvRows(bytes.toString('utf8'));
  expect(header).toEqual([
    '记录ID',
    '模块ID',
    '模块名称',
    '标题',
    '状态',
    '创建时间(UTC)',
    '更新时间(UTC)',
    '版本',
    '结果摘要',
    '有笔记',
  ]);
  expect(rows).toHaveLength(expected.length);
  expect(rows.map((row) => row[0])).toEqual(expected.map((record) => record.id));
  for (let i = 0; i < expected.length; i++) {
    const record = expected[i],
      row = rows[i];
    expect(row).toHaveLength(header.length);
    expect(row[1]).toBe(record.moduleId);
    expect(row[3]).toBe(csvText(record.title));
    expect(row[4]).toBe(record.status);
    expect(new Date(row[5]).toISOString()).toBe(new Date(record.createdAt).toISOString());
    expect(new Date(row[6]).toISOString()).toBe(new Date(record.updatedAt).toISOString());
    expect(row[7]).toBe(String(record.revision));
    expect(row[8]).toBe(csvText(record.result.summary));
    expect(row[9]).toBe(record.notes ? '是' : '否');
  }
}
function verifyMarkdown(bytes: Buffer, expected: StoredRecord[]) {
  const text = bytes.toString('utf8');
  expect(text).toContain('# 专业练习记录');
  // Dynamic fences must be longer than any embedded backticks in literal student text.
  const pattern = /^(`{3,})([^\n]*)\n([\s\S]*?)\n\1(?=\n|$)/gm;
  const blocks = [...text.matchAll(pattern)].map((match) => match[3]);
  const outside = text.replace(pattern, '');
  expect(outside.match(/^## 记录 \d+$/gm) || []).toHaveLength(expected.length);
  expect(outside).not.toContain('<script>');
  expect(outside).not.toContain('<img');
  for (const record of expected) {
    expect(blocks.some((block) => block.includes(record.id))).toBe(true);
    expect(blocks).toContain(record.notes);
    const parsed = blocks.flatMap((block) => {
      try {
        return [JSON.parse(block)];
      } catch {
        return [];
      }
    });
    expect(parsed).toContainEqual(record.values);
    expect(parsed).toContainEqual(record.result);
  }
  return text;
}
async function choose(page: Page, field: Locator, label: string) {
  const visibleDropdowns = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden):visible');
  // Wait for the preceding popup's closing animation, including when a test
  // build assigns the same generated aria-controls ID to more than one Select.
  await expect(visibleDropdowns).toHaveCount(0);
  await field.press('ArrowDown');
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  const listId = await field.getAttribute('aria-controls');
  expect(listId).toBeTruthy();
  const dropdown = visibleDropdowns.filter({
    has: page.locator(`[id=${JSON.stringify(listId)}]`),
  });
  await expect(dropdown).toHaveCount(1);
  for (let count = 0; count < 100; count++) {
    const active = dropdown.locator('.ant-select-item-option-active:visible');
    if ((await active.getAttribute('title')) === label) {
      const option = dropdown.getByTitle(label, { exact: true });
      await expect(option).toBeVisible();
      await option.click();
      await expect(field).toHaveAttribute('aria-expanded', 'false');
      await expect(visibleDropdowns).toHaveCount(0);
      return;
    }
    await field.press('ArrowDown');
  }
  throw new Error('Export filter option is unavailable');
}

test('本人学习记录真实下载跨页CSV和完整Markdown，筛选、重试与空间隔离', async ({ page }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const username = `export_live_${suffix}`,
    otherUsername = `export_other_${suffix}`;
  const password = `Export-${randomBytes(24).toString('base64url')}!`;
  const foreignMarker = `FOREIGN_RECORD_${suffix}`,
    otherMarker = `OTHER_USER_RECORD_${suffix}`;
  let otherContext: APIRequestContext | undefined;
  let foreignSpace: string | undefined;
  const expected: StoredRecord[] = [];
  const errors: string[] = [];
  const downloads: Buffer[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (event) => {
    if (
      event.type() === 'error' &&
      /content security policy|violat.*policy|refused to (?:load|execute|create)/i.test(event.text())
    )
      errors.push(event.text());
  });
  await page.addInitScript(() => {
    (window as any).__exportInjected = false;
  });
  const dialog = page.getByRole('dialog', { name: '导出学习记录', exact: true });
  async function openExport() {
    await page.getByRole('button', { name: '导出记录', exact: true }).click();
    await expect(dialog).toBeVisible();
  }
  async function layout() {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), {
        message: '390px export view must not overflow horizontally',
      })
      .toBe(true);
  }
  async function download(format: 'csv' | 'md', matched: number, count: number, limit?: number) {
    const event = page.waitForEvent('download');
    const response = page.waitForResponse(
      (item) => item.url().endsWith('/api/academics/records/export') && item.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '下载文件', exact: true }).click();
    const [file, result] = await Promise.all([event, response]);
    expect(result.ok()).toBe(true);
    expect(file.suggestedFilename()).toBe(`academic-records.${format}`);
    expect(await file.failure()).toBeNull();
    const path = await file.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path!);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
    const headers = result.headers();
    // Chromium may expose an empty CDP response body for attachments. Inspect the
    // actual downloaded bytes below, and compare their size with the HTTP payload.
    expect(Number(headers['content-length'])).toBe(bytes.length);
    expect(headers['content-disposition']).toContain('attachment');
    expect(headers['x-export-matched-count']).toBe(String(matched));
    expect(headers['x-export-record-count']).toBe(String(count));
    expect(headers['x-export-truncated']).toBe(String(count < matched));
    expect(headers['cache-control']).toContain('no-store');
    expect(result.request().postDataJSON()).toMatchObject({ format });
    if (limit !== undefined) expect(result.request().postDataJSON().limit).toBe(limit);
    await expect(dialog.getByText('已开始下载', { exact: true })).toBeVisible();
    await expect(dialog).toContainText(`已导出 ${count} / ${matched} 条匹配记录`);
    downloads.push(bytes);
    return bytes;
  }
  async function closeExport() {
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  try {
    const personal = await register(page.request, username, password);
    otherContext = await request.newContext();
    const other = await register(otherContext, otherUsername, password);
    const circuit = await call(personal, '/academics/modules/circuit-lab');
    const notebook = await call(personal, '/academics/modules/study-notebook');
    await test.step('14条实际引擎记录、两模块两状态与完整持久化笔记', async () => {
      for (let i = 0; i < 14; i++) {
        const moduleId = i % 2 ? 'study-notebook' : 'circuit-lab';
        const title = `${i === 0 ? '=SUM(1,2)' : i === 1 ? '@formula' : `导出记录${String(i).padStart(2, '0')}`} "引号",${suffix}`;
        const body = `正文${i}\n<script>window.__exportInjected=true</script>\n<img src=x onerror="window.__exportInjected=true">\n\`\`\`\`\`\`\n## 记录 999\n[文字](https://example.invalid)\n末尾段落-${suffix}`;
        const values =
          moduleId === 'circuit-lab'
            ? { ...circuit.defaultValues }
            : { ...notebook.defaultValues, title: `正文主题${i}`, body };
        const saved = await call(personal, `/academics/modules/${moduleId}/evaluate`, 'POST', {
          title,
          values,
        });
        const notes = `\t=SUM(1,2)\r\n笔记${i} "引号",<vector>\n<script>window.__exportInjected=true</script>\n\`\`\`\`\`\`\n## 记录 999\n${'完整笔记，不能因卡片预览而截断。'.repeat(40)}\n结束-${i}-${suffix}`;
        const record = await call(personal, `/academics/records/${saved.record.id}`, 'PATCH', {
          revision: saved.record.revision,
          notes,
          status: i % 3 === 0 ? 'DRAFT' : 'COMPLETED',
        });
        expected.push(record);
      }
      expected.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
      expect(
        await db.academicsRecord.count({
          where: { organizationId: personal.user.organizationId, userId: personal.user.id },
        }),
      ).toBe(14);
      const stored = await db.academicsRecord.findMany({
        where: { organizationId: personal.user.organizationId, userId: personal.user.id },
      });
      for (const actual of stored) {
        const oracle = expected.find((record) => record.id === actual.id)!;
        expect(actual.notes).toBe(oracle.notes);
        expect(actual.values).toEqual(oracle.values);
        expect(actual.result).toEqual(oracle.result);
      }
      const second = await call(other, '/academics/modules/circuit-lab/evaluate', 'POST', {
        title: otherMarker,
        values: circuit.defaultValues,
      });
      foreignSpace = (await db.organization.create({ data: { name: `导出空间隔离-${suffix}` } })).id;
      await db.academicsRecord.create({
        data: {
          organizationId: foreignSpace,
          userId: personal.user.id,
          moduleId: 'circuit-lab',
          title: foreignMarker,
          notes: foreignMarker,
          values: circuit.defaultValues,
          result: second.result,
        },
      });
    });

    await test.step('CSV包含超过当前12条页面的所有本人空间记录', async () => {
      await page.goto(`${web}/academics/records`);
      await expect(page.locator('.academic-record-grid .panel')).toHaveCount(12);
      await expect(page.locator('.academic-filter-bar')).toContainText('共 14 条');
      await openExport();
      await dialog.getByRole('radio', { name: 'CSV 总览', exact: true }).check();
      await expect(dialog).toContainText('当前筛选共 14 条记录，预计导出 14 条');
      verifyCsv(await download('csv', 14, 14), expected);
      await closeExport();
    });

    await test.step('模块及状态筛选同步导出，临时失败保留设置且可重试', async () => {
      await choose(page, page.getByRole('combobox', { name: '学习记录模块' }), '电阻网络与RC响应');
      await expect(page).toHaveURL(/moduleId=circuit-lab$/);
      await expect(page.locator('.academic-record-grid .panel')).toHaveCount(7);
      await choose(page, page.getByRole('combobox', { name: '筛选记录状态' }), '继续研究');
      await expect(page).toHaveURL(/moduleId=circuit-lab&status=DRAFT/);
      const filtered = expected.filter(
        (record) => record.moduleId === 'circuit-lab' && record.status === 'DRAFT',
      );
      expect(filtered).toHaveLength(3);
      await expect(page.locator('.academic-record-grid .panel')).toHaveCount(3);
      for (const record of filtered)
        await expect(page.getByRole('heading', { name: record.title, exact: true })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await layout();
      await openExport();
      await expect(dialog).toContainText('当前筛选共 3 条记录，预计导出 3 条');
      await layout();
      // Only this failed attempt is synthetic; retry below downloads from the real service.
      await page.route(
        '**/api/academics/records/export',
        (route) =>
          route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: '导出验收临时失败，请重试' }),
          }),
        { times: 1 },
      );
      await dialog.getByRole('button', { name: '下载文件', exact: true }).click();
      await expect(dialog).toContainText('导出验收临时失败，请重试');
      await expect(dialog.getByRole('radio', { name: 'CSV 总览', exact: true })).toBeChecked();
      verifyCsv(await download('csv', 3, 3), filtered);
      await closeExport();
    });

    await test.step('Markdown指定最新3条与默认20条保留完整数据库内容、围栏不会被笔记逃逸', async () => {
      await page.goto(`${web}/academics/records`);
      await openExport();
      await dialog.getByRole('radio', { name: 'Markdown 详细笔记', exact: true }).check();
      await expect(dialog.getByLabel('导出数量', { exact: true })).toHaveValue('20');
      await dialog.getByLabel('导出数量', { exact: true }).fill('3');
      const limited = verifyMarkdown(await download('md', 14, 3, 3), expected.slice(0, 3));
      for (const omitted of expected.slice(3)) expect(limited).not.toContain(omitted.id);
      await expect(dialog).toContainText('本次仅包含最新 3 条记录');
      await closeExport();
      await openExport();
      await dialog.getByRole('radio', { name: 'Markdown 详细笔记', exact: true }).check();
      await expect(dialog.getByLabel('导出数量', { exact: true })).toHaveValue('20');
      verifyMarkdown(await download('md', 14, 14, 20), expected);
      await closeExport();
    });

    await test.step('Markdown上限50导出完整记录，另一用户与本人机构历史不混入', async () => {
      await openExport();
      await dialog.getByRole('radio', { name: 'Markdown 详细笔记', exact: true }).check();
      await dialog.getByLabel('导出数量', { exact: true }).fill('50');
      verifyMarkdown(await download('md', 14, 14, 50), expected);
      await closeExport();
      expect(downloads).toHaveLength(5); // Stay within five successful exports per account/minute.
      for (const bytes of downloads) {
        expect(bytes.toString('utf8')).not.toContain(foreignMarker);
        expect(bytes.toString('utf8')).not.toContain(otherMarker);
      }
      const otherExport = await other.api.post(`${web}/api/academics/records/export`, {
        headers: { Origin: web, 'x-csrf-token': other.csrf },
        data: { format: 'csv', status: 'all' },
      });
      expect(otherExport.ok()).toBe(true);
      const otherRows = csvRows((await otherExport.body()).toString('utf8'));
      expect(otherRows).toHaveLength(2);
      expect(otherRows[1][3]).toBe(otherMarker);
      expect(otherRows[1][0]).not.toBe(expected[0].id);
      expect(await page.evaluate(() => (window as any).__exportInjected)).toBe(false);
      expect(errors).toEqual([]);
      await layout();
    });
  } finally {
    await page.close().catch(() => {});
    await otherContext?.dispose();
    const users = await db.user.findMany({
      where: { username: { in: [username, otherUsername] } },
      select: { id: true, personalOrganizationId: true },
    });
    const ids = users.map((user) => user.id);
    const organizations = [
      ...new Set(
        [foreignSpace, ...users.map((user) => user.personalOrganizationId)].filter(
          (id): id is string => !!id,
        ),
      ),
    ];
    try {
      await db.$transaction([
        db.academicsEvaluationAttempt.deleteMany({ where: { userId: { in: ids } } }),
        db.academicsRecord.deleteMany({ where: { userId: { in: ids } } }),
        db.academicsPreference.deleteMany({ where: { userId: { in: ids } } }),
        db.passwordRecovery.deleteMany({ where: { userId: { in: ids } } }),
        db.session.deleteMany({ where: { userId: { in: ids } } }),
        db.sensitiveGrant.deleteMany({ where: { userId: { in: ids } } }),
        db.notification.deleteMany({ where: { organizationId: { in: organizations } } }),
        db.backgroundJob.deleteMany({ where: { organizationId: { in: organizations } } }),
        db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } }),
        db.userRole.deleteMany({ where: { userId: { in: ids } } }),
        db.user.deleteMany({ where: { id: { in: ids } } }),
        db.organization.deleteMany({ where: { id: { in: organizations } } }),
      ]);
    } finally {
      await db.$disconnect();
    }
  }
});
