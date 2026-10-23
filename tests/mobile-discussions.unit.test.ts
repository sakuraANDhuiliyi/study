import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
import { discussionText } from '../apps/mobile/src/discussions-model';
import { mobilePostSchema, mobileReplySchema } from '../apps/api/src/mobile/mobile-discussions.schemas';
test('native discussion permits only reads, topic creation and replies, never moderation or generic website access', () => {
  for (const p of [
    '/api/mobile/discussions',
    '/api/mobile/discussions/a',
    '/api/mobile/discussions/receipts',
  ])
    assert.ok(mobileRouteAllowed(p, 'GET'));
  for (const p of ['/api/mobile/discussions', '/api/mobile/discussions/a/replies'])
    assert.ok(mobileRouteAllowed(p, 'POST'));
  for (const p of ['/api/discussions', '/api/discussions/a', '/api/mobile/discussions/a/moderate'])
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal(mobileRouteAllowed(p, method), false);
  for (const method of ['PUT', 'PATCH', 'DELETE'])
    assert.equal(mobileRouteAllowed('/api/mobile/discussions/a', method), false);
});
test('discussion composer validates the actual trimmed Unicode length and refuses empty/NUL content', () => {
  assert.equal(discussionText('  学习 & code < 5  '), '学习 & code < 5');
  assert.equal(discussionText('题'.repeat(10000)).length, 10000);
  for (const value of ['', ' \n ', 'bad\0text', '题'.repeat(10001)])
    assert.throws(() => discussionText(value));
  assert.throws(() => discussionText('题'.repeat(161), 160));
});
test('native discussion write schemas reject forged authors, attachments, moderation and invalid request identity', () => {
  const p = { courseId: 'course', title: 'Title', body: 'Body', key: 'a'.repeat(8) };
  assert.ok(mobilePostSchema.safeParse(p).success);
  for (const input of [
    { ...p, authorId: 'teacher' },
    { ...p, pinned: true },
    { ...p, attachmentIds: [] },
    { ...p, key: '../invalid/key' },
    { ...p, key: 'short' },
    { ...p, body: 'a\0b' },
  ])
    assert.ok(!mobilePostSchema.safeParse(input).success);
  assert.ok(!mobileReplySchema.safeParse({ body: 'reply', key: p.key, quoteReplyId: 'a/b' }).success);
});
