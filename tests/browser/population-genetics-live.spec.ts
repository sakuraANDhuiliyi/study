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
  'Live population genetics requires loopback web/API and a review database',
);
// Random credentials stay in memory and never enter screenshots, video or traces.
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15000,
  viewport: { width: 390, height: 844 },
});
const moduleId = 'population-genetics';
const moduleTitle = '群体等位基因频率与模型期望';
const defaults = { countAA: 36, countAa: 48, countaa: 16 };
const fractionalValues = { countAA: 0, countAa: 1, countaa: 0 };
const fractionalRows = [
  {
    genotype: 'AA',
    observedCount: 0,
    observedFrequency: 0,
    expectedCount: 0.25,
    expectedFrequency: 0.25,
    countDifference: -0.25,
    frequencyDifference: -0.25,
  },
  {
    genotype: 'Aa',
    observedCount: 1,
    observedFrequency: 1,
    expectedCount: 0.5,
    expectedFrequency: 0.5,
    countDifference: 0.5,
    frequencyDifference: 0.5,
  },
  {
    genotype: 'aa',
    observedCount: 0,
    observedFrequency: 0,
    expectedCount: 0.25,
    expectedFrequency: 0.25,
    countDifference: -0.25,
    frequencyDifference: -0.25,
  },
];
async function layout(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), {
      message: '390px workspace must not overflow the whole page',
    })
    .toBe(true);
}

test('群体遗传真实自由学习、小数分组图、记录笔记和完整导出', async ({ page }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const username = `population_live_${suffix}`;
  const password = `Population-${randomBytes(24).toString('base64url')}!`;
  const fractionalTitle = `小数模型期望-${suffix}`;
  const notes =
    'AA观察为0，模型期望0.25；Aa观察1，模型期望0.5。\n```\n<script>window.__populationInjected=true</script>\n``````\n实验完成不等于群体达标或掌握。';
  let user: any;
  let csrf = '';
  let baseline: any;
  let saved: any;
  let zero: any;
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
    (window as any).__populationInjected = false;
  });
  const fields = ['AA 观察计数', 'Aa 观察计数', 'aa 观察计数'].map((label) =>
    page.getByLabel(label, { exact: true }),
  );
  const resultRegion = page.locator('.academic-result');
  const tableRegion = resultRegion.getByRole('region', { name: '观察与模型期望，可横向滚动', exact: true });
  const popconfirm = page.locator('.ant-popconfirm:visible');
  const chart = page.getByRole('img', {
    name: '观察计数与模型期望计数，分组柱状图；类别：AA、Aa、aa；系列：观察计数、模型期望计数；纵轴：个体数',
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
    expect(response.headers()['x-export-record-count']).toBe('3');
    expect(response.headers()['x-export-matched-count']).toBe('3');
    expect(response.headers()['x-export-truncated']).toBe('false');
    await expect(dialog).toContainText('已导出 3 / 3 条匹配记录');
    await layout(page);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();
    return bytes;
  }
  try {
    const response = await page.request.post(`${web}/api/auth/register`, {
      headers: { Origin: web },
      data: { username, password, name: '群体遗传验收同学' },
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
      await dialog.getByRole('searchbox', { name: '搜索可选模块', exact: true }).fill('群体');
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
      await page.getByRole('searchbox', { name: '搜索学习模块', exact: true }).fill('群体');
      await page.locator(`a.academic-module-card[href="/academics/modules/${moduleId}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/academics/modules/${moduleId}$`));
      for (const [i, value] of ['36', '48', '16'].entries()) await expect(fields[i]).toHaveValue(value);
      await layout(page);
    });
    await test.step('默认样本数值和图表对应，零差值不被解释为统计或能力结论', async () => {
      baseline = (await run(`默认样本-${suffix}`)).record;
      expect(baseline.values).toEqual(defaults);
      expect(baseline.result.metrics.map((metric: any) => metric.value)).toEqual([100, 120, 80, 0.6, 0.4]);
      expect(baseline.result.tables[0].rows.map((row: any) => row.expectedCount)).toEqual([36, 48, 16]);
      expect(baseline.result.tables[0].rows.map((row: any) => row.countDifference)).toEqual([0, 0, 0]);
      expect(baseline.result.categoryChart.series.map((series: any) => series.values)).toEqual([
        [36, 48, 16],
        [36, 48, 16],
      ]);
      await expect(tableRegion.locator('tbody tr')).toHaveCount(3);
      await expect(chart.locator('canvas')).toBeVisible();
      await expect(resultRegion).toContainText('不进行显著性检验或能力评分');
      await expect(resultRegion).toContainText('“已完成”只表示完成一次实验');
      await layout(page);
    });
    await test.step('原创小样本显示小数分组柱形与全部行，笔记原样保存', async () => {
      await example('一个杂合个体');
      for (const [i, value] of ['0', '1', '0'].entries()) await expect(fields[i]).toHaveValue(value);
      saved = (await run(fractionalTitle)).record;
      expect(saved.values).toEqual(fractionalValues);
      expect(saved.result.tables[0].rows).toEqual(fractionalRows);
      expect(saved.result.categoryChart).toEqual({
        title: '观察计数与模型期望计数',
        categories: ['AA', 'Aa', 'aa'],
        series: [
          { name: '观察计数', values: [0, 1, 0] },
          { name: '模型期望计数', values: [0.25, 0.5, 0.25] },
        ],
        yAxisLabel: '个体数',
      });
      for (let index = 0; index < fractionalRows.length; index++) {
        const row = fractionalRows[index];
        await expect(tableRegion.locator('tbody tr').nth(index).locator('td')).toHaveText(
          Object.values(row).map(String),
        );
      }
      await chart.scrollIntoViewIfNeeded();
      await expect(chart.locator('canvas')).toBeVisible();
      const box = await chart.boundingBox();
      expect(box).not.toBeNull();
      const tooltip = page.locator('.academic-category-tooltip:visible');
      for (const [index, expected] of [
        'AA观察计数0模型期望计数0.25',
        'Aa观察计数1模型期望计数0.5',
        'aa观察计数0模型期望计数0.25',
      ].entries()) {
        await chart.hover({ position: { x: 45 + ((box!.width - 61) * (index + 0.5)) / 3, y: 150 } });
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
      expect(stored.values).toEqual(fractionalValues);
      expect(stored.result).toEqual(saved.result);
      await layout(page);
    });
    await test.step('零和输入被真实API拒绝且保留，边界示例的零列正常保存', async () => {
      await page.getByRole('tab', { name: '动手练习', exact: true }).click();
      await fields[1].fill('0');
      const before = await db.academicsRecord.count({ where: { userId: user.id } });
      await run(`无效零和-${suffix}`, 400);
      await expect(page.getByText('本次练习未完成', { exact: true })).toBeVisible();
      for (const field of fields) await expect(field).toHaveValue('0');
      expect(await db.academicsRecord.count({ where: { userId: user.id } })).toBe(before);
      await example('仅有 a 等位基因');
      zero = (await run(`零列-${suffix}`)).record;
      expect(zero.result.categoryChart.series.map((series: any) => series.values)).toEqual([
        [0, 0, 12],
        [0, 0, 12],
      ]);
      await expect(tableRegion.locator('tbody tr').nth(0).locator('td')).toHaveText([
        'AA',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ]);
      await expect(chart.locator('canvas')).toBeVisible();
      await layout(page);
    });
    await test.step('历史恢复使用已存输入与结果，小数图和笔记不被后续计算改写', async () => {
      await history(fractionalTitle, '恢复输入');
      for (const [i, value] of ['0', '1', '0'].entries()) await expect(fields[i]).toHaveValue(value);
      await history(fractionalTitle, '查看结果与笔记');
      await expect(page.getByLabel('学习记录笔记', { exact: true })).toHaveValue(notes);
      await expect(tableRegion.locator('tbody tr').nth(0).locator('td')).toHaveText([
        'AA',
        '0',
        '0',
        '0.25',
        '0.25',
        '-0.25',
        '-0.25',
      ]);
      await expect(chart.locator('canvas')).toBeVisible();
      const fetched = await page.request.get(`${web}/api/academics/records/${saved.id}`, {
        headers: { Origin: web, 'x-csrf-token': csrf },
      });
      expect(fetched.status()).toBe(200);
      const record = await fetched.json();
      expect(record.values).toEqual(fractionalValues);
      expect(record.result).toEqual(saved.result);
      expect(record.notes).toBe(notes);
      await layout(page);
    });
    await test.step('CSV与Markdown实际下载保留零值小数、完整表图和原始笔记', async () => {
      await page.goto(`${web}/academics/records?moduleId=${moduleId}`);
      await expect(page.locator('.academic-filter-bar')).toContainText('共 3 条');
      const csv = await download('csv');
      expect(csv.subarray(0, 3).toString('hex')).toBe('efbbbf');
      expect(csv.toString('utf8')).toContain(saved.result.summary);
      expect(csv.toString('utf8')).toContain(fractionalTitle);
      const text = (await download('md')).toString('utf8');
      const blocks = [...text.matchAll(/^(`{3,})(json|text)\n([\s\S]*?)\n\1\n/gm)];
      const json = blocks.filter((block) => block[2] === 'json').map((block) => JSON.parse(block[3]));
      for (const record of [baseline, saved, zero]) {
        expect(json).toContainEqual(record.values);
        expect(json).toContainEqual(record.result);
      }
      expect(blocks.map((block) => block[3])).toContain(notes);
      expect(
        await db.auditLog.count({ where: { userId: user.id, action: 'academics.records.export' } }),
      ).toBe(2);
      expect(await db.academicsRecord.count({ where: { userId: user.id } })).toBe(3);
      expect(await page.evaluate(() => (window as any).__populationInjected)).toBe(false);
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
          db.academicsEvaluationAttempt.deleteMany({ where: { userId: own.id } }),
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
