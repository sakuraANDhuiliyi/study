// UI contract tests use the actual teaching catalog with controlled server
// results. Boolean parsing/equivalence correctness is covered by engine and
// real HTTP tests, not by this mock API.
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { engineeringModules } from '../../apps/api/src/academics/academics.modules-engineering';
import type { LearningRecord, LearningResult } from '../../apps/web/src/components/academics/types';

test.use({ actionTimeout: 15000 });
const module = engineeringModules.find((item) => item.id === 'digital-logic')!;
const stamp = '2026-10-09T08:00:00Z';
const draftKey = 'academic-draft:logic-personal:logic-student:digital-logic';
const assignments = (variables: string[]) =>
  Array.from({ length: 2 ** variables.length }, (_, mask) =>
    Object.fromEntries(variables.map((name, index) => [name, (mask >> (variables.length - index - 1)) & 1])),
  );
const single: LearningResult = {
  summary: '表达式通过专用布尔语法解析，无代码执行。',
  metrics: [
    { label: '输入变量', value: 3 },
    { label: '真值行数', value: 7 },
    { label: '假值行数', value: 1 },
  ],
  sections: [{ title: '表达式', content: '!(A && B) || C' }],
  tables: [
    {
      title: '真值表',
      columns: ['A', 'B', 'C'].map((key) => ({ key, title: key })).concat({ key: 'output', title: '输出' }),
      rows: assignments(['A', 'B', 'C']).map((input, index) => ({
        ...input,
        output: [1, 1, 1, 1, 1, 1, 0, 1][index],
      })),
    },
  ],
};
function comparison(
  variables: string[],
  output: number[],
  comparisonOutput: number[],
  expressions: [string, string],
): LearningResult {
  const rows = assignments(variables).map((input, index) => ({
    ...input,
    output: output[index],
    comparisonOutput: comparisonOutput[index],
    matches: output[index] === comparisonOutput[index] ? '一致' : '不同',
  }));
  const differences = rows.filter((row) => row.matches === '不同');
  const first = differences[0];
  const columns = variables
    .map((key) => ({ key, title: key }))
    .concat([
      { key: 'output', title: '原表达式输出' },
      { key: 'comparisonOutput', title: '对照表达式输出' },
      { key: 'matches', title: '结果比较' },
    ]);
  return {
    summary: `${differences.length ? '逻辑不等价' : '逻辑等价'}：检查 ${rows.length} 种输入组合，差异 ${differences.length} 种。`,
    metrics: [
      { label: '输入变量', value: variables.length },
      { label: '检查组合数', value: rows.length },
      { label: '一致组合数', value: rows.length - differences.length },
      { label: '差异组合数', value: differences.length },
    ],
    sections: [
      { title: '原表达式', content: expressions[0] },
      { title: '对照表达式', content: expressions[1] },
      {
        title: '等价判断',
        content: differences.length ? '存在输出不同的输入赋值。' : '全部输入组合的输出一致。',
        status: differences.length ? 'warning' : 'success',
      },
      ...(first
        ? [
            {
              title: '首个反例',
              content: `当 ${variables.map((name) => `${name}=${first[name]}`).join('、')} 时，原表达式输出 ${first.output}，对照表达式输出 ${first.comparisonOutput}。`,
              status: 'warning' as const,
            },
          ]
        : []),
    ],
    tables: [
      { title: '真值表', columns, rows },
      ...(differences.length ? [{ title: '全部反例', columns, rows: differences }] : []),
    ],
  };
}
const equivalent = () => comparison(['A', 'B'], [1, 1, 1, 0], [1, 1, 1, 0], ['!(A && B)', '!A || !B']);
const different = () => comparison(['A', 'B'], [1, 1, 1, 0], [1, 0, 0, 0], ['!(A && B)', '!A && !B']);
const record = (
  id: string,
  values: LearningRecord['values'],
  result: LearningResult,
  title = id,
): LearningRecord => ({
  id,
  moduleId: 'digital-logic',
  title,
  values,
  result,
  status: 'COMPLETED',
  revision: 0,
  notes: '',
  createdAt: stamp,
  updatedAt: stamp,
});

async function setup(page: Page, initial: LearningRecord[] = []) {
  const records = structuredClone(initial);
  const requests: { path: string; method: string; body: any }[] = [];
  let output = single;
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
          id: 'logic-student',
          name: '逻辑学习同学',
          username: 'logic-student',
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['learning.use'],
          organizationId: 'logic-personal',
          accountMode: 'PERSONAL',
          majorId: null,
          major: null,
        },
        csrfToken: 'logic-fixture-token',
      });
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/academics/catalog')
      return json(route, { subjects: [], majors: [], modules: [module] });
    if (path === '/api/academics/modules/digital-logic') return json(route, module);
    if (path === '/api/academics/modules/digital-logic/evaluate') {
      if (failure) return json(route, { message: failure }, 400);
      const created = record(
        `record-${records.length + 1}`,
        body.values,
        structuredClone(output),
        body.title || module.title,
      );
      records.unshift(created);
      return json(route, { record: created, result: created.result }, 201);
    }
    if (path === '/api/academics/records')
      return json(route, { items: records, total: records.length, page: 1, pageSize: 6 });
    if (path.startsWith('/api/academics/records/')) {
      const found = records.find((item) => path.endsWith('/' + item.id));
      if (!found) return json(route, { message: '学习记录不存在' }, 404);
      if (request.method() === 'PATCH') Object.assign(found, body, { revision: found.revision + 1 });
      return json(route, found);
    }
    return json(route, { items: [] });
  });
  return {
    records,
    requests,
    result: (next: LearningResult) => {
      output = next;
    },
    fail: (message: string | null) => {
      failure = message;
    },
  };
}
const original = (page: Page) => page.getByRole('textbox', { name: '逻辑表达式', exact: true });
const compared = (page: Page) => page.getByRole('textbox', { name: '对照表达式（可选）', exact: true });
const truth = (page: Page) => page.getByRole('region', { name: '真值表，可横向滚动', exact: true });
const counterexamples = (page: Page) =>
  page.getByRole('region', { name: '全部反例，可横向滚动', exact: true });
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

test('真实模块定义显示可选对照输入及200字符限制，默认单模式照常保存', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/digital-logic');
  await expect(original(page)).toHaveValue('!(A && B) || C');
  await expect(compared(page)).toHaveValue('');
  await expect(original(page)).toHaveAttribute('maxlength', '200');
  await expect(compared(page)).toHaveAttribute('maxlength', '200');
  await expect(
    page.getByText('留空只生成第一条表达式的真值表；填写后逐项验证两者是否等价。最多200字符。', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText('完整枚举与变量并集', { exact: true }).click();
  await expect(page.getByText(/最多4个变量、16种组合/)).toBeVisible();
  await run(page);
  await expect(truth(page).getByRole('row')).toHaveCount(9);
  await expect(truth(page).getByRole('columnheader', { name: '输出', exact: true })).toBeVisible();
  await expect(truth(page).getByRole('columnheader', { name: '对照表达式输出', exact: true })).toHaveCount(0);
  expect(fixture.records[0].values).toEqual({ expression: '!(A && B) || C', compareExpression: '' });
  expect(fixture.records[0].status).toBe('COMPLETED');
});

test('五组教学示例给出独立预期，载入需确认且起步示例清空对照栏', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/digital-logic');
  await original(page).fill('A ^ B');
  await compared(page).fill('A || B');
  await page.getByRole('button', { name: '起步单表达式', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('8种输入：7行输出1，1行输出0');
  await page
    .getByRole('tooltip')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(original(page)).toHaveValue('A ^ B');
  await expect(compared(page)).toHaveValue('A || B');
  const examples = [
    ['起步单表达式', '!(A && B) || C', '', '唯一的0出现在A=1、B=1、C=0'],
    ['德摩根律：等价', '!(A && B)', '!A || !B', '4种输入全部一致'],
    ['与或误写：找反例', '!(A && B)', '!A && !B', '首个反例是A=0、B=1'],
    ['吸收律：不同变量集合', 'A || (A && B)', 'A', '变量并集A、B检查4种输入'],
    ['优先级：括号改变逻辑', 'A || B && C', '(A || B) && C', '首个反例A=1、B=0、C=0'],
  ];
  for (const [title, expression, compareExpression, expected] of examples) {
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByRole('tooltip')).toContainText(expected);
    await page.getByRole('tooltip').getByRole('button', { name: '载入示例', exact: true }).click();
    await expect(page.getByRole('tooltip')).toBeHidden();
    await expect(original(page)).toHaveValue(expression);
    await expect(compared(page)).toHaveValue(compareExpression);
  }
  expect(fixture.requests.filter((item) => item.method === 'POST')).toHaveLength(0);
});

test('等价与不等价结果呈现实际真值行和全部反例，两者都可保存笔记', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/digital-logic');
  fixture.result(equivalent());
  await loadExample(page, '德摩根律：等价');
  await run(page);
  await expect(
    page.getByRole('heading', { name: '逻辑等价：检查 4 种输入组合，差异 0 种。', exact: true }),
  ).toBeVisible();
  await expect(truth(page).getByRole('row')).toHaveCount(5);
  await expect(counterexamples(page)).toHaveCount(0);
  await expect(truth(page).getByRole('cell', { name: '一致', exact: true })).toHaveCount(4);
  await practice(page);
  fixture.result(different());
  await loadExample(page, '与或误写：找反例');
  await run(page);
  await expect(
    page.getByRole('heading', { name: '逻辑不等价：检查 4 种输入组合，差异 2 种。', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('当 A=0、B=1 时，原表达式输出 1，对照表达式输出 0。', { exact: true }),
  ).toBeVisible();
  await expect(counterexamples(page).getByRole('row')).toHaveCount(3);
  await expect(counterexamples(page).getByRole('cell', { name: '不同', exact: true })).toHaveCount(2);
  expect(fixture.records).toHaveLength(2);
  expect(fixture.records.every((item) => item.status === 'COMPLETED')).toBe(true);
  await page
    .getByRole('textbox', { name: '学习记录笔记', exact: true })
    .fill('整体取反还要交换与、或，A=0 B=1是反例。');
  await page.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
  await expect.poll(() => fixture.records[0].notes).toContain('A=0 B=1是反例');
});

test('变量并集与括号优先级示例可运行，表格保留每一输入变量', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/digital-logic');
  fixture.result(comparison(['A', 'B'], [0, 0, 1, 1], [0, 0, 1, 1], ['A || (A && B)', 'A']));
  await loadExample(page, '吸收律：不同变量集合');
  await run(page);
  await expect(truth(page).getByRole('columnheader', { name: 'B', exact: true })).toBeVisible();
  await expect(truth(page).getByRole('row')).toHaveCount(5);
  expect(fixture.records[0].values).toEqual({ expression: 'A || (A && B)', compareExpression: 'A' });
  await practice(page);
  fixture.result(
    comparison(
      ['A', 'B', 'C'],
      [0, 0, 0, 1, 1, 1, 1, 1],
      [0, 0, 0, 1, 0, 1, 0, 1],
      ['A || B && C', '(A || B) && C'],
    ),
  );
  await loadExample(page, '优先级：括号改变逻辑');
  await run(page);
  await expect(truth(page).getByRole('row')).toHaveCount(9);
  await expect(
    page.getByText('当 A=1、B=0、C=0 时，原表达式输出 1，对照表达式输出 0。', { exact: true }),
  ).toBeVisible();
  await expect(counterexamples(page).getByRole('row')).toHaveCount(3);
});

test('旧草稿和旧记录缺少对照字段时清空，新记录及本机草稿恢复两条表达式', async ({ page }) => {
  const old = record(
    'old-record',
    { expression: 'A' },
    { ...single, summary: '旧版单表达式结果，按原样保留。' },
    '旧单表达式记录',
  );
  const newer = record(
    'new-record',
    { expression: '!(A && B)', compareExpression: '!A || !B' },
    equivalent(),
    '双表达式记录',
  );
  await setup(page, [old, newer]);
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('logic-draft-seeded')) {
      localStorage.setItem(key, JSON.stringify({ expression: 'A' }));
      sessionStorage.setItem('logic-draft-seeded', 'true');
    }
  }, draftKey);
  await page.goto('/academics/modules/digital-logic');
  await expect(original(page)).toHaveValue('A');
  await expect(compared(page)).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('已恢复本机草稿');
  await compared(page).fill('A && B');
  await page.getByRole('tab', { name: /学习记录 · 2/ }).click();
  const oldCard = page
    .locator('.academic-history article')
    .filter({ has: page.getByRole('heading', { name: '旧单表达式记录', exact: true }) });
  await oldCard.getByRole('button', { name: '查看结果与笔记', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '旧版单表达式结果，按原样保留。', exact: true }),
  ).toBeVisible();
  await expect(truth(page).getByRole('columnheader', { name: '对照表达式输出', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /学习记录 · 2/ }).click();
  await oldCard.getByRole('button', { name: '恢复输入', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '恢复输入', exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(original(page)).toHaveValue('A');
  await expect(compared(page)).toHaveValue('');
  await page.getByRole('tab', { name: /学习记录 · 2/ }).click();
  const newCard = page
    .locator('.academic-history article')
    .filter({ has: page.getByRole('heading', { name: '双表达式记录', exact: true }) });
  await newCard.getByRole('button', { name: '恢复输入', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '恢复输入', exact: true }).click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(original(page)).toHaveValue('!(A && B)');
  await expect(compared(page)).toHaveValue('!A || !B');
  await page.reload();
  await expect(original(page)).toHaveValue('!(A && B)');
  await expect(compared(page)).toHaveValue('!A || !B');
});

test('第二表达式错误保留输入不新增记录，修正后可保存，纯空白仍提交单模式', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/digital-logic');
  await original(page).fill('!(A && B)');
  await compared(page).fill('!A || (B');
  fixture.fail('对照表达式：括号不匹配');
  await run(page);
  await expect(page.getByText('对照表达式：括号不匹配', { exact: true })).toBeVisible();
  await expect(original(page)).toHaveValue('!(A && B)');
  await expect(compared(page)).toHaveValue('!A || (B');
  expect(fixture.records).toHaveLength(0);
  await page.reload();
  await expect(compared(page)).toHaveValue('!A || (B');
  fixture.fail(null);
  fixture.result(equivalent());
  await compared(page).fill('!A || !B');
  await run(page);
  await expect(truth(page).getByRole('row')).toHaveCount(5);
  expect(fixture.records).toHaveLength(1);
  await practice(page);
  await original(page).fill('!(A && B) || C');
  await compared(page).fill('   ');
  fixture.result(single);
  await run(page);
  await expect(truth(page).getByRole('row')).toHaveCount(9);
  await expect(truth(page).getByRole('columnheader', { name: '对照表达式输出', exact: true })).toHaveCount(0);
  expect(fixture.records[0].values.compareExpression).toBe('   ');
});

test('390px四变量16行真值表内部滚动，反例可读且无页面溢出或脚本错误', async ({ page }) => {
  const fixture = await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security|violates.*policy|worker/i.test(message.text()))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/academics/modules/digital-logic');
  await expect(compared(page)).toBeVisible();
  await original(page).fill('A && B && C && D');
  await compared(page).fill('A || B || C || D');
  fixture.result(
    comparison(
      ['A', 'B', 'C', 'D'],
      [...Array(15).fill(0), 1],
      [0, ...Array(15).fill(1)],
      ['A && B && C && D', 'A || B || C || D'],
    ),
  );
  await mkdir('test-results/digital-logic', { recursive: true });
  await page.screenshot({
    path: 'test-results/digital-logic/input-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await run(page);
  await expect(truth(page).getByRole('row')).toHaveCount(17);
  await expect(counterexamples(page).getByRole('row')).toHaveCount(15);
  await expect(
    page.getByText('当 A=0、B=0、C=0、D=1 时，原表达式输出 0，对照表达式输出 1。', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    .toBe(true);
  expect(await truth(page).evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await truth(page).evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await truth(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await truth(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/digital-logic/truth-mobile.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});
