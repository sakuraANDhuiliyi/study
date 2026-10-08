import { result, table, type StudyResult, type ResultCell } from './academics.types';
import {
  choice,
  ensureJson,
  fail,
  list,
  matrix,
  metric,
  num,
  parsed,
  rounded,
  str,
  type Inputs,
} from './tool-utils';

const fields: Record<string, string[]> = {
  'matrix-lab': ['operation', 'a', 'b'],
  'calculus-lab': ['coefficients', 'x', 'left', 'right', 'intervals'],
  'statistics-lab': ['x', 'y'],
  'probability-lab': ['trials', 'successes', 'probability'],
  'physics-motion': ['mode', 'speed', 'acceleration', 'time', 'angle', 'gravity'],
  'chemistry-balance': ['equation'],
  'chemistry-solution': ['mass', 'molarMass', 'volumeMl', 'targetConcentration', 'targetVolumeMl'],
  'genetics-lab': ['parentA', 'parentB'],
  'population-genetics': ['countAA', 'countAa', 'countaa'],
  'geography-lab': ['lat1', 'lon1', 'lat2', 'lon2'],
  'environment-lab': ['flow1', 'concentration1', 'flow2', 'concentration2', 'removalPercent'],
  'agriculture-lab': ['area', 'et0', 'kc', 'rain', 'efficiency'],
  'food-science': ['protein', 'carbs', 'fat', 'portion', 'servings'],
};
const r = (value: number) => rounded(value, 10);
const sum = (values: number[]) => {
  let total = 0,
    correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = total + adjusted;
    correction = next - total - adjusted;
    total = next;
  }
  return total;
};
const numericalNote = {
  title: '数值精度',
  content:
    '结果使用浮点计算并四舍五入展示。极端尺度、近奇异矩阵和很小的概率可能存在舍入误差；展示结果不代替精确符号证明。',
  status: 'info' as const,
};

function matrixTool(v: Inputs): StudyResult {
  const operation = choice(v, 'operation', ['multiply', 'determinant', 'rank', 'solve']);
  const a = matrix(v, 'a');
  const rows = a.length,
    columns = a[0].length;
  const matrixTable = (title: string, values: number[][]) =>
    table(
      title,
      [['row', '行'], ...values[0].map((_, i): [string, string] => [`c${i}`, `第${i + 1}列`])],
      values.map((row, i) =>
        Object.fromEntries([['row', i + 1], ...row.map((value, j) => [`c${j}`, r(value)])]),
      ) as Record<string, ResultCell>[],
    );
  if (operation === 'multiply') {
    const b = matrix(v, 'b');
    if (columns !== b.length) fail('矩阵相乘要求A的列数等于B的行数');
    const c = a.map((row) => b[0].map((_, j) => sum(row.map((value, k) => value * b[k][j]))));
    return result(
      '矩阵相乘完成：逐行与逐列做点积。',
      [metric('结果行数', rows), metric('结果列数', b[0].length)],
      [
        {
          title: '计算步骤',
          content: `C[i,j]=Σ A[i,k]B[k,j]。例如左上角：${a[0].map((value, k) => `${value}×${b[k][0]}`).join(' + ')} = ${r(c[0][0])}。交换A、B通常不能得到相同结果。`,
        },
        numericalNote,
      ],
      [matrixTable('乘积 A·B', c)],
    );
  }
  if (operation === 'determinant' && rows !== columns) fail('只有方阵具有本工具定义的行列式');
  let rhs: number[] | undefined;
  if (operation === 'solve') {
    const raw = parsed(v, 'b');
    const candidate =
      Array.isArray(raw) && raw.every((item) => Array.isArray(item) && item.length === 1)
        ? raw.map((item: number[]) => item[0])
        : raw;
    rhs = list({ b: candidate }, 'b', 10);
    if (rhs.length !== rows) fail('右端向量b的长度必须等于A的行数');
  }
  // Row scaling makes the pivot tolerance independent of the input's overall unit scale.
  const scales = a.map((row) => Math.max(...row.map(Math.abs)));
  const work = a.map((row, i) => {
    const divisor = scales[i] || (rhs ? Math.abs(rhs[i]) : 0) || 1;
    return [...row, ...(rhs ? [rhs[i]] : [])].map((value) => value / divisor);
  });
  const epsilon = 1e-12;
  const snapshots: Record<string, ResultCell>[] = [];
  const snapshot = (operationText: string) =>
    snapshots.push({
      step: snapshots.length,
      operation: operationText,
      matrix: JSON.stringify(work.map((row) => row.map(r))),
    });
  snapshot('按各行系数最大绝对值缩放；零系数行按右端常数缩放');
  const pivots: number[] = [];
  let pivotProduct = 1,
    swapSign = 1;
  for (let col = 0; col < columns && pivots.length < rows; col++) {
    const pivotRow = pivots.length;
    let best = pivotRow;
    for (let i = pivotRow + 1; i < rows; i++)
      if (Math.abs(work[i][col]) > Math.abs(work[best][col])) best = i;
    if (Math.abs(work[best][col]) <= epsilon) continue;
    let explanation = '';
    if (best !== pivotRow) {
      [work[best], work[pivotRow]] = [work[pivotRow], work[best]];
      swapSign *= -1;
      explanation = `交换R${best + 1}与R${pivotRow + 1}；`;
    }
    const pivot = work[pivotRow][col];
    pivotProduct *= pivot;
    work[pivotRow] = work[pivotRow].map((value) => value / pivot);
    for (let i = 0; i < rows; i++) {
      if (i === pivotRow) continue;
      const factor = work[i][col];
      for (let j = 0; j < work[i].length; j++) work[i][j] -= factor * work[pivotRow][j];
      work[i][col] = 0;
    }
    pivots.push(col);
    snapshot(`${explanation}R${pivotRow + 1}除以主元${r(pivot)}，再消去第${col + 1}列其余行`);
  }
  const rank = pivots.length;
  const sections: StudyResult['sections'] = [
    {
      title: '消元约定',
      content:
        '采用行缩放、列内最大绝对值选主元与Gauss–Jordan消元。缩放后小于等于1e−12的候选主元视为零；近奇异数据的数值秩可能与精确秩不同。',
    },
    numericalNote,
  ];
  const tables: StudyResult['tables'] = [
    matrixTable(rhs ? '最终增广矩阵（最后一列为右端）' : '最终行最简矩阵', work),
    table(
      '消元过程',
      [
        ['step', '步骤'],
        ['operation', '行变换'],
        ['matrix', '该步矩阵'],
      ],
      snapshots,
    ),
  ];
  if (operation === 'determinant') {
    const determinant =
      rank === columns ? scales.reduce((value, scale) => value * scale, swapSign * pivotProduct) : 0;
    sections.unshift({
      title: '行列式恢复',
      content: '消元后的主元乘积乘以初始各行缩放因子，再乘交换行的符号；若秩小于阶数则行列式为0。',
    });
    return result(
      '行列式与数值秩计算完成。',
      [metric('行列式', determinant), metric('秩', rank)],
      sections,
      tables,
    );
  }
  if (!rhs)
    return result(
      '主元个数给出矩阵的数值秩。',
      [metric('秩', rank), metric('行数', rows), metric('列数', columns)],
      sections,
      tables,
    );
  const inconsistent = work.some(
    (row) =>
      row.slice(0, columns).every((value) => Math.abs(value) <= epsilon) && Math.abs(row[columns]) > epsilon,
  );
  if (inconsistent) {
    sections.unshift({
      title: '无解原因',
      content: '消元出现形如0·x₁+…+0·xₙ=非零常数的矛盾行，因此不存在同时满足所有方程的解。',
      status: 'warning',
    });
    return result(
      '该线性方程组无解。',
      [metric('方程状态', '无解'), metric('系数矩阵秩', rank), metric('增广矩阵秩', rank + 1)],
      sections,
      tables,
    );
  }
  const solution = Array(columns).fill(0) as number[];
  pivots.forEach((col, row) => {
    solution[col] = work[row][columns];
  });
  const free = Array.from({ length: columns }, (_, i) => i).filter((col) => !pivots.includes(col));
  const residual = Math.max(
    ...a.map((row, i) => Math.abs(sum(row.map((value, j) => value * solution[j])) - rhs![i])),
  );
  tables.unshift(
    table(
      free.length ? '自由变量取0时的一组特解' : '唯一解',
      [
        ['variable', '变量'],
        ['value', '值'],
      ],
      solution.map((value, i) => ({ variable: `x${i + 1}`, value: r(value) })),
    ),
  );
  if (free.length) {
    const expressions = pivots.map(
      (col, row) =>
        `x${col + 1} = ${r(work[row][columns])}${free.map((freeCol, i) => ` − (${r(work[row][freeCol])})·t${i + 1}`).join('')}`,
    );
    sections.unshift({
      title: '通解与自由变量',
      content:
        [...free.map((col, i) => `x${col + 1}=t${i + 1}`), ...expressions].join('；') +
        '。参数可任取实数，特解只是其中一组。',
      status: 'info',
    });
  } else
    sections.unshift({
      title: '回代核验',
      content: '把解向量代入原始A·x−b，最大绝对残差用于检查计算误差。',
      status: 'success',
    });
  return result(
    free.length ? '该方程组有无穷多解，下面给出参数形式。' : '该方程组有唯一解。',
    [
      metric('方程状态', free.length ? '无穷多解' : '唯一解'),
      metric('系数矩阵秩', rank),
      metric('自由变量数', free.length),
      metric('最大绝对残差', residual),
    ],
    sections,
    tables,
  );
}

const polynomial = (coefficients: number[], x: number) =>
  coefficients.reduceRight((value, coefficient) => value * x + coefficient, 0);
function calculusTool(v: Inputs): StudyResult {
  const coefficients = list(v, 'coefficients', 12);
  const x = num(v, 'x'),
    left = num(v, 'left'),
    right = num(v, 'right');
  const intervals = num(v, 'intervals', 2, 2000, true);
  if (intervals % 2) fail('Simpson细分数量必须为正偶数');
  const derivative = coefficients.slice(1).map((value, i) => value * (i + 1));
  const primitive = [0, ...coefficients.map((value, i) => value / (i + 1))];
  const exact = polynomial(primitive, right) - polynomial(primitive, left);
  const h = (right - left) / intervals;
  const terms = Array.from(
    { length: intervals + 1 },
    (_, i) => polynomial(coefficients, left + i * h) * (i === 0 || i === intervals ? 1 : i % 2 ? 4 : 2),
  );
  const approximate = (h / 3) * sum(terms);
  const answer = result(
    '从低次到高次读取系数，比较原函数积分与复合Simpson结果。',
    [
      metric('函数值 f(x)', polynomial(coefficients, x)),
      metric('导数值 f′(x)', polynomial(derivative, x)),
      metric('定积分（原函数）', exact),
      metric('定积分（Simpson）', approximate),
      metric('绝对误差', Math.abs(approximate - exact)),
    ],
    [
      {
        title: '符号步骤',
        content: '第i项cᵢxⁱ求导得i·cᵢxⁱ⁻¹，积分得cᵢxⁱ⁺¹/(i+1)。原函数常数取0，定积分由F(上限)−F(下限)得到。',
      },
      {
        title: '数值步骤',
        content: `将区间分成${intervals}份，h=${r(h)}。Simpson权重依次为1、4、2、4、…、2、4、1，加权和乘h/3。交换上下限会改变积分符号；上下限相同则积分为0。`,
      },
      numericalNote,
    ],
    [
      table(
        '各项系数',
        [
          ['power', '原次数'],
          ['coefficient', '原系数'],
          ['derivative', '求导后系数'],
          ['primitive', '积分后系数'],
        ],
        coefficients.map((value, i) => ({
          power: i,
          coefficient: value,
          derivative: r(i * value),
          primitive: r(value / (i + 1)),
        })),
      ),
    ],
  );
  answer.chart = {
    title: '积分区间内函数采样',
    points: Array.from({ length: left === right ? 1 : 101 }, (_, i) => {
      const position = left + ((right - left) * i) / 100;
      return { x: r(position), y: r(polynomial(coefficients, position)) };
    }),
  };
  return answer;
}

function statisticsTool(v: Inputs): StudyResult {
  const x = list(v, 'x');
  const sorted = [...x].sort((a, b) => a - b);
  const quantile = (p: number) => {
    const position = (x.length - 1) * p,
      lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  };
  const mean = x[0] + sum(x.map((value) => value - x[0])) / x.length;
  const sxx = sum(x.map((value) => (value - mean) ** 2));
  const populationVariance = sxx / x.length;
  const output = result(
    '描述统计已完成，分位数采用排序位置线性插值。',
    [
      metric('样本数量', x.length),
      metric('均值', mean),
      metric('中位数', quantile(0.5)),
      metric('第一四分位数', quantile(0.25)),
      metric('第三四分位数', quantile(0.75)),
      metric('最小值', sorted[0]),
      metric('最大值', sorted[sorted.length - 1]),
      metric('总体方差', populationVariance),
      metric('总体标准差', Math.sqrt(populationVariance)),
      metric('样本方差', x.length > 1 ? sxx / (x.length - 1) : '未定义（n=1）'),
      metric('样本标准差', x.length > 1 ? Math.sqrt(sxx / (x.length - 1)) : '未定义（n=1）'),
    ],
    [
      {
        title: '计算约定',
        content:
          'Q(p)的位置为(n−1)p，在左右排序值之间线性插值。总体方差除以n，样本方差除以n−1；单个观测没有可定义的样本方差。相关和回归描述线性关联，不能据此推断因果。',
      },
      numericalNote,
    ],
    [
      table(
        '排序数据',
        [
          ['position', '序号'],
          ['value', '值'],
        ],
        sorted.map((value, i) => ({ position: i + 1, value })),
      ),
    ],
  );
  if (v.y === undefined || (typeof v.y === 'string' && !v.y.trim())) return output;
  const y = list(v, 'y');
  if (y.length !== x.length) fail('成对数据x与y的长度必须相同');
  const meanY = y[0] + sum(y.map((value) => value - y[0])) / y.length;
  const syy = sum(y.map((value) => (value - meanY) ** 2));
  const sxy = sum(x.map((value, i) => (value - mean) * (y[i] - meanY)));
  if (!sxx) {
    output.metrics.push(metric('拟合斜率', '未定义（x无变化）'), metric('相关系数', '未定义（x无变化）'));
    output.sections.unshift({
      title: '无法确定拟合直线',
      content: '所有x相同，斜率分母Σ(x−均值)²为0，因此无法识别唯一的斜率与截距。',
      status: 'warning',
    });
  } else {
    const slope = sxy / sxx,
      intercept = meanY - slope * mean;
    const correlation = syy ? Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))) : undefined;
    output.metrics.push(
      metric('拟合斜率', slope),
      metric('拟合截距', intercept),
      metric('相关系数', correlation ?? '未定义（y无变化）'),
    );
    output.sections.unshift({
      title: '最小二乘拟合',
      content: `斜率=Σ(x−x̄)(y−ȳ)/Σ(x−x̄)²，截距=ȳ−斜率·x̄。得到 y=${r(intercept)} + (${r(slope)})x。${syy ? '' : 'y为常数时仍可拟合水平线，但相关系数分母为0。'}`,
    });
    output.tables.push(
      table(
        '配对数据与残差',
        [
          ['x', 'x'],
          ['y', 'y'],
          ['predicted', '拟合值'],
          ['residual', 'y−拟合值'],
        ],
        x.map((value, i) => ({
          x: value,
          y: y[i],
          predicted: r(intercept + slope * value),
          residual: r(y[i] - intercept - slope * value),
        })),
      ),
    );
  }
  output.chart = { title: '成对数据散点', points: x.map((value, i) => ({ x: value, y: y[i] })) };
  return output;
}

function probabilityTool(v: Inputs): StudyResult {
  const n = num(v, 'trials', 0, 200, true),
    k = num(v, 'successes', 0, 200, true),
    p = num(v, 'probability', 0, 1);
  if (k > n) fail('成功次数k不能大于试验次数n');
  const weights = Array(n + 1).fill(0) as number[];
  if (p === 0 || p === 1) weights[p === 0 ? 0 : n] = 1;
  else {
    // Recur away from the mode: ratios stay bounded and avoid factorial overflow/tail underflow at the origin.
    const mode = Math.min(n, Math.floor((n + 1) * p));
    weights[mode] = 1;
    for (let i = mode; i > 0; i--) weights[i - 1] = weights[i] * (i / (n - i + 1)) * ((1 - p) / p);
    for (let i = mode; i < n; i++) weights[i + 1] = weights[i] * ((n - i) / (i + 1)) * (p / (1 - p));
    const total = sum(weights);
    for (let i = 0; i <= n; i++) weights[i] /= total;
  }
  const cumulative = sum(weights.slice(0, k + 1));
  const output = result(
    '二项分布计算完成；每次试验须独立且具有相同成功概率。',
    [
      metric('恰好k次概率', weights[k]),
      metric('至多k次概率', cumulative),
      metric('至少k次概率', sum(weights.slice(k))),
      metric('期望', n * p),
      metric('方差', n * p * (1 - p)),
      metric('概率总和', sum(weights)),
    ],
    [
      {
        title: '公式与稳定计算',
        content:
          'P(X=k)=C(n,k)pᵏ(1−p)ⁿ⁻ᵏ。计算从众数附近开始向两侧递推并归一化，避免直接计算大阶乘；p=0或1分别退化为X=0或X=n，n=0只有X=0。',
      },
      numericalNote,
    ],
    [
      table(
        '完整概率分布',
        [
          ['successes', '成功次数'],
          ['probability', '概率'],
        ],
        weights.map((value, i) => ({ successes: i, probability: r(value) })),
      ),
    ],
  );
  output.chart = { title: '二项分布', points: weights.map((value, i) => ({ x: i, y: r(value) })) };
  return output;
}

function physicsTool(v: Inputs): StudyResult {
  const mode = choice(v, 'mode', ['linear', 'projectile']);
  const speed = num(v, 'speed', 0, 10000);
  if (mode === 'linear') {
    const acceleration = num(v, 'acceleration', -10000, 10000),
      time = num(v, 'time', 0, 10000);
    const position = (t: number) => speed * t + (acceleration * t * t) / 2;
    const output = result(
      '匀加速直线运动计算完成，位移带有相对正方向的符号。',
      [metric('末速度', speed + acceleration * time, 'm/s'), metric('位移', position(time), 'm')],
      [
        {
          title: '代入公式',
          content: `v=v₀+at=${speed}+(${acceleration})×${time}。s=v₀t+at²/2；加速度在整个时间段保持恒定。负位移不等于负路程，物体可能在期间改变方向。`,
        },
      ],
    );
    output.chart = {
      title: '时间—位移',
      points: Array.from({ length: time ? 41 : 1 }, (_, i) => ({
        x: r((time * i) / 40),
        y: r(position((time * i) / 40)),
      })),
    };
    return output;
  }
  const angle = num(v, 'angle', 0, 90),
    gravity = num(v, 'gravity', 0.01, 100);
  const radians = (angle * Math.PI) / 180;
  const vx = angle === 90 ? 0 : speed * Math.cos(radians),
    vy = speed * Math.sin(radians);
  const flight = (2 * vy) / gravity,
    range = vx * flight,
    height = (vy * vy) / (2 * gravity);
  const output = result(
    '同高起落抛体计算完成，轨迹只使用理想重力模型。',
    [
      metric('水平初速度', vx, 'm/s'),
      metric('竖直初速度', vy, 'm/s'),
      metric('飞行时间', flight, 's'),
      metric('水平射程', range, 'm'),
      metric('最高高度', height, 'm'),
      metric('到达最高点时间', vy / gravity, 's'),
    ],
    [
      {
        title: '分解与计算',
        content: `角度${angle}°先转换成弧度。vₓ=v₀cosθ，vᵧ=v₀sinθ；T=2vᵧ/g，R=vₓT，H=vᵧ²/(2g)。轨迹x=vₓt，y=vᵧt−gt²/2。`,
      },
      {
        title: '适用条件',
        content:
          '忽略空气阻力，落地点与发射点等高，重力恒定。水平发射或初速度为0时，同高模型的飞行时间为0；不同高度落地需另建方程。',
        status: 'info',
      },
    ],
  );
  output.chart = {
    title: '水平位置—高度（m）',
    points: Array.from({ length: flight ? 41 : 1 }, (_, i) => {
      const t = (flight * i) / 40;
      return { x: r(vx * t), y: r(Math.max(0, vy * t - (gravity * t * t) / 2)) };
    }),
  };
  return output;
}

type Fraction = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
const fraction = (n: bigint, d = 1n): Fraction => {
  if (!d) fail('配平出现无效除数');
  if (!n) return { n: 0n, d: 1n };
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  n /= divisor;
  d /= divisor;
  if (n.toString().length > 200 || d.toString().length > 200) fail('反应式过于复杂，请减少物质或下标');
  return { n, d };
};
const subtract = (a: Fraction, b: Fraction) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);
const divide = (a: Fraction, b: Fraction) => fraction(a.n * b.d, a.d * b.n);
const elements = new Set(
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(
    ' ',
  ),
);
function chemicalFormula(formula: string): Map<string, bigint> {
  if (!formula || formula.length > 160 || /[^A-Za-z0-9()]/.test(formula))
    fail('化学式仅支持中性分子、元素符号、正整数下标与圆括号');
  let cursor = 0;
  const count = () => {
    const start = cursor;
    while (cursor < formula.length && /[0-9]/.test(formula[cursor])) cursor++;
    if (start === cursor) return 1n;
    const digits = formula.slice(start, cursor);
    if (digits.length > 4 || digits.startsWith('0') || Number(digits) > 1000)
      fail('原子下标必须为1至1000的正整数且没有前导0');
    return BigInt(digits);
  };
  const group = (depth: number): Map<string, bigint> => {
    if (depth > 6) fail('化学式括号嵌套最多6层');
    const atoms = new Map<string, bigint>();
    while (cursor < formula.length && formula[cursor] !== ')') {
      let part: Map<string, bigint>;
      if (formula[cursor] === '(') {
        cursor++;
        part = group(depth + 1);
        if (formula[cursor] !== ')' || !part.size) fail('化学式括号不匹配或为空');
        cursor++;
      } else {
        if (!/[A-Z]/.test(formula[cursor])) fail('化学式元素必须正确区分大小写，分子前不填写系数');
        let symbol = formula[cursor++];
        if (cursor < formula.length && /[a-z]/.test(formula[cursor])) symbol += formula[cursor++];
        if (!elements.has(symbol)) fail('化学式包含未知元素符号');
        part = new Map([[symbol, 1n]]);
      }
      const multiplier = count();
      for (const [element, amount] of part) {
        const next = (atoms.get(element) ?? 0n) + amount * multiplier;
        if (next > 1_000_000n) fail('每种元素的原子数最多1000000');
        atoms.set(element, next);
      }
    }
    return atoms;
  };
  const atoms = group(0);
  if (cursor !== formula.length || !atoms.size) fail('化学式括号不匹配或没有元素');
  return atoms;
}
function chemistryBalanceTool(v: Inputs): StudyResult {
  const equation = str(v, 'equation', 1000).replace(/\s+/g, '');
  const sides = equation.split(/->|→|=/);
  if (sides.length !== 2 || !sides.every(Boolean)) fail('反应式需要且只能有一个箭头 ->，两边都应有物质');
  const left = sides[0].split('+'),
    right = sides[1].split('+'),
    compounds = [...left, ...right];
  if (compounds.length > 12) fail('配平最多支持12种物质');
  const atoms = compounds.map(chemicalFormula);
  const usedElements = [...new Set(atoms.flatMap((item) => [...item.keys()]))];
  const conservation = usedElements.map((element) =>
    atoms.map((item, i) => (item.get(element) ?? 0n) * (i < left.length ? 1n : -1n)),
  );
  const work = conservation.map((row) => row.map((value) => fraction(value)));
  const pivots: number[] = [];
  for (let col = 0; col < compounds.length && pivots.length < usedElements.length; col++) {
    const row = pivots.length;
    const found = work.findIndex((values, i) => i >= row && values[col].n !== 0n);
    if (found < 0) continue;
    [work[row], work[found]] = [work[found], work[row]];
    const pivot = work[row][col];
    work[row] = work[row].map((value) => divide(value, pivot));
    for (let i = 0; i < work.length; i++) {
      if (i === row || !work[i][col].n) continue;
      const factor = work[i][col];
      work[i] = work[i].map((value, j) => subtract(value, multiply(factor, work[row][j])));
    }
    pivots.push(col);
  }
  const free = compounds.map((_, i) => i).filter((col) => !pivots.includes(col));
  if (free.length !== 1)
    fail(
      free.length ? '配平比例不唯一，请拆分独立反应或检查物质列表' : '这些物质不能满足元素守恒，请检查反应式',
    );
  const solution = compounds.map(() => fraction(0n));
  solution[free[0]] = fraction(1n);
  pivots.forEach((col, row) => {
    solution[col] = fraction(-work[row][free[0]].n, work[row][free[0]].d);
  });
  const denominator = solution.reduce((value, item) => (value / gcd(value, item.d)) * item.d, 1n);
  let coefficients = solution.map((item) => item.n * (denominator / item.d));
  if (coefficients.every((value) => value < 0n)) coefficients = coefficients.map((value) => -value);
  if (coefficients.some((value) => value <= 0n)) fail('无法得到全部为正的配平系数，请检查物质位于箭头哪一侧');
  const divisor = coefficients.reduce((value, item) => gcd(value, item), 0n);
  coefficients = coefficients.map((value) => value / divisor);
  const conservationRows = usedElements.map((element) => {
    let before = 0n,
      after = 0n;
    atoms.forEach((item, i) => {
      const amount = (item.get(element) ?? 0n) * coefficients[i];
      if (i < left.length) before += amount;
      else after += amount;
    });
    if (before !== after) fail('元素守恒核验失败，未生成配平结果');
    return { element, reactants: before.toString(), products: after.toString(), balanced: true };
  });
  const display = (formula: string, i: number) =>
    `${coefficients[i] === 1n ? '' : `${coefficients[i]} `}${formula}`;
  const balanced = `${left.map((formula, i) => display(formula, i)).join(' + ')} → ${right.map((formula, i) => display(formula, i + left.length)).join(' + ')}`;
  return result(
    balanced,
    [
      metric('物质数量', compounds.length),
      metric('元素数量', usedElements.length),
      metric('守恒矩阵秩', pivots.length),
      metric('零空间维度', free.length),
    ],
    [
      {
        title: '配平步骤',
        content:
          '解析每个分子的原子计数；给反应物列正号、生成物列负号，建立A·c=0。用BigInt有理数精确消元，唯一自由变量取1；分母最小公倍数化为整数，再除系数最大公约数。所有系数必须为正，最后逐元素重新核验。',
        status: 'success',
      },
      {
        title: '模型范围',
        content:
          '支持中性分子和圆括号，不支持离子、电荷、电子、结晶水点号及物态标记。配平只证明原子数量守恒，不证明该反应在实际条件下会发生。',
        status: 'info',
      },
    ],
    [
      table(
        '最简整数系数',
        [
          ['side', '位置'],
          ['formula', '化学式'],
          ['coefficient', '系数'],
        ],
        compounds.map((formula, i) => ({
          side: i < left.length ? '反应物' : '生成物',
          formula,
          coefficient: coefficients[i].toString(),
        })),
      ),
      table(
        '元素守恒核对',
        [
          ['element', '元素'],
          ['reactants', '反应物原子数'],
          ['products', '生成物原子数'],
          ['balanced', '守恒'],
        ],
        conservationRows,
      ),
      table(
        '元素守恒矩阵',
        [
          ['element', '元素'],
          ...compounds.map((formula, i): [string, string] => [`c${i}`, `${i + 1}: ${formula}`]),
        ],
        conservation.map(
          (row, i) =>
            Object.fromEntries([
              ['element', usedElements[i]],
              ...row.map((value, j) => [`c${j}`, value.toString()]),
            ]) as Record<string, ResultCell>,
        ),
      ),
    ],
  );
}

function chemistrySolutionTool(v: Inputs): StudyResult {
  const mass = num(v, 'mass', 0, 1e6),
    molarMass = num(v, 'molarMass', 0.001, 1e6),
    volume = num(v, 'volumeMl', 0.001, 1e9);
  const target = num(v, 'targetConcentration', 0, 1e6),
    targetVolume = num(v, 'targetVolumeMl', 0.001, 1e9);
  const amount = mass / molarMass,
    concentration = amount / (volume / 1000);
  if (target > concentration + Math.max(target, concentration) * 1e-12)
    fail('目标浓度高于原液，不能只通过加溶剂稀释达到');
  const stock = concentration ? (target * targetVolume) / concentration : 0;
  const solvent = Math.max(0, targetVolume - stock);
  const sections: StudyResult['sections'] = [
    {
      title: '单位与守恒',
      content: `先把${volume} mL换成${r(volume / 1000)} L，再按n=m/M、c=n/V计算。由c₁V₁=c₂V₂得所需原液体积。这里的溶剂量采用体积可加的理想课堂模型；真实混合体积可能不完全可加。`,
    },
    {
      title: '零浓度边界',
      content:
        '目标浓度为0时，可取0 mL原液。原液也是0浓度时原液比例并不唯一，此处约定取0，模型不输出无定义的0/0。',
      status: 'info',
    },
  ];
  if (stock > volume + Math.max(stock, volume) * 1e-12)
    sections.push({
      title: '给定原液量不足',
      content: '按守恒算出的所需原液体积大于本次配制的原液总体积，请在课程记录中注明这一条件。',
      status: 'warning',
    });
  return result(
    '浓度与理想稀释核算完成。',
    [
      metric('物质的量', amount, 'mol'),
      metric('原液摩尔浓度', concentration, 'mol/L'),
      metric('所需原液体积', stock, 'mL'),
      metric('理想添加溶剂体积', solvent, 'mL'),
      metric('目标溶质物质的量', (target * targetVolume) / 1000, 'mol'),
    ],
    sections,
  );
}

function geneticsTool(v: Inputs): StudyResult {
  const parentA = choice(v, 'parentA', ['AA', 'Aa', 'aa']),
    parentB = choice(v, 'parentB', ['AA', 'Aa', 'aa']);
  const counts: Record<string, number> = { AA: 0, Aa: 0, aa: 0 };
  const rows: Record<string, ResultCell>[] = [];
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const genotype = [parentA[i], parentB[j]].sort().join('');
      counts[genotype]++;
      rows.push({
        gameteA: parentA[i],
        gameteB: parentB[j],
        genotype,
        phenotype: genotype === 'aa' ? '隐性' : '显性',
        probability: 0.25,
      });
    }
  return result(
    `${parentA} × ${parentB} 的单基因遗传棋盘。`,
    [
      metric('AA概率', counts.AA * 25, '%'),
      metric('Aa概率', counts.Aa * 25, '%'),
      metric('aa概率', counts.aa * 25, '%'),
      metric('显性表型概率', (counts.AA + counts.Aa) * 25, '%'),
      metric('隐性表型概率', counts.aa * 25, '%'),
    ],
    [
      {
        title: '从配子到基因型',
        content:
          '每个亲本的两个等位基因各以1/2概率进入配子；两两组合有四个等概率格。把aA规范为Aa，再合并相同基因型。相同字母出现两次仍表示两个等概率配子来源。',
      },
      {
        title: '模型条件',
        content:
          '假设二倍体、单基因、随机受精且A对a完全显性。概率是模型中的长期比例，并不保证有限后代恰好具有该比例。',
        status: 'info',
      },
    ],
    [
      table(
        'Punnett棋盘',
        [
          ['gameteA', '亲本一配子'],
          ['gameteB', '亲本二配子'],
          ['genotype', '子代基因型'],
          ['phenotype', '完全显性下表型'],
          ['probability', '该格概率'],
        ],
        rows,
      ),
    ],
  );
}

function populationGeneticsTool(v: Inputs): StudyResult {
  const observed = [
    num(v, 'countAA', 0, 1e6, true),
    num(v, 'countAa', 0, 1e6, true),
    num(v, 'countaa', 0, 1e6, true),
  ];
  const total = observed[0] + observed[1] + observed[2];
  if (total === 0) fail('AA、Aa、aa 的观察计数总和必须大于0');
  const alleleA = 2 * observed[0] + observed[1],
    allelea = 2 * observed[2] + observed[1],
    p = alleleA / (2 * total),
    q = allelea / (2 * total);
  const genotypes = ['AA', 'Aa', 'aa'];
  // These are the integer numerators of p², 2pq, q². Every intermediate is
  // below 2^53 for the bounded counts. The equivalent fractions avoid a tiny
  // cancellation residual for exact examples without rounding rare alleles to zero.
  const numerators = [alleleA * alleleA, 2 * alleleA * allelea, allelea * allelea];
  const denominator = 4 * total;
  const rows = genotypes.map((genotype, i) => {
    const expectedCount = numerators[i] / denominator;
    const countDifference = (observed[i] * denominator - numerators[i]) / denominator;
    return {
      genotype,
      observedCount: observed[i],
      observedFrequency: r(observed[i] / total),
      expectedCount: r(expectedCount),
      expectedFrequency: r(numerators[i] / (denominator * total)),
      countDifference: r(countDifference),
      frequencyDifference: r(countDifference / total),
    };
  });
  const output = result(
    '已按观察计数计算等位基因频率与 Hardy–Weinberg 模型期望；差值用于课堂比较。',
    [
      metric('个体总数 N', total),
      metric('A 等位基因数', alleleA),
      metric('a 等位基因数', allelea),
      { label: 'A 频率 p', value: r(p) },
      { label: 'a 频率 q', value: r(q) },
    ],
    [
      {
        title: '等位基因计数',
        content: `共有 ${total} 个二倍体个体，在这个位点共有 ${2 * total} 份等位基因。A 的份数为 2×${observed[0]}+${observed[1]}=${alleleA}，a 的份数为 2×${observed[2]}+${observed[1]}=${allelea}。分别除以 2N 得到 p 和 q；两者相加为1。`,
        status: 'info',
      },
      {
        title: '随机结合模型',
        content:
          '在二倍体、同一常染色体位点仅有 A/a 两种等位基因的课堂模型中，按当前 p、q 独立随机结合，AA、Aa、aa 的期望频率分别为 p²、2pq、q²。Aa 包含先取 A 后取 a 与先取 a 后取 A 两种顺序。期望频率乘以 N 得到期望个体数。',
        status: 'info',
      },
      {
        title: '如何阅读差值',
        content:
          '差值统一为观察减期望：正数表示该行观察值较多，负数表示较少。期望数量可以是小数，它是模型平均值，不是对个体取整分配。差值为零不能证明真实群体处于平衡，非零也不能据此确定原因；本实验不进行显著性检验或能力评分。',
        status: 'info',
      },
      {
        title: '模型范围与精度',
        content:
          '跨代维持 Hardy–Weinberg 理想状态还依赖随机交配、足够大群体，以及无选择、突变和迁移等条件。本次仅核算给定计数对应的数学期望，不检验这些条件，也不预测个人性状或健康。A/a 是等位基因标签，不包含显隐性判断。计算使用未舍入的计数和比例，最后按有效数字展示；显示值求和可能有微小舍入差。记录中的“已完成”只表示完成一次实验。',
        status: 'info',
      },
    ],
    [
      table(
        '观察与模型期望',
        [
          ['genotype', '基因型'],
          ['observedCount', '观察计数'],
          ['observedFrequency', '观察频率'],
          ['expectedCount', '模型期望计数'],
          ['expectedFrequency', '模型期望频率'],
          ['countDifference', '计数差（观察−期望）'],
          ['frequencyDifference', '频率差（观察−期望）'],
        ],
        rows,
      ),
    ],
  );
  output.categoryChart = {
    title: '观察计数与模型期望计数',
    categories: genotypes,
    series: [
      { name: '观察计数', values: rows.map((row) => row.observedCount) },
      { name: '模型期望计数', values: rows.map((row) => row.expectedCount) },
    ],
    yAxisLabel: '个体数',
  };
  return output;
}

function geographyTool(v: Inputs): StudyResult {
  const lat1 = num(v, 'lat1', -90, 90),
    lon1 = num(v, 'lon1', -180, 180),
    lat2 = num(v, 'lat2', -90, 90),
    lon2 = num(v, 'lon2', -180, 180);
  const radians = Math.PI / 180,
    a = lat1 * radians,
    b = lat2 * radians,
    longitude = (lon2 - lon1) * radians;
  const haversine = Math.min(
    1,
    Math.max(0, Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(longitude / 2) ** 2),
  );
  let arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  if (arc < 1e-12) arc = 0;
  const undefinedBearing = arc === 0 || Math.abs(Math.PI - arc) < 1e-12 || Math.abs(Math.cos(a)) < 1e-12;
  const bearing =
    (Math.atan2(
      Math.sin(longitude) * Math.cos(b),
      Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(longitude),
    ) /
      radians +
      360) %
    360;
  return result(
    '球面大圆距离计算完成，采用平均地球半径6371 km。',
    [
      metric('大圆距离', 6371 * arc, 'km'),
      metric('圆心角', arc / radians, '°'),
      metric(
        '初始方位角',
        undefinedBearing ? '未定义（同点、对跖点或极点）' : bearing,
        undefinedBearing ? undefined : '°',
      ),
    ],
    [
      {
        title: '计算步骤',
        content:
          '将经纬度从度转为弧度。h=sin²(Δ纬度/2)+cos纬度₁cos纬度₂sin²(Δ经度/2)，圆心角=2atan2(√h,√(1−h))，距离=6371×圆心角。方位角从正北顺时针计量。',
      },
      {
        title: '几何边界',
        content:
          '同一点没有出发方向；对跖点的大圆路径不唯一；从极点出发时正北参考方向不唯一。这些情况保留距离，但不伪造方位角。此处不包含椭球修正、道路和地形。',
        status: 'info',
      },
      numericalNote,
    ],
  );
}

function environmentTool(v: Inputs): StudyResult {
  const q1 = num(v, 'flow1', 0, 1e9),
    q2 = num(v, 'flow2', 0, 1e9),
    c1 = num(v, 'concentration1', 0, 1e9),
    c2 = num(v, 'concentration2', 0, 1e9),
    removal = num(v, 'removalPercent', 0, 100) / 100;
  const total = q1 + q2;
  if (!total) fail('至少一股水流的流量必须大于0');
  const load = (q1 * c1 + q2 * c2) / 1000,
    concentration = (load * 1000) / total;
  const output = concentration * (1 - removal);
  return result(
    '两股水流的理想混合与质量负荷核算完成。',
    [
      metric('总流量', total, 'm³/day'),
      metric('混合浓度', concentration, 'mg/L'),
      metric('混合质量负荷', load, 'kg/day'),
      metric('出口浓度', output, 'mg/L'),
      metric('出口质量负荷', load * (1 - removal), 'kg/day'),
      metric('去除质量负荷', load * removal, 'kg/day'),
    ],
    [
      {
        title: '质量守恒步骤',
        content:
          '先将两股流量分别乘浓度得到各自质量流率，再相加除以总流量。m³到L乘1000，mg到kg除1000000，因此Q·C/1000得到kg/day。出口和去除负荷之和等于入口负荷。',
      },
      {
        title: '模型边界',
        content:
          '假设完全混合、恒定流量，无额外反应或损失；去除率只作用于所测物。结果不用于判定排放是否合规。',
        status: 'info',
      },
    ],
    [
      table(
        '各股质量流率',
        [
          ['flow', '水流'],
          ['volume', '流量m³/day'],
          ['concentration', '浓度mg/L'],
          ['load', '负荷kg/day'],
        ],
        [
          { flow: '入口一', volume: q1, concentration: c1, load: r((q1 * c1) / 1000) },
          { flow: '入口二', volume: q2, concentration: c2, load: r((q2 * c2) / 1000) },
        ],
      ),
    ],
  );
}

function agricultureTool(v: Inputs): StudyResult {
  const area = num(v, 'area', 0.01, 1e9),
    et0 = num(v, 'et0', 0, 10000),
    kc = num(v, 'kc', 0, 3),
    rain = num(v, 'rain', 0, 10000),
    efficiency = num(v, 'efficiency', 0.01, 1);
  const etc = kc * et0,
    net = Math.max(etc - rain, 0),
    gross = net / efficiency;
  return result(
    '给定期间的简化农田水量核算完成。',
    [
      metric('作物蒸散 ETc', etc, 'mm'),
      metric('净需水深', net, 'mm'),
      metric('毛需水深', gross, 'mm'),
      metric('净需水体积', (net * area) / 1000, 'm³'),
      metric('毛需水体积', (gross * area) / 1000, 'm³'),
    ],
    [
      {
        title: '计算步骤',
        content: `ETc=Kc×ET0=${kc}×${et0}。净需水深=max(ETc−有效降雨,0)，毛需水深=净需水深/${efficiency}。水深mm乘面积m²再除1000得到m³。降雨超过蒸散时，课程模型把需水截断为0。`,
      },
      {
        title: '给定条件',
        content:
          '只处理题目给定参数，忽略土壤储水变化与其他通量。工具不推荐现实作物系数，也不生成实际灌溉计划。',
        status: 'info',
      },
    ],
  );
}

function foodTool(v: Inputs): StudyResult {
  const protein = num(v, 'protein', 0, 100),
    carbs = num(v, 'carbs', 0, 100),
    fat = num(v, 'fat', 0, 100),
    portion = num(v, 'portion', 0.01, 1e6),
    servings = num(v, 'servings', 1, 10000, true);
  if (protein + carbs + fat > 100 + 1e-10) fail('每100g中的蛋白质、碳水和脂肪总和不能超过100g');
  const scale = portion / 100,
    energy100 = 4 * protein + 4 * carbs + 9 * fat;
  return result(
    '按每100g组成完成单份和整批比例换算。',
    [
      metric('每100g简化能量', energy100, 'kcal'),
      metric('每份简化能量', energy100 * scale, 'kcal'),
      metric('整批简化能量', energy100 * scale * servings, 'kcal'),
      metric('整批总质量', (portion * servings) / 1000, 'kg'),
    ],
    [
      {
        title: '比例计算',
        content: `每100g组成乘${portion}/100得到每份，再乘${servings}得到整批。能量按蛋白质4、可利用碳水4、脂肪9 kcal/g计算。剩余质量可由水分或其他未列成分构成，不能自动当作额外碳水。`,
      },
      {
        title: '课程模型',
        content: '简化因子不覆盖全部成分、消化率或个体需求。结果用于比例和单位练习，不是膳食建议。',
        status: 'info',
      },
    ],
    [
      table(
        '配料放大',
        [
          ['component', '组成'],
          ['per100', '每100g含量g'],
          ['portion', '每份含量g'],
          ['batch', '整批含量g'],
        ],
        [
          ['蛋白质', protein],
          ['碳水化合物', carbs],
          ['脂肪', fat],
          ['其他组成', Math.max(0, 100 - protein - carbs - fat)],
        ].map(([component, value]) => ({
          component: String(component),
          per100: Number(value),
          portion: r(Number(value) * scale),
          batch: r(Number(value) * scale * servings),
        })),
      ),
    ],
  );
}

/** Fixed calculators only: no expressions, executable code, external requests or dynamic evaluation. */
export function evaluateScienceModule(moduleId: string, values: Inputs): StudyResult | undefined {
  const allowed = Object.prototype.hasOwnProperty.call(fields, moduleId) ? fields[moduleId] : undefined;
  if (!allowed) return undefined;
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail('计算参数必须是对象');
  ensureJson(values);
  if (Object.keys(values).some((key) => !allowed.includes(key))) fail('计算参数包含未知字段');
  switch (moduleId) {
    case 'matrix-lab':
      return matrixTool(values);
    case 'calculus-lab':
      return calculusTool(values);
    case 'statistics-lab':
      return statisticsTool(values);
    case 'probability-lab':
      return probabilityTool(values);
    case 'physics-motion':
      return physicsTool(values);
    case 'chemistry-balance':
      return chemistryBalanceTool(values);
    case 'chemistry-solution':
      return chemistrySolutionTool(values);
    case 'genetics-lab':
      return geneticsTool(values);
    case 'population-genetics':
      return populationGeneticsTool(values);
    case 'geography-lab':
      return geographyTool(values);
    case 'environment-lab':
      return environmentTool(values);
    case 'agriculture-lab':
      return agricultureTool(values);
    case 'food-science':
      return foodTool(values);
    default:
      return undefined;
  }
}
