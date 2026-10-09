import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { evaluateScienceModule } from '../apps/api/src/academics/tools-science';
import { scienceModules } from '../apps/api/src/academics/academics.modules-science';
import type { StudyResult } from '../apps/api/src/academics/academics.types';

function run(id: string, overrides: Record<string, unknown> = {}) {
  const module = scienceModules.find((entry) => entry.id === id);
  assert.ok(module);
  const output = evaluateScienceModule(id, { ...module.defaultValues, ...overrides });
  assert.ok(output);
  return output;
}
const value = (output: StudyResult, label: string) => {
  const item = output.metrics.find((metric) => metric.label === label);
  assert.ok(item, `missing metric: ${label}`);
  return item.value;
};
function near(actual: unknown, expected: number, tolerance = 1e-6) {
  assert.equal(typeof actual, 'number');
  assert.ok(
    Math.abs(Number(actual) - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${String(actual)} differs from ${expected}`,
  );
}
const reject = (id: string, parameters: Record<string, unknown>) =>
  assert.throws(
    () => run(id, parameters),
    (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400,
  );
function allNumbersFinite(input: unknown): boolean {
  if (typeof input === 'number') return Number.isFinite(input);
  if (input && typeof input === 'object') return Object.values(input).every(allNumbersFinite);
  return true;
}
test('十五个课程默认示例均产生可保存的完整有限结果，未知模块不接管', () => {
  assert.equal(scienceModules.length, 15);
  for (const module of scienceModules) {
    const output = run(module.id);
    assert.ok(output.summary.length && output.metrics.length && output.sections.length);
    assert.ok(allNumbersFinite(output), module.id);
    assert.ok(JSON.stringify(output).length < 65536, module.id);
  }
  assert.equal(evaluateScienceModule('sql-workbench', {}), undefined);
  assert.equal(evaluateScienceModule('__proto__', {}), undefined);
});
test('矩阵唯一解满足独立代回，乘法按行列点积核验，行列式有交换符号', () => {
  const solved = run('matrix-lab');
  assert.equal(value(solved, '方程状态'), '唯一解');
  const answer = solved.tables
    .find((entry) => entry.title === '唯一解')!
    .rows.map((row) => Number(row.value));
  near(2 * answer[0] + answer[1], 5);
  near(answer[0] + 3 * answer[1], 7);
  assert.ok(solved.tables.find((entry) => entry.title === '消元过程')!.rows.length >= 3);
  const product = run('matrix-lab', {
    operation: 'multiply',
    a: [
      [1, 2, 3],
      [4, 5, 6],
    ],
    b: [
      [7, 8],
      [9, 10],
      [11, 12],
    ],
  });
  assert.deepEqual(
    product.tables[0].rows.map((row) => [row.c0, row.c1]),
    [
      [58, 64],
      [139, 154],
    ],
  );
  near(
    value(
      run('matrix-lab', {
        operation: 'determinant',
        a: [
          [0, 2],
          [3, 4],
        ],
      }),
      '行列式',
    ),
    -6,
  );
});
test('矩阵无解/多解/矩形秩分开处理，维度和非法矩阵返回400', () => {
  assert.equal(
    value(
      run('matrix-lab', {
        a: [
          [1, 1],
          [2, 2],
        ],
        b: [1, 3],
      }),
      '方程状态',
    ),
    '无解',
  );
  const multiple = run('matrix-lab', {
    a: [
      [1, 1, 2],
      [2, 2, 4],
    ],
    b: [3, 6],
  });
  assert.equal(value(multiple, '方程状态'), '无穷多解');
  near(value(multiple, '自由变量数'), 2);
  assert.match(multiple.sections[0].content, /t1|t2/);
  near(
    value(
      run('matrix-lab', {
        operation: 'rank',
        a: [
          [1, 0],
          [0, 1],
          [1, 1],
        ],
      }),
      '秩',
    ),
    2,
  );
  reject('matrix-lab', { operation: 'multiply', a: [[1, 2]], b: [[1, 2]] });
  reject('matrix-lab', { operation: 'determinant', a: [[1, 2, 3]] });
  reject('matrix-lab', { a: [[1], [2, 3]] });
  reject('matrix-lab', { a: [[Infinity]], b: [1] });
});
test('多项式解析导数与积分使用低次在前约定，Simpson对三次式正确', () => {
  const example = run('calculus-lab');
  near(value(example, '函数值 f(x)'), 4);
  near(value(example, '导数值 f′(x)'), 4);
  near(value(example, '定积分（原函数）'), 9);
  near(value(example, '定积分（Simpson）'), 9);
  // 2 - 3x + x^3 at x=2: value 4, derivative 9; integral from -1 to 2 is 5.25.
  const cubic = run('calculus-lab', { coefficients: [2, -3, 0, 1], x: 2, left: -1, right: 2, intervals: 8 });
  near(value(cubic, '函数值 f(x)'), 4);
  near(value(cubic, '导数值 f′(x)'), 9);
  near(value(cubic, '定积分（原函数）'), 5.25);
  near(value(cubic, '定积分（Simpson）'), 5.25);
});
test('积分区间反向/零宽与常数导数正确，奇数细分与执行表达式拒绝', () => {
  near(value(run('calculus-lab', { coefficients: [2], left: 3, right: -2 }), '定积分（Simpson）'), -10);
  near(value(run('calculus-lab', { coefficients: [2], left: 1, right: 1 }), '导数值 f′(x)'), 0);
  near(value(run('calculus-lab', { left: 1, right: 1 }), '定积分（原函数）'), 0);
  for (const intervals of [0, 3, 2.5, 2002]) reject('calculus-lab', { intervals });
  reject('calculus-lab', { coefficients: 'process.exit(1)' });
  reject('calculus-lab', { coefficients: Array(13).fill(1) });
});
test('统计描述与线性拟合用已知直线独立核对，线性插值分位数明确', () => {
  const output = run('statistics-lab', { x: [1, 2, 3, 4], y: [5, 8, 11, 14] });
  near(value(output, '均值'), 2.5);
  near(value(output, '中位数'), 2.5);
  near(value(output, '第一四分位数'), 1.75);
  near(value(output, '第三四分位数'), 3.25);
  near(value(output, '总体方差'), 1.25);
  near(value(output, '样本方差'), 5 / 3);
  near(value(output, '拟合斜率'), 3);
  near(value(output, '拟合截距'), 2);
  near(value(output, '相关系数'), 1);
});
test('单样本、空y、常数x/y和不成对输入不会生成NaN或虚假相关', () => {
  const single = run('statistics-lab', { x: [9], y: '' });
  assert.match(String(value(single, '样本方差')), /未定义/);
  near(value(single, '总体方差'), 0);
  assert.ok(allNumbersFinite(single));
  const fixedX = run('statistics-lab', { x: [0.1, 0.1, 0.1], y: [1, 2, 3] });
  assert.match(String(value(fixedX, '相关系数')), /未定义/);
  const fixedY = run('statistics-lab', { x: [1, 2, 3], y: [0.1, 0.1, 0.1] });
  near(value(fixedY, '拟合斜率'), 0);
  assert.match(String(value(fixedY, '相关系数')), /未定义/);
  reject('statistics-lab', { x: [1, 2], y: [3] });
  reject('statistics-lab', { x: [] });
  reject('statistics-lab', { x: '[1, "2"]' });
});
test('二项分布用组合数和递推伯努利卷积独立核对，最大n数值稳定', () => {
  const example = run('probability-lab');
  near(value(example, '恰好k次概率'), 120 / 1024);
  near(value(example, '至多k次概率'), 176 / 1024);
  near(value(example, '期望'), 5);
  near(value(example, '方差'), 2.5);
  for (const [n, p, k] of [
    [8, 0.3, 4],
    [200, 0.9999, 199],
    [200, 0.0001, 0],
  ]) {
    let oracle = [1];
    for (let i = 0; i < n; i++) {
      const next = Array(i + 2).fill(0);
      for (let j = 0; j <= i; j++) {
        next[j] += oracle[j] * (1 - p);
        next[j + 1] += oracle[j] * p;
      }
      oracle = next;
    }
    const output = run('probability-lab', { trials: n, probability: p, successes: k });
    near(value(output, '恰好k次概率'), oracle[k]);
    const probabilities = output.tables[0].rows.map((row) => Number(row.probability));
    near(
      probabilities.reduce((a, b) => a + b, 0),
      1,
      1e-9,
    );
    near(
      probabilities.reduce((a, b, i) => a + b * i, 0),
      n * p,
      1e-9,
    );
  }
});
test('二项分布p=0/1、n=0正确退化，非整数和k>n拒绝', () => {
  near(value(run('probability-lab', { trials: 0, successes: 0, probability: 0 }), '恰好k次概率'), 1);
  near(value(run('probability-lab', { trials: 200, successes: 200, probability: 1 }), '恰好k次概率'), 1);
  near(value(run('probability-lab', { trials: 200, successes: 1, probability: 0 }), '恰好k次概率'), 0);
  reject('probability-lab', { trials: 2, successes: 3 });
  reject('probability-lab', { trials: 2.5 });
  reject('probability-lab', { probability: 1.001 });
});
test('直线运动与抛体按独立公式计算，轨迹终点回到地面', () => {
  const linear = run('physics-motion', { mode: 'linear', speed: 10, acceleration: -2, time: 8 });
  near(value(linear, '末速度'), -6);
  near(value(linear, '位移'), 16);
  const projectile = run('physics-motion');
  near(value(projectile, '水平射程'), 400 / 9.8);
  near(value(projectile, '最高高度'), 100 / 9.8);
  near(value(projectile, '飞行时间'), (20 * Math.sqrt(2)) / 9.8);
  near(projectile.chart!.points.at(-1)!.y, 0);
});
test('抛体水平/竖直/静止边界保持有限值，非法时间角度或重力返回400', () => {
  const horizontal = run('physics-motion', { angle: 0 });
  near(value(horizontal, '飞行时间'), 0);
  assert.equal(horizontal.chart!.points.length, 1);
  near(value(run('physics-motion', { angle: 90 }), '水平射程'), 0);
  near(value(run('physics-motion', { speed: 0 }), '最高高度'), 0);
  reject('physics-motion', { gravity: 0 });
  reject('physics-motion', { angle: 91 });
  reject('physics-motion', { mode: 'linear', time: -1 });
});
const coefficients = (output: StudyResult) =>
  output.tables.find((entry) => entry.title === '最简整数系数')!.rows.map((row) => String(row.coefficient));
test('化学配平精确处理元素、括号和多物质反应并逐项核验', () => {
  assert.deepEqual(coefficients(run('chemistry-balance')), ['4', '3', '2']);
  assert.deepEqual(coefficients(run('chemistry-balance', { equation: 'Ca(OH)2 + HCl -> CaCl2 + H2O' })), [
    '1',
    '2',
    '1',
    '2',
  ]);
  assert.deepEqual(
    coefficients(run('chemistry-balance', { equation: 'KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2' })),
    ['2', '16', '2', '2', '8', '5'],
  );
  const nested = run('chemistry-balance', { equation: 'Ca3(PO4)2 + H2SO4 -> CaSO4 + H3PO4' });
  assert.deepEqual(coefficients(nested), ['1', '3', '3', '2']);
  assert.ok(
    nested.tables
      .find((entry) => entry.title === '元素守恒核对')!
      .rows.every((row) => row.reactants === row.products && row.balanced),
  );
});
test('化学配平用确定性随机烷烃族的独立解析比例与原子计数核验', () => {
  let seed = 92821;
  for (let i = 0; i < 20; i++) {
    seed = (seed * 16807) % 2147483647;
    const n = (seed % 30) + 1;
    const denominator = (3 * n + 1) % 2 === 0 ? 2 : 1;
    const expected = [2, 3 * n + 1, 2 * n, 2 * n + 2].map((value) => String(value / denominator));
    const output = run('chemistry-balance', { equation: `C${n}H${2 * n + 2} + O2 -> CO2 + H2O` });
    const [fuel, oxygen, carbonDioxide, water] = coefficients(output).map(BigInt);
    assert.deepEqual(coefficients(output), expected);
    assert.equal(fuel * BigInt(n), carbonDioxide);
    assert.equal(fuel * BigInt(2 * n + 2), water * 2n);
    assert.equal(oxygen * 2n, carbonDioxide * 2n + water);
  }
});
test('不唯一、无守恒、非正系数、未知元素、离子与异常括号均返回400', () => {
  for (const equation of [
    'H2 + O2 -> H2O + H2O2',
    'H2 -> O2',
    'H2 -> H2 + O2',
    'Xx + O2 -> XxO2',
    'Fe2+ + Cl- -> FeCl2',
    '2H2 + O2 -> 2H2O',
    'Ca(OH2 + HCl -> CaCl2 + H2O',
    'H0 + O2 -> H2O',
    'H1001 + O2 -> H2O',
    'H2 -> -> H2O',
    'H2 + () -> H2',
    'H2 + O2 -> H2O;process.exit()',
  ])
    reject('chemistry-balance', { equation });
});
test('溶液核算单位一致，稀释前后溶质的量独立守恒', () => {
  const output = run('chemistry-solution');
  near(value(output, '物质的量'), 0.1);
  near(value(output, '原液摩尔浓度'), 0.1);
  near(value(output, '所需原液体积'), 50);
  near(value(output, '理想添加溶剂体积'), 200);
  near((Number(value(output, '原液摩尔浓度')) * Number(value(output, '所需原液体积'))) / 1000, 0.02 * 0.25);
});
test('零浓度避免0/0，不能用稀释增浓，原液量不足明确提醒', () => {
  const zero = run('chemistry-solution', { mass: 0, targetConcentration: 0 });
  near(value(zero, '所需原液体积'), 0);
  assert.ok(allNumbersFinite(zero));
  reject('chemistry-solution', { targetConcentration: 0.2 });
  reject('chemistry-solution', { molarMass: 0 });
  reject('chemistry-solution', { volumeMl: 0 });
  assert.ok(
    run('chemistry-solution', { targetVolumeMl: 10000 }).sections.some(
      (section) => section.status === 'warning',
    ),
  );
});
test('Aa×Aa与AA×aa独立孟德尔模型分别为1:2:1和全Aa', () => {
  const output = run('genetics-lab');
  near(value(output, 'AA概率'), 25);
  near(value(output, 'Aa概率'), 50);
  near(value(output, 'aa概率'), 25);
  near(value(output, '显性表型概率'), 75);
  near(value(run('genetics-lab', { parentA: 'AA', parentB: 'aa' }), 'Aa概率'), 100);
});
test('aa×aa概率为全隐性，非法等位基因不被猜测解释', () => {
  near(value(run('genetics-lab', { parentA: 'aa', parentB: 'aa' }), '隐性表型概率'), 100);
  reject('genetics-lab', { parentA: 'AB' });
  reject('genetics-lab', { parentA: 'aaa' });
});
test('球面赤道四分之一圆、跨日期变更线与距离对称性正确', () => {
  const output = run('geography-lab');
  near(value(output, '大圆距离'), (Math.PI * 6371) / 2);
  near(value(output, '初始方位角'), 90);
  const crossing = run('geography-lab', { lat1: 0, lon1: 179, lat2: 0, lon2: -179 });
  near(value(crossing, '大圆距离'), (6371 * Math.PI) / 90);
  near(value(crossing, '初始方位角'), 90);
  const forward = run('geography-lab', { lat1: 30, lon1: 20, lat2: -40, lon2: 110 });
  const backward = run('geography-lab', { lat2: 30, lon2: 20, lat1: -40, lon1: 110 });
  near(value(forward, '大圆距离'), Number(value(backward, '大圆距离')));
});
test('同点、对跖点和极点的初始方位不伪造，非法经纬度拒绝', () => {
  const same = run('geography-lab', { lat1: 31, lon1: 121, lat2: 31, lon2: 121 });
  near(value(same, '大圆距离'), 0);
  assert.match(String(value(same, '初始方位角')), /未定义/);
  const antipode = run('geography-lab', { lat1: 0, lon1: 0, lat2: 0, lon2: 180 });
  near(value(antipode, '大圆距离'), Math.PI * 6371);
  assert.match(String(value(antipode, '初始方位角')), /未定义/);
  assert.match(String(value(run('geography-lab', { lat1: 90 }), '初始方位角')), /未定义/);
  reject('geography-lab', { lat1: 91 });
  reject('geography-lab', { lon2: -181 });
});
test('水体混合按质量流率加权，独立核验出口加去除等于入口', () => {
  const output = run('environment-lab');
  near(value(output, '混合浓度'), 8);
  near(value(output, '混合质量负荷'), 3.2);
  near(value(output, '出口浓度'), 4);
  near(Number(value(output, '出口质量负荷')) + Number(value(output, '去除质量负荷')), 3.2);
  near(value(run('environment-lab', { flow1: 0, concentration1: 999, removalPercent: 0 }), '混合浓度'), 4);
});
test('水体100%去除归零，零总流量、负浓度或过大去除率拒绝', () => {
  near(value(run('environment-lab', { removalPercent: 100 }), '出口质量负荷'), 0);
  reject('environment-lab', { flow1: 0, flow2: 0 });
  reject('environment-lab', { concentration1: -1 });
  reject('environment-lab', { removalPercent: 101 });
});
test('农田需水深与田块体积按毫米立方米独立换算', () => {
  const output = run('agriculture-lab');
  near(value(output, '作物蒸散 ETc'), 44);
  near(value(output, '净需水深'), 34);
  near(value(output, '毛需水深'), 42.5);
  near(value(output, '净需水体积'), 340);
  near(value(output, '毛需水体积'), 425);
});
test('降雨充足需水归零，效率为1守恒，零效率或非法面积拒绝', () => {
  near(value(run('agriculture-lab', { rain: 100 }), '毛需水体积'), 0);
  near(value(run('agriculture-lab', { efficiency: 1 }), '毛需水体积'), 340);
  reject('agriculture-lab', { efficiency: 0 });
  reject('agriculture-lab', { area: -1 });
  reject('agriculture-lab', { kc: 4 });
});
test('食品简化能量和批次原料按比例核对，未列成分不算额外能量', () => {
  const output = run('food-science');
  near(value(output, '每100g简化能量'), 205);
  near(value(output, '每份简化能量'), 307.5);
  near(value(output, '整批简化能量'), 6150);
  near(value(output, '整批总质量'), 3);
  const rows = output.tables[0].rows;
  near(
    rows.reduce((total, row) => total + Number(row.batch), 0),
    3000,
  );
  assert.deepEqual(
    rows.slice(0, 3).map((row) => row.portion),
    [15, 45, 7.5],
  );
});
test('食品零成分能量为0，百分组成超100、非整数份数和负质量拒绝', () => {
  near(value(run('food-science', { protein: 0, carbs: 0, fat: 0 }), '整批简化能量'), 0);
  reject('food-science', { protein: 50, carbs: 50, fat: 1 });
  reject('food-science', { servings: 1.5 });
  reject('food-science', { portion: -1 });
});
test('全部科学计算器拒绝未知字段和非对象，不接受动态代码入口', () => {
  for (const module of scienceModules) reject(module.id, { source_code: 'process.exit(1)' });
  assert.throws(() => evaluateScienceModule('matrix-lab', null as never), BadRequestException);
  assert.throws(() => evaluateScienceModule('matrix-lab', [] as never), BadRequestException);
});
