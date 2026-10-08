import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { academicMajors } from '../apps/api/src/academics/academics.catalog';
import { evaluateAcademicModule, validateModuleValues } from '../apps/api/src/academics/academics.engine';
import { scienceModules } from '../apps/api/src/academics/academics.modules-science';
import type { StudyResult } from '../apps/api/src/academics/academics.types';
import { evaluateScienceModule } from '../apps/api/src/academics/tools-science';
import { evaluateSimpsonParadox } from '../apps/api/src/academics/tools-simpson';

const id = 'simpson-paradox';
const module = scienceModules.find((item) => item.id === id)!;
const keys = ['aSuccess1', 'aTotal1', 'bSuccess1', 'bTotal1', 'aSuccess2', 'aTotal2', 'bSuccess2', 'bTotal2'];
const bases = ['分层1', '分层2', '原始汇总', '共同权重'];
type Counts = [number, number, number, number, number, number, number, number];
const defaultCounts: Counts = [9, 10, 80, 100, 20, 100, 1, 10];
const input = (counts: Counts) => Object.fromEntries(keys.map((key, index) => [key, counts[index]]));
function run(counts: Counts = defaultCounts) {
  const output = evaluateScienceModule(id, input(counts));
  assert.ok(output);
  return output;
}
const metric = (output: StudyResult, label: string) => {
  const found = output.metrics.find((item) => item.label === label);
  assert.ok(found, label);
  return found.value;
};
const comparisons = (output: StudyResult) => {
  assert.equal(output.tables.length, 3);
  assert.deepEqual(
    output.tables.map((table) => table.title),
    ['分层原始数据', '共同权重与贡献', '四种口径比较'],
  );
  assert.deepEqual(
    output.tables.map((table) => table.rows.length),
    [2, 2, 4],
  );
  assert.deepEqual(
    output.tables[2].rows.map((row) => row.basis),
    bases,
  );
  return output.tables[2].rows;
};
function near(actual: unknown, expected: number) {
  assert.equal(typeof actual, 'number');
  assert.ok(Number.isFinite(actual));
  if (expected === 0) assert.equal(actual, 0);
  else
    assert.ok(
      Math.abs(Number(actual) - expected) <= Math.abs(expected) * 1e-10,
      `${String(actual)} differs from ${expected}`,
    );
}
const badRequest = (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400;
const label = (signed: bigint) => (signed > 0n ? '方案A较高' : signed < 0n ? '方案B较高' : '持平');

// Independent integer-grid oracle: expand every stratum rate onto the product of all four
// sample sizes, weight those integer units, then compare cross-products. No production helper.
function oracle(counts: Counts) {
  const [a1, na1, b1, nb1, a2, na2, b2, nb2] = counts.map(BigInt);
  const grid = na1 * nb1 * na2 * nb2,
    all = na1 + nb1 + na2 + nb2;
  const aStandardUnits = (na1 + nb1) * a1 * (grid / na1) + (na2 + nb2) * a2 * (grid / na2);
  const bStandardUnits = (na1 + nb1) * b1 * (grid / nb1) + (na2 + nb2) * b2 * (grid / nb2);
  const pairs = [
    [a1, na1, b1, nb1],
    [a2, na2, b2, nb2],
    [a1 + a2, na1 + na2, b1 + b2, nb1 + nb2],
    [aStandardUnits, all * grid, bStandardUnits, all * grid],
  ];
  return pairs.map(([a, na, b, nb]) => ({
    aPercent: Number(100n * a) / Number(na),
    bPercent: Number(100n * b) / Number(nb),
    differencePp: Number(100n * (a * nb - b * na)) / Number(na * nb),
    direction: label(a * nb - b * na),
  }));
}
function checkOracle(counts: Counts) {
  const output = run(counts),
    expected = oracle(counts),
    rows = comparisons(output);
  rows.forEach((row, i) => {
    near(row.aPercent, expected[i].aPercent);
    near(row.bPercent, expected[i].bPercent);
    near(row.differencePp, expected[i].differencePp);
    assert.equal(row.direction, expected[i].direction);
  });
  const [a1, na1, b1, nb1, a2, na2, b2, nb2] = counts;
  const all = na1 + nb1 + na2 + nb2;
  for (let i = 0; i < 2; i++) {
    const [a, na, b, nb] = i ? [a2, na2, b2, nb2] : [a1, na1, b1, nb1];
    const raw = output.tables[0].rows[i],
      weighted = output.tables[1].rows[i];
    assert.deepEqual([raw.aSuccess, raw.aTotal, raw.bSuccess, raw.bTotal], [a, na, b, nb]);
    near(raw.aWeight, na / (na1 + na2));
    near(raw.bWeight, nb / (nb1 + nb2));
    assert.equal(weighted.pooledTotal, na + nb);
    near(weighted.pooledWeight, (na + nb) / all);
    near(weighted.aContributionPp, ((na + nb) * a * 100) / (all * na));
    near(weighted.bContributionPp, ((na + nb) * b * 100) / (all * nb));
  }
  assert.deepEqual(output.categoryChart, {
    title: '分层与汇总达成比例',
    categories: bases,
    series: [
      { name: '方案A', values: rows.map((row) => row.aPercent) },
      { name: '方案B', values: rows.map((row) => row.bPercent) },
    ],
    yAxisLabel: '达成比例（%）',
  });
  assert.equal(output.chart, undefined);
  const strictlyReversed =
    expected[0].direction !== '持平' &&
    expected[0].direction === expected[1].direction &&
    expected[2].direction !== '持平' &&
    expected[2].direction !== expected[0].direction;
  assert.equal(metric(output, '比较分类') === '严格反转', strictlyReversed);
  return output;
}

test('八个严格整数字段、六个原创例和公开模块执行均保持完整结果契约', async () => {
  assert.ok(module);
  assert.equal(module.title, '分层与汇总比例：辛普森反转');
  assert.equal(module.kind, 'calculator');
  assert.deepEqual(
    module.fields.map((field) => field.key),
    keys,
  );
  module.fields.forEach((field) => {
    assert.equal(field.type, 'number');
    assert.equal(field.required, true);
    assert.equal(field.min, field.key.includes('Total') ? 1 : 0);
    assert.equal(field.max, 1e6);
    assert.equal(field.step, 1);
  });
  assert.deepEqual(module.defaultValues, input(defaultCounts));
  assert.equal(module.examples.length, 6);
  assert.equal(new Set(module.examples.map((example) => example.title)).size, 6);
  for (const example of module.examples) {
    validateModuleValues(module, example.values);
    const result = await evaluateAcademicModule(module, example.values);
    assert.deepEqual(result, checkOracle(keys.map((key) => Number(example.values[key])) as Counts));
    assert.ok(result.sections.every((section) => section.status === 'info'));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 16384);
  }
});

test('默认课堂样本手算验证严格反转、原始分子分母与共同权重贡献', () => {
  const output = checkOracle(defaultCounts),
    rows = comparisons(output);
  assert.equal(metric(output, '比较分类'), '严格反转');
  assert.equal(metric(output, '方案A原始达成数'), 29);
  assert.equal(metric(output, '方案A原始总数'), 110);
  assert.equal(metric(output, '方案B原始达成数'), 81);
  assert.equal(metric(output, '方案B原始总数'), 110);
  assert.equal(metric(output, '全样本总数'), 220);
  assert.deepEqual(
    rows.slice(0, 2).map((row) => [row.aPercent, row.bPercent, row.differencePp]),
    [
      [90, 80, 10],
      [20, 10, 10],
    ],
  );
  assert.deepEqual([rows[3].aPercent, rows[3].bPercent, rows[3].differencePp], [55, 45, 10]);
  assert.deepEqual(
    output.tables[1].rows.map((row) => [row.pooledWeight, row.aContributionPp, row.bContributionPp]),
    [
      [0.5, 45, 40],
      [0.5, 10, 5],
    ],
  );
  near(rows[2].differencePp, -520 / 11);
  assert.match(output.summary, /两个分层均为方案A较高.*原始汇总却为方案B较高/);
});

test('合并样本不均衡时真实权重21/32与11/32，不默认各半', () => {
  const output = checkOracle([9, 10, 160, 200, 20, 100, 1, 10]),
    rows = comparisons(output);
  assert.equal(metric(output, '全样本总数'), 320);
  assert.deepEqual(
    output.tables[1].rows.map((row) => row.pooledWeight),
    [21 / 32, 11 / 32],
  );
  assert.deepEqual([rows[3].aPercent, rows[3].bPercent, rows[3].differencePp], [65.9375, 55.9375, 10]);
  assert.equal(metric(output, '比较分类'), '严格反转');
});

test('持平、分层混向、汇总持平与一致方向分别解释，不冒充严格反转', () => {
  const samples: [Counts, string][] = [
    [[1, 2, 3, 6, 2, 4, 5, 10], '分层持平'],
    [[1, 2, 1, 2, 4, 5, 1, 5], '分层持平'],
    [[9, 10, 8, 10, 1, 10, 2, 10], '分层混向'],
    [[9, 10, 48, 60, 1, 10, 2, 40], '汇总持平'],
    [[9, 10, 8, 10, 20, 100, 10, 100], '方向一致'],
  ];
  for (const [counts, expected] of samples) {
    const output = checkOracle(counts);
    assert.equal(metric(output, '比较分类'), expected);
    assert.match(output.summary, /^未出现严格辛普森反转/);
  }
});

test('两个方案构成相同时原始汇总等于共同权重；共同权重不捏造观察计数', () => {
  const output = checkOracle([9, 10, 8, 10, 20, 100, 10, 100]),
    rows = comparisons(output);
  for (const key of ['aPercent', 'bPercent', 'differencePp', 'direction'])
    assert.equal(rows[2][key], rows[3][key]);
  assert.equal(metric(output, '方案A原始总数'), 110);
  assert.equal(metric(output, '方案B原始总数'), 110);
  assert.match(
    output.sections.find((section) => section.title === '共同权重的含义')!.content,
    /不是新增观察人数/,
  );
});

test('最小四个观察、零与全达成、最大四百万观察都有有限精确边界', () => {
  for (const counts of [
    [0, 1, 0, 1, 0, 1, 0, 1],
    [1, 1, 0, 1, 1, 1, 0, 1],
    [1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000],
    [0, 1000000, 1000000, 1000000, 1000000, 1000000, 0, 1000000],
  ] as Counts[])
    checkOracle(counts);
  assert.equal(metric(run([0, 1, 0, 1, 0, 1, 0, 1]), '全样本总数'), 4);
  assert.equal(
    metric(run([1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000]), '全样本总数'),
    4000000,
  );
});

test('高分母下共同权重差值约负5e-17百分点，展示比例相同仍不伪持平', () => {
  const counts: Counts = [999999, 1000000, 999998, 999999, 999997, 999998, 999998, 999999];
  const output = checkOracle(counts),
    row = comparisons(output)[3];
  assert.equal(row.aPercent, row.bPercent);
  assert.equal(row.direction, '方案B较高');
  near(row.differencePp, -50 / (1000000 * 999999 * 999998));
  assert.ok(Number(row.differencePp) < 0 && Math.abs(Number(row.differencePp)) < 1e-15);
  assert.equal(metric(output, '共同权重差值'), row.differencePp);
  assert.match(
    output.sections.find((section) => section.title === '计算与展示精度')!.content,
    /两个显示比例可能相同/,
  );
});

test('交换方案翻转差值，交换分层保留汇总，同时放大全部计数保持所有比例', () => {
  const counts: Counts = [9, 10, 160, 200, 20, 100, 1, 10];
  const original = checkOracle(counts),
    rows = comparisons(original);
  const swapped = checkOracle([160, 200, 9, 10, 1, 10, 20, 100]);
  const layersSwapped = checkOracle([20, 100, 1, 10, 9, 10, 160, 200]);
  const scaled = checkOracle(counts.map((value) => value * 100) as Counts);
  comparisons(swapped).forEach((row, index) => {
    assert.equal(row.aPercent, rows[index].bPercent);
    assert.equal(row.bPercent, rows[index].aPercent);
    assert.equal(row.differencePp, -Number(rows[index].differencePp));
  });
  assert.equal(metric(swapped, '比较分类'), '严格反转');
  assert.deepEqual(comparisons(layersSwapped).slice(2), rows.slice(2));
  assert.deepEqual(comparisons(scaled), rows);
  assert.equal(metric(scaled, '全样本总数'), Number(metric(original, '全样本总数')) * 100);
});

test('独立整数网格oracle穷举625组小计数并验证全部表格和反转判断', () => {
  const fractions = [
    [0, 1],
    [1, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  for (const a of fractions)
    for (const b of fractions)
      for (const c of fractions) for (const d of fractions) checkOracle([...a, ...b, ...c, ...d] as Counts);
});

test('独立oracle检验160组可重复大分母样本，覆盖超过安全整数的中间乘积', () => {
  let state = 7193;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let sample = 0; sample < 160; sample++) {
    const counts: number[] = [];
    for (let group = 0; group < 4; group++) {
      const total = 500000 + (next() % 500001);
      counts.push(next() % (total + 1), total);
    }
    checkOracle(counts as Counts);
  }
});

test('每个字段都严格拒绝缺失、字符串、非整数和非法边界，达成数不能超过总数', async () => {
  const defaults = input(defaultCounts);
  for (const key of keys) {
    const missing = { ...defaults };
    delete missing[key];
    assert.throws(() => evaluateScienceModule(id, missing), badRequest);
    for (const value of [undefined, null, '', '1', true, [], {}, NaN, Infinity, -Infinity, -1, 0.5, 1000001])
      assert.throws(() => evaluateScienceModule(id, { ...defaults, [key]: value }), badRequest, key);
    if (key.includes('Total'))
      assert.throws(() => evaluateScienceModule(id, { ...defaults, [key]: 0 }), badRequest);
    else
      assert.throws(
        () =>
          evaluateScienceModule(id, {
            ...defaults,
            [key]: Number(defaults[key.replace('Success', 'Total')]) + 1,
          }),
        badRequest,
      );
  }
  assert.throws(() => evaluateScienceModule(id, { ...defaults, unknown: 1 }), badRequest);
  assert.throws(() => evaluateSimpsonParadox({ ...defaults, unknown: 1 }), badRequest);
  assert.throws(() => evaluateSimpsonParadox(null as unknown as Record<string, unknown>), badRequest);
  assert.throws(() => evaluateSimpsonParadox([] as unknown as Record<string, unknown>), badRequest);
  await assert.rejects(evaluateAcademicModule(module, { ...defaults, aSuccess1: '9' }), badRequest);
  await assert.rejects(evaluateAcademicModule(module, { ...defaults, hidden: true }), badRequest);
});

test('推荐仅追加四个公共专业且模块不重复，结果可JSON持久化且没有评分字段', () => {
  const recommended = academicMajors.filter((major) => major.moduleIds.includes(id));
  assert.deepEqual(recommended.map((major) => major.id).sort(), [
    'major-data-science',
    'major-economics',
    'major-marketing',
    'major-statistics',
  ]);
  for (const major of recommended) {
    assert.equal(major.moduleIds.filter((moduleId) => moduleId === id).length, 1);
    assert.equal(major.moduleIds.at(-1), id);
  }
  const output = run();
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
  assert.ok(output.sections.every((section) => section.status === 'info'));
  assert.equal((output as unknown as Record<string, unknown>).score, undefined);
  assert.equal((output as unknown as Record<string, unknown>).correct, undefined);
  assert.match(
    output.sections.find((section) => section.title === '实验边界与复盘')!.content,
    /不判断因果、不做显著性检验/,
  );
});
