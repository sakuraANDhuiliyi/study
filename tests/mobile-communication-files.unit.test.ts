import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mobileCommunicationFilesRouteAllowed,
  communicationFilesQuery,
  communicationAttachmentIds,
} from '../apps/api/src/mobile/mobile-communication-files.policy';
import { mobilePostSchema, mobileReplySchema } from '../apps/api/src/mobile/mobile-discussions.schemas';
import { mobileMessageInput } from '../apps/api/src/mobile/mobile-messages.policy';
import {
  confirmedCommunicationFile,
  addCommunicationFile,
  communicationFileIds,
  communicationFilesPath,
} from '../apps/mobile/src/communication-files-model';
import { prepareMessage, messagesApi } from '../apps/mobile/src/messages-model';
import { MobileClient, MobileApiError, type MobileSession } from '../apps/mobile/src/client';
test('native attachments allow only exact owned collection/upload/delete and published discussion download paths', () => {
  for (const scope of ['discussions/courses/c1', 'messages/conversations/c1']) {
    for (const method of ['GET', 'POST'])
      assert.ok(mobileCommunicationFilesRouteAllowed('/api/mobile/' + scope + '/files', method));
    assert.ok(mobileCommunicationFilesRouteAllowed('/api/mobile/' + scope + '/files/f1', 'DELETE'));
    assert.equal(mobileCommunicationFilesRouteAllowed('/api/mobile/' + scope + '/files/f1', 'POST'), false);
  }
  assert.ok(mobileCommunicationFilesRouteAllowed('/api/mobile/discussions/p1/files/f1', 'GET'));
  for (const p of [
    '/api/attachments',
    '/api/mobile/discussions/p1/files',
    '/api/mobile/discussions/courses/a/b/files',
    '/api/mobile/messages/conversations/%2e%2e/files',
  ])
    for (const method of ['GET', 'POST', 'DELETE'])
      assert.equal(mobileCommunicationFilesRouteAllowed(p, method), false);
  for (const bad of [true, [], {}, '1.5', ''])
    assert.equal(communicationFilesQuery.safeParse({ page: bad }).success, false);
});
test('text-only write shape remains unchanged while attachments are bounded unique identifiers, never authority fields', () => {
  const post = { courseId: 'course', title: 'title', body: 'body', key: 'request_123' };
  assert.deepEqual(mobilePostSchema.parse(post), post);
  assert.deepEqual(mobileReplySchema.parse({ body: 'reply', key: post.key }), {
    body: 'reply',
    key: post.key,
  });
  assert.deepEqual(mobileMessageInput.parse({ body: 'body', clientId: post.key }), {
    body: 'body',
    clientId: post.key,
  });
  for (const ids of [['same', 'same'], Array(11).fill('file'), ['a/b'], [1], 'file'])
    assert.equal(communicationAttachmentIds.safeParse(ids).success, false);
  for (const schema of [mobilePostSchema, mobileReplySchema, mobileMessageInput]) {
    const base =
      schema === mobilePostSchema
        ? post
        : schema === mobileReplySchema
          ? { body: 'body', key: post.key }
          : { body: 'body', clientId: post.key };
    assert.ok(schema.safeParse({ ...base, attachmentIds: ['file'] }).success);
    assert.equal(schema.safeParse({ ...base, ownerId: 'other' }).success, false);
  }
});
test('confirmed upload metadata strips private fields and selection never silently exceeds ten files', () => {
  const f = { id: 'one', name: '学习.txt', mime: 'text/plain', size: 12 };
  assert.deepEqual(confirmedCommunicationFile({ ...f, storageKey: 'private', ownerId: 'user' }), f);
  const files = Array.from({ length: 10 }, (_, i) => ({ ...f, id: 'file' + i }));
  assert.equal(addCommunicationFile(files, files[0]), files);
  assert.throws(() => addCommunicationFile(files, f));
  assert.deepEqual(communicationFileIds([f]), ['one']);
  for (const bad of [
    { ...f, size: 0 },
    { ...f, size: Infinity },
    { ...f, id: '../x' },
    { ...f, size: 50 * 1024 * 1024 + 1 },
  ])
    assert.throws(() => confirmedCommunicationFile(bad));
  assert.equal(
    communicationFilesPath({ kind: 'course', id: 'one' }),
    '/mobile/discussions/courses/one/files',
  );
  assert.throws(() => communicationFilesPath({ kind: 'conversation', id: '../' }));
});
test('an uncertain message replay freezes attachment order and identifiers as well as its body', async () => {
  const source = ['f1', 'f2'],
    attempt = prepareMessage('conversation', '正文', 'request_123', source);
  source[0] = 'different';
  assert.deepEqual(attempt.attachmentIds, ['f1', 'f2']);
  assert.ok(Object.isFrozen(attempt.attachmentIds));
  const sent: unknown[] = [];
  const c = {
    request: async (_p: string, b: unknown) => {
      sent.push(b);
      return {};
    },
  } as unknown as MobileClient;
  await messagesApi.send(c, attempt);
  await messagesApi.send(c, attempt);
  assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(sent[0], { body: '正文', clientId: 'request_123', attachmentIds: ['f1', 'f2'] });
});
test('explicit native upload cancellation reaches fetch and is never replayed as a new multipart upload', async () => {
  let requests = 0;
  const session: MobileSession = {
    accessToken: 'ma1_' + 'a'.repeat(43),
    refreshToken: 'mr1_' + 'b'.repeat(64),
    accessExpiresAt: new Date(Date.now() + 600000).toISOString(),
    sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    user: {
      id: 'u',
      organizationId: 'o',
      username: 'u',
      name: 'u',
      role: 'STUDENT',
      roles: ['STUDENT'],
      permissions: [],
      accountMode: 'ORGANIZATION',
    },
  };
  const c = new MobileClient(
    'https://study.example.com',
    { get: async () => null, set: async () => {}, remove: async () => {} },
    () => {},
    async (url, options) => {
      if (String(url).endsWith('/login')) return new Response(JSON.stringify(session), { status: 201 });
      requests++;
      return new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(new Error('aborted'));
        if (options!.signal!.aborted) fail();
        else options!.signal!.addEventListener('abort', fail, { once: true });
      });
    },
  );
  await c.login('u', 'test');
  const abort = new AbortController(),
    form = new FormData();
  form.append('file', new Blob(['hello']), 'hello.txt');
  const request = c.request('/mobile/messages/conversations/c/files', form, 'POST', {
    multipart: true,
    signal: abort.signal,
  });
  abort.abort();
  await assert.rejects(request, (e) => e instanceof MobileApiError && e.status === 0);
  assert.equal(requests, 1);
});
