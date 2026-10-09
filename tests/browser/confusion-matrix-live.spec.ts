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
  'Live confusion matrix requires loopback web/API and a review database',
);
// Random credentials stay in memory and never enter screenshots, video or traces.
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15000,
  viewport: { width: 390, height: 844 },
});
const moduleId = 'confusion-matrix';
const moduleTitle = '二分类混淆矩阵与指标';
const defaults = { tp: 45, fp: 5, fn: 10, tn: 40 };
const rareValues = { tp: 0, fp: 0, fn: 1, tn: 99 };
const metricLabels = [
  '准确率 Accuracy',
  '精确率 Precision',
  '召回率 Recall',
  '负类召回率 Specificity',
  'F1',
  '二分类平衡准确率',
];
async function layout(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), {
      message: '390px workspace must not overflow the whole page',
    })
    .toBe(true);
}

test('混淆矩阵真实自由学习、零分母与失衡数据、记录笔记和完整导出', async ({ page }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const username = `confusion_live_${suffix}`;
  const password = `Confusion-${randomBytes(24).toString('base64url')}!`;
  const rareTitle = `稀少正类全部漏判-${suffix}`;
  const notes =
    '准确率99%却没有识别出任何正类。Precision未定义，Recall=0，F1=0，平衡准确率50%。\n```\n<script>window.__confusionInjected=true</script>\n``````\n已完成只表示完成实验，不代表掌握。';
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
    (window as any).__confusionInjected = false;
  });
  const fields = ['真正类 TP', '假正类 FP', '假负类 FN', '真负类 TN'].map((label) =>
    page.getByLabel(label, { exact: true }),
  );
  const resultRegion = page.locator('.academic-result');
  const tableRegion = resultRegion.getByRole('region', {
    name: '混淆矩阵（行实际，列预测），可横向滚动',
    exact: true,
  });
  const popconfirm = page.locator('.ant-popconfirm:visible');
  const chart = page.getByRole('img', {
    name: '四格样本计数，分组柱状图；类别：TP、FP、FN、TN；系列：计数；纵轴：样本数',
    exact: true,
  });
  const metric = (label: string) =>
    resultRegion.locator('.academic-metrics > div').filter({ has: page.getByText(label, { exact: true }) });
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
    const before = await Promise.all(fields.map((field) => field.inputValue()));
    await item.getByRole('button', { name: action, exact: true }).click();
    if (action === '恢复输入') {
      await expect(popconfirm).toBeVisible();
      expect(await Promise.all(fields.map((field) => field.inputValue()))).toEqual(before);
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
      data: { username, password, name: '混淆矩阵验收同学' },
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
    await test.step('新个人账号自由选择模块，输入字段与默认四格计数来自真实目录', async () => {
      await page.goto(`${web}/academics`);
      await page.getByRole('button', { name: '定制学习模块', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '定制我的学习空间', exact: true });
      await expect(dialog).toContainText('不限专业，自由探索');
      await dialog.getByRole('searchbox', { name: '搜索可选模块', exact: true }).fill('混淆');
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
      await page.getByRole('searchbox', { name: '搜索学习模块', exact: true }).fill('混淆');
      await page.locator(`a.academic-module-card[href="/academics/modules/${moduleId}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/academics/modules/${moduleId}$`));
      for (const [i, value] of ['45', '5', '10', '40'].entries()) await expect(fields[i]).toHaveValue(value);
      await layout(page);
    });
    await test.step('默认矩阵行实际列预测，六项指标的独立手算与真实保存一致', async () => {
      baseline = (await run(`默认混合预测-${suffix}`)).record;
      expect(baseline.values).toEqual(defaults);
      expect(baseline.result.metrics.map((item: any) => item.label)).toEqual(metricLabels);
      const expected = [85, 90, 900 / 11, 800 / 9, 600 / 7, (900 / 11 + 800 / 9) / 2];
      baseline.result.metrics.forEach((item: any, i: number) => {
        expect(item.value).toBeCloseTo(expected[i], 8);
        expect(item.unit).toBe('%');
      });
      expect(baseline.result.tables[0].rows).toEqual([
        { actual: '实际负类', predictedNegative: 40, predictedPositive: 5, total: 45 },
        { actual: '实际正类', predictedNegative: 10, predictedPositive: 45, total: 55 },
        { actual: '合计', predictedNegative: 50, predictedPositive: 50, total: 100 },
      ]);
      await expect(tableRegion.locator('tbody tr')).toHaveCount(3);
      for (const [i, row] of [
        ['实际负类', '40', '5', '45'],
        ['实际正类', '10', '45', '55'],
        ['合计', '50', '50', '100'],
      ].entries())
        await expect(tableRegion.locator('tbody tr').nth(i).locator('td')).toHaveText(row);
      await expect(metric(metricLabels[0]).locator('strong')).toHaveText('85 %');
      expect(baseline.result.categoryChart.series).toEqual([{ name: '计数', values: [45, 5, 10, 40] }]);
      await expect(chart.locator('canvas')).toBeVisible();
      await layout(page);
    });
    await test.step('罕见正类漏判仍有99%准确率，Precision未定义而F1按独立分母等于0', async () => {
      await example('罕见正类全部预测负类');
      for (const [i, value] of ['0', '0', '1', '99'].entries()) await expect(fields[i]).toHaveValue(value);
      saved = (await run(rareTitle)).record;
      expect(saved.values).toEqual(rareValues);
      expect(saved.result.metrics.map((item: any) => item.value)).toEqual([99, '未定义', 0, 100, 0, 50]);
      expect(saved.result.metrics[1]).not.toHaveProperty('unit');
      expect(
        saved.result.tables[1].rows.map((row: any) => [row.numerator, row.denominator, row.percent]),
      ).toEqual([
        [99, 100, 99],
        [0, 0, '未定义'],
        [0, 1, 0],
        [99, 99, 100],
        [0, 1, 0],
        [99, 198, 50],
      ]);
      for (const [i, value] of ['99 %', '未定义', '0 %', '100 %', '0 %', '50 %'].entries())
        await expect(metric(metricLabels[i]).locator('strong')).toHaveText(value);
      await expect(metric(metricLabels[1]).locator('small')).toBeEmpty();
      const diagnostic = resultRegion.getByRole('region', {
        name: '指标分子与分母，可横向滚动',
        exact: true,
      });
      await expect(diagnostic.locator('tbody tr').nth(1)).toContainText('未定义');
      await expect(diagnostic.locator('tbody tr').nth(1)).toContainText(
        saved.result.tables[1].rows[1].reason,
      );
      expect(saved.result.categoryChart).toEqual({
        title: '四格样本计数',
        categories: ['TP', 'FP', 'FN', 'TN'],
        series: [{ name: '计数', values: [0, 0, 1, 99] }],
        yAxisLabel: '样本数',
      });
      await chart.scrollIntoViewIfNeeded();
      await expect(chart.locator('canvas')).toBeVisible();
      const box = await chart.boundingBox();
      expect(box).not.toBeNull();
      const tooltip = page.locator('.academic-category-tooltip:visible');
      for (const [index, expected] of ['TP计数0', 'FP计数0', 'FN计数1', 'TN计数99'].entries()) {
        await chart.hover({ position: { x: 45 + ((box!.width - 61) * (index + 0.5)) / 4, y: 150 } });
        await expect(tooltip).toBeVisible();
        await expect.poll(async () => (await tooltip.innerText()).replace(/\s+/g, '')).toBe(expected);
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
      expect(stored.values).toEqual(rareValues);
      expect(stored.result).toEqual(saved.result);
      await layout(page);
    });
    await test.step('用户可输入的全零计数被真实API拒绝，保留输入且不新增记录', async () => {
      await page.getByRole('tab', { name: '动手练习', exact: true }).click();
      for (const field of fields) await field.fill('0');
      const before = await db.academicsRecord.count({ where: { userId: user.id } });
      await run(`无效全零-${suffix}`, 400);
      await expect(page.getByText('本次练习未完成', { exact: true })).toBeVisible();
      await expect(page.getByText('四格样本计数之和必须大于0', { exact: true })).toBeVisible();
      for (const field of fields) await expect(field).toHaveValue('0');
      expect(await db.academicsRecord.count({ where: { userId: user.id } })).toBe(before);
      await layout(page);
    });
    await test.step('查看原记录不重算结果，明确确认后才恢复原输入和未定义指标笔记', async () => {
      await history(`默认混合预测-${suffix}`, '查看结果与笔记');
      await expect(metric(metricLabels[0]).locator('strong')).toHaveText('85 %');
      expect((await db.academicsRecord.findUniqueOrThrow({ where: { id: baseline.id } })).result).toEqual(
        baseline.result,
      );
      await history(rareTitle, '恢复输入');
      for (const [i, value] of ['0', '0', '1', '99'].entries()) await expect(fields[i]).toHaveValue(value);
      await history(rareTitle, '查看结果与笔记');
      await expect(page.getByLabel('学习记录笔记', { exact: true })).toHaveValue(notes);
      await expect(metric(metricLabels[1]).locator('strong')).toHaveText('未定义');
      await expect(metric(metricLabels[4]).locator('strong')).toHaveText('0 %');
      const fetched = await page.request.get(`${web}/api/academics/records/${saved.id}`, {
        headers: { Origin: web, 'x-csrf-token': csrf },
      });
      expect(fetched.status()).toBe(200);
      const record = await fetched.json();
      expect(record.values).toEqual(rareValues);
      expect(record.result).toEqual(saved.result);
      expect(record.notes).toBe(notes);
      await layout(page);
    });
    await test.step('实际CSV仅总览，Markdown包含全部原始计数/矩阵/指标分母/未定义/图及笔记', async () => {
      await page.goto(`${web}/academics/records?moduleId=${moduleId}`);
      await expect(page.locator('.academic-filter-bar')).toContainText('共 2 条');
      const csv = await download('csv');
      expect(csv.subarray(0, 3).toString('hex')).toBe('efbbbf');
      expect(csv.toString('utf8')).toContain(saved.result.summary);
      expect(csv.toString('utf8')).toContain(rareTitle);
      expect(csv.toString('utf8')).not.toContain('<script>window.__confusionInjected=true</script>');
      expect(csv.toString('utf8')).not.toContain('predictedNegative');
      const text = (await download('md')).toString('utf8');
      const blocks = [...text.matchAll(/^(`{3,})(json|text)\n([\s\S]*?)\n\1\n/gm)];
      const json = blocks.filter((block) => block[2] === 'json').map((block) => JSON.parse(block[3]));
      for (const record of [baseline, saved]) {
        expect(json).toContainEqual(record.values);
        expect(json).toContainEqual(record.result);
      }
      expect(blocks.map((block) => block[3])).toContain(notes);
      expect(text).toContain('未定义');
      expect(
        await db.auditLog.count({ where: { userId: user.id, action: 'academics.records.export' } }),
      ).toBe(2);
      expect(await db.academicsRecord.count({ where: { userId: user.id } })).toBe(2);
      expect(await page.evaluate(() => (window as any).__confusionInjected)).toBe(false);
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
