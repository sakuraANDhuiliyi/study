import test from 'node:test';
import assert from 'node:assert/strict';
import {
  androidOwner,
  androidBridgePath,
  AndroidAgentService,
} from '../apps/api/src/programming/android-agent.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
const actor: Actor = {
  id: 'student',
  organizationId: 'school-a',
  role: 'STUDENT',
  permissions: ['learning.use'],
  sessionId: 's',
  csrfToken: 'c',
  name: '测试',
};
test('Android workspace identity separates user and organization and never exposes raw IDs', () => {
  assert.match(androidOwner(actor), /^lms_[0-9a-f]{48}$/);
  assert.notEqual(androidOwner(actor), androidOwner({ ...actor, organizationId: 'school-b' }));
  assert.notEqual(androidOwner(actor), androidOwner({ ...actor, id: 'peer' }));
  assert.equal(androidOwner(actor), androidOwner({ ...actor, role: 'TEACHER' }));
});
test('Android bridge rejects authority endpoints, traversal, remote URLs and host command configuration', () => {
  for (const p of [
    'api/admin/accounts',
    'api/auth/login',
    'api/projects/x/terminals',
    'api/projects/x/mcp',
    'api/projects/x/settings',
    'api/projects/x/../health',
    'api/projects/x/%2e%2e',
    'https://host/api/projects',
    'api/projects//x',
  ])
    assert.throws(() => androidBridgePath(p));
  for (const p of [
    'api/projects',
    'api/projects/x/ask',
    'api/jobs/x/apk',
    'api/conversations/x/events',
    'api/projects/x/files',
  ])
    assert.equal(androidBridgePath(p), '/' + p);
});
test('Android private access rejects changed sessions, spaces, roles and CSRF before data access', async () => {
  for (const changed of [
    null,
    { ...actor, id: 'peer' },
    { ...actor, organizationId: 'b' },
    { ...actor, role: 'TEACHER' },
    { ...actor, csrfToken: 'new' },
  ]) {
    const service = new AndroidAgentService({ resolveSessionId: async () => changed } as never);
    await assert.rejects(() => service.access(actor));
  }
});
test('Android private access requires current learning permission and feature availability', async () => {
  for (const source of ['permission', 'feature']) {
    const service = new AndroidAgentService({
      resolveSessionId: async () => actor,
      require: () => {
        if (source === 'permission') throw Error('revoked');
      },
      checkFeature: async () => {
        if (source === 'feature') throw Error('disabled');
      },
    } as never);
    await assert.rejects(() => service.access(actor));
  }
});

function statusService() {
  return new AndroidAgentService({
    resolveSessionId: async () => actor,
    require: () => {},
    checkFeature: async () => {},
  } as never);
}
test('Android status needs a signed healthy response from the current owner, not just a spawned process', async (t) => {
  const service = statusService();
  assert.equal((await service.status(actor)).available, false);
  Object.assign(service, { available: true });
  for (const body of [
    '{',
    'null',
    JSON.stringify({ status: 'ok', user_id: 'other' }),
    JSON.stringify({ status: 'down', user_id: androidOwner(actor) }),
  ]) {
    t.mock.method(service, 'request', async () => ({ status: 200, body: Buffer.from(body) }));
    const result = await service.status(actor);
    assert.equal(result.available, false);
    assert.equal('ai' in result, false);
    t.mock.restoreAll();
  }
});
test('Android health exposes only explicit AI readiness and never forwards provider, address or credentials', async (t) => {
  const service = statusService();
  Object.assign(service, { available: true });
  for (const configured of [false, true, 'true', null]) {
    t.mock.method(service, 'request', async (...args: unknown[]) => {
      assert.deepEqual(args.slice(1), ['api/health', 'GET', '', undefined, 2000]);
      return {
        status: 200,
        body: Buffer.from(
          JSON.stringify({
            status: 'ok',
            user_id: androidOwner(actor),
            api_key_configured: configured,
            api_key: 'never-export',
            lan_ip: 'private',
            provider: 'private',
          }),
        ),
      };
    });
    const result = await service.status(actor);
    assert.equal(result.available, true);
    assert.equal(result.ai?.available, configured === true);
    assert.equal(JSON.stringify(result).includes('never-export'), false);
    assert.equal('lan_ip' in result, false);
    assert.equal('provider' in result, false);
    t.mock.restoreAll();
  }
});
test('Android health failure can be retried without publishing ready or swallowing authorization failure', async (t) => {
  const service = statusService();
  Object.assign(service, { available: true });
  t.mock.method(service, 'request', async () => {
    throw new ServiceUnavailableException();
  });
  assert.equal((await service.status(actor)).available, false);
  t.mock.restoreAll();
  t.mock.method(service, 'request', async () => {
    throw new UnauthorizedException();
  });
  await assert.rejects(() => service.status(actor), UnauthorizedException);
});
test('Android status revalidates permissions and process lifetime after the health result', async (t) => {
  const service = statusService();
  Object.assign(service, { available: true });
  const ready = () => ({
    status: 200,
    body: Buffer.from(JSON.stringify({ status: 'ok', user_id: androidOwner(actor) })),
  });
  t.mock.method(service, 'request', async () => {
    Object.assign(service, { available: false });
    return ready();
  });
  assert.equal((await service.status(actor)).available, false);
  t.mock.restoreAll();
  Object.assign(service, { available: true });
  t.mock.method(service, 'request', async () => {
    t.mock.method(service, 'access', async () => {
      throw new UnauthorizedException();
    });
    return ready();
  });
  await assert.rejects(() => service.status(actor), UnauthorizedException);
});
test('Android status uses the actual signed loopback transport and treats non-200 health as unavailable', async (t) => {
  const service = statusService();
  Object.assign(service, { available: true });
  let responseStatus = 503;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.equal(url, 'http://127.0.0.1:8011/api/health');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-lms-owner'), androidOwner(actor));
    assert.match(headers.get('x-lms-signature')!, /^[0-9a-f]{64}$/);
    return new Response(
      JSON.stringify({ status: 'ok', user_id: androidOwner(actor), api_key_configured: false }),
      { status: responseStatus },
    );
  });
  assert.equal((await service.status(actor)).available, false);
  responseStatus = 200;
  const result = await service.status(actor);
  assert.equal(result.available, true);
  assert.equal(result.ai?.available, false);
});
