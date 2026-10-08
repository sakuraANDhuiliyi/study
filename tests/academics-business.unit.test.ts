import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBusinessModule } from '../apps/api/src/academics/tools-business';
import { businessModules } from '../apps/api/src/academics/academics.modules-business';
import type { StudyResult } from '../apps/api/src/academics/academics.types';
const evaluate = (id: string, values: Record<string, unknown>) => evaluateBusinessModule(id, values)!;
const defaults = (id: string) => businessModules.find((module) => module.id === id)!.defaultValues;
const m = (result: StudyResult, label: string) => result.metrics.find((item) => item.label === label)!.value;
const close = (actual: unknown, expected: number, tolerance = 1e-4) =>
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    `${actual} vs ${expected}`,
  );

test('复式记账用整数分累计小数和大额，账户余额与逐笔平衡独立核对', () => {
  const result = evaluate('accounting-ledger', {
    entries: [
      {
        memo: '精确小数',
        lines: [
          { account: '现金', debit: 0.1, credit: 0 },
          { account: '现金', debit: 0.2, credit: 0 },
          { account: '资本', debit: 0, credit: 0.3 },
        ],
      },
      {
        memo: '大额分位',
        lines: [
          { account: '现金', debit: 999999999.99, credit: 0 },
          { account: '资本', debit: 0, credit: 999999999.99 },
        ],
      },
    ],
  });
  assert.equal(m(result, '借方合计'), '1000000000.29');
  assert.equal(m(result, '逐笔平衡数'), 2);
  assert.equal(result.tables[1].rows.find((row) => row.account === '现金')!.debitBalance, '1000000000.29');
  assert.equal(result.tables[1].rows.find((row) => row.account === '资本')!.creditBalance, '1000000000.29');
});
test('总额平衡不能抵消两笔不平衡，金额边界和双正借贷拒绝', () => {
  const lines = (debit: number, credit: number) => [
    { account: '甲', debit, credit: 0 },
    { account: '乙', debit: 0, credit },
  ];
  const result = evaluate('accounting-ledger', {
    entries: [
      { memo: '一', lines: lines(10, 5) },
      { memo: '二', lines: lines(5, 10) },
    ],
  });
  assert.equal(m(result, '借方合计'), m(result, '贷方合计'));
  assert.equal(m(result, '逐笔平衡数'), 0);
  assert.match(result.summary, /不平衡/);
  for (const bad of [-1, 0.001, 0.30000000000000004])
    assert.throws(() => evaluate('accounting-ledger', { entries: [{ memo: '无效', lines: lines(bad, 1) }] }));
  assert.throws(() =>
    evaluate('accounting-ledger', {
      entries: [
        {
          memo: '双正',
          lines: [
            { account: '甲', debit: 1, credit: 1 },
            { account: '乙', debit: 1, credit: 0 },
          ],
        },
      ],
    }),
  );
});
test('复利默认场景核对终值、逐年NPV和未折现插值回收期', () => {
  const result = evaluate('finance-lab', defaults('finance-lab'));
  close(m(result, '复利终值'), 11576.25);
  close(m(result, '净现值 NPV'), 892.992117478);
  close(m(result, '未折现回收期'), 2.5);
  assert.equal(result.tables[0].rows[0].factor, 1);
});
test('负折现率、0期收入和无法回收的现金流不生成错误回收期', () => {
  const result = evaluate('finance-lab', {
    principal: 100,
    ratePercent: -50,
    years: 2,
    compounds: 1,
    cashflows: [-100, 25, 25],
  });
  close(m(result, '复利终值'), 25);
  close(m(result, '净现值 NPV'), 50);
  assert.equal(m(result, '未折现回收期'), '给定期间内未回收');
  assert.equal(
    m(evaluate('finance-lab', { ...defaults('finance-lab'), cashflows: [20, -100, 5] }), '未折现回收期'),
    0,
  );
  assert.throws(() => evaluate('finance-lab', { ...defaults('finance-lab'), ratePercent: -100 }));
  assert.throws(() => evaluate('finance-lab', { ...defaults('finance-lab'), compounds: 1.5 }));
  assert.throws(() => evaluate('finance-lab', { ...defaults('finance-lab'), cashflows: Array(102).fill(1) }));
});
test('供需均衡与观察点弹性用独立代数例验证', () => {
  const result = evaluate('economics-lab', { a: 150, b: 3, c: -10, d: 1, price: 30 });
  close(m(result, '均衡价格'), 40);
  close(m(result, '均衡数量'), 30);
  close(m(result, '观察价下需求'), 60);
  close(m(result, '观察价下供给'), 20);
  close(m(result, '需求点弹性'), -1.5);
  assert.match(result.sections[1].content, /短缺/);
});
test('零需求弹性不定义、负均衡不伪报经济可行', () => {
  const zero = evaluate('economics-lab', { a: 100, b: 2, c: 0, d: 1, price: 50 });
  assert.equal(m(zero, '需求点弹性'), '不定义（需求数量非正）');
  const negative = evaluate('economics-lab', { a: 10, b: 1, c: 30, d: 1, price: 0 });
  close(m(negative, '均衡价格'), -10);
  assert.match(negative.summary, /不在.*可行/);
  assert.throws(() => evaluate('economics-lab', { ...defaults('economics-lab'), b: 0 }));
});
test('漏斗与利润的计数、分母和盈亏平衡向上取整独立核算', () => {
  const result = evaluate('business-analysis', {
    visits: 400,
    leads: 100,
    sales: 25,
    marketing: 200,
    price: 13,
    variable: 6,
    fixed: 100,
  });
  close(m(result, '收入'), 325);
  close(m(result, '扣固定成本后结余'), 75);
  close(m(result, '获客成本'), 8);
  close(m(result, '盈亏平衡销量'), 15);
  assert.deepEqual(
    result.tables[0].rows.map((row) => row.rate),
    [25, 25, 6.25],
  );
});
test('零流量与非正贡献保留不定义，逆增漏斗及非整数计数拒绝', () => {
  const result = evaluate('business-analysis', {
    visits: 0,
    leads: 0,
    sales: 0,
    marketing: 10,
    price: 6,
    variable: 6,
    fixed: 100,
  });
  assert.match(String(m(result, '获客成本')), /不定义/);
  assert.match(String(m(result, '盈亏平衡销量')), /不定义/);
  assert.ok(result.tables[0].rows.every((row) => String(row.rate).includes('不定义')));
  assert.throws(() => evaluate('business-analysis', { ...defaults('business-analysis'), leads: 1001 }));
  assert.throws(() => evaluate('business-analysis', { ...defaults('business-analysis'), sales: 1.5 }));
});
test('关键路径菱形网络得到9工期与C的2浮时', () => {
  const result = evaluate('project-planning', defaults('project-planning'));
  assert.equal(m(result, '项目工期'), 9);
  assert.deepEqual(
    result.tables[0].rows.filter((row) => row.critical).map((row) => row.id),
    ['A', 'B', 'D'],
  );
  const c = result.tables[0].rows.find((row) => row.id === 'C')!;
  assert.equal(c.slack, 2);
  assert.equal(c.earliestStart, 3);
  assert.equal(c.latestStart, 5);
});
test('关键路径多终点共用完工时刻，并拒绝环、重复与未知依赖', () => {
  const tasks = [
    { id: 'A', duration: 5, dependencies: [] },
    { id: 'B', duration: 2, dependencies: [] },
    { id: 'C', duration: 1, dependencies: ['B'] },
  ];
  const result = evaluate('project-planning', { tasks });
  assert.equal(m(result, '项目工期'), 5);
  assert.deepEqual(
    result.tables[0].rows.map((row) => [row.id, row.slack]),
    [
      ['A', 0],
      ['B', 2],
      ['C', 2],
    ],
  );
  for (const invalid of [
    [tasks[0], tasks[0]],
    [{ id: 'A', duration: 1, dependencies: ['missing'] }],
    [
      { id: 'A', duration: 1, dependencies: ['B'] },
      { id: 'B', duration: 1, dependencies: ['A'] },
    ],
    [tasks[0], { id: 'B', duration: 1, dependencies: ['A', 'A'] }],
  ])
    assert.throws(() => evaluate('project-planning', { tasks: invalid }));
});
test('EOQ具有相等的订货和周期库存持有成本，ROP时间单位正确', () => {
  const result = evaluate('inventory-lab', defaults('inventory-lab'));
  close(m(result, '经济订货量 EOQ'), 707.1067811865);
  close(m(result, '再订货点 ROP'), 300);
  close(m(result, '年订货成本'), 707.1067811865);
  close(m(result, '年周期库存持有成本'), 707.1067811865);
});
test('EOQ平方尺度变化与零交货期，成本/天数边界拒绝', () => {
  const result = evaluate('inventory-lab', {
    demand: 800,
    ordering: 25,
    holding: 1,
    days: 200,
    leadDays: 0,
    safety: 12,
  });
  close(m(result, '经济订货量 EOQ'), 200);
  close(m(result, '再订货点 ROP'), 12);
  close(m(result, '订货周期'), 50);
  close(m(result, '年相关成本合计'), 200);
  for (const update of [{ holding: 0 }, { ordering: -1 }, { days: 0 }, { days: 365.5 }, { safety: -1 }])
    assert.throws(() => evaluate('inventory-lab', { ...defaults('inventory-lab'), ...update }));
});
test('全部业务默认例运行，未知模块不由此处理器接管，未知字段拒绝', () => {
  for (const module of businessModules) assert.ok(evaluate(module.id, module.defaultValues).summary);
  assert.equal(evaluateBusinessModule('__proto__', {}), undefined);
  assert.throws(() => evaluate('finance-lab', { ...defaults('finance-lab'), arbitrary: 123 }));
});
