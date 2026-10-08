import test from 'node:test';
import assert from 'node:assert/strict';
import { AlgorithmAiGateway } from '../apps/api/src/algorithms/algorithm-ai.gateway';
import type { AiGateway } from '../apps/api/src/ai-study/ai.gateway';
import { getAlgorithmProblem } from '../apps/api/src/algorithms/algorithms.catalog';
import { getAlgorithmEditorial } from '../apps/api/src/algorithms/algorithms.editorials';

const content = {
  summary: '算法分析',
  approach: ['具体步骤'],
  complexity: '时间 O(n)，空间 O(n)',
  pitfalls: ['边界条件'],
  suggestedCode: 'reference',
};
test('algorithm AI tutoring uses authored explanations and only selected-language reference code', async () => {
  const problem = getAlgorithmProblem('shortest-path')!;
  let prompt = '';
  let payload: Record<string, unknown> = {};
  const gateway = new AlgorithmAiGateway({
    completeJson: async (instructions: string, request: Record<string, unknown>) => {
      prompt = instructions;
      payload = request;
      return content;
    },
  } as unknown as AiGateway);
  const result = await gateway.analyze(problem, { mode: 'explain', language: 'python', code: 'print(0)' });
  assert.deepEqual(result, content);
  assert.match(prompt, /状态变化/);
  assert.match(prompt, /没有真实运行证据不能声称代码已通过/);
  const teaching = payload.teaching as Record<string, unknown>;
  assert.deepEqual(teaching.approaches, getAlgorithmEditorial(problem.id)!.approaches);
  assert.equal(teaching.referenceCode, getAlgorithmEditorial(problem.id)!.referenceCode.python);
  const sentProblem = payload.problem as Record<string, unknown>;
  assert.ok(!('testCases' in sentProblem));
  assert.ok(!('starterCode' in sentProblem));
  assert.ok(!('execution' in payload));
  for (const item of problem.testCases.filter((c) => c.hidden)) {
    assert.ok(
      !JSON.stringify(payload).includes(JSON.stringify(item.input).slice(1, -1)),
      'Private case not sent',
    );
  }
});
test('hint mode excludes complete teaching answers and enforces an empty reference response', async () => {
  let payload: Record<string, unknown> = {};
  const gateway = new AlgorithmAiGateway({
    completeJson: async (_: string, request: Record<string, unknown>) => {
      payload = request;
      return content;
    },
  } as unknown as AiGateway);
  const result = await gateway.analyze(getAlgorithmProblem('range-sum')!, {
    mode: 'hint',
    language: 'java',
    code: '',
  });
  assert.equal(result.suggestedCode, '');
  assert.deepEqual(Object.keys(payload.teaching as object).sort(), ['hints', 'readingGuide']);
  assert.ok(!('solution' in (payload.problem as object)));
});
