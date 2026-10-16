import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readLiveConfiguration } from '../apps/api/src/live/live.config';
import { liveChat, liveCreate, liveModeration, livePresence } from '../apps/api/src/live/live.schemas';
import { liveAttendance, liveHost } from '../apps/api/src/live/live.service';
import { liveMediaPath } from '../apps/api/src/live/live.proxy';
import { LiveMedia, publicationPermission } from '../apps/api/src/live/live.media';
import { LiveConnections } from '../apps/api/src/live/live.connections';

test('live configuration is disabled by default and rejects credential URLs, public HTTP and malformed secrets', () => {
  assert.throws(() => readLiveConfiguration({}));
  const env = {
    LIVEKIT_ENABLED: 'true',
    LIVEKIT_URL: 'http://livekit:7880',
    LIVEKIT_API_KEY: 'FixtureKey',
    LIVEKIT_API_SECRET: 'a'.repeat(48),
  };
  assert.equal(readLiveConfiguration(env).serverUrl, env.LIVEKIT_URL);
  for (const patch of [
    { LIVEKIT_ENABLED: 'TRUE' },
    { LIVEKIT_URL: 'http://example.com' },
    { LIVEKIT_URL: 'https://user:pass@example.com' },
    { LIVEKIT_URL: 'https://example.com/?secret=private' },
    { LIVEKIT_API_SECRET: 'x\n'.repeat(32) },
  ])
    assert.throws(() => readLiveConfiguration({ ...env, ...patch }));
});
test('live inputs require explicit revisions, safe limits and a per-connection lease', () => {
  const input = {
    courseId: 'course',
    title: '课堂实践',
    scheduledAt: new Date().toISOString(),
    maxParticipants: 32,
  };
  assert.equal(liveCreate.parse(input).maxParticipants, 32);
  for (const patch of [{ maxParticipants: 101 }, { title: '' }, { role: 'ADMIN' }])
    assert.equal(liveCreate.safeParse({ ...input, ...patch }).success, false);
  assert.equal(liveModeration.safeParse({ action: 'approve' }).success, false);
  assert.equal(livePresence.safeParse({}).success, false);
  assert.equal(
    liveChat.safeParse({ text: '\u0000', clientId: randomUUID(), connectionId: randomUUID() }).success,
    false,
  );
});
test('live attendance uses server intervals, excludes offline gaps and cannot go backwards', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  const member = { state: 'ACTIVE', attendanceSeconds: 8, heartbeatAt: new Date(now.getTime() - 10_500) };
  assert.equal(liveAttendance(member, now), 18);
  assert.equal(liveAttendance({ ...member, heartbeatAt: new Date(now.getTime() - 46_000) }, now), 8);
  assert.equal(liveAttendance({ ...member, state: 'LEFT' }, now), 8);
  assert.equal(liveAttendance({ ...member, heartbeatAt: new Date(now.getTime() + 1000) }, now), 8);
});
test('live admission exposes only signaling routes, not server administration', () => {
  for (const path of ['/rtc', '/rtc/v1', '/rtc/validate', '/rtc/v1/validate'])
    assert.ok(liveMediaPath('/api/live/media' + path + '?access_token=fixture'));
  for (const path of [
    '/twirp/livekit.RoomService/ListRooms',
    '/rtc/../twirp',
    '/rtc/validate/extra',
    '//rtc',
  ])
    assert.equal(liveMediaPath('/api/live/media' + path + '?access_token=fixture'), null);
  assert.equal(liveMediaPath('/api/live/media/rtc?access_token=a&access_token=b'), null);
  assert.equal(liveMediaPath('/api/live/media/rtc'), null);
});
test('viewer grants contain no publishing sources and student speakers cannot share screens', () => {
  assert.equal(publicationPermission(false, false).canPublish, false);
  assert.equal(publicationPermission(false, false).canPublishSources.length, 0);
  assert.equal(publicationPermission(true, false).canPublishSources.length, 2);
  assert.equal(publicationPermission(true, true).canPublishSources.length, 4);
  assert.equal(publicationPermission(true, true).canPublishData, false);
  assert.equal(liveHost({ role: 'STUDENT', permissions: ['course.manage'] } as any), false);
});
test('live JWTs are short-lived, scoped and signed with a per-admission lease', async () => {
  const keys = ['LIVEKIT_ENABLED', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    Object.assign(process.env, {
      LIVEKIT_ENABLED: 'true',
      LIVEKIT_API_KEY: 'FixtureKey',
      LIVEKIT_API_SECRET: 'z'.repeat(48),
    });
    const media = new LiveMedia();
    const lease = randomUUID();
    const claims = await media.verify(
      await media.token('fixture-room', 'member', '学习者', false, false, lease),
    );
    assert.equal(claims.video?.room, 'fixture-room');
    assert.equal(claims.video?.roomAdmin, false);
    assert.equal(claims.video?.canPublish, false);
    assert.equal(claims.exp! - claims.nbf!, 60);
    assert.equal(JSON.parse(claims.metadata!).connectionId, lease);
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  }
});
test('live connection cleanup targets one member/class and closes owned connections on shutdown', () => {
  const connections = new LiveConnections();
  const closed: number[] = [];
  connections.entries.set('a', {
    memberId: 'one',
    liveId: 'first',
    connectionId: 'latest',
    close: () => closed.push(1),
  });
  connections.entries.set('b', {
    memberId: 'two',
    liveId: 'second',
    connectionId: 'another',
    close: () => closed.push(2),
  });
  connections.closeMember('one', 'replaced');
  assert.deepEqual(closed, [], 'A delayed leave must not close the newer connection');
  connections.closeMember('one');
  assert.deepEqual(closed, [1]);
  connections.closeClass('second');
  assert.deepEqual(closed, [1, 2]);
  connections.onModuleDestroy();
  assert.equal(connections.entries.size, 0);
});
