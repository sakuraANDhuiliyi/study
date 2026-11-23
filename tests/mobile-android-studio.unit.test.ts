import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import { mobileAndroidStudioRouteAllowed } from '../apps/api/src/mobile/mobile-android-studio.policy';
import { mobileProgrammingPreviewRouteAllowed } from '../apps/api/src/mobile/mobile-programming-preview.policy';
import * as schema from '../apps/api/src/mobile/mobile-android-studio.schemas';
import { AndroidAgentService } from '../apps/api/src/programming/android-agent.service';
import { MobileAndroidStudioService } from '../apps/api/src/mobile/mobile-android-studio.service';
import { nativePreviewUrl, androidTaskActive } from '../apps/mobile/src/android-studio-model';
const actor: Actor = {
  id: 'student',
  organizationId: 'school-a',
  name: '测试',
  role: 'STUDENT',
  permissions: ['learning.use'],
  clientType: 'MOBILE',
  sessionId: 'mobile-session',
  csrfToken: 'token',
};
test('native Android exposes named project routes only, with strict path and revision input', () => {
  const root = '/api/mobile/android-studio';
  for (const [p, m] of [
    ['/status', 'GET'],
    ['/projects/p/files', 'GET'],
    ['/projects/p/file', 'PUT'],
    ['/projects/p/build', 'POST'],
    ['/projects/p/build/cancel', 'POST'],
    ['/projects/p/apk', 'GET'],
    ['/jobs/j/approvals/a', 'POST'],
  ])
    assert.ok(mobileAndroidStudioRouteAllowed(root + p, m));
  for (const [p, m] of [
    ['/bridge/api/projects', 'GET'],
    ['/projects/p/settings', 'PATCH'],
    ['/projects/p/terminals', 'POST'],
    ['/projects/p', 'DELETE'],
    ['/projects/p/file', 'POST'],
    ['/projects/p/../../health', 'GET'],
  ])
    assert.equal(mobileAndroidStudioRouteAllowed(root + p, m), false);
  for (const path of [
    '/etc/passwd',
    '../secret',
    'app/src/../../secret',
    'app\\src\\a.kt',
    'app/src/.env',
    'app/src/key.properties',
    'app/src/%2e%2e',
  ])
    assert.equal(schema.nativeAndroidPath.safeParse(path).success, false);
  assert.ok(
    schema.nativeAndroidWrite.safeParse({
      path: 'app/src/main/MainActivity.kt',
      content: '中文',
      revision: 'a'.repeat(64),
    }).success,
  );
  assert.equal(
    schema.nativeAndroidWrite.safeParse({
      path: 'build.gradle.kts',
      content: 'arbitrary',
      revision: 'a'.repeat(64),
    }).success,
    false,
  );
  assert.equal(
    schema.nativeAndroidWrite.safeParse({ path: 'app/src/main/a.kt', content: 'x' }).success,
    false,
  );
  assert.equal(
    schema.nativeAndroidGenerate.safeParse({ prompt: '创建页面', provider: 'http://attacker' }).success,
    false,
  );
  assert.equal(schema.nativeAndroidCreate.safeParse({ name: '名字', user_id: 'someone' }).success, false);
});
test('mobile Android resolves current credential rather than accepting a surviving web Session', async () => {
  let webCalls = 0,
    mobileCalls = 0,
    current: Actor | null = actor;
  const agent = new AndroidAgentService({
    resolveSessionId: async () => {
      webCalls++;
      return actor;
    },
    resolveMobileSessionId: async () => {
      mobileCalls++;
      return current;
    },
    require: () => {},
    checkFeature: async () => {},
  } as never);
  await agent.access(actor);
  assert.equal(mobileCalls, 1);
  assert.equal(webCalls, 0);
  current = null;
  await assert.rejects(agent.access(actor));
  current = { ...actor, organizationId: 'other' };
  await assert.rejects(agent.access(actor));
  assert.equal(webCalls, 0);
});
test('native Android files use controlled query encoding and preserve compare-and-swap, truncation disables writes', async () => {
  const calls: { path: string; method: string; input: unknown; query: string }[] = [];
  let truncated = false;
  const agent = {
    access: async () => {},
    request: async (_a: Actor, path: string, method: string, query: string, input: unknown) => {
      calls.push({ path, method, query, input });
      return {
        status: 200,
        body: Buffer.from(
          JSON.stringify({ content: '原始源码', revision: 'b'.repeat(64), writable: true, truncated }),
        ),
        type: 'application/json',
      };
    },
  };
  const service = new MobileAndroidStudioService(agent as never),
    path = 'app/src/main/Example.kt';
  const first = await service.file(actor, 'p', path);
  assert.equal(first.writable, true);
  assert.equal(calls[0].query, '?path=app%2Fsrc%2Fmain%2FExample.kt');
  await service.save(actor, 'p', { path, content: '修改', revision: 'b'.repeat(64) });
  assert.deepEqual(calls[1].input, { path, content: '修改', expected_revision: 'b'.repeat(64) });
  assert.equal(calls[1].path, 'api/projects/p/files/content');
  assert.equal(calls[1].method, 'PUT');
  truncated = true;
  assert.equal((await service.file(actor, 'p', path)).writable, false);
  assert.equal((await service.file(actor, 'p', 'app/build.gradle.kts')).writable, false);
});
test('manual builds expose actual pending/completed state, deduplicate per owner and isolate spaces', async () => {
  let complete!: (v: unknown) => void,
    calls = 0;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const service = new MobileAndroidStudioService({
    access: async () => {},
    request: async (_a: Actor, path: string) => {
      if (path.endsWith('/build')) {
        calls++;
        const result = await pending;
        return { status: 200, body: Buffer.from(JSON.stringify(result)) };
      }
      return { status: 200, body: Buffer.from(JSON.stringify({ id: 'p', name: '作品' })) };
    },
  } as never);
  assert.equal((await service.build(actor, 'p')).build.status, 'running');
  assert.equal((await service.build(actor, 'p')).build.status, 'running');
  assert.equal(calls, 1);
  assert.equal((await service.buildStatus({ ...actor, organizationId: 'b' }, 'p')).build, null);
  complete({ ok: true, message: 'BUILD SUCCESSFUL' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await service.buildStatus(actor, 'p')).build?.status, 'succeeded');
  assert.equal((await service.buildStatus(actor, 'p')).build?.message, 'BUILD SUCCESSFUL');
});
test('native APK download keeps fixed safe filename and real bytes while failed APK is never a fake download', async () => {
  let status = 200;
  const data = Buffer.from([0x50, 0x4b, 3, 4]);
  const service = new MobileAndroidStudioService({
    access: async () => {},
    request: async () => ({ status, body: data }),
  } as never);
  const out = await service.download(actor, 'p', false);
  assert.deepEqual(out.body, data);
  assert.equal(out.filename, 'android-app.apk');
  assert.equal(out.type, 'application/vnd.android.package-archive');
  status = 404;
  await assert.rejects(service.download(actor, 'p', false));
});
test('preview accepts only an unexpired token on its independent configured origin, never bearer paths or redirects', () => {
  const source = 'https://learn.example.test',
    origin = 'https://preview.example.test',
    url = origin + '/preview/' + 'a'.repeat(64) + '/index.html',
    good = { url, origin, expiresAt: new Date(Date.now() + 60000).toISOString() };
  assert.equal(nativePreviewUrl(source, good), url);
  for (const altered of [
    { url: url + '?authorization=token' },
    { url: url + '#session' },
    { url: 'javascript:alert(1)' },
    { url: source + '/preview/' + 'a'.repeat(64) + '/index.html', origin: source },
    { url: url.replace('preview.example.test', 'evil.test') },
    { expiresAt: 'invalid' },
    { expiresAt: new Date(0).toISOString() },
    { origin: 'https://user:password@preview.example.test' },
  ])
    assert.throws(() => nativePreviewUrl(source, { ...good, ...altered }));
  assert.ok(mobileProgrammingPreviewRouteAllowed('/api/mobile/programming-preview/projects/p', 'POST'));
  assert.equal(
    mobileProgrammingPreviewRouteAllowed('/api/mobile/programming-preview/bridge/p', 'POST'),
    false,
  );
  assert.equal(
    mobileProgrammingPreviewRouteAllowed('/api/mobile/programming/projects/p/preview', 'POST'),
    false,
  );
  assert.ok(androidTaskActive('awaiting_approval'));
  assert.equal(androidTaskActive('succeeded'), false);
});
