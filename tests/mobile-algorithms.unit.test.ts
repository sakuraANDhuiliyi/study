import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
import { mobileAlgorithmQuery } from '../apps/api/src/mobile/mobile-algorithms.schemas';
import {
  algorithmNote,
  reconcileAlgorithmEdit,
  type AlgorithmState,
} from '../apps/mobile/src/algorithms-model';
test('native algorithm learning exposes bounded reads and personal learning PATCH only', () => {
  for (const p of [
    '/api/mobile/algorithms/problems',
    '/api/mobile/algorithms/problems/sum-of-two',
    '/api/mobile/algorithms/problems/sum-of-two/editorial',
    '/api/mobile/algorithms/problems/sum-of-two/learning',
  ])
    assert.ok(mobileRouteAllowed(p, 'GET'));
  assert.ok(mobileRouteAllowed('/api/mobile/algorithms/problems/a/learning', 'PATCH'));
  for (const p of [
    '/api/algorithms/problems',
    '/api/mobile/algorithms/problems/a/submissions',
    '/api/mobile/algorithms/problems/a/analysis',
    '/api/mobile/algorithms/problems/a/draft',
    '/api/mobile/algorithms/problems/a/editorial',
  ])
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(mobileRouteAllowed(p, m), false);
  for (const q of [
    { pageSize: 21 },
    { page: 0 },
    { page: true },
    { page: ['1'] },
    { q: 'a'.repeat(101) },
    { tag: 'a'.repeat(61) },
    { userId: 'other' },
    { favorite: true },
    { review: 'none' },
  ])
    assert.ok(!mobileAlgorithmQuery.safeParse(q).success);
  assert.deepEqual(mobileAlgorithmQuery.parse({ q: '100%_\\', page: '2' }), {
    q: '100%_\\',
    page: 2,
    pageSize: 10,
  });
});
test('algorithm notes preserve plain Unicode text, permit explicit clearing and reject oversized or NUL input', () => {
  assert.equal(algorithmNote(' <vector>\n学习😀 '), ' <vector>\n学习😀 ');
  assert.equal(algorithmNote(''), '');
  assert.equal(algorithmNote('学'.repeat(12000)).length, 12000);
  assert.throws(() => algorithmNote('学'.repeat(12001)));
  assert.throws(() => algorithmNote('a\0b'));
});
test('uncertain algorithm save is reconciled by version and every intended field without replaying a write', () => {
  const base: AlgorithmState = {
    revision: 3,
    favorite: false,
    reviewStatus: 'none',
    note: 'old',
    updatedAt: null,
  };
  const intent = { favorite: true, reviewStatus: 'review' as const, note: 'new' };
  assert.equal(reconcileAlgorithmEdit(base, intent, { ...base, ...intent, revision: 4 }), 'applied');
  assert.equal(reconcileAlgorithmEdit(base, intent, base), 'unchanged');
  for (const current of [
    { ...base, ...intent, revision: 5 },
    { ...base, ...intent, revision: 4, note: 'other' },
    { ...base, revision: 0 },
    { ...base, ...intent, revision: 3 },
  ])
    assert.equal(reconcileAlgorithmEdit(base, intent, current), 'conflict');
});
