import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LessonProgressWriter, lessonPosition, publicResource } from '../apps/mobile/src/lesson-model';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
test('lesson bearer scope grants exact read/file/progress paths only', () => {
  for (const [p, m] of [
    ['/api/mobile/lessons/a', 'GET'],
    ['/api/mobile/lessons/a/files/f', 'GET'],
    ['/api/mobile/lessons/a/progress', 'PUT'],
  ])
    assert.ok(mobileRouteAllowed(p, m));
  for (const [p, m] of [
    ['/api/mobile/lessons', 'GET'],
    ['/api/mobile/lessons/a', 'DELETE'],
    ['/api/mobile/lessons/a/files/f', 'POST'],
    ['/api/mobile/lessons/a/answers', 'GET'],
    ['/api/attachments/f/preview', 'GET'],
  ])
    assert.ok(!mobileRouteAllowed(p, m));
});
test('native course progress rounds finite positions and rejects credentialed/cleartext external resources', () => {
  assert.equal(lessonPosition(NaN), 0);
  assert.equal(lessonPosition(-1), 0);
  assert.equal(lessonPosition(999999), 86400);
  assert.equal(lessonPosition(4.8), 4);
  for (const x of [null, 'javascript:alert(1)', 'http://example.com', 'https://u:p@example.com', 'file:///a'])
    assert.equal(publicResource(x), null);
  assert.equal(publicResource('https://example.com/course.mp4'), 'https://example.com/course.mp4');
});
test('position writer serializes and coalesces writes with the returned server version', async () => {
  const calls: any[] = [];
  let resolve!: () => void;
  const blocked = new Promise<void>((r) => (resolve = r));
  const writer = new LessonProgressWriter(null, async (body) => {
    calls.push(body);
    if (calls.length === 1) await blocked;
    return { ...body, updatedAt: new Date(calls.length).toISOString() };
  });
  const first = writer.save(false, 2);
  const second = writer.save(false, 10);
  const third = writer.save(true, 20);
  resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(calls, [
    { completed: false, positionSeconds: 2, expectedUpdatedAt: null },
    { completed: true, positionSeconds: 20, expectedUpdatedAt: new Date(1).toISOString() },
  ]);
  assert.equal(writer.current?.positionSeconds, 20);
});
test('failed or conflicting progress freezes retries until a fresh server reload', async () => {
  let calls = 0;
  const writer = new LessonProgressWriter(null, async () => {
    calls++;
    throw new Error('conflict');
  });
  await assert.rejects(writer.save(false, 3), /conflict/);
  await assert.rejects(writer.save(true, 30), /conflict/);
  assert.equal(calls, 1);
  assert.equal(writer.current, null);
});

import { byteRange } from '../apps/api/src/communication/byte-range';
test('private video byte ranges clamp ends and suffixes and reject multipart, overflow and empty ranges', () => {
  assert.equal(byteRange(undefined, 20), null);
  assert.deepEqual(byteRange('bytes=4-', 20), { start: 4, end: 19 });
  assert.deepEqual(byteRange('bytes=2-99', 20), { start: 2, end: 19 });
  assert.deepEqual(byteRange('bytes=-4', 20), { start: 16, end: 19 });
  assert.deepEqual(byteRange('bytes=-99', 20), { start: 0, end: 19 });
  for (const value of [
    'bytes=20-',
    'bytes=10-2',
    'bytes=-0',
    'bytes=-',
    'bytes=1-2,4-5',
    'items=1-2',
    'bytes=9007199254740993-',
  ])
    assert.throws(() => byteRange(value, 20));
  assert.throws(() => byteRange('bytes=0-', 0));
});
