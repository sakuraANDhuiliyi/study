import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxTarget } from '../apps/api/src/mobile/mobile-inbox.policy';
import { nativeInboxTarget } from '../apps/mobile/src/inbox-model';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
test('announcement notifications accept only strict event identity paired with internal announcement links', () => {
  for (const link of ['/courses/c', '/notifications'])
    assert.deepEqual(inboxTarget('ANNOUNCEMENT', link, 'announcement:a'), { name: 'announcement', id: 'a' });
  for (const link of ['https://evil.invalid', '/admin', '/courses/a?x', '/notifications/'])
    assert.equal(inboxTarget('ANNOUNCEMENT', link, 'announcement:a'), null);
  assert.equal(inboxTarget('PRIVATE_MESSAGE', '/notifications', 'announcement:a'), null);
  assert.equal(inboxTarget('ANNOUNCEMENT', '/notifications', 'announcement:../x'), null);
  assert.deepEqual(nativeInboxTarget({ name: 'announcement', id: 'a_1' }), {
    name: 'announcement',
    id: 'a_1',
  });
  assert.throws(() => nativeInboxTarget({ name: 'announcement', id: 'a/1' }));
});
test('native announcement permission permits only bounded read routes', () => {
  assert.ok(mobileRouteAllowed('/api/mobile/announcements', 'GET'));
  assert.ok(mobileRouteAllowed('/api/mobile/announcements/a', 'GET'));
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
    assert.ok(!mobileRouteAllowed('/api/mobile/announcements/a', method));
  assert.ok(!mobileRouteAllowed('/api/announcements', 'GET'));
  assert.ok(!mobileRouteAllowed('/api/mobile/announcements/a/author', 'GET'));
});
