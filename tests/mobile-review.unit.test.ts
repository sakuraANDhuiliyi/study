import { MobileApiError } from '../apps/mobile/src/client';
import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewBlockedReason,
  reviewScoreVisible,
  type ReviewAttempt,
} from '../apps/api/src/assessment/grade-review-policy';
import { definitiveReviewFailure, reviewReason } from '../apps/mobile/src/review-model';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
import { appealSchema } from '../apps/api/src/assessment/assessment.schemas';
const now = new Date('2026-10-18T12:00:00Z');
const attempt = (): ReviewAttempt => ({
  status: 'submitted',
  gradingStatus: 'graded',
  releaseStatus: 'released',
  scoreCents: 100,
  exam: {
    status: 'published',
    scoreReleaseAt: new Date(now.getTime() - 1),
    appealDeadline: null,
    audience: [{ userId: 's', eligible: true }],
  },
});
test('grade review visibility requires real publication, not a stored numeric score', () => {
  const a = attempt();
  assert.equal(reviewScoreVisible(a, now), true);
  assert.equal(reviewScoreVisible({ ...a, gradingStatus: 'pending' }, now), false);
  assert.equal(reviewScoreVisible({ ...a, releaseStatus: 'hidden' }, now), false);
  assert.equal(
    reviewScoreVisible({ ...a, exam: { ...a.exam, scoreReleaseAt: new Date(now.getTime() + 1) } }, now),
    false,
  );
});
test('review admission checks finished official score, audience, cancellation and exact deadline', () => {
  const a = attempt();
  assert.equal(reviewBlockedReason(a, 's', now), '');
  for (const changed of [
    { ...a, status: 'in_progress' },
    { ...a, gradingStatus: 'pending' },
    { ...a, scoreCents: null },
    { ...a, exam: { ...a.exam, status: 'cancelled' } },
    { ...a, exam: { ...a.exam, audience: [] } },
    { ...a, exam: { ...a.exam, appealDeadline: now } },
  ])
    assert.ok(reviewBlockedReason(changed, 's', now));
  assert.equal(
    reviewBlockedReason({ ...a, exam: { ...a.exam, appealDeadline: new Date(now.getTime() + 1) } }, 's', now),
    '',
  );
});
test('native and server reasons reject whitespace and oversized inputs and preserve unicode text', () => {
  for (const reason of ['     ', 'four', 'x'.repeat(4001)]) {
    assert.throws(() => reviewReason(reason));
    assert.equal(appealSchema.safeParse({ reason }).success, false);
  }
  assert.equal(reviewReason('  请核对本题评分依据  '), '请核对本题评分依据');
  assert.equal(appealSchema.parse({ reason: '  请核对本题评分依据  ' }).reason, '请核对本题评分依据');
});
test('mobile review permits exact own-read and application routes without grade mutation routes', () => {
  for (const [p, m] of [
    ['/mobile/appeals', 'GET'],
    ['/mobile/exam-attempts/a/review', 'GET'],
    ['/mobile/exam-attempts/a/appeals', 'POST'],
  ])
    assert.ok(mobileRouteAllowed('/api' + p, m));
  for (const [p, m] of [
    ['/appeals', 'GET'],
    ['/mobile/appeals/a/resolve', 'POST'],
    ['/mobile/exam-attempts/a/review', 'PUT'],
    ['/mobile/exam-attempts/a/revisions', 'POST'],
    ['/mobile/appeals', 'POST'],
  ])
    assert.ok(!mobileRouteAllowed('/api' + p, m));
});

test('known validation and permission rejection permits correction, while network and server uncertainty stays frozen', () => {
  for (const status of [400, 403, 404, 409, 413, 429])
    assert.ok(definitiveReviewFailure(new MobileApiError(status, 'rejected')));
  for (const status of [0, 408, 500, 502, 503])
    assert.ok(!definitiveReviewFailure(new MobileApiError(status, 'unknown')));
  assert.ok(!definitiveReviewFailure(new Error('network')));
});
