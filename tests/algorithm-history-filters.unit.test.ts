import assert from 'node:assert/strict';
import test from 'node:test';
import {
  algorithmPagination,
  algorithmSubmissionQuery,
  type AlgorithmSubmissionQuery,
} from '../apps/api/src/algorithms/algorithms.schemas';

const kinds = ['submit', 'examples', 'custom'];
const languages = ['cpp', 'python', 'javascript', 'java'];
const statuses = [
  'running',
  'accepted',
  'wrong_answer',
  'compile_error',
  'runtime_error',
  'time_limit',
  'memory_limit',
  'system_error',
];
const rejected = (value: unknown) => assert.equal(algorithmSubmissionQuery.safeParse(value).success, false);

test('提交历史默认保留原分页契约，不自动添加筛选或“全部”值', () => {
  const parsed: AlgorithmSubmissionQuery = algorithmSubmissionQuery.parse({});
  assert.deepEqual(parsed, { page: 1, pageSize: 20 });
  assert.deepEqual(Object.keys(parsed), ['page', 'pageSize']);
  assert.deepEqual(parsed, algorithmPagination.parse({}));
  assert.deepEqual(algorithmSubmissionQuery.parse({ page: undefined, pageSize: undefined }), parsed);
});

test('兼容旧有效数字与标量分页字符串，保留原上下限', () => {
  for (const input of [
    { page: 1, pageSize: 1 },
    { page: 10000, pageSize: 50 },
    { page: '2', pageSize: '8' },
    { page: ' 2 ', pageSize: ' 8 ' },
    { page: '2.0', pageSize: '+8' },
    { page: '2e0', pageSize: '0x10' },
    { page: '0010', pageSize: '05' },
    { page: '10000', pageSize: '50' },
  ])
    assert.deepEqual(algorithmSubmissionQuery.parse(input), algorithmPagination.parse(input));
  assert.deepEqual(algorithmSubmissionQuery.parse({ page: '2', pageSize: '8' }), { page: 2, pageSize: 8 });
});

test('分页排除数组、对象和布尔值，不能靠Number隐式转换穿过严格查询', () => {
  for (const key of ['page', 'pageSize']) {
    for (const value of [[], [1], ['1'], ['1', '2'], {}, { valueOf: () => 1 }, true, false, null])
      rejected({ [key]: value });
  }
});

test('非法范围、非整数、空串和非有限分页值均拒绝，而不静默回默认值', () => {
  for (const key of ['page', 'pageSize']) {
    for (const value of [
      '',
      ' ',
      '\t\n',
      0,
      -1,
      1.5,
      '0',
      '-1',
      '1.5',
      NaN,
      Infinity,
      -Infinity,
      'NaN',
      'Infinity',
      'nonsense',
      '1\0',
    ])
      rejected({ [key]: value });
  }
  rejected({ page: 10001 });
  rejected({ page: '10001' });
  rejected({ pageSize: 51 });
  rejected({ pageSize: '51' });
});

test('三种执行类型、四种语言、八个判题状态单独与组合均可准确解析', () => {
  for (const kind of kinds)
    assert.deepEqual(algorithmSubmissionQuery.parse({ kind }), { page: 1, pageSize: 20, kind });
  for (const language of languages)
    assert.deepEqual(algorithmSubmissionQuery.parse({ language }), { page: 1, pageSize: 20, language });
  for (const status of statuses)
    assert.deepEqual(algorithmSubmissionQuery.parse({ status }), { page: 1, pageSize: 20, status });
  for (const kind of kinds)
    for (const language of languages)
      for (const status of statuses) {
        const input = { kind, language, status, page: '2', pageSize: '8' };
        assert.deepEqual(algorithmSubmissionQuery.parse(input), { ...input, page: 2, pageSize: 8 });
      }
});

test('筛选只接受精确枚举；空串、空白、all、数组及类型混淆不能变成无筛选', () => {
  const samples = { kind: 'submit', language: 'python', status: 'accepted' };
  for (const [key, allowed] of Object.entries(samples)) {
    for (const value of [
      '',
      ' ',
      'all',
      null,
      true,
      false,
      0,
      1,
      [],
      [allowed],
      [allowed, allowed],
      {},
      allowed.toUpperCase(),
      ` ${allowed}`,
      `${allowed} `,
      `${allowed}\0`,
    ])
      rejected({ [key]: value });
  }
  for (const kind of ['run', 'example', 'formal', 'customInput']) rejected({ kind });
  for (const language of ['sh', 'c', 'py', 'js', 'typescript']) rejected({ language });
  for (const status of ['solved', 'pending', 'failed', 'success', 'AC', 'wa']) rejected({ status });
});

test('拒绝未知字段和非对象根值，身份/题目/排序不能通过查询覆盖服务端范围', () => {
  for (const key of [
    'organizationId',
    'userId',
    'problemId',
    'mode',
    'customInput',
    'orderBy',
    'cursor',
    'kind[]',
    'status[]',
  ])
    rejected({ page: '1', kind: 'submit', [key]: 'private-value' });
  for (const value of [undefined, null, true, false, [], 'page=1', 1]) rejected(value);
  rejected(JSON.parse('{"__proto__":{"userId":"other"}}'));
  rejected({ language: 'python', status: 'accepted', unknown: undefined });
});

test('省略某个筛选不会填入其他筛选，传入的枚举值不被修改或重命名', () => {
  const raw = Object.freeze({ kind: 'custom', status: 'accepted' });
  const parsed = algorithmSubmissionQuery.parse(raw);
  assert.deepEqual(parsed, { page: 1, pageSize: 20, kind: 'custom', status: 'accepted' });
  assert.equal(Object.hasOwn(parsed, 'language'), false);
  assert.deepEqual(raw, { kind: 'custom', status: 'accepted' });
});
