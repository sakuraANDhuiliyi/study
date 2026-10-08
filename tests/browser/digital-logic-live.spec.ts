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
  'Live digital logic requires loopback web/API and a review database',
);
// Random account credentials never enter automatic screenshots or tracing artifacts.
test.use({ screenshot: 'off', trace: 'off', video: 'off', actionTimeout: 15000 });

const defaultExpression = '!(A && B) || C';
const legacyResult = {
  summary: '升级前保存的数字逻辑实验结果',
  metrics: [
    { label: '输入变量', value: 3 },
    { label: '真值行数', value: 7 },
    { label: '假值行数', value: 1 },
  ],
  sections: [{ title: '表达式', content: defaultExpression }],
  tables: [
    {
      title: '真值表',
      columns: ['A', 'B', 'C', 'output'].map((key) => ({ key, title: key === 'output' ? '输出' : key })),
      rows: Array.from({ length: 8 }, (_, mask) => {
        const A = (mask >> 2) & 1,
          B = (mask >> 1) & 1,
          C = mask & 1;
        return { A, B, C, output: Number(!(A && B) || C) };
      }),
    },
  ],
};
const nonEquivalentRows = [
  { A: 0, B: 0, output: 1, comparisonOutput: 1, matches: '一致' },
  { A: 0, B: 1, output: 1, comparisonOutput: 0, matches: '不同' },
  { A: 1, B: 0, output: 1, comparisonOutput: 0, matches: '不同' },
  { A: 1, B: 1, output: 0, comparisonOutput: 0, matches: '一致' },
];
async function layout(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), {
      message: '390px logic workspace must not overflow the full page',
    })
    .toBe(true);
}

test('数字逻辑真实工作台比较、历史恢复和完整反例导出', async ({ page }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const username = `logic_live_${suffix}`;
  const password = `Logic-${randomBytes(24).toString('base64url')}!`;
  const oldTitle = `升级前记录-${suffix}`;
  const comparedTitle = `全部反例-${suffix}`;
  const notes =
    '两种差异：A=0,B=1；A=1,B=0。\n```\n<script>window.__logicInjected=true</script>\n``````\n全部反例核对完毕。';
  let user: any;
  let csrf = '';
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
    (window as any).__logicInjected = false;
  });
  const expression = page.getByLabel('逻辑表达式', { exact: true });
  const comparison = page.getByLabel('对照表达式（可选）', { exact: true });
  const resultRegion = page.locator('.academic-result');
  const popconfirm = page.locator('.ant-popconfirm:visible');
  async function example(title: string) {
    await page.getByRole('tab', { name: '动手练习', exact: true }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await popconfirm.getByRole('button', { name: '载入示例', exact: true }).click();
    await expect(popconfirm).toHaveCount(0);
  }
  async function run(title: string, status = 201) {
    await page.getByLabel('本次记录标题（可选）', { exact: true }).fill(title);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/academics/modules/digital-logic/evaluate') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '运行并保存结果', exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(status);
    const body = await response.json();
    if (status === 201) {
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
    expect(response.headers()['x-export-record-count']).toBe('4');
    expect(response.headers()['x-export-truncated']).toBe('false');
    await expect(dialog).toContainText('已导出 4 / 4 条匹配记录');
    await layout(page);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();
    return bytes;
  }
  try {
    const registration = await page.request.post(`${web}/api/auth/register`, {
      headers: { Origin: web },
      data: { username, password, name: '数字逻辑验收同学' },
    });
    expect(registration.status(), 'Independent fixture registration must succeed').toBe(201);
    const account = await registration.json();
    user = account.user;
    csrf = account.csrfToken;
    const old = await db.academicsRecord.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        moduleId: 'digital-logic',
        title: oldTitle,
        values: { expression: defaultExpression },
        result: legacyResult,
        createdAt: new Date('2020-01-01'),
      },
    });

    await test.step('原单式默认行为和德摩根等价通过真实输入保存', async () => {
      await page.goto(`${web}/academics/modules/digital-logic`);
      await expect(expression).toHaveValue(defaultExpression);
      await expect(comparison).toHaveValue('');
      const single = await run(`默认实验-${suffix}`);
      expect(single.result.tables[0].rows).toEqual(legacyResult.tables[0].rows);
      expect(single.result.tables[0].rows.filter((row: any) => row.output === 1)).toHaveLength(7);
      await example('德摩根律：等价');
      await expect(expression).toHaveValue('!(A && B)');
      await expect(comparison).toHaveValue('!A || !B');
      const equivalent = await run(`德摩根-${suffix}`);
      expect(equivalent.result.summary).toContain('逻辑等价');
      expect(equivalent.result.tables[0].rows).toEqual([
        { A: 0, B: 0, output: 1, comparisonOutput: 1, matches: '一致' },
        { A: 0, B: 1, output: 1, comparisonOutput: 1, matches: '一致' },
        { A: 1, B: 0, output: 1, comparisonOutput: 1, matches: '一致' },
        { A: 1, B: 1, output: 0, comparisonOutput: 0, matches: '一致' },
      ]);
      await expect(resultRegion.locator('tbody tr')).toHaveCount(4);
      await expect(resultRegion).not.toContainText('首个反例');
    });

    await test.step('两处反例全部展示与持久化，保存笔记不改变实验结论', async () => {
      await example('与或误写：找反例');
      await expect(expression).toHaveValue('!(A && B)');
      await expect(comparison).toHaveValue('!A && !B');
      saved = (await run(comparedTitle)).record;
      expect(saved.result.summary).toContain('逻辑不等价');
      expect(saved.result.tables.find((table: any) => table.title === '真值表').rows).toEqual(
        nonEquivalentRows,
      );
      expect(saved.result.tables.find((table: any) => table.title === '全部反例').rows).toEqual(
        nonEquivalentRows.slice(1, 3),
      );
      const counterexamples = page.getByRole('region', { name: '全部反例，可横向滚动', exact: true });
      await expect(counterexamples.locator('tbody tr')).toHaveCount(2);
      await expect(resultRegion).toContainText('A=0');
      await expect(resultRegion).toContainText('B=1');
      await page.getByLabel('学习记录笔记', { exact: true }).fill(notes);
      const patch = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/academics/records/${saved.id}`) &&
          response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
      const response = await patch;
      expect(response.status()).toBe(200);
      saved = await response.json();
      expect(saved.notes).toBe(notes);
      const stored = await db.academicsRecord.findUniqueOrThrow({ where: { id: saved.id } });
      expect(stored.result).toEqual(saved.result);
      expect(stored.values).toEqual({ expression: '!(A && B)', compareExpression: '!A && !B' });
      expect(stored.notes).toBe(notes);
      await page.setViewportSize({ width: 390, height: 844 });
      await layout(page);
    });

    await test.step('非法对照表达式400且保留输入，载入单式示例清空第二栏', async () => {
      await page.getByRole('tab', { name: '动手练习', exact: true }).click();
      await comparison.fill('A || )');
      const before = await db.academicsRecord.count({ where: { userId: user.id } });
      await run(`错误实验-${suffix}`, 400);
      await expect(page.getByText('本次练习未完成', { exact: true })).toBeVisible();
      await expect(page.locator('.ant-alert-error')).toContainText('对照表达式');
      await expect(expression).toHaveValue('!(A && B)');
      await expect(comparison).toHaveValue('A || )');
      expect(await db.academicsRecord.count({ where: { userId: user.id } })).toBe(before);
      await example('起步单表达式');
      await expect(expression).toHaveValue(defaultExpression);
      await expect(comparison).toHaveValue('');
    });

    await test.step('旧历史恢复不残留对照输入，新比较记录恢复两条表达式', async () => {
      await comparison.fill('A ^ B');
      await history(oldTitle, '恢复输入');
      await expect(expression).toHaveValue(defaultExpression);
      await expect(comparison).toHaveValue('');
      await history(oldTitle, '查看结果与笔记');
      await expect(resultRegion).toContainText(legacyResult.summary);
      await expect(
        resultRegion.getByRole('region', { name: '全部反例，可横向滚动', exact: true }),
      ).toHaveCount(0);
      expect((await db.academicsRecord.findUniqueOrThrow({ where: { id: old.id } })).result).toEqual(
        legacyResult,
      );
      await history(comparedTitle, '恢复输入');
      await expect(expression).toHaveValue('!(A && B)');
      await expect(comparison).toHaveValue('!A && !B');
      await history(comparedTitle, '查看结果与笔记');
      await expect(
        resultRegion.getByRole('region', { name: '全部反例，可横向滚动', exact: true }).locator('tbody tr'),
      ).toHaveCount(2);
      await layout(page);
    });

    await test.step('实际CSV和Markdown下载完整保留对照输入、全部反例、笔记与旧结果', async () => {
      await page.goto(`${web}/academics/records?moduleId=digital-logic`);
      await expect(page.locator('.academic-filter-bar')).toContainText('共 4 条');
      await layout(page);
      const csv = await download('csv');
      expect(csv.subarray(0, 3).toString('hex')).toBe('efbbbf');
      expect(csv.toString('utf8')).toContain(saved.result.summary);
      expect(csv.toString('utf8')).toContain(legacyResult.summary);
      const text = (await download('md')).toString('utf8');
      const blocks = [...text.matchAll(/^(`{3,})(json|text)\n([\s\S]*?)\n\1\n/gm)];
      const json = blocks.filter((block) => block[2] === 'json').map((block) => JSON.parse(block[3]));
      expect(json).toContainEqual(saved.values);
      expect(json).toContainEqual(saved.result);
      expect(json).toContainEqual(legacyResult);
      expect(json).toContainEqual({ expression: defaultExpression });
      expect(blocks.map((block) => block[3])).toContain(notes);
      const counterexamples = json
        .find((value) => value.summary === saved.result.summary)
        .tables.find((table: any) => table.title === '全部反例').rows;
      expect(counterexamples).toEqual(nonEquivalentRows.slice(1, 3));
      expect(
        await db.auditLog.count({ where: { userId: user.id, action: 'academics.records.export' } }),
      ).toBe(2);
      expect(await page.evaluate(() => (window as any).__logicInjected)).toBe(false);
      expect(errors).toEqual([]);
      await layout(page);
      // Explicit real API read confirms no hidden re-evaluation in the download path.
      const historic = await page.request.get(`${web}/api/academics/records/${old.id}`, {
        headers: { Origin: web, 'x-csrf-token': csrf },
      });
      expect(historic.status()).toBe(200);
      expect((await historic.json()).result).toEqual(legacyResult);
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
