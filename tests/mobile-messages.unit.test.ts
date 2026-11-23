import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mobileMessagesRouteAllowed,
  mobileContactQuery,
  mobileMessageInput,
  mobileMessageQuery,
  mobileMessageReportInput,
} from '../apps/api/src/mobile/mobile-messages.policy';
import { prepareMessage, messageDefinitelyRefused, messagesApi } from '../apps/mobile/src/messages-model';
import { MobileApiError, type MobileClient } from '../apps/mobile/src/client';

test('native communication allowlist is exact by method and path', () => {
  for (const [method, path] of [
    ['GET', '/contacts'],
    ['GET', '/classes'],
    ['GET', '/conversations'],
    ['POST', '/conversations'],
    ['POST', '/reports'],
    ['POST', '/classes/class_1/conversation'],
    ['GET', '/conversations/c1/messages'],
    ['POST', '/conversations/c1/messages'],
    ['POST', '/conversations/c1/read'],
    ['GET', '/conversations/c1/files/f1'],
    ['DELETE', '/messages/m1'],
  ])
    assert.equal(mobileMessagesRouteAllowed('/api/mobile/messages' + path, method), true);
  for (const [method, path] of [
    ['POST', '/contacts'],
    ['PATCH', '/conversations/c1'],
    ['POST', '/conversations/c1/files/f1'],
    ['GET', '/reports'],
    ['GET', '/conversations/c1/messages/other'],
    ['GET', '/conversations/%2e%2e/files/f1'],
    ['DELETE', '/messages/a/b'],
  ])
    assert.equal(mobileMessagesRouteAllowed('/api/mobile/messages' + path, method), false);
  assert.equal(mobileMessagesRouteAllowed('/api/communication/conversations', 'GET'), false);
});
test('native message schemas reject coercion, extra authority and duplicate attachment injection', () => {
  assert.deepEqual(mobileContactQuery.parse({ page: '2', pageSize: '10', q: '老师' }), {
    page: 2,
    pageSize: 10,
    q: '老师',
  });
  for (const bad of [true, ['1'], {}, '1e0', '1.5'])
    assert.equal(mobileMessageQuery.safeParse({ page: bad }).success, false);
  const good = { body: '  请问这道题  ', clientId: 'key_12345678' };
  assert.deepEqual(mobileMessageInput.parse(good), { ...good, body: '请问这道题' });
  for (const bad of [
    { ...good, senderId: 'other' },
    { ...good, attachmentIds: ['same', 'same'] },
    { ...good, body: '\0' },
    { ...good, body: ' ' },
    { ...good, body: 'a'.repeat(10001) },
  ])
    assert.equal(mobileMessageInput.safeParse(bad).success, false);
  assert.equal(
    mobileMessageReportInput.safeParse({
      targetType: 'message',
      targetId: 'message1',
      reason: '恶意内容',
      organizationId: 'other',
    }).success,
    false,
  );
});
test('one send attempt is immutable and keeps its original text/clientId across network retry', async () => {
  const seen: unknown[] = [];
  const client = {
    request: async (path: string, input: unknown, method: string) => {
      seen.push({ path, input, method });
      if (seen.length === 1) throw new MobileApiError(0, '网络中断');
      return {
        id: 'm1',
        conversationId: 'c1',
        clientId: 'retry_key_123',
        createdAt: new Date().toISOString(),
      };
    },
  } as unknown as MobileClient;
  const attempt = prepareMessage('c1', '  原始正文  ', 'retry_key_123');
  assert.equal(Object.isFrozen(attempt), true);
  await assert.rejects(messagesApi.send(client, attempt));
  const result = await messagesApi.send(client, attempt);
  assert.equal(result.id, 'm1');
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(seen[0], {
    path: '/mobile/messages/conversations/c1/messages',
    input: { body: '原始正文', clientId: 'retry_key_123' },
    method: 'POST',
  });
  assert.throws(() => prepareMessage('c1', ' ', 'retry_key_123'));
  assert.throws(() => prepareMessage('c1', 'body', '../bad'));
});
test('only explicit refusals release a first attempt; transport/server failures remain uncertain', () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422, 429])
    assert.equal(messageDefinitelyRefused(new MobileApiError(status, '拒绝')), true);
  for (const status of [0, 408, 500, 502, 503])
    assert.equal(messageDefinitelyRefused(new MobileApiError(status, '不确定')), false);
  assert.equal(messageDefinitelyRefused(new Error('transport')), false);
});
test('read, report and downloads are explicit scoped operations with encoded identifiers', async () => {
  const seen: unknown[] = [],
    client = {
      request: (...args: unknown[]) => {
        seen.push(args);
        return Promise.resolve({ success: true });
      },
    } as unknown as MobileClient;
  await messagesApi.read(client, 'own/room', 'm1');
  await messagesApi.report(client, { targetType: 'reply', targetId: 'r1' }, '  具体原因  ');
  await messagesApi.file(client, 'own/room', '../f');
  assert.deepEqual(seen, [
    ['/mobile/messages/conversations/own%2Froom/read', { messageId: 'm1' }, 'POST'],
    ['/mobile/messages/reports', { targetType: 'reply', targetId: 'r1', reason: '具体原因' }, 'POST'],
    ['/mobile/messages/conversations/own%2Froom/files/..%2Ff', undefined, 'GET', { binary: true }],
  ]);
});
