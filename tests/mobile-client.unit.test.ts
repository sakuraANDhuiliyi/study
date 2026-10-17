import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileClient, MobileApiError, serverOrigin, type MobileSession } from '../apps/mobile/src/client';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
import { mobileLoginInput, mobileRefreshInput } from '../apps/api/src/mobile/mobile.schemas';
const origin = 'https://study.example.com';
function session(letter = 'a', expires = Date.now() + 900000): MobileSession {
  return {
    accessToken: 'ma1_' + letter.repeat(43),
    refreshToken: 'mr1_' + letter.repeat(64),
    accessExpiresAt: new Date(expires).toISOString(),
    sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    user: {
      id: letter,
      username: letter,
      name: '测试用户',
      role: 'STUDENT',
      roles: ['STUDENT'],
      permissions: [],
      organizationId: 'org',
      accountMode: 'ORGANIZATION',
    },
  };
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function storage() {
  let value: string | null = null;
  return {
    get: async () => value,
    set: async (v: string) => {
      value = v;
    },
    remove: async () => {
      value = null;
    },
    value: () => value,
  };
}
const later = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
test('mobile origins require HTTPS and explicit local-preview opt-in', () => {
  assert.equal(serverOrigin(origin + '/api'), origin);
  for (const s of [
    'http://public.example.com',
    'https://user:secret@example.com',
    'https://example.com/?token=x',
    'https://example.com/other',
    'https://example.com/#x',
    'file:///tmp/x',
  ])
    assert.throws(() => serverOrigin(s));
  assert.throws(() => serverOrigin('http://10.0.2.2:3001'));
  assert.equal(serverOrigin('http://10.0.2.2:3001', true), 'http://10.0.2.2:3001');
  assert.throws(() => serverOrigin('http://evil.example.com', true));
});
test('native credentials reject privilege fields, mixed token types and empty device labels', () => {
  const base = { username: 'student', password: 'Test_password!', deviceName: 'Android' };
  assert.equal(mobileLoginInput.safeParse(base).success, true);
  for (const patch of [{ deviceName: ' ' }, { role: 'SUPER_ADMIN' }, { sessionId: 'forged' }])
    assert.equal(mobileLoginInput.safeParse({ ...base, ...patch }).success, false);
  assert.equal(mobileRefreshInput.safeParse({ refreshToken: session().refreshToken }).success, true);
  assert.equal(mobileRefreshInput.safeParse({ refreshToken: session().accessToken }).success, false);
});
test('native bearer scope excludes administration, private file handling and webpage account mutation', () => {
  assert.ok(mobileRouteAllowed('/api/courses', 'GET'));
  assert.ok(mobileRouteAllowed('/api/lessons/lesson/progress', 'PUT'));
  assert.ok(mobileRouteAllowed('/api/live/classes', 'GET'));
  for (const path of [
    '/api/admin/users',
    '/api/auth/password',
    '/api/attachments/id/download',
    '/api/courses/id/members',
    '/api/programming/projects',
  ])
    assert.equal(mobileRouteAllowed(path, 'GET'), false);
  assert.equal(mobileRouteAllowed('/api/courses', 'POST'), false);
});
test('client submits only native bearer credentials and rejects external request paths', async () => {
  const n = session();
  const seen: { url: string; options: RequestInit }[] = [];
  const st = storage();
  const c = new MobileClient(
    origin,
    st,
    () => {},
    async (url, options) => {
      seen.push({ url: String(url), options: options! });
      return response(
        String(url).endsWith('/login') ? n : { items: [] },
        String(url).endsWith('/login') ? 201 : 200,
      );
    },
  );
  await c.login('student', 'not-persisted-password');
  await c.request('/courses');
  assert.equal(seen[1].options.credentials, 'omit');
  assert.equal((seen[1].options.headers as any).authorization, 'Bearer ' + n.accessToken);
  assert.ok(!JSON.stringify(seen[1].options.headers).includes('cookie'));
  assert.ok(!st.value()!.includes('not-persisted-password'));
  for (const path of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com'])
    await assert.rejects(c.request(path));
  assert.equal(seen.length, 2);
});
test('parallel requests share one refresh and use only the rotated access credential', async () => {
  const old = session('a', Date.now() + 1000),
    next = session('b');
  let refreshes = 0;
  let privateReads = 0;
  const c = new MobileClient(
    origin,
    storage(),
    () => {},
    async (url, init) => {
      if (String(url).endsWith('/login')) return response(old, 201);
      if (String(url).endsWith('/refresh')) {
        refreshes++;
        await tick();
        return response(next, 201);
      }
      assert.equal((init!.headers as any).authorization, 'Bearer ' + next.accessToken);
      privateReads++;
      return response({ ok: true });
    },
  );
  await c.login('student', 'secret');
  await Promise.all(Array.from({ length: 6 }, () => c.request('/courses')));
  assert.equal(refreshes, 1);
  assert.equal(privateReads, 6);
});
test('a late old-token 401 reuses a completed rotation instead of replaying refresh', async () => {
  const old = session('a'),
    next = session('b'),
    late = later<Response>();
  let reads = 0,
    refreshes = 0;
  const c = new MobileClient(
    origin,
    storage(),
    () => {},
    async (url, init) => {
      if (String(url).endsWith('/login')) return response(old, 201);
      if (String(url).endsWith('/refresh')) {
        refreshes++;
        return response(next, 201);
      }
      if ((init!.headers as any).authorization === 'Bearer ' + old.accessToken) {
        reads++;
        return reads === 1 ? response({}, 401) : late.promise;
      }
      return response({ ok: true });
    },
  );
  await c.login('student', 'secret');
  const a = c.request('/courses'),
    b = c.request('/courses');
  await a;
  late.resolve(response({}, 401));
  await b;
  assert.equal(refreshes, 1);
});
test('responses from an old account cannot populate the new session', async () => {
  const gate = later<Response>();
  let user = 'a';
  const changes: (string | null)[] = [];
  const c = new MobileClient(
    origin,
    storage(),
    (u) => changes.push(u?.id || null),
    async (url) => (String(url).endsWith('/login') ? response(session(user), 201) : gate.promise),
  );
  await c.login('a', 'secret');
  const old = c.request('/courses');
  user = 'b';
  await c.login('b', 'secret');
  gate.resolve(response({ private: 'account a' }));
  await assert.rejects(old, (e) => e instanceof MobileApiError && e.status === 409);
  assert.equal(changes.at(-1), 'b');
});
test('logout waits for in-flight secure storage and leaves no recoverable credential', async () => {
  let value: string | null = null;
  const gate = later<void>(),
    entered = later<void>();
  const st = {
    get: async () => value,
    set: async (v: string) => {
      entered.resolve();
      await gate.promise;
      value = v;
    },
    remove: async () => {
      value = null;
    },
  };
  const changed: (string | null)[] = [];
  const c = new MobileClient(
    origin,
    st,
    (u) => changed.push(u?.id || null),
    async () => response(session(), 201),
  );
  const login = c.login('student', 'secret');
  await entered.promise;
  const clear = c.clear();
  gate.resolve();
  await Promise.all([login, clear]);
  assert.equal(value, null);
  assert.equal(changed.at(-1), null);
});
test('expired refresh clears the secure session and malformed stored credentials are removed', async () => {
  const st = storage();
  let current: string | null = null;
  const c = new MobileClient(
    origin,
    st,
    (u) => {
      current = u?.id || null;
    },
    async (url) =>
      response(
        String(url).endsWith('/login') ? session('a', Date.now() - 1) : {},
        String(url).endsWith('/login') ? 201 : 401,
      ),
  );
  await c.login('student', 'secret');
  await assert.rejects(c.request('/courses'));
  assert.equal(st.value(), null);
  assert.equal(current, null);
  await st.set('{bad');
  await c.restore();
  assert.equal(st.value(), null);
});

test('stale native audio startup cannot stop a replacement room audio session', async () => {
  const { AudioSessionLease } = await import('../apps/mobile/src/audio-lifecycle');
  const queue = new AudioSessionLease();
  const gate = later<void>();
  let stopped = 0,
    started = 0;
  const a = queue.acquire(
    async () => {
      started++;
      await gate.promise;
    },
    async () => {
      stopped++;
    },
  );
  await tick();
  const releaseA = a.release();
  const b = queue.acquire(
    async () => {
      started++;
    },
    async () => {
      stopped++;
    },
  );
  gate.resolve();
  assert.equal(await a.ready, false);
  await releaseA;
  assert.equal(await b.ready, true);
  assert.equal(stopped, 0);
  assert.equal(started, 2);
  await b.release();
  assert.equal(stopped, 1);
});
test('native audio releases resources after a failed startup and later rooms can acquire', async () => {
  const { AudioSessionLease } = await import('../apps/mobile/src/audio-lifecycle');
  const queue = new AudioSessionLease();
  let stopped = 0;
  const a = queue.acquire(
    async () => {
      throw new Error('device unavailable');
    },
    async () => {
      stopped++;
    },
  );
  await assert.rejects(a.ready);
  await a.release();
  assert.equal(stopped, 1);
  const b = queue.acquire(
    async () => {},
    async () => {
      stopped++;
    },
  );
  assert.equal(await b.ready, true);
  await b.release();
  assert.equal(stopped, 2);
});

test('native signaling cannot normalize a path into the website origin-protected gateway', async () => {
  const { liveMediaPath } = await import('../apps/api/src/live/live.proxy');
  for (const path of [
    '/api/live/native-media/../media/rtc',
    '/api/live/native-media/%2e%2e/media/rtc',
    '/api/live/media/rtc/../rtc',
  ])
    assert.equal(liveMediaPath(path + '?access_token=ticket'), null);
  assert.ok(liveMediaPath('/api/live/native-media/rtc?access_token=ticket'));
});

import { PermissionPromptLease } from '../apps/mobile/src/permission-lifecycle';
test('permission overlays suppress background cleanup only for their own live connection', () => {
  const gate = new PermissionPromptLease();
  const old = gate.begin('old-connection');
  assert.equal(gate.activeFor('old-connection'), true);
  assert.equal(gate.activeFor('new-connection'), false);
  assert.equal(gate.activeFor(), false);
  const next = gate.begin('new-connection');
  old();
  assert.equal(gate.activeFor('new-connection'), true);
  assert.equal(gate.activeFor('old-connection'), false);
  next();
  assert.equal(gate.activeFor('new-connection'), false);
});
test('overlapping OS permission results are reference counted, idempotent and notify deferred cleanup', () => {
  const gate = new PermissionPromptLease();
  let cleanup = 0;
  const unsubscribe = gate.subscribe(() => {
    if (!gate.activeFor('room')) cleanup++;
  });
  const first = gate.begin('room'),
    second = gate.begin('room');
  first();
  first();
  assert.equal(cleanup, 0);
  assert.equal(gate.activeFor('room'), true);
  second();
  assert.equal(cleanup, 1);
  unsubscribe();
  gate.begin('room')();
  assert.equal(cleanup, 1);
});
