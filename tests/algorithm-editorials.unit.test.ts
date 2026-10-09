import { test } from 'node:test';
import assert from 'node:assert/strict';
import { algorithmProblems } from '../apps/api/src/algorithms/algorithms.catalog';
import { algorithmEditorials, getAlgorithmEditorial } from '../apps/api/src/algorithms/algorithms.editorials';

const normalized = (text: string) => text.replace(/\r\n?/g, '\n').trimEnd();

test('每道题都有完整教学内容、三级提示和与真实样例一致的逐步推演', () => {
  assert.equal(algorithmEditorials.length, algorithmProblems.length);
  assert.equal(new Set(algorithmEditorials.map((item) => item.problemId)).size, algorithmEditorials.length);
  assert.equal(getAlgorithmEditorial('not-a-problem'), undefined);
  for (const problem of algorithmProblems) {
    const item = getAlgorithmEditorial(problem.id);
    assert.ok(item, problem.id);
    assert.ok(item.introduction.length >= 50, `${problem.id}: introduction`);
    assert.ok(item.prerequisites.length >= 2 && item.readingGuide.length >= 3);
    assert.equal(item.hints.length, 3, `${problem.id}: progressive hints`);
    assert.ok(item.hints.every((hint) => hint.length >= 10));
    assert.ok(item.approaches.length >= (problem.id === 'sum-of-two' ? 1 : 2), problem.id);
    for (const approach of item.approaches) {
      assert.ok(approach.name && approach.intuition && approach.correctness && approach.tradeoff);
      assert.ok(approach.steps.length >= 2);
      assert.ok(approach.timeComplexity.includes('O(') && approach.spaceComplexity.includes('O('));
    }
    const example = problem.examples.find(
      (example) => normalized(example.input) === normalized(item.walkthrough.input),
    );
    assert.ok(example, `${problem.id}: walkthrough must use a real public example`);
    assert.equal(normalized(item.walkthrough.result), normalized(example.output));
    assert.ok(item.walkthrough.steps.length >= 3);
    item.walkthrough.steps.forEach((step, index) => {
      assert.equal(step.step, index + 1);
      assert.ok(step.state && step.explanation);
    });
    assert.ok(item.edgeCases.length >= 3 && item.mistakes.length >= 3 && item.followUp.length >= 2);
    assert.ok(item.edgeCases.every((item) => item.case && item.why));
    assert.ok(item.mistakes.every((item) => item.mistake && item.fix));
    for (const related of item.relatedProblemIds) {
      assert.notEqual(related, problem.id);
      assert.ok(
        algorithmProblems.some((problem) => problem.id === related),
        `${problem.id}: related ${related}`,
      );
    }
  }
});

test('原19题保留完整四语言参考，新题仅展示已实现且验证的参考程序', () => {
  for (const item of algorithmEditorials) {
    const original = algorithmProblems.find((problem) => problem.id === item.problemId)!.number <= 19;
    assert.deepEqual(
      Object.keys(item.referenceCode).sort(),
      original ? ['cpp', 'java', 'javascript', 'python'] : ['javascript'],
    );
    for (const [language, program] of Object.entries(item.referenceCode)) {
      assert.ok(program.length > 40 && Buffer.byteLength(program) <= 48_000, `${item.problemId} ${language}`);
      assert.doesNotMatch(program, /```|TODO|YOUR_CODE|throw new Error\(['"]Not implemented/);
    }
    if (item.referenceCode.cpp) assert.match(item.referenceCode.cpp, /int main\(/);
    if (item.referenceCode.python) assert.match(item.referenceCode.python, /sys\.stdin/);
    assert.match(item.referenceCode.javascript!, /readFileSync\(0/);
    if (item.referenceCode.java) assert.match(item.referenceCode.java, /public class Main/);
    if (item.referenceCode.java) assert.match(item.referenceCode.java, /public static void main/);
  }
});
