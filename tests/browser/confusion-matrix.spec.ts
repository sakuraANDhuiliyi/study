// Real teaching definitions, calculator and export serializer behind mock HTTP.
// Expected classroom numbers below are independent of the returned result.
import { test, expect, type Download, type Page, type Route } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { scienceModules } from '../../apps/api/src/academics/academics.modules-science';
import { evaluateAcademicModule, publicAcademicModule } from '../../apps/api/src/academics/academics.engine';
import { AcademicExportRenderer } from '../../apps/api/src/academics/records-export.renderer';
import type { LearningRecord, LearningResult } from '../../apps/web/src/components/academics/types';

test.use({ actionTimeout: 15000 });
const moduleId = 'confusion-matrix';
const definition = () => scienceModules.find((item) => item.id === moduleId)!;
const stamp = '2026-10-09T08:00:00.000Z';
const baseline = { tp: 45, fp: 5, fn: 10, tn: 40 };
const fields = [
  ['tp', '真正类 TP'],
  ['fp', '假正类 FP'],
  ['fn', '假负类 FN'],
  ['tn', '真负类 TN'],
] as const;
const metricLabels = [
  '准确率 Accuracy',
  '精确率 Precision',
  '召回率 Recall',
  '负类召回率 Specificity',
  'F1',
  '二分类平衡准确率',
];
const formulas = [
  '(TP + TN) / N',
  'TP / (TP + FP)',
  'TP / (TP + FN)',
  'TN / (TN + FP)',
  '2 × TP / (2 × TP + FP + FN)',
  '[TP × (TN + FP) + TN × (TP + FN)] / [2 × (TP + FN) × (TN + FP)]',
];
const matrixTitle = '混淆矩阵（行实际，列预测）';
const formulaTitle = '指标分子与分母';
const categories = ['TP', 'FP', 'FN', 'TN'];
const graphLabel = '四格样本计数，分组柱状图；类别：TP、FP、FN、TN；系列：计数；纵轴：样本数';
const exampleOracles = [
  { title: '混合预测结果', values: baseline },
  { title: '罕见正类全部预测负类', values: { tp: 0, fp: 0, fn: 1, tn: 99 } },
  { title: '两类均预测正确', values: { tp: 30, fp: 0, fn: 0, tn: 70 } },
  { title: '两类均预测错误', values: { tp: 0, fp: 40, fn: 60, tn: 0 } },
  { title: '仅实际正类且全部正确', values: { tp: 25, fp: 0, fn: 0, tn: 0 } },
  { title: '仅实际负类且全部正确', values: { tp: 0, fp: 0, fn: 0, tn: 100 } },
];
const makeRecord = (
  id: string,
  values: Record<string, unknown>,
  result: LearningResult,
  recordModuleId = moduleId,
): LearningRecord => ({
  id,
  title: id,
  moduleId: recordModuleId,
  values: structuredClone(values),
  result: structuredClone(result),
  notes: '',
  revision: 0,
  status: 'COMPLETED',
  createdAt: stamp,
  updatedAt: stamp,
});

async function setup(page: Page, initial: LearningRecord[] = []) {
  const records = structuredClone(initial);
  const requests: { path: string; method: string; body: any; csrf?: string }[] = [];
  const files: Buffer[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const filtered = (id?: string | null, status?: string | null) =>
    records.filter(
      (item) => (!id || item.moduleId === id) && (!status || status === 'all' || item.status === status),
    );
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const body = request.method() === 'GET' ? undefined : request.postDataJSON();
    requests.push({
      path: path + url.search,
      method: request.method(),
      body,
      csrf: request.headers()['x-csrf-token'],
    });
    if (path === '/api/auth/me')
      return json(route, {
        user: {
          id: 'confusion-student',
          name: '分类实验同学',
          username: 'confusion-fixture',
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['learning.use'],
          organizationId: 'confusion-personal',
          accountMode: 'PERSONAL',
          majorId: null,
          major: null,
        },
        csrfToken: 'confusion-fixture-token',
      });
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/academics/catalog')
      return json(route, { subjects: [], majors: [], modules: scienceModules.map(publicAcademicModule) });
    const moduleMatch = /^\/api\/academics\/modules\/([^/]+)(\/evaluate)?$/.exec(path);
    if (moduleMatch) {
      const module = scienceModules.find((item) => item.id === moduleMatch[1]);
      if (!module) return json(route, { message: '模块不存在' }, 404);
      if (!moduleMatch[2]) return json(route, publicAcademicModule(module));
      try {
        const output = await evaluateAcademicModule(module, body.values);
        const record = makeRecord(`实验记录 ${records.length + 1}`, body.values, output, module.id);
        records.unshift(record);
        return json(route, { record, result: record.result }, 201);
      } catch (error) {
        return json(route, { message: (error as Error).message }, 400);
      }
    }
    if (path === '/api/academics/records/export') {
      const matched = filtered(body.moduleId, body.status);
      const selected = matched.slice(0, body.limit);
      const renderer = new AcademicExportRenderer({
        format: body.format,
        matchedCount: matched.length,
        recordCount: selected.length,
        generatedAt: new Date(stamp),
      });
      for (const record of selected) {
        const row = {
          ...record,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt),
        };
        if (body.format === 'csv')
          renderer.addCsv({ ...row, summary: record.result.summary, hasNotes: !!record.notes });
        else
          renderer.addMarkdown({
            ...row,
            valuesJson: JSON.stringify(record.values, null, 2),
            resultJson: JSON.stringify(record.result, null, 2),
          });
      }
      const file = renderer.finish().buffer;
      files.push(file);
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': body.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="academic-records.${body.format}"`,
          'x-export-matched-count': String(matched.length),
          'x-export-record-count': String(selected.length),
          'x-export-truncated': String(selected.length < matched.length),
        },
        body: file,
      });
    }
    if (path === '/api/academics/records') {
      const found = filtered(url.searchParams.get('moduleId'), url.searchParams.get('status'));
      const pageNumber = Number(url.searchParams.get('page') || 1),
        pageSize = Number(url.searchParams.get('pageSize') || 6);
      return json(route, {
        items: found.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        total: found.length,
        page: pageNumber,
        pageSize,
      });
    }
    if (path.startsWith('/api/academics/records/')) {
      const record = records.find((item) => item.id === decodeURIComponent(path.split('/').at(-1)!));
      if (!record) return json(route, { message: '学习记录不存在' }, 404);
      if (request.method() === 'PATCH') {
        if (body.revision !== record.revision) return json(route, { message: '记录版本冲突' }, 409);
        Object.assign(record, body, { revision: record.revision + 1 });
      }
      return json(route, record);
    }
    return json(route, { items: [] });
  });
  return {
    records,
    requests,
    files,
    evaluations: () => requests.filter((item) => item.path.endsWith('/evaluate')),
  };
}

const field = (page: Page, key: (typeof fields)[number][0]) =>
  page.getByRole('spinbutton', { name: fields.find(([id]) => id === key)![1], exact: true });
const graph = (page: Page) => page.getByRole('img', { name: graphLabel, exact: true });
const table = (page: Page, title: string) =>
  page.getByRole('region', { name: `${title}，可横向滚动`, exact: true });
const metric = (page: Page, label: string) =>
  page.locator('.academic-metrics > div').filter({ has: page.getByText(label, { exact: true }) });
async function practice(page: Page) {
  await page.getByRole('tab', { name: '动手练习', exact: true }).click();
}
async function run(page: Page, status = 201) {
  const button = page
    .getByRole('tabpanel', { name: '动手练习', exact: true })
    .getByRole('button', { name: /^(?:loading )?运行并保存结果$/ });
  await expect(button).not.toHaveClass(/ant-btn-loading/);
  await expect(button).toBeEnabled();
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/academics/modules/${moduleId}/evaluate`,
  );
  await button.click();
  const response = await pending;
  expect(response.status()).toBe(status);
  if (status !== 201) return;
  const body = (await response.json()) as { record: LearningRecord };
  // A prior result remains mounted while the new response is in flight. Wait
  // for this response's record to render before asserting its metric values.
  await expect(page.getByRole('tab', { name: '结果与笔记', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.academic-record-meta')).toContainText(`· 已保存 · ${body.record.id.slice(-8)}`);
  await expect(page.getByRole('textbox', { name: '记录标题', exact: true })).toHaveValue(body.record.title);
}
async function expectFields(page: Page, values: Record<string, unknown>) {
  for (const [key] of fields) await expect(field(page, key)).toHaveValue(String(values[key]));
}
async function loadExample(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeHidden();
}
async function expectMetrics(page: Page, values: (number | '未定义')[]) {
  await expect(page.locator('.academic-metrics > div > span')).toHaveText(metricLabels);
  for (const [index, value] of values.entries()) {
    const tile = metric(page, metricLabels[index]);
    if (typeof value === 'string') {
      await expect(tile.locator('strong')).toHaveText(value);
      await expect(tile.locator('small')).toHaveText('');
    } else {
      await expect(tile.locator('small')).toHaveText('%');
      const shown = (await tile.locator('strong').innerText()).replace('%', '').trim();
      expect(Number(shown)).toBeCloseTo(value, 8);
    }
  }
}
async function expectRow(page: Page, title: string, index: number, values: (string | number)[]) {
  const cells = table(page, title)
    .getByRole('row')
    .nth(index + 1)
    .getByRole('cell');
  await expect(cells).toHaveCount(values.length);
  for (const [column, value] of values.entries()) {
    if (typeof value === 'string') await expect(cells.nth(column)).toHaveText(value);
    else expect(Number(await cells.nth(column).innerText())).toBeCloseTo(value, 8);
  }
}
async function tooltip(page: Page, index: number, value: number) {
  const plot = graph(page);
  await plot.scrollIntoViewIfNeeded();
  await expect(plot.locator('canvas')).toBeVisible();
  const box = await plot.boundingBox();
  if (!box) throw new Error('四格计数图不可见');
  await plot.hover({ position: { x: 45 + ((box.width - 61) * (index + 0.5)) / 4, y: 150 } });
  const hint = page.locator('.academic-category-tooltip');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText(new RegExp(`^${categories[index]}\\s*计数\\s*${value}$`));
}
async function viewRecord(page: Page, title: string) {
  await page.getByRole('tab', { name: /学习记录 ·/ }).click();
  await page
    .locator('.academic-history article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('button', { name: '查看结果与笔记', exact: true })
    .click();
}
async function capture(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await expect(page.locator('.academic-category-tooltip')).toBeHidden();
  await expect(page.getByText('练习结果已保存', { exact: true })).toBeHidden();
  await graph(page).scrollIntoViewIfNeeded();
  await mkdir('test-results/confusion-matrix', { recursive: true });
  await page.screenshot({ path: `test-results/confusion-matrix/${name}.png`, animations: 'disabled' });
}
async function downloadedBytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).toBeTruthy();
  return readFile(path!);
}
async function downloadFile(page: Page) {
  const button = page
    .getByRole('dialog', { name: '导出学习记录', exact: true })
    .getByRole('button', { name: /^(?:loading )?下载文件$/ });
  // A completed request can leave its animated icon briefly in the accessible name.
  await expect(button).toBeVisible();
  await expect(button).not.toHaveClass(/ant-btn-loading/);
  await expect(button).toBeEnabled();
  const download = page.waitForEvent('download');
  await button.click();
  return download;
}

test('四个必填整数计数形成正确边际总数、六个百分比与四根计数柱', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  await expect(page.getByRole('heading', { name: '二分类混淆矩阵与指标', exact: true })).toBeVisible();
  await expectFields(page, baseline);
  for (const [key] of fields) {
    await expect(field(page, key)).toHaveAttribute('step', '1');
    await expect(field(page, key)).toHaveAttribute('aria-valuemin', '0');
    await expect(field(page, key)).toHaveAttribute('aria-valuemax', '1000000');
  }
  await field(page, 'tp').press('ArrowUp');
  await expect(field(page, 'tp')).toHaveValue('46');
  await field(page, 'tp').press('ArrowDown');
  await run(page);
  await expectMetrics(page, [85, 90, 900 / 11, 800 / 9, 600 / 7, 8450 / 99]);
  await expect(table(page, matrixTitle).getByRole('row')).toHaveCount(4);
  await expectRow(page, matrixTitle, 0, ['实际负类', 40, 5, 45]);
  await expectRow(page, matrixTitle, 1, ['实际正类', 10, 45, 55]);
  await expectRow(page, matrixTitle, 2, ['合计', 50, 50, 100]);
  await expect(table(page, formulaTitle).getByRole('row')).toHaveCount(7);
  const expectedFractions = [
    [85, 100],
    [45, 50],
    [45, 55],
    [40, 45],
    [90, 105],
    [4225, 4950],
  ];
  for (const [index, [numerator, denominator]] of expectedFractions.entries()) {
    const cells = table(page, formulaTitle)
      .getByRole('row')
      .nth(index + 1)
      .getByRole('cell');
    await expect(cells.nth(0)).toHaveText(metricLabels[index]);
    await expect(cells.nth(1)).toHaveText(formulas[index]);
    await expect(cells.nth(2)).toHaveText(String(numerator));
    await expect(cells.nth(3)).toHaveText(String(denominator));
    expect(Number(await cells.nth(4).innerText())).toBeCloseTo(
      [85, 90, 900 / 11, 800 / 9, 600 / 7, 8450 / 99][index],
      8,
    );
  }
  for (const [index, value] of [45, 5, 10, 40].entries()) await tooltip(page, index, value);
  expect(fixture.records[0].values).toEqual(baseline);
  expect(fixture.records[0].status).toBe('COMPLETED');
  expect(fixture.records[0].result.chart).toBeUndefined();
  await capture(page, 'desktop');
});

test('六个原创示例确认才覆盖四字段，取消保留输入且示例本身不会创建记录', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  await field(page, 'tp').fill('17');
  await page.getByRole('button', { name: '混合预测结果', exact: true }).click();
  await page
    .getByRole('tooltip')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(field(page, 'tp')).toHaveValue('17');
  expect(definition().examples.map((item) => item.title)).toEqual(exampleOracles.map((item) => item.title));
  for (const example of exampleOracles) {
    await loadExample(page, example.title);
    await expectFields(page, example.values);
  }
  expect(fixture.evaluations()).toHaveLength(0);
  expect(fixture.records).toHaveLength(0);
});

test('零分母显示未定义而非零百分比，直接F1与缺一实际类别的平衡准确率正确区分', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  const cases: { index: number; metrics: (number | '未定义')[] }[] = [
    { index: 1, metrics: [99, '未定义', 0, 100, 0, 50] },
    { index: 2, metrics: [100, 100, 100, 100, 100, 100] },
    { index: 3, metrics: [0, 0, 0, 0, 0, 0] },
    { index: 4, metrics: [100, 100, 100, '未定义', 100, '未定义'] },
    { index: 5, metrics: [100, '未定义', '未定义', 100, '未定义', '未定义'] },
  ];
  for (const [runIndex, item] of cases.entries()) {
    if (runIndex) await practice(page);
    await loadExample(page, exampleOracles[item.index].title);
    await run(page);
    await expectMetrics(page, item.metrics);
    for (const [index, value] of item.metrics.entries()) {
      const cells = table(page, formulaTitle)
        .getByRole('row')
        .nth(index + 1)
        .getByRole('cell');
      if (value === '未定义') {
        await expect(cells.nth(3)).toHaveText('0');
        await expect(cells.nth(4)).toHaveText('未定义');
        await expect(cells.nth(5)).not.toBeEmpty();
        await expect(cells.nth(5)).not.toHaveText('—');
        const reason =
          index === 1
            ? '没有预测为正类'
            : index === 2
              ? '没有实际正类'
              : index === 3
                ? '没有实际负类'
                : index === 4
                  ? '实际正类和预测正类均不存在'
                  : item.index === 4
                    ? '缺少实际负类'
                    : '缺少实际正类';
        await expect(cells.nth(5)).toContainText(reason);
        expect(fixture.records[0].result.metrics[index]).not.toHaveProperty('unit');
      }
    }
    if (item.index === 1) {
      const f1 = table(page, formulaTitle).getByRole('row').nth(5).getByRole('cell');
      await expect(f1.nth(2)).toHaveText('0');
      await expect(f1.nth(3)).toHaveText('1');
      await expect(f1.nth(4)).toHaveText('0');
      for (const [index, value] of [0, 0, 1, 99].entries()) await tooltip(page, index, value);
    }
  }
  expect(fixture.records).toHaveLength(5);
});

test('必填、非整数和总数为零错误保留输入且不存记录，修正后能运行保存', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  await field(page, 'tp').fill('');
  await page.getByRole('button', { name: '运行并保存结果', exact: true }).click();
  await expect(page.getByText('请填写真正类 TP', { exact: true })).toBeVisible();
  expect(fixture.evaluations()).toHaveLength(0);
  await field(page, 'tp').fill('1.5');
  await run(page, 400);
  await expect(page.locator('.ant-alert-error')).toContainText('整数');
  await expect(field(page, 'tp')).toHaveValue('1.5');
  expect(fixture.evaluations().at(-1)!.body.values).toEqual({ ...baseline, tp: 1.5 });
  expect(fixture.records).toHaveLength(0);
  await page.reload();
  await expect(field(page, 'tp')).toHaveValue('1.5');
  for (const [key] of fields) await field(page, key).fill('0');
  await run(page, 400);
  await expect(page.locator('.ant-alert-error')).toContainText('四格样本计数之和必须大于0');
  await expectFields(page, { tp: 0, fp: 0, fn: 0, tn: 0 });
  expect(fixture.evaluations().at(-1)!.body.values).toEqual({ tp: 0, fp: 0, fn: 0, tn: 0 });
  expect(fixture.records).toHaveLength(0);
  await loadExample(page, '混合预测结果');
  await run(page);
  await expectMetrics(page, [85, 90, 900 / 11, 800 / 9, 600 / 7, 8450 / 99]);
  expect(fixture.records).toHaveLength(1);
});

test('笔记与历史保留原结果快照，恢复输入需确认，旧折线及无图记录仍可阅读', async ({ page }) => {
  const oldResult = await evaluateAcademicModule(definition(), baseline);
  delete oldResult.categoryChart;
  const fixture = await setup(page, [
    makeRecord('旧数值折线记录', baseline, {
      ...oldResult,
      chart: {
        title: '旧连续采样',
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 4 },
        ],
      },
    }),
    makeRecord('旧无图记录', baseline, oldResult),
  ]);
  await page.goto(`/academics/modules/${moduleId}`);
  await run(page);
  await expectMetrics(page, [85, 90, 900 / 11, 800 / 9, 600 / 7, 8450 / 99]);
  const first = structuredClone(fixture.records[0]);
  const note = '先声明正类。99%准确率不能代替正类召回率；未定义不是0%。';
  await page.getByRole('textbox', { name: '学习记录笔记', exact: true }).fill(note);
  await page.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
  await expect.poll(() => fixture.records[0].revision).toBe(1);
  await practice(page);
  await loadExample(page, '罕见正类全部预测负类');
  await run(page);
  await expectMetrics(page, [99, '未定义', 0, 100, 0, 50]);
  const second = structuredClone(fixture.records[0]);
  expect(fixture.records[1].result).toEqual(first.result);
  expect(fixture.records[1].values).toEqual(baseline);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await viewRecord(page, first.title);
  await expect(page.getByRole('textbox', { name: '学习记录笔记', exact: true })).toHaveValue(note);
  await expectMetrics(page, [85, 90, 900 / 11, 800 / 9, 600 / 7, 8450 / 99]);
  await tooltip(page, 0, 45);
  await viewRecord(page, '旧数值折线记录');
  await expect(page.getByRole('heading', { name: '旧连续采样', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '统计图', exact: true }).locator('canvas')).toBeVisible();
  await expect(graph(page)).toHaveCount(0);
  await viewRecord(page, '旧无图记录');
  await expect(table(page, matrixTitle).getByRole('row')).toHaveCount(4);
  await expect(page.locator('.academic-result canvas')).toHaveCount(0);
  await practice(page);
  await field(page, 'tp').fill('17');
  await page.getByRole('tab', { name: /学习记录 ·/ }).click();
  const card = page
    .locator('.academic-history article')
    .filter({ has: page.getByRole('heading', { name: second.title, exact: true }) });
  await card.getByRole('button', { name: '恢复输入', exact: true }).click();
  await page
    .getByRole('tooltip')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await practice(page);
  await expect(field(page, 'tp')).toHaveValue('17');
  await page.getByRole('tab', { name: /学习记录 ·/ }).click();
  await card.getByRole('button', { name: '恢复输入', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '恢复输入', exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expectFields(page, { tp: 0, fp: 0, fn: 1, tn: 99 });
  expect(fixture.evaluations()).toHaveLength(2);
  expect(fixture.records.find((item) => item.id === first.id)!.notes).toBe(note);
});

test('CSV只导出总览而Markdown实际文件保留未定义、完整矩阵图表和已保存笔记', async ({ page }) => {
  const values = { tp: 0, fp: 0, fn: 1, tn: 99 };
  const saved = makeRecord('私人分类实验', values, await evaluateAcademicModule(definition(), values));
  saved.notes = 'Precision 未定义，F1=0。\n保留原文 <vector> 与 ``` 代码标记，不能把无定义补成零。';
  const other = { ...saved, id: '另一模块记录', moduleId: 'calculus-lab', notes: '不应导出这条记录' };
  const fixture = await setup(page, [saved, other]);
  await page.goto(`/academics/records?moduleId=${moduleId}&status=COMPLETED`);
  await expect(page.getByRole('heading', { name: saved.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导出记录', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '导出学习记录', exact: true });
  await expect(modal).toContainText('当前筛选共 1 条记录');
  await expect(modal).toContainText('包含记录信息、结果摘要和笔记标记');
  const csvDownload = await downloadFile(page);
  expect(csvDownload.suggestedFilename()).toBe('academic-records.csv');
  const csvBytes = await downloadedBytes(csvDownload);
  expect([...csvBytes.subarray(0, 3)]).toEqual([239, 187, 191]);
  expect(csvBytes).toEqual(fixture.files[0]);
  const csv = csvBytes.toString('utf8');
  expect(csv).toContain('有笔记');
  expect(csv).toContain(saved.title);
  expect(csv).toContain(saved.result.summary);
  expect(csv).not.toContain(saved.notes);
  expect(csv).not.toContain('predictedNegative');
  expect(csv).not.toContain('categoryChart');
  expect(csv).not.toContain('另一模块记录');
  await expect(modal).toContainText('已导出 1 / 1 条匹配记录');
  await modal.getByRole('radio', { name: 'Markdown 详细笔记', exact: true }).check();
  const mdDownload = await downloadFile(page);
  expect(mdDownload.suggestedFilename()).toBe('academic-records.md');
  const mdBytes = await downloadedBytes(mdDownload);
  expect(mdBytes).toEqual(fixture.files[1]);
  const markdown = mdBytes.toString('utf8');
  expect(markdown).toContain(saved.notes);
  expect(markdown).not.toContain('不应导出这条记录');
  const jsonBlocks = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
  expect(jsonBlocks).toHaveLength(2);
  expect(jsonBlocks[0]).toEqual(values);
  const result = jsonBlocks[1];
  expect(result.metrics[1]).toEqual({ label: '精确率 Precision', value: '未定义' });
  expect(result.metrics[4]).toEqual({ label: 'F1', value: 0, unit: '%' });
  expect(result.tables[0].rows).toEqual([
    { actual: '实际负类', predictedNegative: 99, predictedPositive: 0, total: 99 },
    { actual: '实际正类', predictedNegative: 1, predictedPositive: 0, total: 1 },
    { actual: '合计', predictedNegative: 100, predictedPositive: 0, total: 100 },
  ]);
  expect(result.categoryChart).toEqual({
    title: '四格样本计数',
    categories,
    series: [{ name: '计数', values: [0, 0, 1, 99] }],
    yAxisLabel: '样本数',
  });
  expect(fixture.requests.filter((item) => item.path.endsWith('/export'))).toEqual([
    expect.objectContaining({
      method: 'POST',
      csrf: 'confusion-fixture-token',
      body: { format: 'csv', moduleId, status: 'COMPLETED', limit: 5000 },
    }),
    expect.objectContaining({
      method: 'POST',
      csrf: 'confusion-fixture-token',
      body: { format: 'md', moduleId, status: 'COMPLETED', limit: 20 },
    }),
  ]);
  expect(fixture.evaluations()).toHaveLength(0);
});

test('390像素的字符串指标、四格提示和表格内部横滚清晰且无整页溢出或脚本错误', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /content security|content-security|refused to|worker/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto(`/academics/modules/${moduleId}`);
  await expectFields(page, baseline);
  const inputBoxes = [];
  for (const [key] of fields) inputBoxes.push((await field(page, key).boundingBox())!);
  for (let index = 1; index < inputBoxes.length; index++)
    expect(inputBoxes[index].y).toBeGreaterThan(inputBoxes[index - 1].y + inputBoxes[index - 1].height);
  await loadExample(page, '罕见正类全部预测负类');
  await run(page);
  await expectMetrics(page, [99, '未定义', 0, 100, 0, 50]);
  for (const [index, value] of [0, 0, 1, 99].entries()) await tooltip(page, index, value);
  for (const title of [matrixTitle, formulaTitle]) {
    const region = table(page, title);
    await expect
      .poll(() => region.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
    await region.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    expect(await region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  }
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    .toBe(true);
  await capture(page, 'mobile');
  expect(errors).toEqual([]);
});
