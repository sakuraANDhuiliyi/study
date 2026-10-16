import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, rm, symlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { initializeLivekit, livekitConfiguration, checkLivekitFiles } from '../scripts/livekit-selfhost.mjs';

test('live deployment preparation works on a Docker-only host without npm dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'live-host-'));
  try {
    const script = join(directory, 'livekit-selfhost.mjs');
    await writeFile(script, await readFile('scripts/livekit-selfhost.mjs'));
    const code = `import { initializeLivekit, checkLivekitFiles } from ${JSON.stringify(pathToFileURL(script).href)};
      await initializeLivekit(${JSON.stringify(join(directory, 'private'))}, '123.207.184.119');
      await checkLivekitFiles(${JSON.stringify(join(directory, 'private'))});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, 'Standalone host configuration preparation failed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('live deployment generates matching private credentials and never overwrites existing secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'live-deploy-'));
  try {
    await initializeLivekit(directory, '123.207.184.119');
    await checkLivekitFiles(directory);
    const text = await readFile(join(directory, 'livekit.yaml'), 'utf8');
    const env = await readFile(join(directory, '.env'), 'utf8');
    const c = parse(text);
    assert.equal(c.rtc.node_ip, '123.207.184.119');
    assert.equal(c.rtc.use_external_ip, false);
    assert.equal(c.room.auto_create, false);
    assert.equal(c.room.enable_remote_unmute, false);
    assert.equal((await lstat(join(directory, '.env'))).mode & 0o777, 0o600);
    await assert.rejects(() => initializeLivekit(directory, '123.207.184.119'));
    assert.ok((await readFile(join(directory, '.env'), 'utf8')) === env, 'Existing credentials changed');
    assert.ok((await readFile(join(directory, 'livekit.yaml'), 'utf8')) === text, 'Existing config changed');
    await chmod(join(directory, '.env'), 0o644);
    await assert.rejects(() => checkLivekitFiles(directory));
    await chmod(join(directory, '.env'), 0o600);
    await rm(join(directory, '.env'));
    await writeFile(join(directory, 'other.env'), env, { mode: 0o600 });
    await symlink(join(directory, 'other.env'), join(directory, '.env'));
    await assert.rejects(() => checkLivekitFiles(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('live deployment refuses malformed IPs and line injection before writing credentials', async () => {
  for (const ip of ['0.0.0.0', '127.0.0.1', '224.0.0.1', '123.2.3.4\nkeys: {}', 'example.com'])
    assert.throws(() => livekitConfiguration(ip, 'ReviewKey', 'a'.repeat(48)));
  assert.throws(() => livekitConfiguration('123.207.184.119', 'bad\nkey', 'a'.repeat(48)));
});
test('live production composition keeps 7880 private, drops capabilities and uses the website auth gateway', async () => {
  const composition = parse(await readFile('deploy/livekit/compose.yaml', 'utf8'));
  const service = composition.services.livekit;
  assert.equal(service.image, 'livekit/livekit-server:v1.13.10');
  assert.ok(!service.ports.some((p: string) => p.includes('7880')));
  assert.deepEqual(service.cap_drop, ['ALL']);
  assert.equal(service.read_only, true);
  assert.equal(service.user, '1000:1000');
  assert.equal(service.volumes[0].bind.create_host_path, false);
  assert.equal(composition.services.app.environment.LIVEKIT_URL, 'http://livekit:7880');
  const nginx = await readFile('deploy/livekit/nginx.location.conf', 'utf8');
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3001;/);
  assert.match(nginx, /access_log off;/);
  assert.ok(!/proxy_pass[^;]*7880/.test(nginx));
  for (const path of ['.gitignore', '.dockerignore'])
    assert.match(await readFile(path, 'utf8'), /deploy\/livekit\/livekit\.yaml/);
});
