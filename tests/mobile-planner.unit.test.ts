import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
import {
  assessmentPage,
  monthRange,
  moveMonth,
  parseTaskDate,
  shanghaiInput,
} from '../apps/mobile/src/planner-model';

test('native planner exposes exact read and personal mutation routes without widening course or admin scope', () => {
  for (const path of [
    '/api/planner',
    '/api/planner/',
    '/api/planner/actions',
    '/api/planner/actions/courses',
    '/api/planner/tasks/abc',
  ])
    assert.equal(mobileRouteAllowed(path, 'GET'), true, path);
  assert.equal(mobileRouteAllowed('/api/planner/tasks', 'POST'), true);
  for (const method of ['PATCH', 'DELETE'])
    assert.equal(mobileRouteAllowed('/api/planner/tasks/abc', method), true);
  for (const [path, method] of [
    ['/api/planner/actions', 'POST'],
    ['/api/planner/tasks', 'DELETE'],
    ['/api/planner/tasks/abc', 'POST'],
    ['/api/planner/tasks/abc/owner', 'PATCH'],
    ['/api/planner/tasks/abc', 'PUT'],
    ['/api/planner/export', 'GET'],
    ['/api/planner/tasks', 'GET'],
    ['/api/admin/users', 'GET'],
    ['/api/assignments/abc', 'POST'],
    ['/api/exams/abc/start', 'POST'],
  ])
    assert.equal(mobileRouteAllowed(path, method), false, method + path);
});
test('native plan dates use Shanghai regardless of device timezone and reject normalized impossible dates', () => {
  assert.equal(shanghaiInput('2026-10-18T16:15:00Z'), '2026-10-19T00:15');
  assert.equal(parseTaskDate('2028-02-29', '00:30'), '2028-02-28T16:30:00.000Z');
  for (const [day, time] of [
    ['2026-02-29', '12:00'],
    ['2026-04-31', '12:00'],
    ['2026-13-01', '12:00'],
    ['2026-10-18', '24:00'],
    ['2026-10-18', '12:60'],
    ['2026-1-8', '12:00'],
    ['1999-12-31', '12:00'],
    ['2101-01-01', '12:00'],
    ['2026-10-18', '12:00:01'],
  ])
    assert.throws(() => parseTaskDate(day, time));
});
test('native month agenda crosses years and leap months without phone timezone drift', () => {
  assert.deepEqual(monthRange('2028-02'), {
    start: '2028-01-31T16:00:00.000Z',
    end: '2028-02-29T16:00:00.000Z',
  });
  assert.equal(moveMonth('2026-12', 1), '2027-01');
  assert.equal(moveMonth('2026-01', -1), '2025-12');
  assert.throws(() => moveMonth('2000-01', -1));
  assert.throws(() => monthRange('2026-00'));
});
test('assessment handoff only accepts recognized relative detail paths, never tokens or external URLs', () => {
  for (const path of ['/assignments/abc-1', '/exams/exam_2', '/exam-attempts/abc'])
    assert.equal(assessmentPage(path), path);
  for (const path of [
    undefined,
    '//evil.test',
    'https://evil.test',
    '/admin/users',
    '/exams/../admin',
    '/exams/a?token=secret',
    '/exams/a#fragment',
    '/exams/%2fadmin',
  ])
    assert.equal(assessmentPage(path), null);
});
