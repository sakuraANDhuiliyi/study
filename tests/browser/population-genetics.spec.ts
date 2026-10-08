// Browser contracts use the real teaching catalog and fixed, independently
// checked result examples. Engine mathematics and persistence have separate tests.
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { scienceModules } from '../../apps/api/src/academics/academics.modules-science';
import type { LearningRecord, LearningResult } from '../../apps/web/src/components/academics/types';

test.use({ actionTimeout: 15000 });
const module = scienceModules.find((item) => item.id === 'population-genetics')!;
const stamp = '2026-10-09T08:00:00Z';
const defaultValues = { countAA: 36, countAa: 48, countaa: 16 };
const chartTitle = '观察计数与模型期望计数';
const columns = [
  ['genotype', '基因型'],
  ['observedCount', '观察计数'],
  ['observedFrequency', '观察频率'],
  ['expectedCount', '模型期望计数'],
  ['expectedFrequency', '模型期望频率'],
  ['countDifference', '计数差（观察−期望）'],
  ['frequencyDifference', '频率差（观察−期望）'],
].map(([key, title]) => ({ key, title }));
const baseline: LearningResult = {
  summary: '已根据观察计数计算等位基因频率及模型期望；数值吻合不构成统计检验。',
  metrics: [
    { label: '个体总数 N', value: 100 },
    { label: 'A 等位基因数', value: 120 },
    { label: 'a 等位基因数', value: 80 },
    { label: 'A 频率 p', value: 0.6 },
    { label: 'a 频率 q', value: 0.4 },
  ],
  sections: [{ title: '模型条件', content: '期望值是模型下的对照，不是观测结果或个体预测。' }],
  tables: [
    {
      title: '观察与模型期望',
      columns,
      rows: [
        {
          genotype: 'AA',
          observedCount: 36,
          observedFrequency: 0.36,
          expectedCount: 36,
          expectedFrequency: 0.36,
          countDifference: 0,
          frequencyDifference: 0,
        },
        {
          genotype: 'Aa',
          observedCount: 48,
          observedFrequency: 0.48,
          expectedCount: 48,
          expectedFrequency: 0.48,
          countDifference: 0,
          frequencyDifference: 0,
        },
        {
          genotype: 'aa',
          observedCount: 16,
          observedFrequency: 0.16,
          expectedCount: 16,
          expectedFrequency: 0.16,
          countDifference: 0,
          frequencyDifference: 0,
        },
      ],
    },
  ],
  categoryChart: {
    title: chartTitle,
    categories: ['AA', 'Aa', 'aa'],
    yAxisLabel: '个体数',
    series: [
      { name: '观察计数', values: [36, 48, 16] },
      { name: '模型期望计数', values: [36, 48, 16] },
    ],
  },
};
const singleton: LearningResult = {
  ...baseline,
  summary: '一个杂合个体的模型期望计数为 0.25、0.5、0.25，可为小数。',
  metrics: [
    { label: '个体总数 N', value: 1 },
    { label: 'A 频率 p', value: 0.5 },
    { label: 'a 频率 q', value: 0.5 },
  ],
  tables: [
    {
      title: '观察与模型期望',
      columns,
      rows: [
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
      ],
    },
  ],
  categoryChart: {
    title: chartTitle,
    categories: ['AA', 'Aa', 'aa'],
    yAxisLabel: '个体数',
    series: [
      { name: '观察计数', values: [0, 1, 0] },
      { name: '模型期望计数', values: [0.25, 0.5, 0.25] },
    ],
  },
};
const makeRecord = (
  id: string,
  result = baseline,
  values: Record<string, unknown> = defaultValues,
): LearningRecord => ({
  id,
  moduleId: 'population-genetics',
  title: id,
  result: structuredClone(result),
  values,
  status: 'COMPLETED',
  revision: 0,
  notes: '',
  createdAt: stamp,
  updatedAt: stamp,
});
async function setup(page: Page, initial: LearningRecord[] = []) {
  const records = structuredClone(initial);
  const requests: { path: string; method: string; body: any }[] = [];
  let output = structuredClone(baseline);
  let failure: string | null = null;
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.method() === 'GET' ? undefined : request.postDataJSON();
    requests.push({ path: path + url.search, method: request.method(), body });
    if (path === '/api/auth/me')
      return json(route, {
        user: {
          id: 'population-student',
          name: '群体遗传学习同学',
          username: 'population-fixture',
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['learning.use'],
          organizationId: 'population-personal',
          accountMode: 'PERSONAL',
          majorId: null,
          major: null,
        },
        csrfToken: 'population-fixture-token',
      });
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/academics/catalog')
      return json(route, { subjects: [], majors: [], modules: [module] });
    if (path === '/api/academics/modules/population-genetics') return json(route, module);
    if (path === '/api/academics/modules/population-genetics/evaluate') {
      if (failure) return json(route, { message: failure }, 400);
      const record = makeRecord(`练习记录 ${records.length + 1}`, output, body.values);
      records.unshift(record);
      return json(route, { record, result: record.result }, 201);
    }
    if (path === '/api/academics/records')
      return json(route, { items: records, total: records.length, page: 1, pageSize: 6 });
    if (path.startsWith('/api/academics/records/')) {
      const found = records.find(
        (item) => path.endsWith('/' + encodeURIComponent(item.id)) || path.endsWith('/' + item.id),
      );
      if (!found) return json(route, { message: '学习记录不存在' }, 404);
      if (request.method() === 'PATCH') Object.assign(found, body, { revision: found.revision + 1 });
      return json(route, found);
    }
    return json(route, { items: [] });
  });
  return {
    records,
    requests,
    output: (value: LearningResult) => {
      output = value;
    },
    fail: (message: string | null) => {
      failure = message;
    },
  };
}
const field = (page: Page, genotype: string) =>
  page.getByRole('spinbutton', { name: `${genotype} 观察计数`, exact: true });
const graph = (page: Page) => page.getByRole('img', { name: /^观察计数与模型期望计数，分组柱状图/ });
const table = (page: Page) => page.getByRole('region', { name: '观察与模型期望，可横向滚动', exact: true });
async function run(page: Page) {
  await page.getByRole('button', { name: '运行并保存结果', exact: true }).click();
}
async function practice(page: Page) {
  await page.getByRole('tab', { name: '动手练习', exact: true }).click();
}
async function loadExample(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeHidden();
}
async function checkTooltip(
  page: Page,
  categoryIndex: number,
  category: string,
  observed: number,
  expected: number,
) {
  const plot = graph(page);
  await plot.scrollIntoViewIfNeeded();
  await expect(plot.locator('canvas')).toBeVisible();
  const box = await plot.boundingBox();
  if (!box) throw new Error('分类图不可见');
  await plot.hover({ position: { x: 45 + ((box.width - 61) * (categoryIndex + 0.5)) / 3, y: 150 } });
  const tooltip = page.locator('.academic-category-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(
    new RegExp(
      `^${category}\\s*观察计数\\s*${String(observed).replace('.', '\\.')}\\s*模型期望计数\\s*${String(expected).replace('.', '\\.')}$`,
    ),
  );
}
async function viewRecord(page: Page, name: string) {
  await page.getByRole('tab', { name: /学习记录 ·/ }).click();
  const card = page
    .locator('.academic-history article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await card.getByRole('button', { name: '查看结果与笔记', exact: true }).click();
}
async function capture(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await expect(page.locator('.academic-category-tooltip')).toBeHidden();
  await expect(page.getByText('练习结果已保存', { exact: true })).toBeHidden();
  await graph(page).scrollIntoViewIfNeeded();
  await mkdir('test-results/population-genetics', { recursive: true });
  await page.screenshot({ path: `test-results/population-genetics/${name}.png`, animations: 'disabled' });
}

test('默认真实教学模块使用整数步长，完整结果表与三类六根柱的值一致', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/population-genetics');
  for (const [genotype, value] of [
    ['AA', '36'],
    ['Aa', '48'],
    ['aa', '16'],
  ]) {
    await expect(field(page, genotype)).toHaveValue(value);
    await expect(field(page, genotype)).toHaveAttribute('step', '1');
    await expect(field(page, genotype)).toHaveAttribute('aria-valuemin', '0');
    await expect(field(page, genotype)).toHaveAttribute('aria-valuemax', '1000000');
  }
  await field(page, 'AA').press('ArrowUp');
  await expect(field(page, 'AA')).toHaveValue('37');
  await field(page, 'AA').press('ArrowDown');
  await run(page);
  await expect(table(page).getByRole('row')).toHaveCount(4);
  for (const [index, expected] of [
    ['AA', '36', '0.36', '36', '0.36', '0', '0'],
    ['Aa', '48', '0.48', '48', '0.48', '0', '0'],
    ['aa', '16', '0.16', '16', '0.16', '0', '0'],
  ].entries())
    await expect(
      table(page)
        .getByRole('row')
        .nth(index + 1)
        .getByRole('cell'),
    ).toHaveText(expected);
  await expect(graph(page)).toHaveAttribute(
    'aria-label',
    `${chartTitle}，分组柱状图；类别：AA、Aa、aa；系列：观察计数、模型期望计数；纵轴：个体数`,
  );
  for (const [index, value] of [36, 48, 16].entries())
    await checkTooltip(page, index, ['AA', 'Aa', 'aa'][index], value, value);
  expect(fixture.records[0].values).toEqual(defaultValues);
  expect(fixture.records[0].status).toBe('COMPLETED');
  await capture(page, 'desktop');
});

test('六组原创示例载入需确认，单杂合个体保留零值与非整数模型期望', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/population-genetics');
  await field(page, 'AA').fill('17');
  await page.getByRole('button', { name: '比例吻合的课堂样本', exact: true }).click();
  await page
    .getByRole('tooltip')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(field(page, 'AA')).toHaveValue('17');
  expect(module.examples.map((item) => item.title)).toEqual([
    '比例吻合的课堂样本',
    '两类纯合个体',
    '一个杂合个体',
    '仅有 A 等位基因',
    '仅有 a 等位基因',
    '稀少的 a 等位基因',
  ]);
  for (const example of module.examples) {
    await loadExample(page, example.title);
    for (const [genotype, key] of [
      ['AA', 'countAA'],
      ['Aa', 'countAa'],
      ['aa', 'countaa'],
    ])
      await expect(field(page, genotype)).toHaveValue(String(example.values[key]));
  }
  expect(fixture.requests.filter((item) => item.method === 'POST')).toHaveLength(0);
  await loadExample(page, '一个杂合个体');
  fixture.output(singleton);
  await run(page);
  await expect(table(page).getByRole('row').nth(1).getByRole('cell')).toHaveText([
    'AA',
    '0',
    '0',
    '0.25',
    '0.25',
    '-0.25',
    '-0.25',
  ]);
  await checkTooltip(page, 0, 'AA', 0, 0.25);
  await checkTooltip(page, 1, 'Aa', 1, 0.5);
  await checkTooltip(page, 2, 'aa', 0, 0.25);
  expect(fixture.records[0].values).toEqual({ countAA: 0, countAa: 1, countaa: 0 });
});

test('稀少等位基因的微小期望以科学记数法保留，表格和提示不显示为零', async ({ page }) => {
  const fixture = await setup(page);
  fixture.output({
    summary: '稀有等位基因的模型期望显示测试。',
    metrics: [{ label: 'a 频率 q', value: 5e-7 }],
    sections: [],
    tables: [
      {
        title: '观察与模型期望',
        columns,
        rows: [
          {
            genotype: 'AA',
            observedCount: 999999,
            observedFrequency: 0.999999,
            expectedCount: 999999.00000025,
            expectedFrequency: 0.99999900000025,
            countDifference: -2.5e-7,
            frequencyDifference: -2.5e-13,
          },
          {
            genotype: 'Aa',
            observedCount: 1,
            observedFrequency: 1e-6,
            expectedCount: 0.9999995,
            expectedFrequency: 9.999995e-7,
            countDifference: 5e-7,
            frequencyDifference: 5e-13,
          },
          {
            genotype: 'aa',
            observedCount: 0,
            observedFrequency: 0,
            expectedCount: 2.5e-7,
            expectedFrequency: 2.5e-13,
            countDifference: -2.5e-7,
            frequencyDifference: -2.5e-13,
          },
        ],
      },
    ],
    categoryChart: {
      title: chartTitle,
      categories: ['AA', 'Aa', 'aa'],
      yAxisLabel: '个体数',
      series: [
        { name: '观察计数', values: [999999, 1, 0] },
        { name: '模型期望计数', values: [999999.00000025, 0.9999995, 2.5e-7] },
      ],
    },
  });
  await page.goto('/academics/modules/population-genetics');
  await loadExample(page, '稀少的 a 等位基因');
  await run(page);
  await expect(table(page).getByRole('row').nth(3).getByRole('cell')).toHaveText([
    'aa',
    '0',
    '0',
    '2.5e-7',
    '2.5e-13',
    '-2.5e-7',
    '-2.5e-13',
  ]);
  await checkTooltip(page, 2, 'aa', 0, 2.5e-7);
  expect(fixture.records[0].values).toEqual({ countAA: 999999, countAa: 1, countaa: 0 });
});

test('非法小数与零总数错误保留输入、不新增记录，修正后正常保存', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/population-genetics');
  await field(page, 'AA').fill('1.5');
  fixture.fail('AA 观察计数必须为整数');
  await run(page);
  await expect(page.getByText('AA 观察计数必须为整数', { exact: true })).toBeVisible();
  await expect(field(page, 'AA')).toHaveValue('1.5');
  expect(fixture.records).toHaveLength(0);
  await page.reload();
  await expect(field(page, 'AA')).toHaveValue('1.5');
  for (const genotype of ['AA', 'Aa', 'aa']) await field(page, genotype).fill('0');
  fixture.fail('观察个体总数必须大于0');
  await run(page);
  await expect(page.getByText('观察个体总数必须大于0', { exact: true })).toBeVisible();
  for (const genotype of ['AA', 'Aa', 'aa']) await expect(field(page, genotype)).toHaveValue('0');
  expect(fixture.records).toHaveLength(0);
  fixture.fail(null);
  await loadExample(page, '比例吻合的课堂样本');
  await run(page);
  await expect(graph(page).locator('canvas')).toBeVisible();
  expect(fixture.records).toHaveLength(1);
});

test('历史分类图与笔记原样保存，旧数值折线和无图记录兼容且不重算', async ({ page }) => {
  const withoutCategory = structuredClone(baseline);
  delete withoutCategory.categoryChart;
  const fixture = await setup(page, [
    makeRecord('分类图历史记录', singleton, { countAA: 0, countAa: 1, countaa: 0 }),
    makeRecord('旧数值折线记录', {
      ...withoutCategory,
      chart: {
        title: '旧版连续采样',
        points: [
          { x: 0, y: 0, label: '起点' },
          { x: 2, y: 4 },
        ],
      },
    }),
    makeRecord('旧无图记录', withoutCategory),
  ]);
  await page.goto('/academics/modules/population-genetics');
  await viewRecord(page, '分类图历史记录');
  await checkTooltip(page, 0, 'AA', 0, 0.25);
  await page
    .getByRole('textbox', { name: '学习记录笔记', exact: true })
    .fill('观察个体数为整数，模型期望可以是小数。');
  await page.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
  await expect.poll(() => fixture.records[0].revision).toBe(1);
  expect(fixture.records[0].result.categoryChart).toEqual(singleton.categoryChart);
  await page.reload();
  await viewRecord(page, '分类图历史记录');
  await expect(page.getByRole('textbox', { name: '学习记录笔记', exact: true })).toHaveValue(
    '观察个体数为整数，模型期望可以是小数。',
  );
  await checkTooltip(page, 1, 'Aa', 1, 0.5);
  await viewRecord(page, '旧数值折线记录');
  await expect(page.getByRole('heading', { name: '旧版连续采样', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '统计图', exact: true }).locator('canvas')).toBeVisible();
  await expect(graph(page)).toHaveCount(0);
  await viewRecord(page, '旧无图记录');
  await expect(table(page).getByRole('row')).toHaveCount(4);
  await expect(page.locator('.academic-result canvas')).toHaveCount(0);
  await expect(page.getByText('分类图表无法绘制', { exact: true })).toHaveCount(0);
  expect(fixture.requests.filter((item) => item.path.endsWith('/evaluate'))).toHaveLength(0);
});

test('畸形分类图保留完整表格并明确提示，切回有效结果可恢复绘图', async ({ page }) => {
  const fixture = await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/academics/modules/population-genetics');
  const malformed: unknown[] = [
    null,
    { ...baseline.categoryChart, categories: [] },
    { ...baseline.categoryChart, categories: ['AA', 'AA', 'aa'] },
    { ...baseline.categoryChart, series: [{ name: '观察计数', values: [36, 48] }] },
    { ...baseline.categoryChart, series: [{ name: '观察计数', values: [36, '48', 16] }] },
    { ...baseline.categoryChart, series: [{ name: '观察计数', values: [36, -48, 16] }] },
    { ...baseline.categoryChart, series: [null] },
  ];
  for (const value of malformed) {
    fixture.output({ ...baseline, categoryChart: value } as LearningResult);
    await run(page);
    await expect(page.getByText('分类图表无法绘制', { exact: true })).toBeVisible();
    await expect(table(page).getByRole('row')).toHaveCount(4);
    await expect(page.locator('.academic-result canvas')).toHaveCount(0);
    await practice(page);
  }
  fixture.output(baseline);
  await run(page);
  await checkTooltip(page, 1, 'Aa', 48, 48);
  await expect(page.getByText('分类图表无法绘制', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('同一结果可同时保留旧数值折线与分类图，互不替换', async ({ page }) => {
  const fixture = await setup(page);
  fixture.output({
    ...baseline,
    chart: {
      title: '保留的连续数值图',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  });
  await page.goto('/academics/modules/population-genetics');
  await run(page);
  await checkTooltip(page, 2, 'aa', 16, 16);
  await expect(page.getByRole('heading', { name: '保留的连续数值图', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '统计图', exact: true }).locator('canvas')).toBeVisible();
  await expect(page.locator('.academic-result canvas')).toHaveCount(2);
});

test('390px分组图可读、完整表内部滚动，无页面溢出或脚本安全错误', async ({ page }) => {
  await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security|violates.*policy|worker/i.test(message.text()))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/academics/modules/population-genetics');
  await expect(field(page, 'AA')).toBeVisible();
  await run(page);
  for (const [index, value] of [36, 48, 16].entries())
    await checkTooltip(page, index, ['AA', 'Aa', 'aa'][index], value, value);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    .toBe(true);
  expect(await table(page).evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await table(page).evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await table(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await capture(page, 'mobile');
  expect(errors).toEqual([]);
});
