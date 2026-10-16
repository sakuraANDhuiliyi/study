import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { RoomServiceClient } from 'livekit-server-sdk';
import { hashPasswordAsync } from '../apps/api/src/auth/password';
import { permissionDefinitions, roleDefinitions } from '../apps/api/src/auth/permissions';

export type LiveTestClient = { cookie: string; csrf: string; user: any };
export const liveWait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function freePort(udp = false) {
  if (udp) {
    const socket = createSocket('udp4');
    await new Promise<void>((done) => socket.bind(0, '127.0.0.1', done));
    const port = socket.address().port;
    socket.close();
    return port;
  }
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

export async function createLiveFixture() {
  assert.notEqual(process.env.NODE_ENV, 'production', 'Live fixtures cannot use production');
  const configured =
    process.env.LIVE_TEST_ADMIN_DATABASE_URL ||
    process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL ||
    (process.env.DOTENV_CONFIG_PATH && process.env.DATABASE_URL);
  assert.ok(configured, 'Explicit loopback review/test database required');
  const adminUrl = new URL(configured);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(adminUrl.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname) &&
      /review|test/i.test(adminUrl.pathname),
    'Only a local review/test database may provision a fixture',
  );
  const suffix = randomBytes(8).toString('hex');
  const name = `live_review_${suffix}`;
  const url = new URL(adminUrl);
  url.pathname = '/' + name;
  url.searchParams.set('connection_limit', '8');
  const owner = new PrismaClient({ datasourceUrl: adminUrl.href });
  const db = new PrismaClient({ datasourceUrl: url.href });
  const directory = mkdtempSync(join(tmpdir(), 'study-live-review-'));
  const port = await freePort(),
    mediaPort = await freePort(),
    rtcTcp = await freePort(),
    rtcUdp = await freePort(true);
  const origin = `http://127.0.0.1:${port}`;
  const password = 'Fixture-' + randomBytes(20).toString('hex') + '!';
  const apiKey = 'Review' + randomBytes(8).toString('hex');
  const secret = randomBytes(40).toString('hex');
  const configPath = join(directory, 'providers.yaml');
  const mediaConfig = join(directory, 'livekit.yaml');
  writeFileSync(configPath, 'judge0: {enabled: false}\nai: {enabled: false}\nwebSearch: {enabled: false}\n', {
    mode: 0o600,
  });
  writeFileSync(
    mediaConfig,
    `port: ${mediaPort}\nbind_addresses: [127.0.0.1]\nrtc:\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  enable_loopback_candidate: true\n  tcp_port: ${rtcTcp}\n  udp_port: ${rtcUdp}\n  stun_servers: [127.0.0.1:${rtcUdp}]\nkeys:\n  ${apiKey}: ${secret}\nroom:\n  auto_create: false\n  enable_remote_unmute: false\nlogging:\n  level: error\n`,
    { mode: 0o600 },
  );
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url.href,
    APP_ORIGIN: origin,
    PORT: String(port),
    BIND_HOST: '127.0.0.1',
    COOKIE_SECURE: 'false',
    DISABLE_JOBS: 'true',
    AI_CONFIG_PATH: configPath,
    ALGORITHM_JUDGE_ENABLED: 'false',
    ALGORITHM_JUDGE_URL: '',
    ALGORITHM_JUDGE_TOKEN: '',
    PROGRAMMING_PREVIEW_ENABLED: 'false',
    ANDROID_AGENT_ENABLED: 'false',
    UPLOAD_DIR: join(directory, 'uploads'),
    LIVEKIT_ENABLED: 'true',
    LIVEKIT_URL: `http://127.0.0.1:${mediaPort}`,
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: secret,
  };
  const processes: ChildProcess[] = [];
  let created = false;
  let logs = '';
  const safe = (value: string) =>
    [password, secret, configured, url.href, decodeURIComponent(adminUrl.password)]
      .filter(Boolean)
      .reduce((v, s) => v.split(s).join('[redacted]'), value)
      .replace(/(?:access_token=|lms_session=)[^\s&;]+/gi, '[credential redacted]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt redacted]');
  const start = (command: string, args: string[]) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    processes.push(child);
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (chunk) => {
        logs = (logs + String(chunk)).slice(-80_000);
      });
    return child;
  };
  async function stop(child?: ChildProcess) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, liveWait(2000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([exited, liveWait(1000)]);
    }
  }
  async function cleanup() {
    for (const child of [...processes].reverse()) await stop(child);
    await db.$disconnect();
    if (created) {
      await owner.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=${name} AND pid <> pg_backend_pid()`;
      await owner.$executeRawUnsafe(`DROP DATABASE "${name}"`);
    }
    await owner.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
  async function call(
    client: LiveTestClient | null,
    path: string,
    method = 'GET',
    body?: unknown,
    expected: number | number[] = method === 'POST' ? 201 : 200,
    csrf = true,
    requestOrigin = origin,
  ) {
    let response: Response;
    try {
      response = await fetch(`${origin}/api${path}`, {
        method,
        signal: AbortSignal.timeout(20000),
        headers: {
          origin: requestOrigin,
          'content-type': 'application/json',
          ...(client ? { cookie: client.cookie, ...(csrf ? { 'x-csrf-token': client.csrf } : {}) } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(`Fixture HTTP transport failed: ${method} ${path.split('?')[0]}`);
    }
    const text = await response.text();
    assert.ok(
      (Array.isArray(expected) ? expected : [expected]).includes(response.status),
      `${method} ${path}: HTTP ${response.status}; ${safe(text).slice(0, 700)}`,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      cookie: response.headers
        .getSetCookie()
        .map((s) => s.split(';')[0])
        .join('; '),
    };
  }
  async function login(username: string) {
    const result = await call(null, '/auth/login', 'POST', { username, password });
    return { cookie: result.cookie, csrf: result.body.csrfToken, user: result.body.user } as LiveTestClient;
  }
  try {
    await owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const migration = start(process.execPath, [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      'prisma',
    ]);
    const timeout = setTimeout(() => migration.kill('SIGKILL'), 60000);
    const [code] = await once(migration, 'exit');
    clearTimeout(timeout);
    assert.equal(code, 0, 'Fixture migrations failed: ' + safe(logs));
    await db.permission.createMany({
      data: permissionDefinitions.map(([id, name, sensitive]) => ({ id, name, sensitive })),
    });
    for (const [id, role] of Object.entries(roleDefinitions))
      await db.role.create({
        data: {
          id,
          name: role.name,
          description: role.description,
          permissions: { create: role.permissions.map((permissionId) => ({ permissionId })) },
        },
      });
    const organization = await db.organization.create({ data: { name: '直播验收机构' } });
    const foreign = await db.organization.create({ data: { name: '其他机构' } });
    const hash = await hashPasswordAsync(password);
    const makeUser = (tag: string, roleId: string, org = organization.id) =>
      db.user.create({
        data: {
          username: `live_${suffix}_${tag}`,
          name: tag,
          organizationId: org,
          passwordHash: hash,
          roles: { create: { roleId } },
        },
      });
    const [teacher, otherTeacher, student, student2, student3, outsider, admin] = await Promise.all([
      makeUser('教师甲', 'TEACHER'),
      makeUser('教师乙', 'TEACHER'),
      makeUser('学生甲', 'STUDENT'),
      makeUser('学生乙', 'STUDENT'),
      makeUser('学生丙', 'STUDENT'),
      makeUser('外部学生', 'STUDENT', foreign.id),
      makeUser('管理员', 'ADMIN'),
    ]);
    // Usernames must match the platform's ASCII-only login schema.
    for (const [i, u] of [teacher, otherTeacher, student, student2, student3, outsider, admin].entries()) {
      u.username = `live_${suffix}_${i}`;
      await db.user.update({ where: { id: u.id }, data: { username: u.username } });
    }
    const course = await db.course.create({
      data: {
        organizationId: organization.id,
        teacherId: teacher.id,
        title: '直播互动验收课程',
        status: 'PUBLISHED',
      },
    });
    await db.teachingAssignment.create({ data: { courseId: course.id, userId: teacher.id } });
    await db.enrollment.createMany({
      data: [student, student2, student3].map((u) => ({ courseId: course.id, userId: u.id })),
    });
    const binary = resolve(process.env.LIVEKIT_TEST_BINARY || '.data/tools/livekit-server');
    assert.ok(existsSync(binary), 'Install pinned test media runtime: node scripts/setup-livekit.mjs');
    let media = start(binary, ['--config', mediaConfig]);
    const mediaClient = new RoomServiceClient(env.LIVEKIT_URL, apiKey, secret, {
      requestTimeout: 2,
      failover: false,
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (media.exitCode !== null) throw new Error('Media fixture exited: ' + safe(logs));
      try {
        await mediaClient.listRooms();
        ready = true;
        break;
      } catch {
        await liveWait(100);
      }
    }
    assert.ok(ready, 'Media fixture did not become ready: ' + safe(logs));
    const api = start(process.execPath, ['apps/api/dist/main.js']);
    ready = false;
    for (let i = 0; i < 150; i++) {
      if (api.exitCode !== null) throw new Error('API fixture exited: ' + safe(logs));
      try {
        if ((await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) {
          ready = true;
          break;
        }
      } catch {
        /* Await this fixture only. */
      }
      await liveWait(100);
    }
    assert.ok(ready, 'API fixture did not become ready: ' + safe(logs));
    const users = { teacher, otherTeacher, student, student2, student3, outsider, admin };
    const clients = Object.fromEntries(
      await Promise.all(Object.entries(users).map(async ([tag, u]) => [tag, await login(u.username)])),
    ) as Record<keyof typeof users, LiveTestClient>;
    return {
      db,
      origin,
      env,
      users,
      clients,
      course,
      organization,
      foreign,
      call,
      login,
      cleanup,
      mediaClient,
      stopMedia: () => stop(media),
      restartMedia: async () => {
        const next = start(binary, ['--config', mediaConfig]);
        media = next;
        for (let i = 0; i < 100; i++) {
          try {
            await mediaClient.listRooms();
            return next;
          } catch {
            await liveWait(100);
          }
        }
        throw new Error('Media fixture restart failed');
      },
      safe,
      logs: () => safe(logs),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
