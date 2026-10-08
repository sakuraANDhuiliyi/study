// Mock transport uses the real module and calculator. Display expectations below
// are independent classroom arithmetic, not a duplicate implementation of it.
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { scienceModules } from '../../apps/api/src/academics/academics.modules-science';
import { evaluateAcademicModule, publicAcademicModule } from '../../apps/api/src/academics/academics.engine';
import type { LearningRecord, LearningResult } from '../../apps/web/src/components/academics/types';

test.use({ actionTimeout: 15000 });
const moduleId = 'simpson-paradox';
const module = () => scienceModules.find((item) => item.id === moduleId)!;
const stamp = '2026-10-09T08:00:00Z';
const fields = [
  ['aSuccess1', '分层1 · A 达成数'],
  ['aTotal1', '分层1 · A 总数'],
  ['bSuccess1', '分层1 · B 达成数'],
  ['bTotal1', '分层1 · B 总数'],
  ['aSuccess2', '分层2 · A 达成数'],
  ['aTotal2', '分层2 · A 总数'],
  ['bSuccess2', '分层2 · B 达成数'],
  ['bTotal2', '分层2 · B 总数'],
] as const;
const baseline = {
  aSuccess1: 9,
  aTotal1: 10,
  bSuccess1: 80,
  bTotal1: 100,
  aSuccess2: 20,
  aTotal2: 100,
  bSuccess2: 1,
  bTotal2: 10,
};
const categories = ['分层1', '分层2', '原始汇总', '共同权重'];
const graphLabel =
  '分层与汇总达成比例，分组柱状图；类别：分层1、分层2、原始汇总、共同权重；系列：方案A、方案B；纵轴：达成比例（%）';
const graph = (page: Page) => page.getByRole('img', { name: graphLabel, exact: true });
const table = (page: Page, title: string) =>
  page.getByRole('region', { name: `${title}，可横向滚动`, exact: true });
const field = (page: Page, key: (typeof fields)[number][0]) =>
  page.getByRole('spinbutton', { name: fields.find(([id]) => id === key)![1], exact: true });
const makeRecord = (
  id: string,
  values: Record<string, unknown>,
  result: LearningResult,
  idOfModule = moduleId,
): LearningRecord => ({
  id,
  moduleId: idOfModule,
  title: id,
  values: structuredClone(values),
  result: structuredClone(result),
  status: 'COMPLETED',
  revision: 0,
  notes: '',
  createdAt: stamp,
  updatedAt: stamp,
});

async function setup(page: Page, initial: LearningRecord[] = []) {
  const records = structuredClone(initial);
  const requests: { path: string; method: string; body: any }[] = [];
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
          id: 'simpson-student',
          name: '比例实验同学',
          username: 'simpson-fixture',
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['learning.use'],
          organizationId: 'simpson-personal',
          accountMode: 'PERSONAL',
          majorId: null,
          major: null,
        },
        csrfToken: 'simpson-fixture-token',
      });
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/academics/catalog')
      return json(route, { subjects: [], majors: [], modules: scienceModules.map(publicAcademicModule) });
    const match = /^\/api\/academics\/modules\/([^/]+)(\/evaluate)?$/.exec(path);
    if (match) {
      const definition = scienceModules.find((item) => item.id === match[1]);
      if (!definition) return json(route, { message: '模块不存在' }, 404);
      if (!match[2]) return json(route, publicAcademicModule(definition));
      try {
        const output = await evaluateAcademicModule(definition, body.values);
        const record = makeRecord(`实验记录 ${records.length + 1}`, body.values, output, definition.id);
        records.unshift(record);
        return json(route, { record, result: record.result }, 201);
      } catch (error) {
        return json(route, { message: (error as Error).message }, 400);
      }
    }
    if (path === '/api/academics/records') {
      const found = records.filter(
        (item) => !url.searchParams.get('moduleId') || item.moduleId === url.searchParams.get('moduleId'),
      );
      const currentPage = Number(url.searchParams.get('page') || 1),
        pageSize = Number(url.searchParams.get('pageSize') || 6);
      return json(route, {
        items: found.slice((currentPage - 1) * pageSize, currentPage * pageSize),
        total: found.length,
        page: currentPage,
        pageSize,
      });
    }
    if (path.startsWith('/api/academics/records/')) {
      const found = records.find((item) => item.id === decodeURIComponent(path.split('/').at(-1)!));
      if (!found) return json(route, { message: '学习记录不存在' }, 404);
      if (request.method() === 'PATCH') Object.assign(found, body, { revision: found.revision + 1 });
      return json(route, found);
    }
    return json(route, { items: [] });
  });
  return { records, requests, evaluations: () => requests.filter((item) => item.path.endsWith('/evaluate')) };
}

async function practice(page: Page) {
  await page.getByRole('tab', { name: '动手练习', exact: true }).click();
}
async function run(page: Page) {
  await page.getByRole('button', { name: '运行并保存结果', exact: true }).click();
}
async function loadExample(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeHidden();
}
async function expectFields(page: Page, values: Record<string, unknown>) {
  for (const [key] of fields) await expect(field(page, key)).toHaveValue(String(values[key]));
}
async function fillFields(page: Page, values: Record<string, number>) {
  for (const [key] of fields) await field(page, key).fill(String(values[key]));
}
async function expectRow(page: Page, title: string, index: number, expected: (string | number)[]) {
  const cells = table(page, title)
    .getByRole('row')
    .nth(index + 1)
    .getByRole('cell');
  await expect(cells).toHaveCount(expected.length);
  for (const [column, value] of expected.entries()) {
    if (typeof value === 'string') await expect(cells.nth(column)).toHaveText(value);
    else expect(Number(await cells.nth(column).innerText())).toBeCloseTo(value, 8);
  }
}
async function classification(page: Page, text: string) {
  const metric = page
    .locator('.academic-metrics > div')
    .filter({ has: page.getByText('比较分类', { exact: true }) });
  await expect(metric.locator('strong')).toHaveText(text);
}
async function tooltip(page: Page, index: number, a: number, b: number) {
  const plot = graph(page);
  await plot.scrollIntoViewIfNeeded();
  await expect(plot.locator('canvas')).toBeVisible();
  const box = await plot.boundingBox();
  if (!box) throw new Error('比例分组图不可见');
  await plot.hover({ position: { x: 45 + ((box.width - 61) * (index + 0.5)) / 4, y: 150 } });
  const hint = page.locator('.academic-category-tooltip');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(categories[index]);
  const text = await hint.innerText();
  const numbers = new RegExp(
    `^${categories[index]}\\s*方案A\\s*([\\d.eE+-]+)\\s*方案B\\s*([\\d.eE+-]+)$`,
  ).exec(text.trim());
  expect(numbers, `完整图例提示：${text}`).not.toBeNull();
  expect(Number(numbers![1])).toBeCloseTo(a, 8);
  expect(Number(numbers![2])).toBeCloseTo(b, 8);
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
  await mkdir('test-results/simpson-paradox', { recursive: true });
  await page.screenshot({ path: `test-results/simpson-paradox/${name}.png`, animations: 'disabled' });
}

test('八个整数计数字段提交完整分母，三表与八个图中比例呈现严格反转', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  await expect(page.getByRole('heading', { name: '分层与汇总比例：辛普森反转', exact: true })).toBeVisible();
  await expectFields(page, baseline);
  for (const [key] of fields) {
    await expect(field(page, key)).toHaveAttribute('step', '1');
    await expect(field(page, key)).toHaveAttribute('aria-valuemin', key.includes('Total') ? '1' : '0');
    await expect(field(page, key)).toHaveAttribute('aria-valuemax', '1000000');
  }
  await field(page, 'aTotal1').press('ArrowUp');
  await expect(field(page, 'aTotal1')).toHaveValue('11');
  await field(page, 'aTotal1').press('ArrowDown');
  await run(page);
  await classification(page, '严格反转');
  await expectRow(page, '分层原始数据', 0, ['分层1', 9, 10, 80, 100, 90, 80, 1 / 11, 10 / 11, 10]);
  await expectRow(page, '分层原始数据', 1, ['分层2', 20, 100, 1, 10, 20, 10, 10 / 11, 1 / 11, 10]);
  await expectRow(page, '共同权重与贡献', 0, ['分层1', 10, 100, 110, 0.5, 45, 40]);
  await expectRow(page, '共同权重与贡献', 1, ['分层2', 100, 10, 110, 0.5, 10, 5]);
  const pairs = [
    [90, 80],
    [20, 10],
    [290 / 11, 810 / 11],
    [55, 45],
  ];
  for (const [index, [a, b]] of pairs.entries()) {
    await expectRow(page, '四种口径比较', index, [
      categories[index],
      a,
      b,
      a - b,
      index === 2 ? '方案B较高' : '方案A较高',
    ]);
    await tooltip(page, index, a, b);
  }
  await expect(page.locator('.academic-result')).toContainText('不是新增观察人数');
  await expect(page.locator('.academic-result')).toContainText('不判断因果、不做显著性检验');
  expect(fixture.records[0].values).toEqual(baseline);
  expect(fixture.records[0].status).toBe('COMPLETED');
  await capture(page, 'desktop');
});

test('六个原创示例覆盖确认取消、交换、非等权、持平和混向，不偷换为简单平均', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  await field(page, 'aSuccess1').fill('7');
  await page.getByRole('button', { name: '分层同向却汇总反转', exact: true }).click();
  await page
    .getByRole('tooltip')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(field(page, 'aSuccess1')).toHaveValue('7');
  expect(fixture.evaluations()).toHaveLength(0);
  const titles = [
    '分层同向却汇总反转',
    '交换两个方案',
    '共同权重并非各半',
    '相同样本构成',
    '各层与汇总都持平',
    '分层方向不同',
  ];
  expect(module().examples.map((item) => item.title)).toEqual(titles);
  const classes = ['严格反转', '严格反转', '严格反转', '方向一致', '分层持平', '分层混向'];
  for (const [index, example] of module().examples.entries()) {
    if (index) await practice(page);
    await loadExample(page, example.title);
    await expectFields(page, example.values);
    expect(fixture.evaluations()).toHaveLength(index);
    await run(page);
    await classification(page, classes[index]);
    expect(fixture.records[0].values).toEqual(example.values);
    if (index === 1) await expectRow(page, '四种口径比较', 3, ['共同权重', 45, 55, -10, '方案B较高']);
    if (index === 2) {
      await expectRow(page, '共同权重与贡献', 0, ['分层1', 10, 200, 210, 21 / 32, 59.0625, 52.5]);
      await expectRow(page, '共同权重与贡献', 1, ['分层2', 100, 10, 110, 11 / 32, 6.875, 3.4375]);
      await expectRow(page, '四种口径比较', 3, ['共同权重', 65.9375, 55.9375, 10, '方案A较高']);
      await tooltip(page, 3, 65.9375, 55.9375);
    }
  }
  expect(fixture.records).toHaveLength(6);
});

test('超出总数和非整数错误保留原输入，不写记录，修正后可重试', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  // InputNumber clamps totals to its min=1 on blur/Enter. Zero-total rejection
  // belongs to HTTP tests; use a genuine cross-field error in the browser.
  await field(page, 'bSuccess2').fill('11');
  await run(page);
  await expect(page.getByText('分层2的达成数不能超过对应总数', { exact: true })).toBeVisible();
  await expect(field(page, 'bSuccess2')).toHaveValue('11');
  expect(fixture.evaluations().at(-1)!.body.values).toEqual({ ...baseline, bSuccess2: 11 });
  expect(fixture.records).toHaveLength(0);
  await page.reload();
  await expect(field(page, 'bSuccess2')).toHaveValue('11');
  await field(page, 'bSuccess2').fill('1.5');
  await run(page);
  await expect(page.getByText(/bSuccess2.*整数/)).toBeVisible();
  await expect(field(page, 'bSuccess2')).toHaveValue('1.5');
  expect(fixture.records).toHaveLength(0);
  await loadExample(page, '分层同向却汇总反转');
  await run(page);
  await classification(page, '严格反转');
  expect(fixture.records).toHaveLength(1);
});

test('微小精确差值不会被展示舍入变成持平，零和百分之百保留原值', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  const tiny = {
    aSuccess1: 999998,
    aTotal1: 999999,
    bSuccess1: 999999,
    bTotal1: 1000000,
    aSuccess2: 999998,
    aTotal2: 999999,
    bSuccess2: 999999,
    bTotal2: 1000000,
  };
  await fillFields(page, tiny);
  await run(page);
  await classification(page, '方向一致');
  const cells = table(page, '四种口径比较').getByRole('row').nth(1).getByRole('cell');
  // Adjacent rational numbers round to the same displayed percentage; the
  // unrounded difference is -100/(999999*1000000), never zero.
  await expect(cells.nth(1)).toHaveText('99.9999');
  await expect(cells.nth(2)).toHaveText('99.9999');
  const difference = Number(await cells.nth(3).innerText());
  expect(difference).toBeLessThan(0);
  expect(Math.abs(difference / (-100 / (999999 * 1000000)) - 1)).toBeLessThan(1e-9);
  await expect(cells.nth(4)).toHaveText('方案B较高');
  await expect(page.locator('.academic-result')).toContainText('两个显示比例可能相同');
  await practice(page);
  const endpoints = {
    aSuccess1: 0,
    aTotal1: 10,
    bSuccess1: 10,
    bTotal1: 10,
    aSuccess2: 0,
    aTotal2: 10,
    bSuccess2: 10,
    bTotal2: 10,
  };
  await fillFields(page, endpoints);
  await run(page);
  for (let index = 0; index < 4; index++) await tooltip(page, index, 0, 100);
  expect(fixture.records[0].values).toEqual(endpoints);
});

test('笔记与图表保存历史快照，清本机数据后仍可读取，恢复八字段需确认且不重算', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/academics/modules/${moduleId}`);
  await run(page);
  await classification(page, '严格反转');
  const first = structuredClone(fixture.records[0]);
  const note = '原始汇总权重来自各自样本构成；共同权重各为 1/2。标准化 55% 与 45% 不是新增观察人数。';
  await page.getByRole('textbox', { name: '学习记录笔记', exact: true }).fill(note);
  await page.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
  await expect.poll(() => fixture.records[0].revision).toBe(1);
  await practice(page);
  await loadExample(page, '共同权重并非各半');
  await run(page);
  await tooltip(page, 3, 65.9375, 55.9375);
  expect(fixture.records[1].result).toEqual(first.result);
  expect(fixture.records[1].values).toEqual(baseline);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await viewRecord(page, first.title);
  await expect(page.getByRole('textbox', { name: '学习记录笔记', exact: true })).toHaveValue(note);
  await tooltip(page, 3, 55, 45);
  expect(fixture.evaluations()).toHaveLength(2);
  await practice(page);
  await field(page, 'aSuccess1').fill('7');
  await page.getByRole('tab', { name: /学习记录 ·/ }).click();
  const secondCard = page
    .locator('.academic-history article')
    .filter({ has: page.getByRole('heading', { name: '实验记录 2', exact: true }) });
  await secondCard.getByRole('button', { name: '恢复输入', exact: true }).click();
  await page
    .getByRole('tooltip')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await practice(page);
  await expect(field(page, 'aSuccess1')).toHaveValue('7');
  await page.getByRole('tab', { name: /学习记录 ·/ }).click();
  await secondCard.getByRole('button', { name: '恢复输入', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '恢复输入', exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expectFields(page, module().examples.find((item) => item.title === '共同权重并非各半')!.values);
  expect(fixture.evaluations()).toHaveLength(2);
  expect(fixture.records[1].notes).toBe(note);
});

test('新增四分类结果不影响已保存的群体遗传分类图、旧数值折线和仅表格记录', async ({ page }) => {
  const population = scienceModules.find((item) => item.id === 'population-genetics')!;
  const calculus = scienceModules.find((item) => item.id === 'calculus-lab')!;
  const populationResult = await evaluateAcademicModule(population, { countAA: 0, countAa: 1, countaa: 0 });
  const lineResult = await evaluateAcademicModule(calculus, calculus.defaultValues);
  const noChart = await evaluateAcademicModule(module(), baseline);
  delete noChart.categoryChart;
  const fixture = await setup(page, [
    makeRecord('已有群体遗传记录', { countAA: 0, countAa: 1, countaa: 0 }, populationResult, population.id),
    makeRecord('已有连续数值记录', calculus.defaultValues, lineResult, calculus.id),
    makeRecord('仅表格实验快照', baseline, noChart),
  ]);
  await page.goto(`/academics/modules/${population.id}`);
  await viewRecord(page, '已有群体遗传记录');
  await expect(
    page.getByRole('img', { name: /^观察计数与模型期望计数，分组柱状图/ }).locator('canvas'),
  ).toBeVisible();
  await expect(table(page, '观察与模型期望').getByRole('row').nth(1).getByRole('cell').nth(3)).toHaveText(
    '0.25',
  );
  await page.goto(`/academics/modules/${calculus.id}`);
  await viewRecord(page, '已有连续数值记录');
  await expect(page.getByRole('img', { name: '统计图', exact: true }).locator('canvas')).toBeVisible();
  await expect(page.locator('.academic-category-chart')).toHaveCount(0);
  await page.goto(`/academics/modules/${moduleId}`);
  await viewRecord(page, '仅表格实验快照');
  await expect(table(page, '四种口径比较').getByRole('row')).toHaveCount(5);
  await expect(page.locator('.academic-result canvas')).toHaveCount(0);
  await expect(page.getByText('分类图表无法绘制', { exact: true })).toHaveCount(0);
  expect(fixture.evaluations()).toHaveLength(0);
});

test('390像素页面四类八值图例可读，宽表内部滚动，无整页溢出与脚本策略错误', async ({ page }) => {
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
  await loadExample(page, '共同权重并非各半');
  await run(page);
  const pairs = [
    [90, 80],
    [20, 10],
    [290 / 11, 1610 / 21],
    [65.9375, 55.9375],
  ];
  for (const [index, [a, b]] of pairs.entries()) await tooltip(page, index, a, b);
  for (const title of ['分层原始数据', '共同权重与贡献', '四种口径比较']) {
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
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
    .toBe(true);
  await capture(page, 'mobile');
  expect(errors).toEqual([]);
});
