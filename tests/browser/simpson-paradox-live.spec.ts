import { test, expect, type Page } from '@playwright/test';
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
  'Live Simpson paradox requires loopback web/API and a review database',
);
// Random credentials stay in memory and never enter screenshots, video or traces.
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15000,
  viewport: { width: 390, height: 844 },
});
const moduleId = 'simpson-paradox';
const moduleTitle = '分层与汇总比例：辛普森反转';
const fieldKeys = [
  'aSuccess1',
  'aTotal1',
  'bSuccess1',
  'bTotal1',
  'aSuccess2',
  'aTotal2',
  'bSuccess2',
  'bTotal2',
];
const counts = (...values: number[]) => Object.fromEntries(fieldKeys.map((key, i) => [key, values[i]]));
const defaults = counts(9, 10, 80, 100, 20, 100, 1, 10);
const unequalValues = counts(9, 10, 160, 200, 20, 100, 1, 10);
const categories = ['分层1', '分层2', '原始汇总', '共同权重'];
const baselineChart = [
  [90, 20, 26.363636364, 55],
  [80, 10, 73.636363636, 45],
];
const unequalChart = [
  [90, 20, 26.363636364, 65.9375],
  [80, 10, 76.666666667, 55.9375],
];
const unequalWeights = [
  ['分层1', 10, 200, 210, 0.65625, 59.0625, 52.5],
  ['分层2', 100, 10, 110, 0.34375, 6.875, 3.4375],
];
async function layout(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), {
      message: '390px workspace must not overflow the whole page',
    })
    .toBe(true);
}

test('辛普森反转真实自由学习、四口径非等权图、记录笔记和完整导出', async ({ page }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const username = `simpson_live_${suffix}`;
  const password = `Simpson-${randomBytes(24).toString('base64url')}!`;
  const unequalTitle = `非等权分层比较-${suffix}`;
  const notes =
    '原始汇总使用各自样本构成；共同权重是21/32和11/32。\n```\n<script>window.__simpsonInjected=true</script>\n``````\n严格反转只是算术比较，不推出因果或学习能力结论。';
  let user: any;
  let csrf = '';
  let baseline: any;
  let saved: any;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (event) => {
    if (
      event.type() === 'error' &&
      /content security policy|violat.*policy|refused to (?:load|execute|create)/i.test(event.text())
    )
      errors.push(event.text());
  });
  await page.addInitScript(() => {
    (window as any).__simpsonInjected = false;
  });
  const fields = [
    '分层1 · A 达成数',
    '分层1 · A 总数',
    '分层1 · B 达成数',
    '分层1 · B 总数',
    '分层2 · A 达成数',
    '分层2 · A 总数',
    '分层2 · B 达成数',
    '分层2 · B 总数',
  ].map((label) => page.getByLabel(label, { exact: true }));
  const resultRegion = page.locator('.academic-result');
  const tableRegion = resultRegion.getByRole('region', { name: '四种口径比较，可横向滚动', exact: true });
  const popconfirm = page.locator('.ant-popconfirm:visible');
  const chart = page.getByRole('img', {
    name: '分层与汇总达成比例，分组柱状图；类别：分层1、分层2、原始汇总、共同权重；系列：方案A、方案B；纵轴：达成比例（%）',
    exact: true,
  });
  async function example(title: string) {
    await page.getByRole('tab', { name: '动手练习', exact: true }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await popconfirm.getByRole('button', { name: '载入示例', exact: true }).click();
    await expect(popconfirm).toHaveCount(0);
  }
  async function run(title: string, expected = 201) {
    await page.getByLabel('本次记录标题（可选）', { exact: true }).fill(title);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/academics/modules/${moduleId}/evaluate`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '运行并保存结果', exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(expected);
    const body = await response.json();
    if (expected === 201) {
      expect(body.record.status).toBe('COMPLETED');
      await expect(page.getByRole('tab', { name: '结果与笔记', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    return body;
  }
  async function history(title: string, action: '恢复输入' | '查看结果与笔记') {
    await page.getByRole('tab', { name: /^学习记录/ }).click();
    const item = page
      .locator('.academic-history article')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await item.getByRole('button', { name: action, exact: true }).click();
    if (action === '恢复输入') {
      await popconfirm.getByRole('button', { name: '恢复输入', exact: true }).click();
      await expect(popconfirm).toHaveCount(0);
    }
  }
  async function download(format: 'csv' | 'md') {
    await page.getByRole('button', { name: '导出记录', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出学习记录', exact: true });
    await dialog
      .getByRole('radio', { name: format === 'csv' ? 'CSV 总览' : 'Markdown 详细笔记', exact: true })
      .check();
    const pending = page.waitForEvent('download');
    const responded = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/academics/records/export') && response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '下载文件', exact: true }).click();
    const [file, response] = await Promise.all([pending, responded]);
    expect(response.status()).toBe(200);
    expect(file.suggestedFilename()).toBe(`academic-records.${format}`);
    expect(await file.failure()).toBeNull();
    const path = await file.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path!);
    expect(Number(response.headers()['content-length'])).toBe(bytes.length);
    expect(response.headers()['x-export-record-count']).toBe('2');
    expect(response.headers()['x-export-matched-count']).toBe('2');
    expect(response.headers()['x-export-truncated']).toBe('false');
    await expect(dialog).toContainText('已导出 2 / 2 条匹配记录');
    await layout(page);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();
    return bytes;
  }
  try {
    const response = await page.request.post(`${web}/api/auth/register`, {
      headers: { Origin: web },
      data: { username, password, name: '辛普森反转验收同学' },
    });
    expect(response.status(), 'Independent fixture registration must succeed').toBe(201);
    const account = await response.json();
    user = account.user;
    csrf = account.csrfToken;
    const status = await page.request.get(`${web}/api/algorithms/status`);
    expect(status.status()).toBe(200);
    const services = await status.json();
    expect(services.judge.available).toBe(false);
    expect(services.ai.available).toBe(false);
    await test.step('新个人账号保持不限专业，选择模块后从自由学习入口进入', async () => {
      await page.goto(`${web}/academics`);
      await page.getByRole('button', { name: '定制学习模块', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '定制我的学习空间', exact: true });
      await expect(dialog).toContainText('不限专业，自由探索');
      await dialog.getByRole('searchbox', { name: '搜索可选模块', exact: true }).fill('辛普森');
      await dialog.getByRole('checkbox', { name: moduleTitle, exact: true }).check();
      const patched = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/academics/preferences') && response.request().method() === 'PATCH',
      );
      await dialog.getByRole('button', { name: '保存学习设置', exact: true }).click();
      expect((await patched).status()).toBe(200);
      await expect(dialog).toBeHidden();
      const me = await page.request.get(`${web}/api/academics/me`);
      expect(me.status()).toBe(200);
      expect(await me.json()).toMatchObject({
        accountMode: 'PERSONAL',
        majorId: null,
        selectedModuleIds: [moduleId],
      });
      await page.getByRole('searchbox', { name: '搜索学习模块', exact: true }).fill('辛普森');
      await page.locator(`a.academic-module-card[href="/academics/modules/${moduleId}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/academics/modules/${moduleId}$`));
      for (const [i, value] of Object.values(defaults).map(String).entries())
        await expect(fields[i]).toHaveValue(value);
      await layout(page);
    });
    await test.step('默认分层均A较高但原始汇总B较高，共同权重明确为各半', async () => {
      baseline = (await run(`默认反转-${suffix}`)).record;
      expect(baseline.values).toEqual(defaults);
      expect(baseline.result.metrics.find((metric: any) => metric.label === '比较分类').value).toBe(
        '严格反转',
      );
      expect(baseline.result.categoryChart.series.map((series: any) => series.values)).toEqual(baselineChart);
      expect(baseline.result.tables[1].rows.map((row: any) => row.pooledWeight)).toEqual([0.5, 0.5]);
      expect(baseline.result.tables[2].rows.map((row: any) => row.direction)).toEqual([
        '方案A较高',
        '方案A较高',
        '方案B较高',
        '方案A较高',
      ]);
      await expect(tableRegion.locator('tbody tr')).toHaveCount(4);
      await expect(chart.locator('canvas')).toBeVisible();
      await expect(resultRegion).toContainText('不判断因果');
      await expect(resultRegion).toContainText('不做显著性检验');
      await layout(page);
    });
    await test.step('原创非等权例保留计数/共同权重，四类八个tooltip数值对应真实结果', async () => {
      await example('共同权重并非各半');
      for (const [i, value] of Object.values(unequalValues).map(String).entries())
        await expect(fields[i]).toHaveValue(value);
      saved = (await run(unequalTitle)).record;
      expect(saved.values).toEqual(unequalValues);
      expect(saved.result.categoryChart).toEqual({
        title: '分层与汇总达成比例',
        categories,
        series: [
          { name: '方案A', values: unequalChart[0] },
          { name: '方案B', values: unequalChart[1] },
        ],
        yAxisLabel: '达成比例（%）',
      });
      const weights = resultRegion.getByRole('region', { name: '共同权重与贡献，可横向滚动', exact: true });
      for (const [i, row] of unequalWeights.entries())
        await expect(weights.locator('tbody tr').nth(i).locator('td')).toHaveText(row.map(String));
      await chart.scrollIntoViewIfNeeded();
      await expect(chart.locator('canvas')).toBeVisible();
      const box = await chart.boundingBox();
      expect(box).not.toBeNull();
      const tooltip = page.locator('.academic-category-tooltip:visible');
      for (let index = 0; index < 4; index++) {
        await chart.hover({ position: { x: 45 + ((box!.width - 61) * (index + 0.5)) / 4, y: 150 } });
        await expect(tooltip).toBeVisible();
        await expect
          .poll(async () => (await tooltip.innerText()).replace(/\s+/g, ''))
          .toBe(`${categories[index]}方案A${unequalChart[0][index]}方案B${unequalChart[1][index]}`);
      }
      await page.getByLabel('学习记录笔记', { exact: true }).fill(notes);
      const patch = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/academics/records/${saved.id}`) &&
          response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
      expect((await patch).status()).toBe(200);
      const stored = await db.academicsRecord.findUniqueOrThrow({ where: { id: saved.id } });
      expect(stored.notes).toBe(notes);
      expect(stored.values).toEqual(unequalValues);
      expect(stored.result).toEqual(saved.result);
      await layout(page);
    });
    await test.step('达成数大于对应总数由真实API拒绝，保留输入且不新增记录', async () => {
      await page.getByRole('tab', { name: '动手练习', exact: true }).click();
      // 11 is inside the field's scalar bounds, but violates the cross-field 11 > 10 rule.
      await fields[0].fill('11');
      const before = await db.academicsRecord.count({ where: { userId: user.id } });
      await run(`无效达成数-${suffix}`, 400);
      await expect(page.getByText('本次练习未完成', { exact: true })).toBeVisible();
      await expect(fields[0]).toHaveValue('11');
      await expect(fields[1]).toHaveValue('10');
      expect(await db.academicsRecord.count({ where: { userId: user.id } })).toBe(before);
      await layout(page);
    });
    await test.step('历史恢复使用已存输入和结果，默认与非等权记录互不改写', async () => {
      await history(`默认反转-${suffix}`, '查看结果与笔记');
      await expect(chart.locator('canvas')).toBeVisible();
      expect((await db.academicsRecord.findUniqueOrThrow({ where: { id: baseline.id } })).result).toEqual(
        baseline.result,
      );
      await history(unequalTitle, '恢复输入');
      for (const [i, value] of Object.values(unequalValues).map(String).entries())
        await expect(fields[i]).toHaveValue(value);
      await history(unequalTitle, '查看结果与笔记');
      await expect(page.getByLabel('学习记录笔记', { exact: true })).toHaveValue(notes);
      await expect(tableRegion.locator('tbody tr').nth(3).locator('td')).toHaveText([
        '共同权重',
        '65.9375',
        '55.9375',
        '10',
        '方案A较高',
      ]);
      const fetched = await page.request.get(`${web}/api/academics/records/${saved.id}`, {
        headers: { Origin: web, 'x-csrf-token': csrf },
      });
      expect(fetched.status()).toBe(200);
      const record = await fetched.json();
      expect(record.values).toEqual(unequalValues);
      expect(record.result).toEqual(saved.result);
      expect(record.notes).toBe(notes);
      await layout(page);
    });
    await test.step('实际下载CSV总览及含全部计数/权重/表图和原始笔记的Markdown', async () => {
      await page.goto(`${web}/academics/records?moduleId=${moduleId}`);
      await expect(page.locator('.academic-filter-bar')).toContainText('共 2 条');
      const csv = await download('csv');
      expect(csv.subarray(0, 3).toString('hex')).toBe('efbbbf');
      expect(csv.toString('utf8')).toContain(saved.result.summary);
      expect(csv.toString('utf8')).toContain(unequalTitle);
      const text = (await download('md')).toString('utf8');
      const blocks = [...text.matchAll(/^(`{3,})(json|text)\n([\s\S]*?)\n\1\n/gm)];
      const json = blocks.filter((block) => block[2] === 'json').map((block) => JSON.parse(block[3]));
      for (const record of [baseline, saved]) {
        expect(json).toContainEqual(record.values);
        expect(json).toContainEqual(record.result);
      }
      expect(blocks.map((block) => block[3])).toContain(notes);
      expect(
        await db.auditLog.count({ where: { userId: user.id, action: 'academics.records.export' } }),
      ).toBe(2);
      expect(await db.academicsRecord.count({ where: { userId: user.id } })).toBe(2);
      expect(await page.evaluate(() => (window as any).__simpsonInjected)).toBe(false);
      expect(errors).toEqual([]);
      await layout(page);
    });
  } finally {
    await page.close().catch(() => {});
    const own = await db.user.findUnique({
      where: { username },
      select: { id: true, personalOrganizationId: true },
    });
    try {
      if (own) {
        const organizationId = own.personalOrganizationId!;
        await db.$transaction([
          db.academicGoal.deleteMany({ where: { userId: own.id } }),
          db.academicsRecord.deleteMany({ where: { userId: own.id } }),
          db.academicsPreference.deleteMany({ where: { userId: own.id } }),
          db.passwordRecovery.deleteMany({ where: { userId: own.id } }),
          db.session.deleteMany({ where: { userId: own.id } }),
          db.sensitiveGrant.deleteMany({ where: { userId: own.id } }),
          db.notification.deleteMany({ where: { organizationId } }),
          db.backgroundJob.deleteMany({ where: { organizationId } }),
          db.auditLog.deleteMany({ where: { organizationId } }),
          db.userRole.deleteMany({ where: { userId: own.id } }),
          db.user.delete({ where: { id: own.id } }),
          db.organization.delete({ where: { id: organizationId } }),
        ]);
      }
    } finally {
      await db.$disconnect();
    }
  }
});
