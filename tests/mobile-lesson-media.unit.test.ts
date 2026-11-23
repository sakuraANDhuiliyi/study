import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileClient, type MobileSession } from '../apps/mobile/src/client';
import { publicLessonVideo } from '../apps/mobile/src/lesson-model';
import { mobileLessonMediaRouteAllowed } from '../apps/api/src/mobile/mobile-lesson-media.policy';
const origin = 'https://learn.example.test';
const session = (token = 'a', expires = Date.now() + 900000): MobileSession => ({
  accessToken: 'ma1_' + token.repeat(43),
  refreshToken: 'mr1_' + token.repeat(64),
  accessExpiresAt: new Date(expires).toISOString(),
  sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  user: {
    id: 'student',
    username: 'student',
    name: '学生',
    role: 'STUDENT',
    roles: ['STUDENT'],
    permissions: ['learning.use'],
    organizationId: 'org',
    accountMode: 'ORGANIZATION',
  },
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
test('lesson streaming policy permits exact authenticated GET/HEAD routes and public video never carries platform headers', () => {
  for (const method of ['GET', 'HEAD'])
    assert.ok(mobileLessonMediaRouteAllowed('/api/mobile/lessons/l/media/f', method));
  for (const [path, method] of [
    ['/api/mobile/lessons/l/media/f', 'POST'],
    ['/api/mobile/lessons/l/files/f', 'HEAD'],
    ['/api/mobile/lessons/l/media/../f', 'GET'],
    ['/api/attachments/f/preview', 'GET'],
  ])
    assert.equal(mobileLessonMediaRouteAllowed(path, method), false);
  assert.deepEqual(publicLessonVideo('https://cdn.example.test/video.mp4?public=1'), {
    uri: 'https://cdn.example.test/video.mp4?public=1',
    useCaching: false,
  });
  for (const value of [
    'http://cdn.example.test/video.mp4',
    'https://user:pass@cdn.example.test/a',
    'javascript:alert(1)',
    null,
  ])
    assert.equal(publicLessonVideo(value), null);
});
test('controlled native video rotates nearing-expiry credentials and signals the player without leaking refresh tokens', async () => {
  let raw: string | null = null,
    refresh = 0,
    notifications = 0;
  const paths: string[] = [];
  const client = new MobileClient(
    origin,
    {
      get: async () => raw,
      set: async (v) => {
        raw = v;
      },
      remove: async () => {
        raw = null;
      },
    },
    () => {},
    async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path.endsWith('/login')) return json(session('a', Date.now() + 60000));
      if (path.endsWith('/refresh')) {
        refresh++;
        return json(session('b'));
      }
      return json({ type: 'VIDEO', attachmentId: 'f', files: [{ id: 'f', mime: 'video/mp4' }] });
    },
  );
  await client.login('student', 'password');
  const unsubscribe = client.onAccessTokenChanged(() => {
    notifications++;
  });
  const source = await client.lessonVideoSource('l', 'f');
  assert.equal(refresh, 1);
  assert.equal(notifications, 1);
  assert.equal(source.uri, origin + '/api/mobile/lessons/l/media/f');
  assert.equal(source.headers.Authorization, 'Bearer ' + session('b').accessToken);
  assert.equal(source.useCaching, false);
  assert.ok(!JSON.stringify(source).includes('mr1_'));
  assert.deepEqual(paths, ['/api/mobile/auth/login', '/api/mobile/lessons/l', '/api/mobile/auth/refresh']);
  unsubscribe();
  const before = paths.length;
  await assert.rejects(client.lessonVideoSource('../l', 'f'));
  assert.equal(paths.length, before);
  await client.clear();
  await assert.rejects(client.lessonVideoSource('l', 'f'));
});
test('wrong lesson attachment and a late account switch never yield playable bearer sources', async () => {
  let raw: string | null = null,
    allowed = false,
    release!: (v: Response) => void,
    hold = false;
  const client = new MobileClient(
    origin,
    {
      get: async () => raw,
      set: async (v) => {
        raw = v;
      },
      remove: async () => {
        raw = null;
      },
    },
    () => {},
    async (input) => {
      if (String(input).endsWith('/login')) return json(session());
      if (hold)
        return new Promise((resolve) => {
          release = resolve;
        });
      return json({
        type: 'VIDEO',
        attachmentId: allowed ? 'f' : 'other',
        files: [{ id: 'f', mime: 'video/mp4' }],
      });
    },
  );
  await client.login('student', 'password');
  await assert.rejects(client.lessonVideoSource('l', 'f'));
  allowed = true;
  hold = true;
  const pending = client.lessonVideoSource('l', 'f');
  await new Promise((resolve) => setImmediate(resolve));
  await client.clear();
  release(json({ type: 'VIDEO', attachmentId: 'f', files: [{ id: 'f', mime: 'video/mp4' }] }));
  await assert.rejects(pending);
});
