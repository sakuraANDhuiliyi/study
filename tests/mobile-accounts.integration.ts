import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createLiveFixture } from './live.fixture';

test(
  'native accounts: personal registration, recovery, device isolation and role rotation',
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
    const login = async (username: string, password = f.password) => {
      const r = await call('/mobile/auth/login', 'POST', { username, password, deviceName: '独立设备验收' });
      assert.equal(r.status, 201, 'Native login must succeed');
      return r.body as { accessToken: string; refreshToken: string; user: { id: string; role: string } };
    };
    const username = 'native_' + randomBytes(10).toString('hex');
    const input = { username, password: f.password, name: '个人注册验收', deviceName: '注册设备' };
    let personal: Awaited<ReturnType<typeof login>>;
    let recoveryCode = '';
    try {
      await t.test(
        'anonymous native registration rejects mixed browser credentials and privilege fields',
        async () => {
          for (const headers of [
            { origin: f.origin },
            { cookie: f.clients.student.cookie },
            { authorization: 'Bearer ma1_invalid' },
          ] as Record<string, string>[])
            assert.equal(
              (await call('/mobile/auth/register', 'POST', input, undefined, headers)).status,
              403,
            );
          for (const extra of [
            { organizationId: f.organization.id },
            { role: 'ADMIN' },
            { accountMode: 'ORGANIZATION' },
          ])
            assert.equal((await call('/mobile/auth/register', 'POST', { ...input, ...extra })).status, 400);
          assert.equal(await f.db.user.count({ where: { username } }), 0);
          const result = await call('/mobile/auth/register', 'POST', input);
          assert.equal(result.status, 201);
          assert.equal(result.cookie, null);
          assert.equal(result.body.user.accountMode, 'PERSONAL');
          assert.equal(result.body.user.role, 'STUDENT');
          assert.deepEqual(result.body.user.roles, ['STUDENT']);
          personal = result.body;
          assert.match(personal.accessToken, /^ma1_[A-Za-z0-9_-]{43}$/);
          const user = await f.db.user.findUniqueOrThrow({
            where: { id: personal.user.id },
          });
          const organization = await f.db.organization.findUniqueOrThrow({
            where: { id: user.organizationId },
          });
          assert.equal(organization.kind, 'PERSONAL');
          assert.equal(user.organizationId, user.personalOrganizationId);
          assert.equal(await f.db.session.count({ where: { userId: user.id, clientType: 'WEB' } }), 0);
          assert.equal(await f.db.mobileCredential.count({ where: { session: { userId: user.id } } }), 1);
          assert.equal((await call('/mobile/auth/me', 'GET', undefined, personal.accessToken)).status, 200);
        },
      );
      await t.test(
        'device listing never discloses credentials and only the owner can revoke devices',
        async () => {
          const second = await login(username),
            other = await login(f.users.student2.username);
          const list = await call('/mobile/auth/sessions', 'GET', undefined, personal.accessToken);
          assert.equal(list.status, 200);
          assert.equal(list.body.total, 2);
          assert.equal(list.body.items.filter((s: { current: boolean }) => s.current).length, 1);
          for (const s of list.body.items)
            assert.deepEqual(
              Object.keys(s).sort(),
              ['clientType', 'createdAt', 'current', 'deviceName', 'expiresAt', 'id', 'role'].sort(),
            );
          const target = list.body.items.find((s: { current: boolean }) => !s.current);
          assert.equal(
            (await call('/mobile/auth/sessions/' + target.id, 'DELETE', undefined, other.accessToken)).status,
            404,
          );
          assert.equal((await call('/mobile/auth/me', 'GET', undefined, second.accessToken)).status, 200);
          assert.equal(
            (await call('/mobile/auth/sessions/' + target.id, 'DELETE', undefined, personal.accessToken))
              .status,
            200,
          );
          assert.equal((await call('/mobile/auth/me', 'GET', undefined, second.accessToken)).status, 401);
          assert.equal(
            (await call('/mobile/auth/refresh', 'POST', { refreshToken: second.refreshToken })).status,
            401,
          );
        },
      );
      await t.test('role switches require actual grants and rotate the same mobile session', async () => {
        assert.equal(
          (await call('/mobile/auth/role', 'POST', { role: 'ADMIN' }, personal.accessToken)).status,
          403,
        );
        await f.db.userRole.create({ data: { userId: f.users.teacher.id, roleId: 'STUDENT' } });
        const teacher = await login(f.users.teacher.username);
        const before = await f.db.session.count({ where: { userId: teacher.user.id } });
        const switched = await call('/mobile/auth/role', 'POST', { role: 'STUDENT' }, teacher.accessToken);
        assert.equal(switched.status, 201);
        assert.equal(switched.body.user.role, 'STUDENT');
        assert.equal(await f.db.session.count({ where: { userId: teacher.user.id } }), before);
        assert.equal((await call('/mobile/auth/me', 'GET', undefined, teacher.accessToken)).status, 401);
        assert.equal(
          (await call('/mobile/auth/me', 'GET', undefined, switched.body.accessToken)).status,
          200,
        );
        assert.equal(
          (await call('/mobile/auth/role', 'POST', { role: 'ADMIN' }, switched.body.accessToken)).status,
          403,
        );
        // Replay of a credential retired by role rotation follows the existing device revocation policy.
        assert.equal(
          (await call('/mobile/auth/refresh', 'POST', { refreshToken: teacher.refreshToken })).status,
          401,
        );
        assert.equal(
          (await call('/mobile/auth/me', 'GET', undefined, switched.body.accessToken)).status,
          401,
        );
      });
      await t.test(
        'recovery code is issued after password verification and stored only as a hash',
        async () => {
          assert.deepEqual(
            (await call('/mobile/auth/recovery', 'GET', undefined, personal.accessToken)).body,
            { configured: false, requiresOrganizationApproval: false },
          );
          assert.equal(
            (
              await call(
                '/mobile/auth/recovery-code',
                'POST',
                { oldPassword: 'incorrect' },
                personal.accessToken,
              )
            ).status,
            403,
          );
          const result = await call(
            '/mobile/auth/recovery-code',
            'POST',
            { oldPassword: f.password },
            personal.accessToken,
          );
          assert.equal(result.status, 201);
          recoveryCode = result.body.code;
          assert.match(recoveryCode, /^lmsr_[A-Za-z0-9_-]{43}$/);
          const stored = await f.db.passwordRecovery.findUniqueOrThrow({
            where: { userId: personal.user.id },
          });
          assert.notEqual(stored.codeHash, recoveryCode);
          assert.match(stored.codeHash, /^[a-f0-9]{64}$/);
          const audit = await f.db.auditLog.findMany({ where: { userId: personal.user.id } });
          assert.equal(JSON.stringify(audit).includes(recoveryCode), false);
        },
      );
      await t.test(
        'personal recovery consumes the code once, revokes web and mobile sessions, and requires login',
        async () => {
          const web = await f.login(username),
            extra = await login(username);
          const nextPassword = 'Restored-' + randomBytes(20).toString('hex');
          const payload = { username, code: recoveryCode, newPassword: nextPassword };
          assert.equal(
            (await call('/mobile/auth/recover', 'POST', payload, personal.accessToken)).status,
            403,
          );
          const result = await call('/mobile/auth/recover', 'POST', payload);
          assert.equal(result.status, 201);
          assert.deepEqual(result.body, { ok: true, loginRequired: true });
          assert.equal(result.cookie, null);
          assert.equal(await f.db.session.count({ where: { userId: personal.user.id } }), 0);
          assert.equal(await f.db.passwordRecovery.count({ where: { userId: personal.user.id } }), 0);
          for (const native of [personal, extra])
            assert.equal((await call('/mobile/auth/me', 'GET', undefined, native.accessToken)).status, 401);
          await f.call(web, '/auth/me', 'GET', undefined, 401);
          assert.equal((await call('/mobile/auth/recover', 'POST', payload)).status, 401);
          assert.equal(
            (
              await call('/mobile/auth/login', 'POST', {
                username,
                password: f.password,
                deviceName: 'old-password',
              })
            ).status,
            401,
          );
          const recovered = await login(username, nextPassword);
          assert.equal((await call('/mobile/auth/me', 'GET', undefined, recovered.accessToken)).status, 200);
        },
      );
      await t.test(
        'organization recovery cannot bypass administrator permission and website CSRF stays intact',
        async () => {
          const student = await login(f.users.student.username);
          const status = await call('/mobile/auth/recovery', 'GET', undefined, student.accessToken);
          assert.equal(status.body.requiresOrganizationApproval, true);
          const issued = await call(
            '/mobile/auth/recovery-code',
            'POST',
            { oldPassword: f.password },
            student.accessToken,
          );
          assert.equal(issued.status, 201);
          assert.equal(
            (
              await call('/mobile/auth/recover', 'POST', {
                username: f.users.student.username,
                code: issued.body.code,
                newPassword: 'New-' + randomBytes(20).toString('hex'),
              })
            ).status,
            401,
          );
          assert.equal((await call('/mobile/auth/me', 'GET', undefined, student.accessToken)).status, 200);
          await f.call(
            f.clients.student,
            '/auth/recovery-code',
            'POST',
            { oldPassword: f.password },
            403,
            false,
          );
          assert.equal(
            (
              await call('/mobile/auth/sessions', 'GET', undefined, undefined, {
                cookie: f.clients.student.cookie,
                origin: f.origin,
              })
            ).status,
            403,
          );
          const own = (
            await call('/mobile/auth/sessions', 'GET', undefined, student.accessToken)
          ).body.items.find((s: { current: boolean }) => s.current);
          const revoked = await call(
            '/mobile/auth/sessions/' + own.id,
            'DELETE',
            undefined,
            student.accessToken,
          );
          assert.deepEqual(revoked.body, { ok: true, loginRequired: true });
          assert.equal((await call('/mobile/auth/me', 'GET', undefined, student.accessToken)).status, 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
