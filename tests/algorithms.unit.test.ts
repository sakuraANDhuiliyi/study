import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { AlgorithmAiGateway } from '../apps/api/src/algorithms/algorithm-ai.gateway';
import { algorithmProblems } from '../apps/api/src/algorithms/algorithms.catalog';
import {
  AlgorithmsService,
  publicAlgorithmProblem,
  sanitizeJudgeResult,
  algorithmDate,
  algorithmActivity,
  algorithmLearningDto,
} from '../apps/api/src/algorithms/algorithms.service';
import {
  algorithmAnalysisInput,
  algorithmDraftInput,
  algorithmProblemQuery,
  algorithmSubmissionInput,
  algorithmLearningInput,
} from '../apps/api/src/algorithms/algorithms.schemas';
import { AuthService } from '../apps/api/src/auth/auth.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { JudgeExecutionResult } from '../apps/api/src/algorithms/judge.gateway';

const actor: Actor = {
  id: 'student',
  organizationId: 'org',
  role: 'STUDENT',
  permissions: ['learning.use'],
  name: '测试学生',
  sessionId: 'session',
};

test('算法输入严格拒绝越权字段、不受支持语言、超大代码和正式提交自定义输入', () => {
  const valid = { language: 'python', code: 'print(3)', mode: 'submit' };
  assert.equal(algorithmSubmissionInput.safeParse(valid).success, true);
  for (const input of [
    { ...valid, userId: 'other' },
    { ...valid, language: 'sh' },
    { ...valid, code: '' },
    { ...valid, code: 'x\0' },
    { ...valid, code: 'x'.repeat(16001) },
    { ...valid, stdin: '1 2' },
    { ...valid, timeLimitMs: 900000 },
  ])
    assert.equal(algorithmSubmissionInput.safeParse(input).success, false);
  assert.equal(algorithmDraftInput.safeParse({ language: 'cpp', code: '' }).success, true);
  assert.equal(algorithmSubmissionInput.safeParse({ ...valid, mode: 'run', stdin: '' }).success, true);
  assert.equal(
    algorithmAnalysisInput.safeParse({ language: 'python', code: '', mode: 'hint' }).success,
    true,
  );
  assert.equal(algorithmProblemQuery.safeParse({ page: '-1' }).success, false);
  assert.equal(algorithmProblemQuery.safeParse({ difficulty: 'impossible' }).success, false);
  assert.equal(algorithmProblemQuery.parse({ page: '2', pageSize: '10' }).page, 2);
});

test('公开题目使用允许字段白名单，隐藏用例、提示和解答不能下发', () => {
  for (const problem of algorithmProblems) {
    const safe = publicAlgorithmProblem(problem);
    assert.equal(safe.id, problem.id);
    assert.equal('testCases' in safe, false);
    assert.equal('hints' in safe, false);
    assert.equal('solution' in safe, false);
    assert.deepEqual(Object.keys(safe.starterCode).sort(), ['cpp', 'java', 'javascript', 'python']);
  }
});

test('服务端再次依据题库隐藏标记清洗判题回显与诊断，而不信任供应商标记', () => {
  const raw: JudgeExecutionResult = {
    status: 'wrong_answer',
    passed: 999,
    total: 999,
    runtimeMs: 3.8,
    memoryKb: Infinity,
    compileOutput: 'hidden-input-must-never-leak',
    error: 'hidden-input-must-never-leak',
    results: [
      { index: 50, status: 'accepted', hidden: true, stdout: '3\n', stderr: '' },
      {
        index: 1,
        status: 'wrong_answer',
        hidden: false,
        input: 'hidden-input-must-never-leak',
        expectedOutput: 'private-answer',
        stdout: 'private-stdout',
        stderr: 'private-stderr',
      },
    ],
  };
  const output = sanitizeJudgeResult(raw, [
    { input: '1 2', output: '3', hidden: false },
    { input: 'hidden-input-must-never-leak', output: 'private-answer', hidden: true },
  ]);
  assert.equal(output.passed, 1);
  assert.equal(output.total, 2);
  assert.equal(output.runtimeMs, 4);
  assert.equal(output.memoryKb, null);
  assert.equal(output.results[0].index, 1);
  assert.equal(output.results[0].hidden, false);
  assert.equal(output.results[1].hidden, true);
  for (const secret of ['hidden-input-must-never-leak', 'private-answer', 'private-stdout', 'private-stderr'])
    assert.equal(JSON.stringify(output).includes(secret), false);
});

test('缺失测试结果不能伪装通过，自定义运行不伪造预期答案', () => {
  const raw: JudgeExecutionResult = {
    status: 'accepted',
    passed: 1,
    total: 1,
    runtimeMs: 1,
    memoryKb: 1,
    compileOutput: '',
    error: '',
    results: [],
  };
  assert.equal(sanitizeJudgeResult(raw, [{ input: 'x', output: 'y', hidden: false }]).status, 'system_error');
  raw.results = [{ index: 1, status: 'accepted', hidden: false, stdout: 'anything' }];
  const custom = sanitizeJudgeResult(raw, [{ input: 'x', hidden: false }]);
  assert.equal(custom.status, 'accepted');
  assert.equal('expectedOutput' in custom.results[0], false);
});

test('算法 AI 提示请求只传必要数据，不发送隐藏用例/学生身份且移除模型给出的完整代码', async () => {
  let captured: any;
  const modelOutput = {
    summary: '先观察输入',
    approach: ['读取两个整数'],
    complexity: '时间 O(1)，空间 O(1)',
    pitfalls: ['考虑负数'],
    suggestedCode: 'print(sum(map(int,input().split())))',
  };
  const gateway = new AlgorithmAiGateway({
    completeJson: async (_instructions: string, input: unknown) => {
      captured = input;
      return modelOutput;
    },
  } as any);
  const problem = {
    ...algorithmProblems[0],
    testCases: [{ input: 'sensitive-hidden-case', output: 'secret', hidden: true }],
    solution: 'private-complete-solution',
  };
  const hint = await gateway.analyze(problem, { language: 'python', code: '# student code', mode: 'hint' });
  assert.equal(hint.suggestedCode, '');
  assert.equal(captured.problem.solution, undefined);
  assert.equal(captured.problem.testCases, undefined);
  assert.equal(captured.organizationId, undefined);
  assert.equal(captured.userId, undefined);
  assert.equal(JSON.stringify(captured).includes('sensitive-hidden-case'), false);
  await gateway.analyze(problem, { language: 'python', code: '', mode: 'explain' });
  assert.equal(captured.problem.solution, 'private-complete-solution');
});

test('算法接口拒绝教师、缺少learning.use权限与关闭practice的机构', async () => {
  let closed = false;
  const db = { systemSetting: { findUnique: async () => ({ value: { practice: !closed } }) } };
  const auth = new AuthService(db as any);
  const service = new AlgorithmsService(
    db as any,
    auth,
    { status: () => ({ available: false, reason: '尚未配置', languages: [] }) } as any,
    { status: () => ({ available: false, reason: '尚未配置', model: '' }) } as any,
  );
  await assert.rejects(service.status({ ...actor, role: 'TEACHER' }), ForbiddenException);
  await assert.rejects(service.status({ ...actor, permissions: [] }), ForbiddenException);
  assert.equal((await service.status(actor)).judge.available, false);
  closed = true;
  await assert.rejects(service.status(actor), ForbiddenException);
  await assert.rejects(auth.checkFeature(actor, '/api/algorithms/problems'), ForbiddenException);
});

test('草稿和提交读取始终带有本人及机构范围', async () => {
  const queries: any[] = [];
  const tx: any = {
    $queryRaw: async () => [],
    algorithmOperation: { findMany: async () => [] },
    algorithmDraft: {
      findFirst: async (query: any) => {
        queries.push(query.where);
        return null;
      },
    },
    algorithmLearningState: {
      findFirst: async (query: any) => {
        queries.push(query.where);
        return null;
      },
    },
    algorithmSubmission: {
      findFirst: async (query: any) => {
        queries.push(query.where);
        return null;
      },
    },
  };
  tx.$transaction = async (run: any) => run(tx);
  const service = new AlgorithmsService(
    tx,
    { require: () => {}, checkFeature: async () => {} } as any,
    {} as any,
    {} as any,
  );
  await service.problem(actor, algorithmProblems[0].id);
  await assert.rejects(service.submission(actor, 'foreign-submission'));
  for (const query of queries) {
    assert.equal(query.organizationId, actor.organizationId);
    assert.equal(query.userId, actor.id);
  }
});

test('学习状态只接受有版本号的部分更新，保留纯文本并拒绝越权字段和超限笔记', () => {
  assert.deepEqual(algorithmLearningInput.parse({ revision: 0, favorite: false, note: '' }), {
    revision: 0,
    favorite: false,
    note: '',
  });
  assert.equal(algorithmLearningInput.parse({ revision: 3, note: '<vector>\nO(n)' }).note, '<vector>\nO(n)');
  for (const input of [
    { revision: 0 },
    { favorite: true },
    { revision: '0', favorite: true },
    { revision: -1, note: '' },
    { revision: 0, reviewStatus: 'solved' },
    { revision: 0, favorite: 'true' },
    { revision: 0, userId: 'other', note: '' },
    { revision: 0, note: '\0' },
    { revision: 0, note: '学'.repeat(12001) },
  ])
    assert.equal(algorithmLearningInput.safeParse(input).success, false);
  assert.deepEqual(algorithmLearningDto(null), {
    favorite: false,
    reviewStatus: 'none',
    note: '',
    revision: 0,
    updatedAt: null,
  });
  assert.equal(algorithmProblemQuery.safeParse({ favorite: 'true', review: 'review' }).success, true);
  assert.equal(algorithmProblemQuery.safeParse({ favorite: '1' }).success, false);
  assert.equal(algorithmProblemQuery.safeParse({ review: 'none' }).success, false);
});

test('学习日历按北京时间跨日、补齐28天，连续天数可从昨天开始且不被28天展示窗口截断', () => {
  assert.equal(algorithmDate(new Date('2026-10-08T15:59:59Z')), '2026-10-08');
  assert.equal(algorithmDate(new Date('2026-10-08T16:00:00Z')), '2026-10-09');
  const now = new Date('2026-10-08T23:30:00Z');
  const empty = algorithmActivity([], now);
  assert.equal(empty.activity.length, 28);
  assert.equal(empty.activity.at(-1)?.date, '2026-10-09');
  assert.equal(empty.activity[0].date, '2026-09-12');
  assert.equal(empty.streak, 0);
  assert.ok(empty.activity.every((day) => day.submissions === 0 && day.solved === 0));
  const days = Array.from({ length: 31 }, (_, i) => ({
    date: new Date(Date.parse('2026-10-08T00:00:00Z') - i * 86400000).toISOString().slice(0, 10),
    submissions: 2,
    accepted: 1,
    solved: 1,
  }));
  const yesterday = algorithmActivity(days, now);
  assert.equal(yesterday.streak, 31);
  assert.equal(yesterday.activity.at(-1)?.submissions, 0);
  assert.equal(algorithmActivity(days, new Date('2026-10-08T12:00:00Z')).streak, 31);
  assert.equal(
    algorithmActivity(
      days.filter((day) => day.date !== '2026-10-07'),
      now,
    ).streak,
    1,
  );
  assert.equal(algorithmActivity(days, new Date('2026-10-10T12:00:00Z')).streak, 0);
});
