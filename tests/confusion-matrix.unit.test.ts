import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { academicMajors } from '../apps/api/src/academics/academics.catalog';
import { evaluateAcademicModule, validateModuleValues } from '../apps/api/src/academics/academics.engine';
import { scienceModules } from '../apps/api/src/academics/academics.modules-science';
import type { StudyResult } from '../apps/api/src/academics/academics.types';
import { evaluateConfusionMatrix } from '../apps/api/src/academics/tools-confusion-matrix';
import { evaluateScienceModule } from '../apps/api/src/academics/tools-science';

const id = 'confusion-matrix';
const module = scienceModules.find((item) => item.id === id)!;
const keys = ['tp', 'fp', 'fn', 'tn'];
const labels = [
  '准确率 Accuracy',
  '精确率 Precision',
  '召回率 Recall',
  '负类召回率 Specificity',
  'F1',
  '二分类平衡准确率',
];
type Counts = [number, number, number, number];
type Pair = { actual: boolean; predicted: boolean };
const input = (counts: Counts) => Object.fromEntries(keys.map((key, index) => [key, counts[index]]));
const run = (counts: Counts = [45, 5, 10, 40]) => {
  const output = evaluateScienceModule(id, input(counts));
  assert.ok(output);
  return output;
};
const badRequest = (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400;
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
function checkMetrics(output: StudyResult, expected: (number | undefined)[]) {
  assert.deepEqual(
    output.metrics.map((entry) => entry.label),
    labels,
  );
  assert.deepEqual(
    output.tables.map((entry) => entry.title),
    ['混淆矩阵（行实际，列预测）', '指标分子与分母'],
  );
  assert.deepEqual(
    output.tables[1].rows.map((entry) => entry.metric),
    labels,
  );
  output.metrics.forEach((entry, index) => {
    const row = output.tables[1].rows[index];
    assert.equal(row.percent, entry.value);
    assert.equal(typeof row.formula, 'string');
    assert.ok(String(row.formula).length > 0);
    assert.equal(typeof row.reason, 'string');
    assert.ok(Number.isSafeInteger(row.numerator));
    assert.ok(Number.isSafeInteger(row.denominator));
    if (expected[index] === undefined) {
      assert.equal(entry.value, '未定义');
      assert.equal(Object.hasOwn(entry, 'unit'), false);
      assert.equal(row.denominator, 0);
      assert.ok(String(row.reason).length > 0);
    } else {
      near(entry.value, expected[index]!);
      assert.equal(entry.unit, '%');
      assert.equal(row.reason, '');
      assert.ok(Number(row.denominator) > 0);
    }
  });
}

// Build the expected matrix and rates from individual actual/predicted label pairs.
// Counts come from grouping labels, not from the production formulas or helpers.
function checkLabelOracle(pairs: Pair[]) {
  const actualPositive = pairs.filter((pair) => pair.actual),
    actualNegative = pairs.filter((pair) => !pair.actual),
    predictedPositive = pairs.filter((pair) => pair.predicted),
    correct = pairs.filter((pair) => pair.actual === pair.predicted),
    correctPositive = actualPositive.filter((pair) => pair.predicted),
    correctNegative = actualNegative.filter((pair) => !pair.predicted);
  const counts: Counts = [
    correctPositive.length,
    actualNegative.filter((pair) => pair.predicted).length,
    actualPositive.filter((pair) => !pair.predicted).length,
    correctNegative.length,
  ];
  const recall = actualPositive.length ? correctPositive.length / actualPositive.length : undefined,
    specificity = actualNegative.length ? correctNegative.length / actualNegative.length : undefined;
  const output = run(counts);
  checkMetrics(output, [
    (correct.length / pairs.length) * 100,
    predictedPositive.length ? (correctPositive.length / predictedPositive.length) * 100 : undefined,
    recall === undefined ? undefined : recall * 100,
    specificity === undefined ? undefined : specificity * 100,
    actualPositive.length + predictedPositive.length
      ? (200 * correctPositive.length) / (actualPositive.length + predictedPositive.length)
      : undefined,
    recall === undefined || specificity === undefined ? undefined : 50 * (recall + specificity),
  ]);
  const groups = [actualNegative, actualPositive, pairs];
  assert.deepEqual(
    output.tables[0].rows,
    groups.map((group, index) => ({
      actual: ['实际负类', '实际正类', '合计'][index],
      predictedNegative: group.filter((pair) => !pair.predicted).length,
      predictedPositive: group.filter((pair) => pair.predicted).length,
      total: group.length,
    })),
  );
  assert.deepEqual(output.categoryChart, {
    title: '四格样本计数',
    categories: ['TP', 'FP', 'FN', 'TN'],
    series: [{ name: '计数', values: counts }],
    yAxisLabel: '样本数',
  });
  assert.equal(output.chart, undefined);
}

test('模块四个严格整数字段、六个原创例与公开执行通道保持完整契约', async () => {
  assert.ok(module);
  assert.equal(module.title, '二分类混淆矩阵与指标');
  assert.equal(module.kind, 'calculator');
  assert.deepEqual(module.subjectIds, [
    'subject-science',
    'subject-interdisciplinary',
    'subject-engineering',
  ]);
  assert.deepEqual(
    module.fields.map((field) => field.key),
    keys,
  );
  for (const field of module.fields) {
    assert.equal(field.type, 'number');
    assert.equal(field.required, true);
    assert.equal(field.min, 0);
    assert.equal(field.max, 1e6);
    assert.equal(field.step, 1);
  }
  assert.deepEqual(module.defaultValues, input([45, 5, 10, 40]));
  assert.deepEqual(
    module.examples.map((entry) => entry.values),
    [
      input([45, 5, 10, 40]),
      input([0, 0, 1, 99]),
      input([30, 0, 0, 70]),
      input([0, 40, 60, 0]),
      input([25, 0, 0, 0]),
      input([0, 0, 0, 100]),
    ],
  );
  assert.equal(new Set(module.examples.map((entry) => entry.title)).size, 6);
  for (const example of module.examples) {
    validateModuleValues(module, example.values);
    const output = await evaluateAcademicModule(module, example.values);
    assert.deepEqual(output, evaluateConfusionMatrix(example.values));
    assert.ok(output.sections.every((section) => section.status === 'info'));
  }
});

test('默认混合样本的手算六指标及未约分分子分母准确，矩阵行列方向明确', () => {
  const output = run();
  checkMetrics(output, [85, 90, 900 / 11, 800 / 9, 600 / 7, 8450 / 99]);
  assert.deepEqual(
    output.tables.map((entry) => entry.columns.map((column) => column.key)),
    [
      ['actual', 'predictedNegative', 'predictedPositive', 'total'],
      ['metric', 'formula', 'numerator', 'denominator', 'percent', 'reason'],
    ],
  );
  assert.deepEqual(output.tables[0].rows, [
    { actual: '实际负类', predictedNegative: 40, predictedPositive: 5, total: 45 },
    { actual: '实际正类', predictedNegative: 10, predictedPositive: 45, total: 55 },
    { actual: '合计', predictedNegative: 50, predictedPositive: 50, total: 100 },
  ]);
  assert.deepEqual(
    output.tables[1].rows.map((row) => [row.numerator, row.denominator]),
    [
      [85, 100],
      [45, 50],
      [45, 55],
      [40, 45],
      [90, 105],
      [4225, 4950],
    ],
  );
  assert.match(output.sections.map((entry) => entry.content).join('\n'), /不是新增观察样本数/);
});

test('穷举1至5个样本的全部1364组真实与预测标签，独立重建矩阵和六指标', () => {
  let checked = 0;
  for (let size = 1; size <= 5; size++) {
    for (let encoded = 0; encoded < 4 ** size; encoded++) {
      const pairs: Pair[] = [];
      let digits = encoded;
      for (let i = 0; i < size; i++) {
        const value = digits % 4;
        pairs.push({ actual: value >= 2, predicted: value % 2 === 1 });
        digits = Math.floor(digits / 4);
      }
      checkLabelOracle(pairs);
      checked++;
    }
  }
  assert.equal(checked, 1364);
});

test('稀有正类全部预测负类时99%准确率不掩盖Recall/F1为0和Precision未定义', () => {
  const output = run([0, 0, 1, 99]);
  checkMetrics(output, [99, undefined, 0, 100, 0, 50]);
  assert.equal(output.tables[1].rows[4].denominator, 1);
  assert.match(String(output.tables[1].rows[1].reason), /没有预测为正类/);
});

test('两类全对/全错与单一真实类别按各分母独立判断，不相互传染未定义', () => {
  checkMetrics(run([30, 0, 0, 70]), [100, 100, 100, 100, 100, 100]);
  checkMetrics(run([0, 40, 60, 0]), [0, 0, 0, 0, 0, 0]);
  checkMetrics(run([25, 0, 0, 0]), [100, 100, 100, undefined, 100, undefined]);
  checkMetrics(run([0, 0, 0, 100]), [100, undefined, undefined, 100, undefined, undefined]);
  checkMetrics(run([0, 1, 0, 0]), [0, 0, undefined, 0, 0, undefined]);
  checkMetrics(run([0, 0, 1, 0]), [0, undefined, 0, undefined, 0, undefined]);
});

test('最大计数保持整数精确，极小的非零百分比不被舍成0', () => {
  const largest = run([1e6, 1e6, 1e6, 1e6]);
  checkMetrics(largest, [50, 50, 50, 50, 50, 50]);
  assert.equal(largest.tables[0].rows[2].total, 4e6);
  assert.equal(largest.tables[1].rows[5].numerator, 4e12);
  assert.equal(largest.tables[1].rows[5].denominator, 8e12);
  const tiny = run([1, 1e6, 1e6, 0]);
  checkMetrics(tiny, [100 / 2000001, 100 / 1000001, 100 / 1000001, 0, 100 / 1000001, 50 / 1000001]);
  for (const index of [0, 1, 2, 4, 5]) assert.ok(Number(tiny.metrics[index].value) > 0);
});

test('同比例放大计数保留六项比例，样本与矩阵合计随倍数变化', () => {
  const counts: Counts = [3, 7, 11, 19],
    factor = 30000;
  const original = run(counts),
    scaled = run(counts.map((value) => value * factor) as Counts);
  assert.deepEqual(scaled.metrics, original.metrics);
  for (let i = 0; i < 3; i++)
    for (const key of ['predictedNegative', 'predictedPositive', 'total'])
      assert.equal(scaled.tables[0].rows[i][key], Number(original.tables[0].rows[i][key]) * factor);
});

test('交换实际与预测使Precision/Recall互换，Accuracy和F1不变；交换标签使两类召回率互换', () => {
  for (const counts of [
    [3, 7, 11, 19],
    [0, 0, 1, 99],
    [0, 0, 0, 100],
  ] as Counts[]) {
    const [tp, fp, fn, tn] = counts;
    const initial = run(counts).metrics.map((entry) => entry.value),
      transpose = run([tp, fn, fp, tn]).metrics.map((entry) => entry.value),
      relabeled = run([tn, fn, fp, tp]).metrics.map((entry) => entry.value);
    assert.equal(transpose[0], initial[0]);
    assert.equal(transpose[1], initial[2]);
    assert.equal(transpose[2], initial[1]);
    assert.equal(transpose[4], initial[4]);
    assert.equal(relabeled[0], initial[0]);
    assert.equal(relabeled[2], initial[3]);
    assert.equal(relabeled[3], initial[2]);
    assert.equal(relabeled[5], initial[5]);
  }
});

test('直接工具与公开引擎都拒绝缺失、非整数、类型混淆、越界及非有限计数', async () => {
  for (const key of keys) {
    for (const value of [
      undefined,
      null,
      '',
      '1',
      ' ',
      false,
      true,
      [],
      [1],
      {},
      -1,
      0.5,
      1000001,
      NaN,
      Infinity,
      -Infinity,
    ]) {
      const values = { ...module.defaultValues, [key]: value };
      assert.throws(() => evaluateConfusionMatrix(values), badRequest);
      assert.throws(() => evaluateScienceModule(id, values), badRequest);
      await assert.rejects(evaluateAcademicModule(module, values), badRequest);
    }
    const omitted = { ...module.defaultValues };
    delete omitted[key];
    assert.throws(() => evaluateConfusionMatrix(omitted), badRequest);
  }
});

test('全零、非对象根值和未知字段拒绝，不补示例值、不接受可执行表达式', async () => {
  const zero = input([0, 0, 0, 0]);
  assert.throws(() => evaluateConfusionMatrix(zero), /四格样本计数之和必须大于0/);
  await assert.rejects(evaluateAcademicModule(module, zero), badRequest);
  for (const value of [undefined, null, [], '1', 0, false])
    assert.throws(() => evaluateConfusionMatrix(value as never), badRequest);
  for (const extra of ['source_code', 'threshold', 'organizationId', 'unit', 'constructor']) {
    const values = { ...module.defaultValues, [extra]: 'process.exit(1)' };
    assert.throws(() => evaluateConfusionMatrix(values), badRequest);
    await assert.rejects(evaluateAcademicModule(module, values), badRequest);
  }
  assert.throws(
    () => evaluateConfusionMatrix(JSON.parse('{"tp":1,"fp":0,"fn":0,"tn":1,"__proto__":{}}')),
    badRequest,
  );
});

test('所有示例结果保持有限JSON、原始输入不变，未定义保留文字且无NaN或Infinity', () => {
  function finite(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    return !value || typeof value !== 'object' || Object.values(value).every(finite);
  }
  for (const example of module.examples) {
    const before = structuredClone(example.values),
      values = Object.freeze({ ...example.values });
    const output = evaluateConfusionMatrix(values);
    assert.ok(finite(output));
    assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
    assert.ok(Buffer.byteLength(JSON.stringify(output)) < 16384);
    assert.deepEqual(values, before);
    assert.ok(output.summary.includes('完成一次指标实验'));
  }
});

test('只向三个相关公共专业模板追加推荐，已有14个科学模块仍可执行', () => {
  const selected = academicMajors.filter((major) => major.moduleIds.includes(id));
  assert.deepEqual(selected.map((major) => major.id).sort(), [
    'major-artificial-intelligence',
    'major-data-science',
    'major-statistics',
  ]);
  for (const major of selected) {
    assert.equal(major.moduleIds.at(-1), id);
    assert.equal(major.moduleIds.filter((entry) => entry === id).length, 1);
  }
  const previous = scienceModules.filter((entry) => entry.id !== id);
  assert.equal(previous.length, 14);
  for (const entry of previous) {
    const output = evaluateScienceModule(entry.id, entry.defaultValues);
    assert.ok(output?.summary, entry.id);
  }
  assert.equal(evaluateScienceModule('not-a-real-module', {}), undefined);
});
