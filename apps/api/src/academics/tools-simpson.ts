import { result, table, type StudyResult } from './academics.types';
import { ensureJson, fail, num, rounded, type Inputs } from './tool-utils';

const keys = ['aSuccess1', 'aTotal1', 'bSuccess1', 'bTotal1', 'aSuccess2', 'aTotal2', 'bSuccess2', 'bTotal2'];
type Fraction = { numerator: bigint; denominator: bigint };
function fraction(numerator: bigint, denominator: bigint): Fraction {
  let a = numerator < 0n ? -numerator : numerator,
    b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}
const ratio = (numerator: number, denominator: number) => fraction(BigInt(numerator), BigInt(denominator));
const add = (a: Fraction, b: Fraction) =>
  fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
const subtract = (a: Fraction, b: Fraction) =>
  fraction(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
const multiply = (a: Fraction, b: Fraction) =>
  fraction(a.numerator * b.numerator, a.denominator * b.denominator);
const sign = (value: Fraction) => (value.numerator > 0n ? 1 : value.numerator < 0n ? -1 : 0);
const direction = (value: Fraction) =>
  sign(value) > 0 ? '方案A较高' : sign(value) < 0 ? '方案B较高' : '持平';
// Only the presentation boundary converts to Number; comparisons and differences stay exact.
const shown = (value: Fraction, percent = false) =>
  rounded(Number(value.numerator * (percent ? 100n : 1n)) / Number(value.denominator), 10);

/** A bounded two-stratum classroom calculation. No randomness, providers or executable inputs. */
export function evaluateSimpsonParadox(values: Inputs): StudyResult {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail('计算参数必须是对象');
  ensureJson(values);
  if (Object.keys(values).some((key) => !keys.includes(key))) fail('计算参数包含未知字段');
  const layers = [1, 2].map((index) => {
    const aSuccess = num(values, `aSuccess${index}`, 0, 1e6, true),
      aTotal = num(values, `aTotal${index}`, 1, 1e6, true),
      bSuccess = num(values, `bSuccess${index}`, 0, 1e6, true),
      bTotal = num(values, `bTotal${index}`, 1, 1e6, true);
    if (aSuccess > aTotal || bSuccess > bTotal) fail(`分层${index}的达成数不能超过对应总数`);
    const aRate = ratio(aSuccess, aTotal),
      bRate = ratio(bSuccess, bTotal);
    return {
      layer: `分层${index}`,
      aSuccess,
      aTotal,
      bSuccess,
      bTotal,
      aRate,
      bRate,
      difference: subtract(aRate, bRate),
    };
  });
  const aSuccess = layers[0].aSuccess + layers[1].aSuccess,
    aTotal = layers[0].aTotal + layers[1].aTotal,
    bSuccess = layers[0].bSuccess + layers[1].bSuccess,
    bTotal = layers[0].bTotal + layers[1].bTotal,
    allTotal = aTotal + bTotal;
  const weighted = layers.map((layer) => {
    const pooledTotal = layer.aTotal + layer.bTotal,
      weight = ratio(pooledTotal, allTotal);
    return {
      ...layer,
      pooledTotal,
      weight,
      aContribution: multiply(weight, layer.aRate),
      bContribution: multiply(weight, layer.bRate),
    };
  });
  const rawA = ratio(aSuccess, aTotal),
    rawB = ratio(bSuccess, bTotal),
    standardA = add(weighted[0].aContribution, weighted[1].aContribution),
    standardB = add(weighted[0].bContribution, weighted[1].bContribution),
    rawDifference = subtract(rawA, rawB),
    standardDifference = subtract(standardA, standardB);
  const first = sign(layers[0].difference),
    second = sign(layers[1].difference),
    raw = sign(rawDifference);
  let classification: string, conclusion: string;
  if (first !== 0 && first === second && raw === -first) {
    classification = '严格反转';
    conclusion = `出现严格辛普森反转：两个分层均为${direction(layers[0].difference)}，原始汇总却为${direction(rawDifference)}。`;
  } else if (first === 0 || second === 0) {
    classification = '分层持平';
    conclusion = '未出现严格辛普森反转：至少一个分层比例持平，不满足两个分层严格同向的条件。';
  } else if (first !== second) {
    classification = '分层混向';
    conclusion = '未出现严格辛普森反转：两个分层的比较方向不同，不能概括为各层同向。';
  } else if (raw === 0) {
    classification = '汇总持平';
    conclusion = '未出现严格辛普森反转：两个分层严格同向，但原始汇总持平，并非严格反向。';
  } else {
    classification = '方向一致';
    conclusion = '未出现严格辛普森反转：两个分层与原始汇总的比较方向一致。';
  }
  const comparisons = [
    ...layers.map((layer) => ({
      basis: layer.layer,
      a: layer.aRate,
      b: layer.bRate,
      difference: layer.difference,
    })),
    { basis: '原始汇总', a: rawA, b: rawB, difference: rawDifference },
    { basis: '共同权重', a: standardA, b: standardB, difference: standardDifference },
  ];
  const comparisonRows = comparisons.map((row) => ({
    basis: row.basis,
    aPercent: shown(row.a, true),
    bPercent: shown(row.b, true),
    differencePp: shown(row.difference, true),
    direction: direction(row.difference),
  }));
  const output = result(
    `${conclusion}共同权重下${direction(standardDifference)}；本次记录表示完成一次比例实验。`,
    [
      { label: '比较分类', value: classification },
      { label: '方案A原始达成数', value: aSuccess },
      { label: '方案A原始总数', value: aTotal },
      { label: '方案B原始达成数', value: bSuccess },
      { label: '方案B原始总数', value: bTotal },
      { label: '全样本总数', value: allTotal },
      { label: '原始汇总差值', value: shown(rawDifference, true), unit: '百分点' },
      { label: '共同权重差值', value: shown(standardDifference, true), unit: '百分点' },
    ],
    [
      {
        title: '比较结论',
        content: `${conclusion}严格反转只比较两层方向与原始汇总方向；共同权重是另外一种明确指定样本构成的计算口径。`,
        status: 'info',
      },
      {
        title: '样本构成如何改变汇总',
        content: `方案A的原始汇总为${aSuccess}/${aTotal}，方案B为${bSuccess}/${bTotal}。每个方案用自己的分层总数占比加权：R_A=Σ(n_Ai/N_A)·r_Ai，R_B=Σ(n_Bi/N_B)·r_Bi。它们不一定给两个分层相同权重，不能直接平均两个百分数。`,
        status: 'info',
      },
      {
        title: '共同权重的含义',
        content: `合并两方案后，分层1有${weighted[0].pooledTotal}个观察、分层2有${weighted[1].pooledTotal}个观察，共${allTotal}个。使用w_i=(n_Ai+n_Bi)/${allTotal}，两方案都以Σw_i·r_i计算。共同权重分别为${weighted[0].pooledTotal}/${allTotal}和${weighted[1].pooledTotal}/${allTotal}，并非总是各半。贡献列是共同权重乘分层比例得到的百分点；标准化结果是计算指标，不是新增观察人数。`,
        status: 'info',
      },
      {
        title: '计算与展示精度',
        content:
          '比例、方向和差值先用整数有理数精确运算，再以约11位有效数字展示。A−B差值直接从未舍入的比例相减，单位是百分点；极小非零差值会保留。因此两个显示比例可能相同，而精确方向仍不同。',
        status: 'info',
      },
      {
        title: '实验边界与复盘',
        content:
          '这里展示给定计数之间的算术关系，不判断因果、不做显著性检验，也不建议选择哪种方案。共同权重不保证消除所有混杂。请记录：先前预测是什么、两方案的样本构成有何差别，以及为什么不同汇总口径可以得到不同方向；完成实验不代表方案正确或学习能力评分。',
        status: 'info',
      },
    ],
    [
      table(
        '分层原始数据',
        [
          ['layer', '分层'],
          ['aSuccess', 'A 达成数'],
          ['aTotal', 'A 总数'],
          ['bSuccess', 'B 达成数'],
          ['bTotal', 'B 总数'],
          ['aPercent', 'A 比例（%）'],
          ['bPercent', 'B 比例（%）'],
          ['aWeight', 'A 自身分层权重'],
          ['bWeight', 'B 自身分层权重'],
          ['differencePp', 'A−B（百分点）'],
        ],
        layers.map((layer) => ({
          layer: layer.layer,
          aSuccess: layer.aSuccess,
          aTotal: layer.aTotal,
          bSuccess: layer.bSuccess,
          bTotal: layer.bTotal,
          aPercent: shown(layer.aRate, true),
          bPercent: shown(layer.bRate, true),
          aWeight: shown(ratio(layer.aTotal, aTotal)),
          bWeight: shown(ratio(layer.bTotal, bTotal)),
          differencePp: shown(layer.difference, true),
        })),
      ),
      table(
        '共同权重与贡献',
        [
          ['layer', '分层'],
          ['aTotal', 'A 总数'],
          ['bTotal', 'B 总数'],
          ['pooledTotal', '合并分层总数'],
          ['pooledWeight', '共同权重'],
          ['aContributionPp', 'A 加权贡献（百分点）'],
          ['bContributionPp', 'B 加权贡献（百分点）'],
        ],
        weighted.map((layer) => ({
          layer: layer.layer,
          aTotal: layer.aTotal,
          bTotal: layer.bTotal,
          pooledTotal: layer.pooledTotal,
          pooledWeight: shown(layer.weight),
          aContributionPp: shown(layer.aContribution, true),
          bContributionPp: shown(layer.bContribution, true),
        })),
      ),
      table(
        '四种口径比较',
        [
          ['basis', '比较口径'],
          ['aPercent', 'A 比例（%）'],
          ['bPercent', 'B 比例（%）'],
          ['differencePp', 'A−B（百分点）'],
          ['direction', '精确比较方向'],
        ],
        comparisonRows,
      ),
    ],
  );
  output.categoryChart = {
    title: '分层与汇总达成比例',
    categories: comparisonRows.map((row) => row.basis),
    series: [
      { name: '方案A', values: comparisonRows.map((row) => row.aPercent) },
      { name: '方案B', values: comparisonRows.map((row) => row.bPercent) },
    ],
    yAxisLabel: '达成比例（%）',
  };
  return output;
}
