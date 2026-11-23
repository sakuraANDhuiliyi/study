import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  MobilePushGateway,
  mobilePushConfig,
  sealPushToken,
  openPushToken,
  pushTokenHash,
  remotePushContent,
} from '../apps/api/src/mobile/mobile-push.gateway';
import { mobilePushBindInput, mobilePushRouteAllowed } from '../apps/api/src/mobile/mobile-push.schemas';
import { remoteInboxNotification } from '../apps/mobile/src/remote-push-model';
const project = '12345678-1234-4234-9234-123456789012',
  token = 'ExpoPushToken[test_only_token]';
function configure() {
  const names = [
      'MOBILE_PUSH_ENABLED',
      'MOBILE_PUSH_EXPO_PROJECT_ID',
      'MOBILE_PUSH_TOKEN_KEY',
      'MOBILE_PUSH_EXPO_ACCESS_TOKEN',
    ],
    prior = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  process.env.MOBILE_PUSH_ENABLED = 'true';
  process.env.MOBILE_PUSH_EXPO_PROJECT_ID = project;
  process.env.MOBILE_PUSH_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  delete process.env.MOBILE_PUSH_EXPO_ACCESS_TOKEN;
  return () => {
    for (const k of names) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  };
}
test('remote push is off by default and requires real project/key; schemas reject token URLs, scopes and unknown authority', () => {
  assert.equal(mobilePushConfig({}).available, false);
  assert.equal(
    mobilePushConfig({ MOBILE_PUSH_ENABLED: 'true', MOBILE_PUSH_EXPO_PROJECT_ID: project }).available,
    false,
  );
  assert.equal(
    mobilePushConfig({
      MOBILE_PUSH_ENABLED: 'true',
      MOBILE_PUSH_EXPO_PROJECT_ID: project,
      MOBILE_PUSH_TOKEN_KEY: Buffer.alloc(32, 3).toString('base64'),
    }).available,
    true,
  );
  assert.deepEqual(mobilePushBindInput.parse({ token, projectId: project }), { token, projectId: project });
  for (const input of [
    { token: 'https://attacker.invalid', projectId: project },
    { token, projectId: project, userId: 'other' },
    { token, projectId: project, url: 'https://attacker.invalid' },
    { token: [], projectId: project },
  ])
    assert.equal(mobilePushBindInput.safeParse(input).success, false);
  for (const [path, method] of [
    ['status', 'GET'],
    ['device', 'POST'],
    ['device', 'DELETE'],
  ])
    assert.ok(mobilePushRouteAllowed('/api/mobile/push/' + path, method));
  assert.equal(mobilePushRouteAllowed('/api/mobile/push/device/other', 'DELETE'), false);
});
test('device token at rest is authenticated ciphertext with fresh random nonces and no original plaintext', () => {
  const key = randomBytes(32),
    a = sealPushToken(token, key),
    b = sealPushToken(token, key);
  assert.notEqual(a, b);
  assert.ok(!a.includes(token));
  assert.equal(openPushToken(a, key), token);
  assert.equal(pushTokenHash(token).length, 64);
  const altered = Buffer.from(a, 'base64');
  altered[15] ^= 1;
  assert.throws(() => openPushToken(altered.toString('base64'), key));
  assert.throws(() => openPushToken(a, randomBytes(32)));
});
test('official gateway sends only generic inbox payload and checks receipt without accepting configurable destinations', async () => {
  const restore = configure(),
    prior = globalThis.fetch,
    seen: { url: string; body: any; redirect: any }[] = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(String(init!.body)), redirect: init!.redirect });
    return new Response(
      JSON.stringify(
        String(url).endsWith('send')
          ? { data: { status: 'ok', id: 'ticket_001' } }
          : { data: { ticket_001: { status: 'ok' } } },
      ),
      { status: 200 },
    );
  };
  try {
    const gateway = new MobilePushGateway();
    assert.deepEqual(await gateway.send(token, 'binding'), { kind: 'ticket', id: 'ticket_001' });
    assert.deepEqual(await gateway.receipt('ticket_001'), { kind: 'delivered' });
    assert.equal(seen[0].url, 'https://exp.host/--/api/v2/push/send');
    assert.deepEqual(seen[0].body, {
      to: token,
      ...remotePushContent,
      data: { kind: 'study-inbox', bindingId: 'binding' },
    });
    assert.equal(seen[0].redirect, 'error');
    assert.equal(seen[1].url, 'https://exp.host/--/api/v2/push/getReceipts');
    assert.deepEqual(seen[1].body, { ids: ['ticket_001'] });
  } finally {
    globalThis.fetch = prior;
    restore();
  }
});
test('ambiguous sends are terminal unknown while rate limits and read-only receipt failures can retry', async () => {
  const restore = configure(),
    prior = globalThis.fetch,
    g = new MobilePushGateway();
  try {
    globalThis.fetch = async () => {
      throw new Error('network');
    };
    assert.equal((await g.send(token, 'binding')).kind, 'unknown');
    assert.equal((await g.receipt('ticket')).kind, 'retry');
    globalThis.fetch = async () => new Response('', { status: 429 });
    assert.deepEqual(await g.send(token, 'binding'), { kind: 'retry', code: 'RATE_LIMITED' });
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }));
    assert.deepEqual(await g.send(token, 'binding'), {
      kind: 'failed',
      code: 'DEVICE_NOT_REGISTERED',
      disable: true,
    });
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { status: 'ok', id: '../bad' } }));
    assert.equal((await g.send(token, 'binding')).kind, 'unknown');
  } finally {
    globalThis.fetch = prior;
    restore();
  }
});
test('notification interaction accepts only the active opaque binding and never stored links or notification identities', () => {
  assert.ok(remoteInboxNotification({ kind: 'study-inbox', bindingId: 'current' }, 'current'));
  for (const data of [
    null,
    { kind: 'study-inbox', bindingId: 'old' },
    { kind: 'other', bindingId: 'current' },
    { url: 'https://attacker.invalid', userId: 'other' },
  ])
    assert.equal(remoteInboxNotification(data, 'current'), false);
  assert.equal(remoteInboxNotification({ kind: 'study-inbox', bindingId: 'current' }, null), false);
});
test('unconfigured preview builds do not advertise remote-push capability or fabricate a token project', () => {
  const keys = [
      'EXPO_PUBLIC_REMOTE_PUSH_ENABLED',
      'EXPO_ANDROID_GOOGLE_SERVICES_FILE',
      'EXPO_PUBLIC_EAS_PROJECT_ID',
    ],
    prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const key of keys) delete process.env[key];
    const config = createRequire(import.meta.url)('../apps/mobile/app.config.js')();
    assert.equal(config.extra.remotePushConfigured, false);
    assert.equal(config.android.googleServicesFile, undefined);
    process.env.EXPO_PUBLIC_REMOTE_PUSH_ENABLED = 'true';
    assert.throws(() => createRequire(import.meta.url)('../apps/mobile/app.config.js')());
  } finally {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
