import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxKind, inboxTarget } from '../apps/api/src/mobile/mobile-inbox.policy';
import { nativeInboxTarget } from '../apps/mobile/src/inbox-model';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
test('notification target parsing accepts only paired internal resource routes', () => {
  for (const [type, path, name] of [
    ['assignment', '/assignments/a', 'assignment'],
    ['grade', '/assignments/a', 'assignment'],
    ['exam', '/exams/e', 'exam'],
    ['grade', '/exams/e', 'exam'],
    ['grade', '/attempts/x', 'review'],
    ['MEMBERSHIP', '/courses/c', 'course'],
    ['ANNOUNCEMENT', '/courses/c', 'course'],
  ])
    assert.equal(inboxTarget(type, path)?.name, name);
  assert.equal(inboxKind('PRIVATE_MESSAGE'), 'other');
});
test('stored external links, path tricks and unrecognized notification types never navigate', () => {
  for (const path of [
    'https://evil.test/exams/e',
    '//evil.test',
    '/exams/e?token=x',
    '/exams/%2e%2e',
    '/exams/e/answers',
    '/exams/e#x',
    '/exams/../admin',
    'javascript:alert(1)',
    '/exams/e/',
  ])
    assert.equal(inboxTarget('exam', path), null);
  assert.equal(inboxTarget('PRIVATE_MESSAGE', '/exams/e'), null);
  assert.equal(inboxTarget('exam', '/assignments/e'), null);
});
test('native notification navigation independently rejects unrecognized routes and unsafe identifiers', () => {
  assert.deepEqual(nativeInboxTarget({ name: 'review', id: 'a_1' }), { name: 'review', id: 'a_1' });
  for (const t of [
    null,
    {},
    { name: 'admin', id: 'a' },
    { name: 'exam', id: '../x' },
    { name: 'exam', id: 'a?x' },
    { name: 'course', id: 'x'.repeat(101) },
  ])
    assert.throws(() => nativeInboxTarget(t));
});
test('mobile inbox grants only list, typed target lookup and bounded read action', () => {
  for (const [p, m] of [
    ['/mobile/notifications', 'GET'],
    ['/mobile/notifications/a/target', 'GET'],
    ['/mobile/notifications/read', 'POST'],
  ])
    assert.ok(mobileRouteAllowed('/api' + p, m));
  for (const [p, m] of [
    ['/notifications', 'GET'],
    ['/notifications/read-all', 'POST'],
    ['/mobile/notifications', 'POST'],
    ['/mobile/notifications/read-all', 'POST'],
    ['/mobile/notifications/a', 'DELETE'],
    ['/mobile/notifications/a/target', 'POST'],
  ])
    assert.ok(!mobileRouteAllowed('/api' + p, m));
});
