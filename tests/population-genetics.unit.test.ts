import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { academicMajors } from '../apps/api/src/academics/academics.catalog';
import { evaluateAcademicModule, validateModuleValues } from '../apps/api/src/academics/academics.engine';
import { scienceModules } from '../apps/api/src/academics/academics.modules-science';
import type { StudyResult } from '../apps/api/src/academics/academics.types';
import { evaluateScienceModule } from '../apps/api/src/academics/tools-science';

const id = 'population-genetics';
const module = scienceModules.find((item) => item.id === id)!;
const keys = ['countAA', 'countAa', 'countaa'];
const values = (AA: number, Aa: number, aa: number) => ({ countAA: AA, countAa: Aa, countaa: aa });
function run(AA: number, Aa: number, aa: number) {
  const output = evaluateScienceModule(id, values(AA, Aa, aa));
  assert.ok(output);
  return output;
}
function metric(output: StudyResult, label: string) {
  const found = output.metrics.find((item) => item.label === label);
  assert.ok(found, label);
  assert.equal(typeof found.value, 'number');
  return Number(found.value);
}
function near(actual: unknown, expected: number, tolerance = 1e-10) {
  assert.equal(typeof actual, 'number');
  assert.ok(Number.isFinite(actual));
  assert.ok(
    Math.abs(Number(actual) - expected) <= tolerance * Math.max(Math.abs(expected), 1e-15),
    `${String(actual)} differs from ${expected}`,
  );
}
const rows = (output: StudyResult) => {
  assert.equal(output.tables.length, 1);
  assert.equal(output.tables[0].title, '观察与模型期望');
  assert.deepEqual(
    output.tables[0].rows.map((row) => row.genotype),
    ['AA', 'Aa', 'aa'],
  );
  return output.tables[0].rows;
};
const badRequest = (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400;

test('群体实验使用整数输入定义，公开默认值与全部六个原创例都可实际计算', async () => {
  assert.ok(module);
  assert.equal(module.kind, 'calculator');
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
  assert.deepEqual(module.defaultValues, values(36, 48, 16));
  assert.equal(module.examples.length, 6);
  assert.ok(module.resources.every((resource) => resource.url.startsWith('https://')));
  for (const example of module.examples) {
    validateModuleValues(module, example.values);
    const output = await evaluateAcademicModule(module, example.values);
    assert.equal(rows(output).length, 3);
    assert.ok(output.sections.length && output.summary.length);
    assert.ok(Buffer.byteLength(JSON.stringify(output)) < 16384);
  }
});

test('36/48/16独立手算给出120/80份等位基因与零差值，图表与表格逐项一致', () => {
  const output = run(36, 48, 16);
  assert.deepEqual(output.metrics, [
    { label: '个体总数 N', value: 100 },
    { label: 'A 等位基因数', value: 120 },
    { label: 'a 等位基因数', value: 80 },
    { label: 'A 频率 p', value: 0.6 },
    { label: 'a 频率 q', value: 0.4 },
  ]);
  const expected = [36, 48, 16];
  rows(output).forEach((row, index) => {
    assert.equal(row.observedCount, expected[index]);
    assert.equal(row.expectedCount, expected[index]);
    assert.equal(row.observedFrequency, expected[index] / 100);
    assert.equal(row.expectedFrequency, expected[index] / 100);
    assert.equal(row.countDifference, 0);
    assert.equal(row.frequencyDifference, 0);
  });
  assert.deepEqual(output.categoryChart, {
    title: '观察计数与模型期望计数',
    categories: ['AA', 'Aa', 'aa'],
    series: [
      { name: '观察计数', values: expected },
      { name: '模型期望计数', values: expected },
    ],
    yAxisLabel: '个体数',
  });
  assert.equal(output.chart, undefined);
});

test('两类纯合个体与相同等位频率的混合基因型共享期望，差值保留正负', () => {
  const separated = run(50, 0, 50),
    mixed = run(25, 50, 25);
  assert.equal(metric(separated, 'A 频率 p'), 0.5);
  assert.equal(metric(separated, 'a 频率 q'), 0.5);
  assert.deepEqual(
    rows(separated).map((row) => row.expectedCount),
    [25, 50, 25],
  );
  assert.deepEqual(
    rows(separated).map((row) => row.countDifference),
    [25, -50, 25],
  );
  assert.deepEqual(
    rows(separated).map((row) => row.frequencyDifference),
    [0.25, -0.5, 0.25],
  );
  assert.deepEqual(separated.categoryChart!.series[1], mixed.categoryChart!.series[1]);
  assert.deepEqual(
    rows(mixed).map((row) => row.countDifference),
    [0, 0, 0],
  );
});

test('N=1杂合个体和N=3样本保留分数期望，不取整分配个体', () => {
  const single = run(0, 1, 0);
  assert.equal(metric(single, '个体总数 N'), 1);
  assert.deepEqual(
    rows(single).map((row) => row.expectedCount),
    [0.25, 0.5, 0.25],
  );
  assert.deepEqual(
    rows(single).map((row) => row.countDifference),
    [-0.25, 0.5, -0.25],
  );
  assert.deepEqual(single.categoryChart!.series[1].values, [0.25, 0.5, 0.25]);
  const thirds = run(0, 2, 1);
  near(metric(thirds, 'A 频率 p'), 1 / 3);
  near(metric(thirds, 'a 频率 q'), 2 / 3);
  [1 / 3, 4 / 3, 4 / 3].forEach((expected, i) => near(rows(thirds)[i].expectedCount, expected));
});

test('单一等位基因端点保留三个类别，零频率与零期望没有NaN或伪零除', () => {
  for (const counts of [
    [1, 0, 0],
    [0, 0, 1],
    [1000000, 0, 0],
    [0, 0, 1000000],
  ]) {
    const output = run(counts[0], counts[1], counts[2]);
    assert.equal(metric(output, 'A 频率 p'), counts[0] ? 1 : 0);
    assert.equal(metric(output, 'a 频率 q'), counts[2] ? 1 : 0);
    assert.deepEqual(
      rows(output).map((row) => row.expectedCount),
      counts,
    );
    assert.deepEqual(
      rows(output).map((row) => row.countDifference),
      [0, 0, 0],
    );
    assert.deepEqual(output.categoryChart!.series[1].values, counts);
  }
});

test('稀有等位基因在小频率、小数量和差值中仍非零，展示不先舍入比例', () => {
  const output = run(999999, 1, 0),
    outputRows = rows(output);
  assert.equal(metric(output, 'A 等位基因数'), 1999999);
  assert.equal(metric(output, 'a 等位基因数'), 1);
  near(metric(output, 'a 频率 q'), 5e-7);
  near(outputRows[2].expectedFrequency, 2.5e-13);
  near(outputRows[2].expectedCount, 2.5e-7);
  near(outputRows[2].countDifference, -2.5e-7);
  near(outputRows[2].frequencyDifference, -2.5e-13);
  near(outputRows[1].expectedCount, 0.9999995);
  near(outputRows[1].countDifference, 5e-7);
  assert.ok(Number(outputRows[2].expectedFrequency) > 0);
  assert.ok(output.categoryChart!.series[1].values[2] > 0);
});

test('计数同时放大只放大数量；交换AA与aa对称交换频率和三行顺序', () => {
  const small = run(7, 4, 2),
    scaled = run(700, 400, 200),
    swapped = run(2, 4, 7);
  assert.equal(metric(small, 'A 频率 p'), metric(scaled, 'A 频率 p'));
  assert.equal(metric(small, 'a 频率 q'), metric(scaled, 'a 频率 q'));
  assert.equal(metric(small, 'A 频率 p'), metric(swapped, 'a 频率 q'));
  const first = rows(small),
    second = rows(scaled),
    reverse = rows(swapped);
  first.forEach((row, i) => {
    for (const field of ['observedFrequency', 'expectedFrequency', 'frequencyDifference'])
      assert.equal(row[field], second[i][field]);
    for (const field of ['observedCount', 'expectedCount', 'countDifference'])
      near(second[i][field], Number(row[field]) * 100);
    for (const field of Object.keys(row).filter((key) => key !== 'genotype'))
      assert.equal(row[field], reverse[2 - i][field]);
  });
});

test('独立枚举等位基因有序配对得到三种期望概率，所有小样本均守恒', () => {
  for (let AA = 0; AA <= 3; AA++)
    for (let Aa = 0; Aa <= 3; Aa++)
      for (let aa = 0; aa <= 3; aa++) {
        if (AA + Aa + aa === 0) continue;
        const copies = [
          ...Array.from({ length: AA }, () => ['A', 'A']),
          ...Array.from({ length: Aa }, () => ['A', 'a']),
          ...Array.from({ length: aa }, () => ['a', 'a']),
        ].flat();
        const pairs: Record<string, number> = { AA: 0, Aa: 0, aa: 0 };
        for (const first of copies) for (const second of copies) pairs[[first, second].sort().join('')]++;
        const output = run(AA, Aa, aa),
          outputRows = rows(output),
          total = AA + Aa + aa;
        for (const row of outputRows) {
          const probability = pairs[String(row.genotype)] / (copies.length * copies.length);
          near(row.expectedFrequency, probability);
          near(row.expectedCount, probability * total);
        }
        near(
          outputRows.reduce((sum, row) => sum + Number(row.observedFrequency), 0),
          1,
        );
        near(
          outputRows.reduce((sum, row) => sum + Number(row.expectedFrequency), 0),
          1,
        );
        near(
          outputRows.reduce((sum, row) => sum + Number(row.expectedCount), 0),
          total,
        );
        assert.ok(Math.abs(outputRows.reduce((sum, row) => sum + Number(row.countDifference), 0)) < 1e-9);
      }
});

test('三项最大值及上限附近计数保持有限且整数指标精确', () => {
  const output = run(1000000, 1000000, 1000000);
  assert.equal(metric(output, '个体总数 N'), 3000000);
  assert.equal(metric(output, 'A 等位基因数'), 3000000);
  assert.equal(metric(output, 'a 等位基因数'), 3000000);
  assert.deepEqual(
    rows(output).map((row) => row.expectedCount),
    [750000, 1500000, 750000],
  );
  const uneven = run(1000000, 999999, 1);
  const walk = (value: unknown): void => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(uneven);
  assert.equal(metric(uneven, '个体总数 N'), 2000000);
  near(
    rows(uneven).reduce((sum, row) => sum + Number(row.expectedCount), 0),
    2000000,
  );
});

test('所有字段拒绝缺失、非法类型、非整数、非有限值和范围外值；非法输入不能静默回退', async () => {
  for (const key of keys) {
    const missing: Record<string, unknown> = { ...module.defaultValues };
    delete missing[key];
    for (const input of [
      missing,
      ...[null, undefined, '', '1', true, {}, [], -1, 0.5, 1000001, Infinity, -Infinity, NaN].map(
        (value) => ({ ...module.defaultValues, [key]: value }),
      ),
    ]) {
      assert.throws(() => evaluateScienceModule(id, input), badRequest);
      await assert.rejects(evaluateAcademicModule(module, input), badRequest);
    }
  }
  for (const input of [
    values(0, 0, 0),
    { ...module.defaultValues, countAAa: 1 },
    { ...module.defaultValues, source_code: 'process.exit(1)' },
    JSON.parse('{"countAA":1,"countAa":1,"countaa":1,"__proto__":{"polluted":true}}'),
  ]) {
    assert.throws(() => evaluateScienceModule(id, input), badRequest);
    await assert.rejects(evaluateAcademicModule(module, input), badRequest);
  }
  for (const input of [null, [], 'counts'])
    assert.throws(() => evaluateScienceModule(id, input as unknown as Record<string, unknown>), badRequest);
});

test('教学结果只描述模型与差值，不返回显著性、平衡判定、个人预测或评分', () => {
  for (const output of [run(36, 48, 16), run(50, 0, 50)]) {
    assert.deepEqual(
      output.sections.map((section) => section.title),
      ['等位基因计数', '随机结合模型', '如何阅读差值', '模型范围与精度'],
    );
    assert.ok(output.sections.every((section) => section.status === 'info'));
    const content = output.sections.map((section) => section.content).join('\n');
    assert.match(content, /期望数量可以是小数/);
    assert.match(content, /差值为零不能证明/);
    assert.match(content, /不进行显著性检验或能力评分/);
    assert.match(content, /不预测个人性状或健康/);
    assert.match(content, /“已完成”只表示完成一次实验/);
    assert.ok(!output.metrics.some((item) => /评分|显著|平衡判定/.test(item.label)));
    assert.doesNotMatch(output.summary, /显著|达标|通过|处于平衡/);
  }
});

test('仅五个相关专业模板追加新模块且位于原有研究与笔记之后', () => {
  const selected = [
    'major-biology',
    'major-ecology',
    'major-agronomy',
    'major-horticulture',
    'major-animal-science',
  ];
  assert.deepEqual(
    academicMajors
      .filter((major) => major.moduleIds.includes(id))
      .map((major) => major.id)
      .sort(),
    [...selected].sort(),
  );
  for (const major of academicMajors.filter((major) => selected.includes(major.id))) {
    assert.deepEqual(major.moduleIds.slice(-2), ['study-notebook', id]);
    assert.equal(major.moduleIds.filter((moduleId) => moduleId === id).length, 1);
  }
  const old = scienceModules.find((item) => item.id === 'genetics-lab')!;
  assert.deepEqual(old.defaultValues, { parentA: 'Aa', parentB: 'Aa' });
  const punnett = evaluateScienceModule(old.id, old.defaultValues)!;
  assert.equal(punnett.tables[0].title, 'Punnett棋盘');
  assert.equal(punnett.categoryChart, undefined);
});
