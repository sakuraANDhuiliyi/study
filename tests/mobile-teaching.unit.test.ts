import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mobileTeachingRouteAllowed,
  teachingQuery,
  teachingPage,
  teachingMembers,
  teachingQuestionPatch,
  teachingAssignmentPatch,
  teachingExamPatch,
} from '../apps/api/src/mobile/mobile-teaching.policy';
import {
  teachingApi,
  teachingDate,
  teachingInteger,
  teachingScore,
  type TeachingAssessment,
} from '../apps/mobile/src/teaching-model';
import type { MobileClient } from '../apps/mobile/src/client';
test('native teaching allowlist exposes only exact management routes, not student answers, admin or general storage', () => {
  for (const [path, method] of [
    ['courses', 'GET'],
    ['courses/c1/members', 'GET'],
    ['courses/c1/files/f1', 'GET'],
    ['courses/c1/files', 'POST'],
    ['chapters/c1', 'PATCH'],
    ['chapters/c1/lessons', 'POST'],
    ['lessons/l1', 'PATCH'],
    ['questions/q1', 'GET'],
    ['questions/q1', 'PATCH'],
    ['questions/q1/versions', 'GET'],
    ['questions/q1/copy', 'POST'],
    ['papers', 'POST'],
    ['assignments', 'POST'],
    ['assignments/a1', 'PATCH'],
    ['assignments/a1/roster', 'GET'],
    ['assignments/a1/exceptions', 'POST'],
    ['submissions/s1/return', 'POST'],
    ['exams/e1/extension', 'POST'],
    ['exams/e1/eligibility', 'POST'],
  ])
    assert.equal(mobileTeachingRouteAllowed('/api/mobile/teaching/' + path, method), true, path);
  for (const [path, method] of [
    ['questions/q1/answers', 'POST'],
    ['questions/q1', 'DELETE'],
    ['exams/e1/submit', 'POST'],
    ['courses/c1/files/f1', 'DELETE'],
    ['files/f1', 'GET'],
    ['users', 'GET'],
    ['courses/c1/files/f1/preview', 'GET'],
    ['questions/%2e%2e', 'GET'],
    ['papers/foreign', 'GET'],
  ])
    assert.equal(mobileTeachingRouteAllowed('/api/mobile/teaching/' + path, method), false, path);
});
test('native teaching pagination and bodies reject unknown authority, coercion collections and absent revisions', () => {
  assert.deepEqual(teachingPage.parse({ page: '2', pageSize: '20' }), { page: 2, pageSize: 20 });
  for (const q of [{ page: ['1', '2'] }, { page: true }, { pageSize: 21 }, { organizationId: 'other' }])
    assert.equal(teachingQuery.safeParse(q).success, false);
  assert.equal(teachingMembers.safeParse({ kind: 'admin' }).success, false);
  assert.equal(teachingQuestionPatch.safeParse({ stem: '更新', expectedVersion: 1 }).success, true);
  for (const body of [
    { stem: '更新' },
    { expectedVersion: 1, courseId: 'other' },
    { expectedVersion: 1, userId: 'other' },
  ])
    assert.equal(teachingQuestionPatch.safeParse(body).success, false);
  for (const schema of [teachingAssignmentPatch, teachingExamPatch]) {
    assert.equal(schema.safeParse({ revision: 0, audienceIds: ['s1'] }).success, true);
    assert.equal(schema.safeParse({ audienceIds: ['s1'] }).success, false);
    assert.equal(schema.safeParse({ revision: 0, courseId: 'other' }).success, false);
  }
});
test('teacher form parsing preserves money exactly and rejects truncated or invalid schedules', () => {
  assert.equal(teachingScore('12.34'), 1234);
  assert.equal(teachingInteger('0', '次数', 0, 20), 0);
  assert.equal(teachingDate('2026-12-01T09:00:00+08:00', '时间'), '2026-12-01T01:00:00.000Z');
  for (const value of ['1.234', '1e2', '-1', 'NaN', '']) assert.throws(() => teachingScore(value));
  for (const value of ['1x', '1.2', '1e1', '-1', ''])
    assert.throws(() => teachingInteger(value, '次数', 0, 20));
  assert.throws(() => teachingDate('not-a-date', '时间'));
});
test('native revisions preserve server preconditions and exact selected audience without caller override', async () => {
  const calls: unknown[][] = [];
  const client = {
    request: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as MobileClient;
  await teachingApi.revise(client, 'q1', 3, { stem: '新题', expectedVersion: 99 });
  await teachingApi.audience(client, 'assignments', { id: 'a1', revision: 7 } as TeachingAssessment, [
    's1',
    's2',
    's1',
  ]);
  assert.deepEqual(calls, [
    ['/mobile/teaching/questions/q1', { stem: '新题', expectedVersion: 3 }, 'PATCH'],
    ['/mobile/teaching/assignments/a1', { revision: 7, audienceIds: ['s1', 's2'] }, 'PATCH'],
  ]);
});
