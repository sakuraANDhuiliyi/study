import test from 'node:test';
import assert from 'node:assert/strict';
import {
  androidOwner,
  androidBridgePath,
  AndroidAgentService,
} from '../apps/api/src/programming/android-agent.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
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
