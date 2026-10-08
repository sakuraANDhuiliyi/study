import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { hashPasswordAsync, verifyPasswordAsync } from '../apps/api/src/auth/password';
import { releaseAuthAttempt, reserveAuthAttempt } from '../apps/api/src/auth/attempt-limit';
import type { PrismaService } from '../apps/api/src/common/prisma.service';

const base = process.env.TEST_BASE_URL;
const databaseUrl = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (
  !base ||
  process.env.NODE_ENV === 'production' ||
  !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  !/(review|test|clean)/i.test(databaseUrl.pathname)
)
  throw new Error('Auth fixes tests require a disposable local test database and TEST_BASE_URL');

const db = new PrismaClient();
const secondReplica = new PrismaClient();
after(async () => {
  await db.$disconnect();
  await secondReplica.$disconnect();
});
const suffix = randomUUID().slice(0, 8);
const password = 'Auth-fixes-original-123!';
type Client = { cookie: string; csrf: string; id: string };

async function request(client: Client | null, path: string, method = 'GET', body?: unknown, expected = 200) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(client ? { cookie: client.cookie, 'x-csrf-token': client.csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return { response, data };
}

async function login(username: string, pass = password): Promise<Client> {
  const { response, data } = await request(null, '/auth/login', 'POST', { username, password: pass }, 201);
  return {
    cookie: response.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; '),
    csrf: data.csrfToken,
    id: data.user.id,
  };
}

async function user(organizationId: string, name: string, role: string) {
  return db.user.create({
    data: {
      organizationId,
      name,
      username: `fix_${suffix}_${name}`,
      passwordHash: await hashPasswordAsync(password),
      roles: { create: { roleId: role } },
    },
  });
}

test('数据库共享限流对两实例80次并发原子预占，并在HTTP层阻止60次并发登录', async () => {
  await db.authAttemptWindow.deleteMany();
  const successful = await reserveAuthAttempt(
    db as PrismaService,
    'success-ip',
    'success-account',
    'test-success',
  );
  await reserveAuthAttempt(secondReplica as PrismaService, 'success-ip', 'success-account', 'test-success');
  await releaseAuthAttempt(db as PrismaService, successful);
  const preserved = await db.authAttemptWindow.findMany({ where: { key: { startsWith: 'test-success:' } } });
  assert(
    preserved.every((entry) => entry.count === 1),
    '成功仅返还自己的额度，保留并发失败',
  );
  const stale = await reserveAuthAttempt(
    db as PrismaService,
    'success-ip',
    'success-account',
    'test-success',
  );
  await db.authAttemptWindow.updateMany({
    where: { key: { startsWith: 'test-success:' } },
    data: {
      count: 4,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  await releaseAuthAttempt(db as PrismaService, stale);
  assert(
    (await db.authAttemptWindow.findMany({ where: { key: { startsWith: 'test-success:' } } })).every(
      (entry) => entry.count === 4,
    ),
    '旧窗口成功请求不能返还新窗口额度',
  );
  await db.authAttemptWindow.deleteMany();
  const reservations = await Promise.allSettled(
    Array.from({ length: 80 }, (_, index) =>
      reserveAuthAttempt(
        (index % 2 ? db : secondReplica) as PrismaService,
        `shared-${suffix}`,
        `shared-${suffix}`,
        'test-replica',
      ),
    ),
  );
  assert.equal(reservations.filter((entry) => entry.status === 'fulfilled').length, 8);
  for (const entry of reservations)
    if (entry.status === 'rejected') assert.equal(entry.reason.getStatus(), 429);
  const windows = await db.authAttemptWindow.findMany({ where: { key: { startsWith: 'test-replica:' } } });
  assert.equal(windows.length, 2);
  assert.equal(windows.find((entry) => entry.key.includes(':ip:'))?.count, 51);
  assert.equal(windows.find((entry) => entry.key.includes(':account:'))?.count, 9);
  assert(!JSON.stringify(windows).includes(`shared-${suffix}`));

  await db.authAttemptWindow.deleteMany();
  const responses = await Promise.all(
    Array.from({ length: 60 }, () =>
      fetch(base + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: `absent_${suffix}`, password }),
      }),
    ),
  );
  assert.equal(responses.filter((entry) => entry.status === 401).length, 8);
  assert.equal(responses.filter((entry) => entry.status === 429).length, 52);
  assert.equal(responses.filter((entry) => entry.status >= 500).length, 0);
  await db.authAttemptWindow.deleteMany();
});

test('管理员仅批准恢复，由本人一次性恢复码设置密码，角色转换不能绕过', async () => {
  const organization = await db.organization.create({ data: { name: `账号修复验证 ${suffix}` } });
  const administrator = await user(organization.id, 'admin', 'ADMIN');
  const teacher = await user(organization.id, 'teacher', 'TEACHER');
  const student = await user(organization.id, 'student', 'STUDENT');
  const admin = await login(administrator.username);
  const client = await login(teacher.username);
  const secondSession = await login(teacher.username);
  assert.equal((await request(client, '/auth/recovery')).data.configured, false);
  await request(
    admin,
    `/admin/users/${teacher.id}`,
    'PATCH',
    { password: 'Admin-chosen-password-123!' },
    403,
  );
  await request(
    admin,
    `/admin/users/${teacher.id}`,
    'PATCH',
    {
      roles: ['STUDENT'],
      password: 'Admin-chosen-password-123!',
    },
    403,
  );
  await request(
    admin,
    `/admin/users/${student.id}`,
    'PATCH',
    { password: 'Admin-chosen-password-123!' },
    403,
  );
  assert.equal((await db.userRole.findMany({ where: { userId: teacher.id } }))[0].roleId, 'TEACHER');
  await request(admin, `/admin/users/${student.id}/recovery`, 'POST', {}, 400);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: student.id } })).authVersion, 0);
  await request(client, '/auth/recovery-code', 'POST', { oldPassword: 'incorrect' }, 403);
  const firstCode = (await request(client, '/auth/recovery-code', 'POST', { oldPassword: password }, 201))
    .data.code;
  const issued = await request(client, '/auth/recovery-code', 'POST', { oldPassword: password }, 201);
  const code = issued.data.code;
  assert.equal(issued.response.headers.get('cache-control'), 'no-store');
  assert.notEqual(code, firstCode);
  assert(
    !JSON.stringify(await db.passwordRecovery.findUnique({ where: { userId: teacher.id } })).includes(code),
  );
  assert.equal((await request(client, '/auth/recovery')).data.configured, true);
  const newPassword = 'Only-owner-knows-new-password-123!';
  await request(null, '/auth/recover', 'POST', { username: teacher.username, code, newPassword }, 401);
  await db.sensitiveGrant.create({
    data: {
      organizationId: organization.id,
      userId: teacher.id,
      permissionId: 'data.export',
      grantedBy: administrator.id,
      reason: '恢复撤销验证',
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const approval = await request(admin, `/admin/users/${teacher.id}/recovery`, 'POST', {}, 201);
  assert(!JSON.stringify(approval.data).includes(code));
  assert(!JSON.stringify((await request(admin, '/admin/users')).data).includes(code));
  assert.equal(await db.session.count({ where: { userId: teacher.id } }), 0);
  assert.equal(await db.sensitiveGrant.count({ where: { userId: teacher.id } }), 0);
  await request(client, '/auth/me', 'GET', undefined, 401);
  await request(secondSession, '/auth/me', 'GET', undefined, 401);
  await request(null, '/auth/login', 'POST', { username: teacher.username, password }, 401);
  await request(
    null,
    '/auth/recover',
    'POST',
    { username: teacher.username, code: firstCode, newPassword },
    401,
  );
  // Expired permission rejects the correct secret, then a new permission can be approved.
  await db.passwordRecovery.update({
    where: { userId: teacher.id },
    data: { pendingUntil: new Date(Date.now() - 1000) },
  });
  await request(null, '/auth/recover', 'POST', { username: teacher.username, code, newPassword }, 401);
  await request(admin, `/admin/users/${teacher.id}/recovery`, 'POST', {}, 201);
  const attempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      fetch(base + '/api/auth/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: teacher.username, code, newPassword }),
      }),
    ),
  );
  assert.deepEqual(attempts.map((entry) => entry.status).sort(), [201, 401]);
  assert.equal(await db.passwordRecovery.count({ where: { userId: teacher.id } }), 0);
  await request(null, '/auth/recover', 'POST', { username: teacher.username, code, newPassword }, 401);
  const restored = await login(teacher.username, newPassword);
  assert(!(await request(restored, '/auth/me')).data.user.permissions.includes('data.export'));
  const account = await db.user.findUniqueOrThrow({ where: { id: teacher.id } });
  assert(await verifyPasswordAsync(newPassword, account.passwordHash));
  assert.equal(await verifyPasswordAsync(password, account.passwordHash), false);
  const audit = await db.auditLog.findMany({ where: { resourceId: teacher.id } });
  assert(!JSON.stringify(audit).includes(code));
  assert(!JSON.stringify(audit).includes(newPassword));
  await db.authAttemptWindow.deleteMany();
});

test('真实Guard通过后的旧请求无法在管理员恢复后重生成恢复码或修改密码', async () => {
  // Invoke the built controller against the disposable database after pausing at
  // the real guard boundary; this deterministically exercises the narrow HTTP race.
  const require = createRequire(import.meta.url);
  const { AuthController } = require('../apps/api/dist/auth/auth.controller.js');
  const { AuthService } = require('../apps/api/dist/auth/auth.service.js');
  const { AuthGuard } = require('../apps/api/dist/auth/auth.guard.js');
  const organization = await db.organization.create({ data: { name: `恢复并发验证 ${suffix}` } });
  const administrator = await user(organization.id, 'race_admin', 'ADMIN');
  const teacher = await user(organization.id, 'race_teacher', 'TEACHER');
  const admin = await login(administrator.username);
  const owner = await login(teacher.username);
  await request(owner, '/auth/recovery-code', 'POST', { oldPassword: password }, 201);
  const token = owner.cookie
    .split('; ')
    .find((entry) => entry.startsWith('lms_session='))!
    .slice('lms_session='.length);
  const auth = new AuthService(db);
  const guard = new AuthGuard(auth);
  const guardedRequest: Record<string, any> = {
    cookies: { lms_session: token },
    headers: { 'x-csrf-token': owner.csrf },
    method: 'POST',
    path: '/api/auth/recovery-code',
    ip: '127.0.0.1',
  };
  assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => guardedRequest }) }), true);
  const actor = guardedRequest.actor;
  // Revocation commits before the controller reads the user, so checking only the
  // newly-read user version would incorrectly accept the stale guarded request.
  await request(admin, `/admin/users/${teacher.id}/recovery`, 'POST', {}, 201);
  const before = await db.passwordRecovery.findUniqueOrThrow({ where: { userId: teacher.id } });
  const controller = new AuthController(db, auth, {});
  const response = { setHeader() {}, clearCookie() {} };
  const revoked = (error: unknown) =>
    !!error && typeof (error as any).getStatus === 'function' && (error as any).getStatus() === 401;
  await assert.rejects(
    controller.recoveryCode(actor, { oldPassword: password }, guardedRequest, response),
    revoked,
  );
  await assert.rejects(
    controller.password(
      actor,
      {
        oldPassword: password,
        newPassword: 'Stale-session-cannot-change-password-123!',
      },
      guardedRequest,
      response,
    ),
    revoked,
  );
  const after = await db.passwordRecovery.findUniqueOrThrow({ where: { userId: teacher.id } });
  assert.equal(after.codeHash, before.codeHash);
  assert.equal(after.pendingUntil?.getTime(), before.pendingUntil?.getTime());
  assert.equal(after.requestedAuthVersion, before.requestedAuthVersion);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: teacher.id } })).passwordHash,
    teacher.passwordHash,
  );
});
