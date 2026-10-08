import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { evaluateEngineeringModule } from '../apps/api/src/academics/tools-engineering';
import type { StudyResult } from '../apps/api/src/academics/academics.types';

const defaultExpression = '!(A && B) || C';
const run = (values: Record<string, unknown>) => {
  const output = evaluateEngineeringModule('digital-logic', values);
  assert.ok(output);
  return output;
};
const truth = (output: StudyResult) => {
  const table = output.tables.find((item) => item.title === '真值表');
  assert.ok(table);
  return table;
};
type BooleanInput = Record<string, boolean>;
type Oracle = (input: BooleanInput) => boolean;

// Build the Cartesian product independently of the engine's bit-mask enumeration.
function assignments(variables: string[]): BooleanInput[] {
  return variables.reduce<BooleanInput[]>(
    (inputs, variable) =>
      inputs.flatMap((input) => [false, true].map((value) => ({ ...input, [variable]: value }))),
    [{}],
  );
}
function verify(
  expression: string,
  compareExpression: string,
  variables: string[],
  left: Oracle,
  right: Oracle,
) {
  const output = run({ expression, compareExpression });
  const expected = assignments(variables).map((input) => {
    const original = Number(left(input));
    const comparison = Number(right(input));
    return {
      ...Object.fromEntries(variables.map((name) => [name, Number(input[name])])),
      output: original,
      comparisonOutput: comparison,
      matches: original === comparison ? '一致' : '不同',
    };
  });
  const different = expected.filter((row) => row.matches === '不同');
  assert.deepEqual(truth(output).rows, expected);
  assert.deepEqual(truth(output).columns, [
    ...variables.map((name) => ({ key: name, title: name })),
    { key: 'output', title: '原表达式输出' },
    { key: 'comparisonOutput', title: '对照表达式输出' },
    { key: 'matches', title: '结果比较' },
  ]);
  assert.deepEqual(output.metrics, [
    { label: '输入变量', value: variables.length },
    { label: '检查组合数', value: expected.length },
    { label: '一致组合数', value: expected.length - different.length },
    { label: '差异组合数', value: different.length },
  ]);
  const verdict = output.sections.find((section) => section.title === '等价判断');
  assert.equal(verdict?.status, different.length ? 'warning' : 'success');
  assert.deepEqual(output.sections.slice(0, 2), [
    { title: '原表达式', content: expression.trim() },
    { title: '对照表达式', content: compareExpression.trim() },
  ]);
  if (different.length) {
    assert.equal(
      output.summary,
      `逻辑不等价：已检查全部${expected.length}组输入组合，发现${different.length}组差异。`,
    );
    assert.deepEqual(output.tables.find((item) => item.title === '全部反例')?.rows, different);
    assert.equal(output.sections.find((section) => section.title === '首个反例')?.status, 'warning');
  } else {
    assert.equal(output.summary, `逻辑等价：已检查全部${expected.length}组输入组合，差异组合数为0。`);
    assert.equal(output.tables.length, 1);
    assert.equal(
      output.sections.some((section) => section.title === '首个反例'),
      false,
    );
  }
  return output;
}

test('缺失、null、空白对照完整保留旧单表达式summary、metrics、sections与rows', () => {
  const expected: StudyResult = {
    summary: '表达式通过专用布尔语法解析，无代码执行。',
    metrics: [
      { label: '输入变量', value: 3 },
      { label: '真值行数', value: 7 },
      { label: '假值行数', value: 1 },
    ],
    sections: [{ title: '表达式', content: defaultExpression }],
    tables: [
      {
        title: '真值表',
        columns: ['A', 'B', 'C']
          .map((name) => ({ key: name, title: name }))
          .concat({ key: 'output', title: '输出' }),
        rows: [
          { A: 0, B: 0, C: 0, output: 1 },
          { A: 0, B: 0, C: 1, output: 1 },
          { A: 0, B: 1, C: 0, output: 1 },
          { A: 0, B: 1, C: 1, output: 1 },
          { A: 1, B: 0, C: 0, output: 1 },
          { A: 1, B: 0, C: 1, output: 1 },
          { A: 1, B: 1, C: 0, output: 0 },
          { A: 1, B: 1, C: 1, output: 1 },
        ],
      },
    ],
  };
  assert.deepEqual(run({ expression: defaultExpression }), expected);
  for (const compareExpression of [undefined, null, '', ' \t\r\n ', ' '.repeat(200)])
    assert.deepEqual(run({ expression: defaultExpression, compareExpression }), expected);
});

test('两条德摩根定律在全部输入组合上符合独立Boolean oracle', () => {
  verify(
    '!(A && B)',
    '!A || !B',
    ['A', 'B'],
    ({ A, B }) => !(A && B),
    ({ A, B }) => !A || !B,
  );
  verify(
    '!(A || B)',
    '!A && !B',
    ['A', 'B'],
    ({ A, B }) => !(A || B),
    ({ A, B }) => !A && !B,
  );
});

test('与和或的分配律覆盖全部三变量组合', () => {
  verify(
    'A && (B || C)',
    '(A && B) || (A && C)',
    ['A', 'B', 'C'],
    ({ A, B, C }) => A && (B || C),
    ({ A, B, C }) => (A && B) || (A && C),
  );
  verify(
    'A || (B && C)',
    '(A || B) && (A || C)',
    ['A', 'B', 'C'],
    ({ A, B, C }) => A || (B && C),
    ({ A, B, C }) => (A || B) && (A || C),
  );
});

test('吸收律与冗余变量按变量并集比较，不按两张表行号配对', () => {
  verify(
    'A || (A && B)',
    'A',
    ['A', 'B'],
    ({ A, B }) => A || (A && B),
    ({ A }) => A,
  );
  verify(
    'A',
    'A || (B && !B)',
    ['A', 'B'],
    ({ A }) => A,
    ({ A, B }) => A || (B && !B),
  );
  verify(
    'A && (A || B)',
    'A',
    ['A', 'B'],
    ({ A, B }) => A && (A || B),
    ({ A }) => A,
  );
});

test('异或的展开式、结合律和自身相消使用独立奇偶性oracle', () => {
  verify(
    'A ^ B',
    '(A || B) && !(A && B)',
    ['A', 'B'],
    ({ A, B }) => A !== B,
    ({ A, B }) => (A || B) && !(A && B),
  );
  const odd: Oracle = ({ A, B, C }) => (Number(A) + Number(B) + Number(C)) % 2 === 1;
  verify('A ^ B ^ C', 'A ^ (B ^ C)', ['A', 'B', 'C'], odd, odd);
  verify(
    'A ^ A',
    'A && !A',
    ['A'],
    () => false,
    ({ A }) => A && !A,
  );
});

test('非、与、异或、或的优先级保持不变，显式括号可改变结论', () => {
  verify(
    '!A && B ^ C || D',
    '((!A && B) ^ C) || D',
    ['A', 'B', 'C', 'D'],
    ({ A, B, C, D }) => (!A && B) !== C || D,
    ({ A, B, C, D }) => (!A && B) !== C || D,
  );
  verify(
    'A || B && C',
    '(A || B) && C',
    ['A', 'B', 'C'],
    ({ A, B, C }) => A || (B && C),
    ({ A, B, C }) => (A || B) && C,
  );
});

test('与和或恰有两个反例，按二进制字母顺序返回并解释首个反例', () => {
  const output = verify(
    'A && B',
    'A || B',
    ['A', 'B'],
    ({ A, B }) => A && B,
    ({ A, B }) => A || B,
  );
  assert.deepEqual(output.tables[1].rows, [
    { A: 0, B: 1, output: 0, comparisonOutput: 1, matches: '不同' },
    { A: 1, B: 0, output: 0, comparisonOutput: 1, matches: '不同' },
  ]);
  assert.equal(
    output.sections.find((section) => section.title === '首个反例')?.content,
    '当A=0，B=1时，原表达式输出为0，对照表达式输出为1。这一组输入已足以说明两者不等价。',
  );
});

test('A对B使用两变量四行；互不重叠的AB和CD使用四变量十六行', () => {
  verify(
    'A',
    'B',
    ['A', 'B'],
    ({ A }) => A,
    ({ B }) => B,
  );
  verify(
    'B && A',
    'D && C',
    ['A', 'B', 'C', 'D'],
    ({ A, B }) => A && B,
    ({ C, D }) => C && D,
  );
});

test('所有输入都不同仍完整返回十六个反例，不只返回首个或截断', () => {
  const output = verify(
    '(A || !A) && (B || !B) && (C || !C) && (D || !D)',
    'A && !A',
    ['A', 'B', 'C', 'D'],
    () => true,
    () => false,
  );
  assert.equal(output.tables[1].rows.length, 16);
  assert.deepEqual(output.tables[1].rows[15], {
    A: 1,
    B: 1,
    C: 1,
    D: 1,
    output: 1,
    comparisonOutput: 0,
    matches: '不同',
  });
});

test('两条表达式分别限制原始长度200，201字符即使语法有效也拒绝', () => {
  const boundary = `!${'A||'.repeat(66)}A`;
  assert.equal(boundary.length, 200);
  verify(
    boundary,
    boundary,
    ['A'],
    () => true,
    () => true,
  );
  for (const expression of [boundary + ' ', ' '.repeat(200) + 'A'])
    assert.throws(() => run({ expression }), BadRequestException);
  for (const compareExpression of [boundary + ' ', ' '.repeat(201)])
    assert.throws(() => run({ expression: 'A', compareExpression }), /对照表达式.*200/);
});

test('沿用20层递归边界，原式与对照式独立计数，平行括号不会累加深度', () => {
  const unary = '!'.repeat(19) + 'A';
  const grouped = '('.repeat(19) + 'A' + ')'.repeat(19);
  verify(
    unary,
    '!A',
    ['A'],
    ({ A }) => !A,
    ({ A }) => !A,
  );
  verify(
    grouped,
    'A',
    ['A'],
    ({ A }) => A,
    ({ A }) => A,
  );
  verify(
    unary,
    unary,
    ['A'],
    ({ A }) => !A,
    ({ A }) => !A,
  );
  verify(
    Array(30).fill('(A)').join('||'),
    'A',
    ['A'],
    ({ A }) => A,
    ({ A }) => A,
  );
  for (const expression of ['!'.repeat(20) + 'A', '('.repeat(20) + 'A' + ')'.repeat(20)]) {
    assert.throws(() => run({ expression }), /嵌套过深/);
    assert.throws(() => run({ expression: 'A', compareExpression: expression }), /对照表达式.*嵌套过深/);
  }
});

test('非法对照类型、语法和代码注入均返回指明对照表达式的400，不退回单模式', () => {
  const invalid: unknown[] = [
    false,
    0,
    1,
    {},
    [],
    ['A'],
    'a',
    'E',
    'true',
    '0',
    'A & B',
    'A | B',
    'A == B',
    'A === B',
    'A => B',
    'A B',
    'A &&',
    'A ^',
    '!',
    '(A',
    'A)',
    '()',
    'A ? B : C',
    '\0A',
    'globalThis.process.exit()',
    'A; process.exit()',
    'constructor.constructor("return process")()',
    'A || (B = true)',
    'A/*comment*/',
    'Ａ',
  ];
  for (const compareExpression of invalid)
    assert.throws(
      () => run({ expression: 'A', compareExpression }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.getStatus(), 400);
        assert.match(error.message, /对照表达式/);
        return true;
      },
    );
  for (const expression of ['globalThis.process.exit()', '(A && B', 'A == B', 'E'])
    assert.throws(() => run({ expression }), BadRequestException);
});
