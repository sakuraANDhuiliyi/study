import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoScore,
  normalizeBlank,
  paginate,
  personalDeadline,
  publicQuestion,
  type QuestionData,
  shuffled,
  validAnswerValue,
} from '../apps/api/src/assessment/scoring';
import {
  questionSchema,
  saveSchema,
  submissionSchema,
  practiceProgressSchema,
  examGradeSchema,
  answerSchema,
} from '../apps/api/src/assessment/assessment.schemas';
const question = (override: Partial<QuestionData> = {}): QuestionData => ({
  id: 'v1',
  questionId: 'q1',
  version: 1,
  type: 'single',
  stem: '问题',
  options: [
    { id: 'A', text: '甲' },
    { id: 'B', text: '乙' },
  ],
  answer: 'A',
  explanation: '不可泄露的解析',
  rules: {},
  scoreCents: 1000,
  difficulty: 2,
  knowledgePoints: ['知识点'],
  tags: [],
  children: [],
  ...override,
});

describe('客观评分：整数分值、漏选与标准化规则', () => {
  it('单选题空答为零，正确答案满分', () => {
    assert.equal(autoScore(question(), undefined), 0);
    assert.equal(autoScore(question(), 'A'), 1000);
    assert.equal(autoScore(question(), 'B'), 0);
  });
  it('判断题区分 false 与空答', () => {
    const q = question({ type: 'boolean', answer: false });
    assert.equal(autoScore(q, false), 1000);
    assert.equal(autoScore(q, ''), 0);
    assert.equal(autoScore(q, null), 0);
  });
  it('多选全对满分，重复输入不重复计分，错选为零', () => {
    const q = question({ type: 'multiple', answer: ['A', 'B'], rules: { partialCredit: true } });
    assert.equal(autoScore(q, ['A', 'B', 'A']), 1000);
    assert.equal(autoScore(q, ['A']), 500);
    assert.equal(autoScore(q, ['A', 'X']), 0);
    assert.equal(autoScore(q, []), 0);
  });
  it('未开启部分分值时，漏选为零', () => {
    assert.equal(autoScore(question({ type: 'multiple', answer: ['A', 'B'] }), ['A']), 0);
  });
  it('部分分值向下取整，避免浮点尾差', () => {
    assert.equal(
      autoScore(
        question({
          type: 'multiple',
          answer: ['A', 'B', 'C'],
          options: ['A', 'B', 'C'].map((id) => ({ id, text: id })),
          scoreCents: 100,
          rules: { partialCredit: true },
        }),
        ['A'],
      ),
      33,
    );
  });
  it('填空按每空可接受答案列表匹配，规范全角、空白和大小写', () => {
    const q = question({ type: 'blank', answer: [['select', '查询'], ['order by']] });
    assert.equal(autoScore(q, ['ＳＥＬＥＣＴ', '  ORDER   BY  ']), 1000);
    assert.equal(autoScore(q, ['查询', '错误']), 500);
    assert.equal(autoScore(q, ['select']), 0);
  });
  it('启用大小写精确模式后保留大小写', () => {
    assert.equal(normalizeBlank(' SQL ', { caseSensitive: true }), 'SQL');
    assert.equal(
      autoScore(question({ type: 'blank', answer: [['sql']], rules: { caseSensitive: true } }), ['SQL']),
      0,
    );
  });
  it('主观题和综合题返回待人工评分，而非临时零分', () => {
    assert.equal(autoScore(question({ type: 'short' }), '回答'), null);
    assert.equal(autoScore(question({ type: 'composite', children: [question()] }), null), null);
  });
  it('历史对象答案和嵌套对象不会执行隐式转换或阻塞交卷', () => {
    const poison = JSON.parse('{"toString":{}}');
    for (const q of [
      question(),
      question({ type: 'boolean', answer: false }),
      question({ type: 'multiple', answer: ['A', 'B'] }),
      question({ type: 'blank', answer: [['A']] }),
    ]) {
      for (const value of [poison, [poison]]) assert.equal(autoScore(q, value), 0);
    }
    assert.equal(normalizeBlank(poison), '');
    assert.equal(autoScore(question({ type: 'short' }), poison), null);
  });
  it('损坏的历史标准答案转人工处理，不能作为已自动评分的零分发布', () => {
    for (const type of ['single', 'boolean', 'multiple', 'blank', 'unknown'])
      assert.equal(autoScore(question({ type, answer: { toString: {} } }), 'A'), null);
    for (const q of [
      question({ answer: '' }),
      question({ answer: 'unknown' }),
      question({ type: 'multiple', answer: ['A', 'A'] }),
      question({ type: 'multiple', answer: ['unknown'] }),
      question({ type: 'blank', answer: [['  ']] }),
      question({ rules: null as never }),
      question({ scoreCents: -1 }),
      question({ scoreCents: Infinity }),
    ])
      assert.equal(autoScore(q, ''), null);
  });
});

describe('字段白名单和时间权威', () => {
  it('学生题目递归剔除答案、解析、评分规则与内部字段', () => {
    const q = question({ type: 'composite', children: [question({ id: 'child' })] });
    const response = publicQuestion({ ...q, secretMarker: 'hidden' } as QuestionData);
    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes('answer'));
    assert.ok(!serialized.includes('explanation'));
    assert.ok(!serialized.includes('rules'));
    assert.ok(!serialized.includes('hidden'));
    assert.equal(response.stem, '问题');
  });
  it('答案与解析各自单独放行', () => {
    const answersOnly = publicQuestion(question(), true, false);
    assert.equal(answersOnly.answer, 'A');
    assert.equal(answersOnly.explanation, undefined);
    const explanationOnly = publicQuestion(question(), false, true);
    assert.equal(explanationOnly.answer, undefined);
    assert.equal(explanationOnly.explanation, '不可泄露的解析');
  });
  it('个人截止使用允许时长与考试窗口的较小值', () => {
    const start = new Date('2026-10-01T00:00:00Z');
    assert.equal(
      personalDeadline(start, 60, new Date('2026-10-01T00:30:00Z')).toISOString(),
      '2026-10-01T00:30:00.000Z',
    );
    assert.equal(
      personalDeadline(start, 15, new Date('2026-10-01T02:00:00Z')).toISOString(),
      '2026-10-01T00:15:00.000Z',
    );
  });
  it('独立延时记录改变截止时刻且不使用客户端时间', () => {
    assert.equal(
      personalDeadline(
        new Date('2026-10-01T00:00:00Z'),
        10,
        new Date('2026-10-01T00:10:00Z'),
        new Date('2026-10-01T01:00:00Z'),
      ).toISOString(),
      '2026-10-01T01:00:00.000Z',
    );
  });
  it('随机序列保留全部项目，且不修改原始数组', () => {
    const values = ['a', 'b', 'c', 'd'];
    const result = shuffled(values, () => 0);
    assert.deepEqual([...result].sort(), [...values].sort());
    assert.deepEqual(values, ['a', 'b', 'c', 'd']);
    assert.notDeepEqual(values, result);
  });
  it('分页大小有上限', () => {
    assert.deepEqual(paginate({ page: 2, pageSize: 50000 }), {
      page: 2,
      pageSize: 100,
      skip: 100,
      take: 100,
    });
  });
});

describe('输入边界', () => {
  it('答案DTO只接受实际支持的标量、字符串数组和综合题子题映射', () => {
    for (const value of [null, false, '', 'A', ['A'], { child: ['first', 'second'] }])
      assert.equal(answerSchema.safeParse({ questionVersionId: 'v1', value }).success, true);
    for (const value of [undefined, 1, { toString: {} }, { child: { nested: 'A' } }, [['A']], [false]])
      assert.equal(answerSchema.safeParse({ questionVersionId: 'v1', value }).success, false);
    const manyBlanks = Array.from({ length: 31 }, () => '答案');
    assert.equal(answerSchema.safeParse({ questionVersionId: 'v1', value: manyBlanks }).success, true);
    assert.equal(
      validAnswerValue(question({ type: 'blank', answer: manyBlanks.map((value) => [value]) }), manyBlanks),
      true,
    );
  });
  it('题型、选项与填空数量来自任务快照，保留草稿空答和分步作答', () => {
    assert.equal(validAnswerValue(question(), 'A'), true);
    assert.equal(validAnswerValue(question(), 'X'), false);
    assert.equal(validAnswerValue(question(), { toString: 'A' }), false);
    assert.equal(validAnswerValue(question({ type: 'boolean' }), false), true);
    assert.equal(validAnswerValue(question({ type: 'boolean' }), 'false'), true);
    assert.equal(validAnswerValue(question({ type: 'boolean' }), 'A'), false);
    const multiple = question({ type: 'multiple', answer: ['A', 'B'] });
    assert.equal(validAnswerValue(multiple, []), true);
    assert.equal(validAnswerValue(multiple, ['A', 'B']), true);
    assert.equal(validAnswerValue(multiple, ['A', 'A']), false);
    assert.equal(validAnswerValue(multiple, ['X']), false);
    const blank = question({ type: 'blank', answer: [['first'], ['second']] });
    assert.equal(validAnswerValue(blank, ['first']), true);
    assert.equal(validAnswerValue(blank, ['first', 'second', 'third']), false);
    assert.equal(validAnswerValue(blank, 'first'), false);
    assert.equal(validAnswerValue(question({ type: 'short' }), '文字作答'), true);
    assert.equal(validAnswerValue(question({ type: 'short' }), ['文字作答']), false);
    for (const type of ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'])
      assert.equal(validAnswerValue(question({ type }), null), true);
  });
  it('综合题递归检查真实子题，拒绝未知子题、错误类型和额外嵌套', () => {
    const composite = question({
      type: 'composite',
      children: [
        question({ id: 'choice' }),
        question({ id: 'essay', type: 'short' }),
        question({ id: 'blanks', type: 'blank', answer: [['one']] }),
      ],
    });
    assert.equal(validAnswerValue(composite, {}), true);
    assert.equal(validAnswerValue(composite, { choice: 'A', essay: '步骤', blanks: ['one'] }), true);
    assert.equal(validAnswerValue(composite, { choice: null }), true);
    for (const value of [
      { unknown: 'A' },
      { choice: ['A'] },
      { essay: { toString: {} } },
      { blanks: ['one', 'two'] },
      'A',
      [],
    ])
      assert.equal(validAnswerValue(composite, value), false);
  });
  it('考试保存必须提供非负版本号', () => {
    assert.equal(saveSchema.safeParse({ answers: [] }).success, false);
    assert.equal(saveSchema.safeParse({ revision: -1, answers: [] }).success, false);
    assert.equal(saveSchema.safeParse({ revision: 0, answers: [] }).success, true);
  });
  it('重复提交必须有足够长度的幂等键', () => {
    assert.equal(submissionSchema.safeParse({ answers: [], idempotencyKey: 'x' }).success, false);
    assert.equal(submissionSchema.safeParse({ answers: [], idempotencyKey: 'test-key-001' }).success, true);
  });
  it('题库缺省不开放练习；内容过滤脚本', () => {
    const result = questionSchema.parse({
      courseId: 'course',
      type: 'single',
      stem: '<script>alert(1)</script><b>有效题干</b>',
      options: [
        { id: 'A', text: '甲' },
        { id: 'B', text: '乙' },
      ],
      answer: 'A',
      scoreCents: 100,
    });
    assert.equal(result.practiceEnabled, false);
    assert.ok(result.stem.includes('有效题干'));
    assert.ok(!result.stem.includes('script'));
    assert.equal(result.scope, 'private');
  });
  it('图文题干保留文字与 HTTPS 图片，移除事件、脚本和危险图片协议', () => {
    const result = questionSchema.parse({
      courseId: 'course',
      type: 'short',
      answer: '参考',
      scoreCents: 100,
      stem: '<p>读<strong>图</strong></p><img src="https://example.com/image.png" alt="示意图" onerror="alert(1)"><img src="javascript:alert(1)"><img src="data:image/svg+xml;base64,PHN2Zz4="><svg onload="alert(1)"></svg><script>alert(1)</script>',
    });
    assert.ok(result.stem.includes('<strong>图</strong>'));
    assert.ok(result.stem.includes('https://example.com/image.png'));
    assert.ok(!/(?:javascript:|data:|onerror|onload|<script|<svg)/i.test(result.stem));
    assert.equal(
      questionSchema.safeParse({
        courseId: 'course',
        type: 'short',
        answer: '参考',
        scoreCents: 100,
        stem: '<script>alert(1)</script>',
      }).success,
      false,
    );
  });
  it('练习进度限制版本、标记数量及当前位置边界', () => {
    assert.equal(
      practiceProgressSchema.safeParse({ revision: 0, flags: ['version-id'], currentPosition: 0 }).success,
      true,
    );
    assert.equal(
      practiceProgressSchema.safeParse({ revision: -1, flags: [], currentPosition: 0 }).success,
      false,
    );
    assert.equal(
      practiceProgressSchema.safeParse({ revision: 0, flags: [], currentPosition: 100 }).success,
      false,
    );
  });
  it('按题阅卷省略总评与显式清空总评是两种不同操作', () => {
    assert.equal(examGradeSchema.parse({ revision: 0, items: [] }).comment, undefined);
    assert.equal(examGradeSchema.parse({ revision: 0, items: [], comment: '' }).comment, '');
    assert.equal(
      examGradeSchema.parse({ revision: 0, items: [], comment: '<script>x</script>总评' }).comment,
      '总评',
    );
  });
  it('超过最大答题数量被拒绝', () => {
    assert.equal(
      saveSchema.safeParse({
        revision: 0,
        answers: Array.from({ length: 201 }, (_, i) => ({ questionVersionId: `q${i}`, value: 'A' })),
      }).success,
      false,
    );
  });
  it('小数分数被拒绝，所有接口使用整数分', () => {
    assert.equal(
      questionSchema.safeParse({
        courseId: 'c',
        type: 'short',
        stem: '题目',
        answer: '答案',
        scoreCents: 0.5,
      }).success,
      false,
    );
  });
});
