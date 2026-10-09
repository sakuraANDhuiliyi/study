import { result, table, type StudyResult } from './academics.types';
import { ensureJson, fail, num, rounded, type Inputs } from './tool-utils';

const keys = ['tp', 'fp', 'fn', 'tn'];

/** Fixed binary counts: no fitted model, inferred labels or zero-division substitutions. */
export function evaluateConfusionMatrix(values: Inputs): StudyResult {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail('计算参数必须是对象');
  ensureJson(values);
  if (Object.keys(values).some((key) => !keys.includes(key))) fail('计算参数包含未知字段');
  const tp = num(values, 'tp', 0, 1e6, true),
    fp = num(values, 'fp', 0, 1e6, true),
    fn = num(values, 'fn', 0, 1e6, true),
    tn = num(values, 'tn', 0, 1e6, true);
  const actualPositive = tp + fn,
    actualNegative = tn + fp,
    predictedPositive = tp + fp,
    predictedNegative = tn + fn,
    total = actualPositive + actualNegative;
  if (total === 0) fail('四格样本计数之和必须大于0');

  // At these input bounds every numerator/denominator is an exact safe integer,
  // including the balanced-accuracy denominator (at most 8e12).
  const definitions = [
    {
      metric: '准确率 Accuracy',
      formula: '(TP + TN) / N',
      numerator: tp + tn,
      denominator: total,
      reason: '',
    },
    {
      metric: '精确率 Precision',
      formula: 'TP / (TP + FP)',
      numerator: tp,
      denominator: predictedPositive,
      reason: '没有预测为正类的样本（TP + FP = 0），无法计算预测正类中实际正类的比例。',
    },
    {
      metric: '召回率 Recall',
      formula: 'TP / (TP + FN)',
      numerator: tp,
      denominator: actualPositive,
      reason: '没有实际正类样本（TP + FN = 0），无法计算实际正类被找回的比例。',
    },
    {
      metric: '负类召回率 Specificity',
      formula: 'TN / (TN + FP)',
      numerator: tn,
      denominator: actualNegative,
      reason: '没有实际负类样本（TN + FP = 0），无法计算实际负类被正确预测的比例。',
    },
    {
      metric: 'F1',
      formula: '2 × TP / (2 × TP + FP + FN)',
      numerator: 2 * tp,
      denominator: 2 * tp + fp + fn,
      reason: '实际正类和预测正类均不存在（TP = FP = FN = 0），F1的分母为0。',
    },
    {
      metric: '二分类平衡准确率',
      formula: '[TP × (TN + FP) + TN × (TP + FN)] / [2 × (TP + FN) × (TN + FP)]',
      numerator: tp * actualNegative + tn * actualPositive,
      denominator: 2 * actualPositive * actualNegative,
      reason:
        actualPositive === 0
          ? '缺少实际正类样本，正类召回率未定义，无法计算两类召回率的平均值。'
          : '缺少实际负类样本，负类召回率未定义，无法计算两类召回率的平均值。',
    },
  ];
  const rows = definitions.map((entry) => ({
    ...entry,
    percent: entry.denominator === 0 ? '未定义' : rounded((entry.numerator / entry.denominator) * 100, 10),
    reason: entry.denominator === 0 ? entry.reason : '',
  }));
  const undefinedCount = rows.filter((entry) => entry.denominator === 0).length;
  const output = result(
    `已核对${total}个样本的二分类计数，${tp + tn}个预测正确、${fp + fn}个预测错误。${undefinedCount ? `${undefinedCount}项指标因分母为0未定义。` : '六项指标均有定义。'}本次记录表示完成一次指标实验。`,
    rows.map((entry) => ({
      label: entry.metric,
      value: entry.percent,
      ...(entry.denominator === 0 ? {} : { unit: '%' }),
    })),
    [
      {
        title: '先确定真实类别与预测类别',
        content: `本表按“行实际、列预测”排列。实际正类${actualPositive}个，实际负类${actualNegative}个；预测正类${predictedPositive}个，预测负类${predictedNegative}个。TP和TN在正确预测的两格，FP与FN分别记录两种不同的错误。正类与负类是本次任务约定的类别名称，不表示好坏。`,
        status: 'info',
      },
      {
        title: '每个指标回答不同的问题',
        content:
          '准确率统计全部样本中预测正确的比例；精确率以预测正类为分母，召回率以实际正类为分母，负类召回率以实际负类为分母。F1直接从四格计数计算；二分类平衡准确率为正类与负类召回率的等权平均，不按各类样本数量加权。它的分子与分母是通分后的整数乘积，不是新增观察样本数；原始计数请看混淆矩阵与四格图。表中公式先得到0至1的比例，再乘100展示为百分数。',
        status: 'info',
      },
      {
        title: '零分母与类别缺失',
        content:
          '分母为0时，该指标显示“未定义”，不替换成0或100%。每项独立判断：没有预测正类但仍有实际正类时，精确率未定义，F1仍为0；只有实际负类且全部预测为负类时，准确率为100%，但正类召回率、精确率、F1和平衡准确率均未定义。',
        status: 'info',
      },
      {
        title: '类别构成与解释范围',
        content:
          '当正类很少时，全部预测为负类也可能有很高的准确率，应同时查看两类数量及各项指标。这里仅描述给定计数，不训练模型，不推断因果或未来表现，也不用于学生能力评分。可以在笔记中写出各指标的分母、错误类型与本次样本缺少的信息。',
        status: 'info',
      },
      {
        title: '数值精度',
        content: '原始计数、分子与分母保持整数；计算使用未舍入计数，仅在百分数展示时保留11位有效数字。',
        status: 'info',
      },
    ],
    [
      table(
        '混淆矩阵（行实际，列预测）',
        [
          ['actual', '实际类别'],
          ['predictedNegative', '预测负类'],
          ['predictedPositive', '预测正类'],
          ['total', '合计'],
        ],
        [
          { actual: '实际负类', predictedNegative: tn, predictedPositive: fp, total: actualNegative },
          { actual: '实际正类', predictedNegative: fn, predictedPositive: tp, total: actualPositive },
          { actual: '合计', predictedNegative, predictedPositive, total },
        ],
      ),
      table(
        '指标分子与分母',
        [
          ['metric', '指标'],
          ['formula', '比例公式'],
          ['numerator', '分子'],
          ['denominator', '分母'],
          ['percent', '百分数（%）'],
          ['reason', '未定义原因'],
        ],
        rows,
      ),
    ],
  );
  output.categoryChart = {
    title: '四格样本计数',
    categories: ['TP', 'FP', 'FN', 'TN'],
    series: [{ name: '计数', values: [tp, fp, fn, tn] }],
    yAxisLabel: '样本数',
  };
  return output;
}
