import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceInput, practiceRate, definitivePracticeFailure } from '../apps/mobile/src/practice-model';
import { MobileApiError } from '../apps/mobile/src/client';
test('native practice count is explicit and bounded; empty keeps automatic bank selection', () => {
  assert.equal(practiceInput('course', '', '', 0, '', 'random').count, undefined);
  assert.equal(practiceInput('course', '30', '', 0, '', 'random').count, 30);
  for (const n of ['0', '31', '-1', '1.5', 'NaN'])
    assert.throws(() => practiceInput('course', n, '', 0, '', 'random'));
  assert.throws(() => practiceInput('', '', '', 0, '', 'random'));
});
test('native practice filters preserve question type and exact knowledge name without accepting unknown types', () => {
  assert.deepEqual(practiceInput('c', '2', 'blank', 3, '  知识点  ', 'mistakes'), {
    courseId: 'c',
    count: 2,
    type: 'blank',
    difficulty: 3,
    knowledgePoint: '知识点',
    mode: 'mistakes',
  });
  assert.throws(() => practiceInput('c', '', 'admin', 0, '', 'random'));
  assert.throws(() => practiceInput('c', '', '', 6, '', 'random'));
});
test('practice accuracy excludes subjective-only answers and avoids false zero correctness', () => {
  const r = {
    answered: 2,
    total: 2,
    objectivelyScored: 0,
    correct: 0,
    scoreCents: 0,
    totalCents: 200,
    note: '',
  };
  assert.equal(practiceRate(r), '数据不足');
  assert.equal(practiceRate({ ...r, objectivelyScored: 3, correct: 2 }), '67%');
});
test('unknown practice writes stay distinct from definitive rejection so create retry can retain the frozen request', () => {
  assert.equal(definitivePracticeFailure(new TypeError('lost response')), false);
  assert.equal(definitivePracticeFailure(new MobileApiError(503, 'temporary')), false);
  assert.equal(definitivePracticeFailure(new MobileApiError(409, 'conflict')), true);
});
