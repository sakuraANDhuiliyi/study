import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileApiError, MobileClient, type MobileSession } from '../apps/mobile/src/client';
import { accountApi, accountPasswordError } from '../apps/mobile/src/account-model';
import {
  mobileAccountRouteAllowed,
  assertPublicNativeAccountRequest,
  mobileRecoveryInput,
  mobileRegistrationInput,
  mobileRoleInput,
} from '../apps/api/src/mobile/mobile-account.schemas';

const origin = 'https://study.example.com';
const session = (role = 'STUDENT', token = 'a'): MobileSession => ({
  accessToken: 'ma1_' + token.repeat(43),
  refreshToken: 'mr1_' + token.repeat(64),
  accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
  sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  user: {
    id: 'own',
    username: 'student',
    name: '学生',
    organizationId: 'own-space',
    accountMode: 'ORGANIZATION',
    role,
    roles: ['STUDENT', 'TEACHER'],
    permissions: [role],
  },
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function store() {
  let value: string | null = null;
  return {
    get: async () => value,
    set: async (v: string) => {
      value = v;
    },
    remove: async () => {
      value = null;
    },
    read: () => value,
  };
}

test('mobile registration and recovery strictly reject organization/role injection and mixed recovery tokens', () => {
  const input = { username: 'personal', name: '同学', password: 'Longpassword123', deviceName: 'Android' };
  assert.equal(mobileRegistrationInput.safeParse(input).success, true);
  for (const patch of [
    { organizationId: 'other' },
    { role: 'ADMIN' },
    { accountMode: 'ORGANIZATION' },
    { deviceName: '' },
  ])
    assert.equal(mobileRegistrationInput.safeParse({ ...input, ...patch }).success, false);
  assert.equal(
    mobileRecoveryInput.safeParse({
      username: 'personal',
      code: 'lmsr_' + 'c'.repeat(43),
      newPassword: 'longpassword123',
    }).success,
    true,
  );
  for (const code of [session().accessToken, session().refreshToken, 'lmsr_short'])
    assert.equal(
      mobileRecoveryInput.safeParse({ username: 'personal', code, newPassword: 'longpassword123' }).success,
      false,
    );
  assert.equal(mobileRoleInput.safeParse({ role: 'TEACHER', userId: 'other' }).success, false);
  assert.equal(accountPasswordError('a'.repeat(12), 'a'.repeat(12)), '');
  assert.ok(accountPasswordError('a'.repeat(11), 'a'.repeat(11)));
  assert.ok(accountPasswordError('a'.repeat(12), 'b'.repeat(12)));
});
test('native account allowlist accepts only exact methods and authenticated self-service routes', () => {
  for (const [path, method] of [
    ['recovery', 'GET'],
    ['recovery-code', 'POST'],
    ['sessions', 'GET'],
    ['sessions/own', 'DELETE'],
    ['role', 'POST'],
  ])
    assert.equal(mobileAccountRouteAllowed('/api/mobile/auth/' + path, method), true);
  for (const [path, method] of [
    ['register', 'POST'],
    ['recover', 'POST'],
    ['sessions/own/other', 'DELETE'],
    ['sessions', 'DELETE'],
    ['sessions/own', 'POST'],
    ['role', 'GET'],
    ['recovery-code', 'GET'],
    ['sessions/%2Fother', 'DELETE'],
  ])
    assert.equal(mobileAccountRouteAllowed('/api/mobile/auth/' + path, method), false);
});
test('public native account routes reject browser Origin, cookies and authorization', () => {
  for (const req of [
    { headers: { origin }, cookies: {} },
    { headers: {}, cookies: { lms_session: 'web' } },
    { headers: { authorization: 'Bearer native' }, cookies: {} },
  ]) {
    assert.throws(() => assertPublicNativeAccountRequest(req));
  }
  assert.doesNotThrow(() => assertPublicNativeAccountRequest({ headers: {}, cookies: {} }));
});
test('personal registration stores only validated native credentials and never passwords or recovery secrets', async () => {
  const st = store(),
    seen: RequestInit[] = [],
    users: unknown[] = [];
  const client = new MobileClient(
    origin,
    st,
    (user) => users.push(user),
    async (url, options) => {
      assert.equal(String(url), origin + '/api/mobile/auth/register');
      seen.push(options!);
      return json(session(), 201);
    },
  );
  await client.register({ username: ' personal ', name: ' 同学 ', password: 'password-secret-123' });
  assert.deepEqual(JSON.parse(String(seen[0].body)), {
    username: 'personal',
    name: '同学',
    password: 'password-secret-123',
    deviceName: '知学 Android',
  });
  assert.equal(seen[0].credentials, 'omit');
  assert.equal((seen[0].headers as any).authorization, undefined);
  assert.ok(!st.read()!.includes('password-secret-123'));
  assert.deepEqual(users.at(-1), session().user);
});
test('recovery is anonymous, does not send a bearer and clears prior credentials only on confirmed success', async () => {
  const st = store();
  let success = false;
  const client = new MobileClient(
    origin,
    st,
    () => {},
    async (url, options) => {
      if (String(url).endsWith('/login')) return json(session(), 201);
      assert.equal((options!.headers as any).authorization, undefined);
      return success
        ? json({ ok: true, loginRequired: true })
        : json({ error: { message: '恢复码或恢复许可无效' } }, 401);
    },
  );
  await client.login('student', 'password-secret');
  const input = { username: 'student', code: 'lmsr_' + 'c'.repeat(43), newPassword: 'new-password-123' };
  await assert.rejects(client.recover(input), MobileApiError);
  assert.ok(st.read());
  success = true;
  await client.recover(input);
  assert.equal(st.read(), null);
});
test('successful role switch rotates saved credentials and invalidates late old-role responses and resources', async () => {
  let resolve!: (response: Response) => void;
  const late = new Promise<Response>((done) => {
    resolve = done;
  });
  const st = store(),
    users: unknown[] = [];
  let clears = 0;
  const client = new MobileClient(
    origin,
    st,
    (user) => users.push(user),
    async (url) => {
      if (String(url).endsWith('/login')) return json(session(), 201);
      if (String(url).endsWith('/role')) return json(session('TEACHER', 'b'), 201);
      return late;
    },
  );
  await client.login('student', 'password');
  client.onSessionInvalidated(() => {
    clears++;
  });
  const pending = client.request('/courses');
  await client.switchRole('TEACHER');
  resolve(json({ privateOldRoleData: true }));
  await assert.rejects(pending, (error: any) => error.status === 409);
  assert.equal(clears, 1);
  assert.equal((users.at(-1) as any).role, 'TEACHER');
  assert.equal(JSON.parse(st.read()!).session.accessToken, session('TEACHER', 'b').accessToken);
});
test('failed role authorization preserves current session and does not report a changed identity', async () => {
  const st = store(),
    users: unknown[] = [];
  const client = new MobileClient(
    origin,
    st,
    (user) => users.push(user),
    async (url) =>
      String(url).endsWith('/login')
        ? json(session(), 201)
        : json({ error: { message: '未被授予该身份' } }, 403),
  );
  await client.login('student', 'password');
  const before = st.read();
  await assert.rejects(client.switchRole('ADMIN'), (error: any) => error.status === 403);
  assert.equal(st.read(), before);
  assert.equal((users.at(-1) as any).role, 'STUDENT');
});
test('self-service device revocation encodes IDs and never broadens to another route', async () => {
  const seen: unknown[][] = [];
  const client = {
    request: (...args: unknown[]) => {
      seen.push(args);
      return Promise.resolve({ ok: true });
    },
  } as any;
  await accountApi.revoke(client, 'one/../../other');
  assert.deepEqual(seen, [['/mobile/auth/sessions/one%2F..%2F..%2Fother', undefined, 'DELETE']]);
});
