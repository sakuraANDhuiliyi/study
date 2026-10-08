import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasResponse, itemAccumulator } from '../apps/api/src/assessment/item-analysis';
import type { QuestionData } from '../apps/api/src/assessment/scoring';
const question = (overrides: Partial<QuestionData> = {}): QuestionData => ({
  id: 'v',
  questionId: 'q',
  version: 1,
  type: 'single',
  stem: '题干',
  options: [
    { id: 'A', text: '甲' },
    { id: 'B', text: '乙' },
  ],
  answer: 'A',
  explanation: '保密解析',
  rules: {},
  scoreCents: 1000,
  difficulty: 2,
  knowledgePoints: [],
  tags: [],
  children: [],
  ...overrides,
});
describe('考试题目分析指标', () => {
  it('false、0是回答，空白数组和综合题空槽不是回答', () => {
    for (const value of [false, 0, ['A'], { child: '答案' }]) assert.equal(hasResponse(value), true);
    for (const value of [null, undefined, '', '  ', [], ['', null], { child: [' '] }])
      assert.equal(hasResponse(value), false);
  });
  it('没有交卷时比率和平均数为null，不能显示虚构零分', () => {
    const result = itemAccumulator(question(), 0).result();
    assert.equal(result.correctRate, null);
    assert.equal(result.averageScoreCents, null);
    assert.equal(result.scoreRate, null);
  });
  it('空答纳入正确率分母，客观正确率与人工得分分离', () => {
    const stats = itemAccumulator(question(), 3);
    stats.add({ value: 'A', graded: true, scoreCents: 500 });
    stats.add({ value: 'B', graded: true, scoreCents: 1000 });
    stats.add({ value: null, graded: true, scoreCents: 0 });
    const result = stats.result();
    assert.equal(result.correctRate, 33.33);
    assert.equal(result.answeredCount, 2);
    assert.equal(result.unansweredCount, 1);
    assert.equal(result.averageScoreCents, 500);
    assert.equal(result.scoreRate, 50);
    assert.deepEqual(
      result.options.map((o) => o.count),
      [1, 1],
    );
  });
  it('多选去重计频次且部分分不等于完全正确', () => {
    const stats = itemAccumulator(
      question({ type: 'multiple', answer: ['A', 'B'], rules: { partialCredit: true } }),
      2,
    );
    stats.add({ value: ['A', 'B', 'A'], graded: true, scoreCents: 1000 });
    stats.add({ value: ['A'], graded: true, scoreCents: 500 });
    const result = stats.result();
    assert.equal(result.correctRate, 50);
    assert.equal(result.scoreRate, 75);
    assert.deepEqual(
      result.options.map((o) => o.percent),
      [100, 50],
    );
  });
  it('判断false计入对应选项，非法选项单独计数且不泄露原值', () => {
    const stats = itemAccumulator(question({ type: 'boolean', answer: false }), 2);
    stats.add({ value: false, graded: true, scoreCents: 1000 });
    stats.add({ value: { private: '学生隐私' }, graded: true, scoreCents: 0 });
    const result = stats.result();
    assert.equal(result.options.find((o) => o.id === 'false')?.count, 1);
    assert.equal(result.invalidResponseCount, 1);
    assert.ok(!JSON.stringify(result).includes('学生隐私'));
  });
  it('主观题只平均已评分答案，缺失和待批阅都不当作0', () => {
    const stats = itemAccumulator(question({ type: 'short', answer: '参考答案' }), 3);
    stats.add({ value: '待批文本', graded: false, scoreCents: null });
    stats.add({ value: '已批文本', graded: true, scoreCents: 600 });
    const result = stats.result();
    assert.equal(result.correctRate, null);
    assert.equal(result.averageScoreCents, 600);
    assert.equal(result.pendingCount, 2);
    assert.equal(result.gradedCount, 1);
    assert.equal(result.scoreRate, 60);
    assert.deepEqual(result.options, []);
  });
  it('零分权重题仍以真实答案计算正确率，得分率为null', () => {
    const stats = itemAccumulator(question({ scoreCents: 0 }), 2);
    stats.add({ value: 'A', graded: true, scoreCents: 0 });
    stats.add({ value: 'B', graded: true, scoreCents: 0 });
    assert.equal(stats.result().correctRate, 50);
    assert.equal(stats.result().scoreRate, null);
  });
  it('填空按冻结规则归一化，只有所有空正确才计正确', () => {
    const stats = itemAccumulator(question({ type: 'blank', answer: [['select'], ['order by']] }), 2);
    stats.add({ value: ['ＳＥＬＥＣＴ', ' ORDER   BY '], graded: true, scoreCents: 1000 });
    stats.add({ value: ['select', ''], graded: true, scoreCents: 500 });
    assert.equal(stats.result().correctRate, 50);
    assert.equal(stats.result().scoreRate, 75);
  });
});
