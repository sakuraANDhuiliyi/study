import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, getCsrf } from '../apps/web/src/api';

test('web API: delayed responses cannot expire or overwrite a newer login', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;
  const events: string[] = [];
  (globalThis as any).window = {
    dispatchEvent(event: Event) {
      events.push(event.type);
    },
  };
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  async function login(id: string, csrf: string) {
    globalThis.fetch = async () =>
      response({ user: { id, organizationId: `org-${id}`, role: 'STUDENT' }, csrfToken: csrf });
    await api('/auth/login', { method: 'POST' });
  }
  function hold(body: unknown, status: number) {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async () => {
      await wait;
      return response(body, status);
    };
    return release;
  }
  try {
    await t.test('a previous account 401 does not clear the successful new account', async () => {
      await login('first', 'first-csrf');
      const release = hold({ message: '登录已失效' }, 401);
      const old = api('/programming/projects/first/backup').catch((error) => error);
      await login('second', 'second-csrf');
      release();
      assert.equal((await old).status, 401);
      assert.deepEqual(events, []);
      assert.equal(getCsrf(), 'second-csrf');
    });
    await t.test('logging into the same account with a new session also fences the old 401', async () => {
      await login('same', 'old-session-csrf');
      const release = hold({ message: '登录已失效' }, 401);
      const old = api('/algorithms/training-plans').catch((error) => error);
      await login('same', 'new-session-csrf');
      release();
      assert.equal((await old).status, 401);
      assert.deepEqual(events, []);
    });
    await t.test('an old auth profile cannot restore the old identity or CSRF token', async () => {
      await login('profile-first', 'profile-first-csrf');
      const release = hold(
        {
          user: { id: 'profile-first', organizationId: 'org-profile-first', role: 'STUDENT' },
          csrfToken: 'profile-first-csrf',
        },
        200,
      );
      const old = api('/auth/me').catch((error) => error);
      await login('profile-second', 'profile-second-csrf');
      release();
      const result = await old;
      assert.ok(result instanceof ApiError);
      assert.equal(result.status, 409);
      assert.equal(getCsrf(), 'profile-second-csrf');
      assert.deepEqual(events, []);
    });
    await t.test('an old auth lookup 401 cannot mark the fresh auth query unauthenticated', async () => {
      await login('lookup-first', 'lookup-first-csrf');
      const release = hold({ message: '旧会话已失效' }, 401);
      const old = api('/auth/me').catch((error) => error);
      await login('lookup-second', 'lookup-second-csrf');
      release();
      assert.equal((await old).status, 409);
      assert.equal(getCsrf(), 'lookup-second-csrf');
      assert.deepEqual(events, []);
    });
    await t.test('a current session 401 still prompts authentication', async () => {
      await login('current', 'current-csrf');
      globalThis.fetch = async () => response({ message: '当前登录已失效' }, 401);
      await assert.rejects(
        api('/algorithms/training-plans'),
        (error: unknown) => error instanceof ApiError && error.status === 401,
      );
      assert.deepEqual(events, ['auth-expired']);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;
  }
});
