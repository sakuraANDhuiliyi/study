import { bulkExampleReasoning } from './algorithms.editorials-bulk-walkthrough';
import type { AlgorithmEditorial } from './algorithms.editorials.types';
import { bulkAlgorithmDefinitions } from './algorithms.catalog-bulk-data';
import { bulkReferencePrograms } from './algorithms.catalog-bulk';

/** Every new exercise has an executable JS solution; unsupported languages are not advertised. */
export const bulkAlgorithmEditorials: AlgorithmEditorial[] = bulkAlgorithmDefinitions.map((item) => ({
  problemId: item.id,
  introduction: `“${item.title}”训练${item.tags.join('、')}。${item.description} 解题时先固定输入与输出的含义，再识别重复计算和不变量；以下解法和隐藏测试针对本题明确的约束，不依赖输入恰好与样例相同。`,
  prerequisites: ['标准输入、输出与下标约定', ...item.tags],
  readingGuide: [
    item.inputFormat,
    item.outputFormat,
    item.constraints,
    '参考程序当前提供 JavaScript；其他三种语言可从编辑器的起始程序独立实现。',
  ],
  hints: [...item.hints],
  approaches: [
    {
      name: `${item.tags.slice(1).join('与') || item.tags[0]}解法`,
      intuition: item.solution,
      steps: [
        '解析题目规定的输入并处理最小规模。',
        item.solution,
        '按输出契约输出结果并检查溢出和等值边界。',
      ],
      correctness: `本题目标由题干精确定义。${item.solution} 每次状态更新只纳入当前已处理部分的贡献，终止时覆盖整个输入，因此得到题目要求的值。`,
      timeComplexity: item.timeComplexity,
      spaceComplexity: item.spaceComplexity,
      tradeoff: '适合题目给定范围；对新约束应重新估计复杂度与整数范围。',
    },
    {
      name: '小规模定义枚举与校验',
      intuition: '对最小输入直接依照题干逐项列举合法对象，避免在优化前误解目标与等号边界。',
      steps: [
        '缩小输入规模，列举定义中的所有候选或逐步手算。',
        '将独立计算得到的结果与优化状态的最后结果比较。',
      ],
      correctness:
        '枚举覆盖定义允许的每一个对象，并且仅计入满足条件的对象；无漏计也无重复计数，所以适合作为小规模对拍。',
      timeComplexity: 'O(候选数量 × 校验代价)：仅用于小规模，不承诺通过最大输入。',
      spaceComplexity: 'O(候选存储)：可以边枚举边汇总。',
      tradeoff: '这是理解与验证方式；正式提交请使用上面的满足范围的参考解法。',
    },
  ],
  walkthrough: {
    input: item.examples[0].input,
    result: item.examples[0].output,
    steps: [
      {
        step: 1,
        state: item.examples[0].input.trim(),
        explanation: '按输入格式识别参数与数据，先检查对象数量和编号约定。',
      },
      ...(bulkExampleReasoning[item.id] ?? []).map((state, index) => ({
        step: index + 2,
        state,
        explanation:
          index === 0 ? '根据本题公开样例建立具体状态，展开手算。' : '延续上一状态并用题意检查结果与最优性。',
      })),
      {
        step: 4,
        state: item.examples[0].output.trim(),
        explanation: '最终汇总值按输出格式输出；结果与公开样例一致。',
      },
    ],
  },
  edgeCases: [
    { case: '最小允许规模', why: '初始化、空循环和只有一个对象时仍必须符合定义。' },
    { case: '题目约束允许的重复与端点情况', why: '检查题目指定的等号边界和重复对象处理。' },
    { case: '题面最大数值与结果范围', why: '确认整数精度、取模和所选复杂度可满足范围。' },
  ],
  mistakes: [
    { mistake: '输出交互提示或解释文字。', fix: '仅输出 outputFormat 要求的值。' },
    {
      mistake: '照样例猜测规律，省略题意中的边界。',
      fix: '使用提示中的不变量，并独立手算隐藏边界同类的小输入。',
    },
    {
      mistake: '中间值超出整数安全范围或忘记严格不等号。',
      fix: '对照 constraints 选择 BigInt/64 位整数，逐一检查比较条件。',
    },
  ],
  followUp: [
    '为最小值、相等值和最大值各写一个自己的用例。',
    '尝试用另一种语言实现，并解释每次状态更新为何正确。',
  ],
  relatedProblemIds: [],
  referenceCode: { javascript: bulkReferencePrograms[item.id] },
}));
