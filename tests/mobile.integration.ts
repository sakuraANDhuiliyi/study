import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { request } from 'node:http';
import type { Duplex } from 'node:stream';
import { TokenVerifier } from 'livekit-server-sdk';
import { createLiveFixture, liveWait } from './live.fixture';

test(
  'Android client: real database sessions, rotation, isolation and native LiveKit signaling',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const call = async (
      path: string,
      method = 'GET',
      body?: unknown,
      token?: string,
      headers: Record<string, string> = {},
    ) => {
      const response = await fetch(f.origin + '/api' + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      return {
        status: response.status,
        cookie: response.headers.get('set-cookie'),
        body: await response.json().catch(() => null),
      };
    };
    const login = async (user = f.users.student) => {
      const r = await call('/mobile/auth/login', 'POST', {
        username: user.username,
        password: f.password,
        deviceName: '验收 Android',
      });
      assert.equal(r.status, 201, 'Native login must succeed');
      return r.body as {
        accessToken: string;
        refreshToken: string;
        user: any;
        accessExpiresAt: string;
        sessionExpiresAt: string;
      };
    };
    const valid = async (token: string, path = '/mobile/auth/me') =>
      (await call(path, 'GET', undefined, token)).status;
    async function signal(token: string, path = '/api/live/native-media/rtc') {
      return new Promise<{ socket: Duplex; closed: Promise<void> }>((resolve, reject) => {
        const url = new URL(path, f.origin);
        url.search = new URLSearchParams({
          access_token: token,
          sdk: 'js',
          version: '2.23.0',
          protocol: '15',
          auto_subscribe: '1',
        }).toString();
        const req = request(url, {
          headers: {
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-key': randomBytes(16).toString('base64'),
            'sec-websocket-version': '13',
          },
        });
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error('Native signal timeout'));
        });
        req.on('error', () => reject(new Error('Native signal transport failed')));
        req.on('response', (res) => {
          res.resume();
          reject(new Error('Native signal rejected: ' + res.statusCode));
        });
        req.on('upgrade', (_res, socket) => {
          req.setTimeout(0);
          socket.on('error', () => undefined);
          socket.resume();
          resolve({ socket, closed: new Promise<void>((done) => socket.once('close', done)) });
        });
        req.end();
      });
    }
    let classroom: any;
    try {
      await t.test(
        'separate credentials, no cookies, explicit native scope and unchanged website CSRF',
        async () => {
          const n = await login();
          assert.match(n.accessToken, /^ma1_[A-Za-z0-9_-]{43}$/);
          assert.match(n.refreshToken, /^mr1_[A-Za-z0-9_-]{64}$/);
          assert.ok(Date.parse(n.accessExpiresAt) <= Date.now() + 15 * 60000);
          assert.equal(await valid(n.accessToken), 200);
          const spec = (await call('/openapi.json')).body;
          for (const path of [
            '/api/mobile/auth/login',
            '/api/mobile/auth/refresh',
            '/api/mobile/auth/logout',
          ]) {
            assert.ok(spec.paths[path].post.requestBody);
            assert.equal(
              (spec.paths[path].post.parameters || []).some((p: any) => p.name === 'x-csrf-token'),
              false,
            );
          }
          assert.deepEqual(spec.paths['/api/mobile/auth/me'].get.security, [{ mobileAccess: [] }]);

          assert.equal(
            (
              await call('/mobile/auth/login', 'POST', {
                username: f.users.student.username,
                password: f.password,
                deviceName: 'phone',
              })
            ).cookie,
            null,
          );
          assert.equal((await call('/courses', 'GET', undefined, n.accessToken)).status, 200);
          assert.equal(await valid(n.accessToken, '/admin/users'), 403);
          assert.equal(
            (await call('/auth/me', 'GET', undefined, undefined, { cookie: 'lms_session=' + n.accessToken }))
              .status,
            401,
          );
          assert.equal(
            (
              await call('/mobile/auth/me', 'GET', undefined, n.accessToken, {
                cookie: f.clients.student.cookie,
              })
            ).status,
            403,
          );
          assert.equal(
            (await call('/mobile/auth/me', 'GET', undefined, n.accessToken, { origin: f.origin })).status,
            403,
          );
          assert.equal((await f.call(f.clients.student, '/auth/me')).status, 200);
          assert.equal(
            (await f.call(f.clients.student, '/mobile/auth/me', 'GET', undefined, 403)).status,
            403,
          );
          assert.equal(
            (
              await call('/mobile/auth/login', 'POST', {
                username: f.users.student.username,
                password: f.password,
                deviceName: 'phone',
                role: 'SUPER_ADMIN',
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        'refresh rotates both tokens and recognizes replay without revoking website sessions',
        async () => {
          const n = await login();
          const r = await call('/mobile/auth/refresh', 'POST', { refreshToken: n.refreshToken });
          assert.equal(r.status, 201);
          assert.notEqual(r.body.accessToken, n.accessToken);
          assert.notEqual(r.body.refreshToken, n.refreshToken);
          assert.equal(await valid(n.accessToken), 401);
          assert.equal(await valid(r.body.accessToken), 200);
          assert.equal(
            (await call('/mobile/auth/refresh', 'POST', { refreshToken: n.refreshToken })).status,
            401,
          );
          assert.equal(await valid(r.body.accessToken), 401);
          assert.equal((await f.call(f.clients.student, '/auth/me')).status, 200);
        },
      );
      await t.test(
        'parallel refresh consumes a credential once and revokes a replayed device session',
        async () => {
          const n = await login();
          const results = await Promise.all(
            [1, 2].map(() => call('/mobile/auth/refresh', 'POST', { refreshToken: n.refreshToken })),
          );
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 401]);
          assert.equal(await valid(results.find((r) => r.status === 201)!.body.accessToken), 401);
        },
      );
      await t.test(
        'refresh replay history has a per-device bound and never affects another device or website session',
        async () => {
          const capped = await login(),
            other = await login();
          const row = await f.db.mobileCredential.findUniqueOrThrow({
            where: { accessHash: createHash('sha256').update(capped.accessToken).digest('hex') },
          });
          await f.db.mobileRefreshUse.createMany({
            data: Array.from({ length: 512 }, (_, index) => ({
              hash: createHash('sha256')
                .update(row.sessionId + ':' + index)
                .digest('hex'),
              sessionId: row.sessionId,
              expiresAt: new Date(Date.now() + 3600000),
            })),
          });
          assert.equal(
            (await call('/mobile/auth/refresh', 'POST', { refreshToken: capped.refreshToken })).status,
            401,
          );
          assert.equal(await f.db.mobileRefreshUse.count({ where: { sessionId: row.sessionId } }), 0);
          assert.equal(await valid(capped.accessToken), 401);
          assert.equal(await valid(other.accessToken), 200);
          assert.equal((await f.call(f.clients.student, '/auth/me')).status, 200);
        },
      );
      await t.test(
        'expiry, account deactivation, course membership and database cascades remain authoritative',
        async () => {
          let n = await login(f.users.student2);
          const rows = await f.db.session.findMany({
            where: { userId: f.users.student2.id, clientType: 'MOBILE' },
            orderBy: { createdAt: 'desc' },
          });
          await f.db.mobileCredential.update({
            where: { sessionId: rows[0].id },
            data: { accessExpiresAt: new Date(Date.now() - 1000) },
          });
          assert.equal(await valid(n.accessToken), 401);
          const r = await call('/mobile/auth/refresh', 'POST', { refreshToken: n.refreshToken });
          assert.equal(r.status, 201);
          n = r.body;
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student2.id } },
            data: { active: false },
          });
          assert.equal(await valid(n.accessToken, '/courses/' + f.course.id), 403);
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student2.id } },
            data: { active: true },
          });
          await f.db.user.update({ where: { id: f.users.student2.id }, data: { active: false } });
          assert.equal(await valid(n.accessToken), 401);
          await f.db.user.update({ where: { id: f.users.student2.id }, data: { active: true } });
          await f.db.session.delete({ where: { id: rows[0].id } });
          assert.equal(await f.db.mobileCredential.count({ where: { sessionId: rows[0].id } }), 0);
          assert.equal(await f.db.mobileRefreshUse.count({ where: { sessionId: rows[0].id } }), 0);
        },
      );
      await t.test(
        'native live tickets are bound to a mobile session and cannot bypass website admission',
        async () => {
          classroom = (
            await f.call(f.clients.teacher, '/live/classes', 'POST', {
              courseId: f.course.id,
              title: 'Android 原生验收',
              scheduledAt: new Date().toISOString(),
              maxParticipants: 10,
            })
          ).body;
          await f.call(f.clients.teacher, `/live/classes/${classroom.id}/start`, 'POST', {
            revision: classroom.revision,
          });
          const n = await login();
          const j = await call(`/live/classes/${classroom.id}/join`, 'POST', {}, n.accessToken);
          assert.equal(j.status, 201);
          assert.equal(j.body.path, '/api/live/native-media');
          const claims = await new TokenVerifier(f.env.LIVEKIT_API_KEY, f.env.LIVEKIT_API_SECRET).verify(
            j.body.token,
            0,
          );
          assert.ok(JSON.parse(claims.metadata!).mobileSessionId);
          assert.equal(claims.video?.canPublish, false);
          const probe = async (path: string, token: string, cookie?: string) => {
            const r = await fetch(
              f.origin + path + '/rtc/validate?access_token=' + encodeURIComponent(token),
              { headers: cookie ? { cookie } : undefined, signal: AbortSignal.timeout(10000) },
            );
            await r.body?.cancel();
            return r.status;
          };
          assert.equal(await probe('/api/live/native-media', j.body.token), 200);
          assert.equal(await probe('/api/live/media', j.body.token, f.clients.student.cookie), 403);
          assert.equal(await probe('/api/live/native-media', j.body.token, f.clients.student.cookie), 403);
          const s = await signal(j.body.token);
          try {
            const refresh = await call('/mobile/auth/refresh', 'POST', { refreshToken: n.refreshToken });
            assert.equal(refresh.status, 201);
            assert.equal(
              (
                await call(
                  `/live/classes/${classroom.id}/heartbeat`,
                  'POST',
                  { connectionId: j.body.connectionId },
                  refresh.body.accessToken,
                )
              ).status,
              201,
            );
            assert.equal(
              (await call('/mobile/auth/logout', 'POST', {}, refresh.body.accessToken)).status,
              201,
            );
            assert.equal(await valid(refresh.body.accessToken), 401);
            const closed = await Promise.race([s.closed.then(() => true), liveWait(8000).then(() => false)]);
            assert.ok(closed, 'Logout must revoke native signaling');
            assert.equal(await probe('/api/live/native-media', j.body.token), 403);
          } finally {
            s.socket.destroy();
          }
          const w = (await f.call(f.clients.student, `/live/classes/${classroom.id}/join`, 'POST')).body;
          assert.equal(await probe('/api/live/native-media', w.token), 403);
        },
      );
      await t.test(
        'native approval, kick and institution feature changes retain server enforcement',
        async () => {
          const n = await login(f.users.student2);
          const j = await call(`/live/classes/${classroom.id}/join`, 'POST', {}, n.accessToken);
          assert.equal(j.status, 201);
          let row = (await f.call(f.clients.teacher, `/live/classes/${classroom.id}`)).body;
          let member = row.members.find((m: any) => m.id === j.body.identity);
          await f.call(f.clients.teacher, `/live/classes/${classroom.id}/members/${member.id}`, 'POST', {
            action: 'approve',
            revision: member.revision,
          });
          const next = await call(`/live/classes/${classroom.id}/join`, 'POST', {}, n.accessToken);
          assert.equal(next.status, 201);
          assert.equal(next.body.approved, true);
          const s = await signal(next.body.token);
          try {
            row = (await f.call(f.clients.teacher, `/live/classes/${classroom.id}`)).body;
            member = row.members.find((m: any) => m.id === j.body.identity);
            await f.call(f.clients.teacher, `/live/classes/${classroom.id}/members/${member.id}`, 'POST', {
              action: 'remove',
              revision: member.revision,
            });
            assert.ok(await Promise.race([s.closed.then(() => true), liveWait(8000).then(() => false)]));
            assert.equal(
              (await call(`/live/classes/${classroom.id}/join`, 'POST', {}, n.accessToken)).status,
              403,
            );
          } finally {
            s.socket.destroy();
          }
          await f.db.systemSetting.upsert({
            where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
            create: { organizationId: f.organization.id, key: 'features', value: { live: false } },
            update: { value: { live: false } },
          });
          assert.equal(await valid(n.accessToken, '/live/classes'), 403);
          await f.db.systemSetting.delete({
            where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
          });
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
