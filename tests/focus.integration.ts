import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

const base = process.env.TEST_API_URL;
const database = new URL(process.env.DATABASE_URL!);
assert.ok(
  base?.endsWith('/api') &&
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname) &&
    ['localhost', '127.0.0.1'].includes(database.hostname) &&
    /review|test/i.test(database.pathname) &&
    process.env.NODE_ENV !== 'production',
  '专注集成验收需要隔离 PostgreSQL 和本机 API',
);
const db = new PrismaClient();
const origin = process.env.APP_ORIGIN!;
type Client = { id: string; organizationId: string; csrf: string; cookie: string };
const auditRequests = new Set<string>();

async function http(
  c: Client | null,
  path: string,
  method = 'GET',
  body?: unknown,
  status = 200,
  originHeader = origin,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: originHeader,
      ...(c ? { Cookie: c.cookie, 'x-csrf-token': c.csrf } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, status, `${method} ${path} → ${response.status} (expected ${status})`);
  const request = response.headers.get('x-request-id');
  if (request) auditRequests.add(request);
  return {
    data: await response.json(),
    cookies: response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
  };
}
async function login(username: string, register = false): Promise<Client> {
  const { data, cookies } = await http(
    null,
    register ? '/auth/register' : '/auth/login',
    'POST',
    {
      username,
      password: process.env.DEV_SEED_PASSWORD,
      ...(register ? { name: '专注记录验收' } : {}),
    },
    201,
  );
  return {
    id: data.user.id,
    organizationId: data.user.organizationId,
    csrf: data.csrfToken,
    cookie: cookies,
  };
}

test('专注空间严格校验、双空间隔离、真实统计与审计', { timeout: 90000 }, async (t) => {
  const username = 'focus_' + randomUUID().slice(0, 8);
  const personal = await login(username, true);
  const teacher = await login('teacher'),
    admin = await login('admin'),
    student = await login('student');
  const outsider = await login('outsider');
  const root = '/focus/sessions';
  const history = async (c: Client, query = '') => (await http(c, root + query)).data;
  const summary = async (c: Client) => (await http(c, '/focus/summary')).data;
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const midnight = Date.parse(date + 'T00:00:00+08:00');
  const payload = (offsetDays: number, offsetEndSeconds: number, actualSeconds: number, extra = {}) => {
    const end = midnight + offsetDays * 86400000 + offsetEndSeconds * 1000;
    return {
      title: '私人专题 ' + username,
      category: '算法练习',
      mode: 'FOCUS',
      plannedMinutes: 25,
      actualSeconds,
      status: 'COMPLETED',
      reflection: '私密复盘 ' + username,
      startedAt: new Date(end - (actualSeconds + 12) * 1000).toISOString(),
      endedAt: new Date(end).toISOString(),
      ...extra,
    };
  };
  const first = payload(0, 0, 63);
  let ownId: string;
  try {
    await t.test('匿名与教师/管理员拒绝，Origin、CSRF、时间/字段/分页边界', async () => {
      await http(null, root, 'GET', undefined, 401);
      for (const c of [teacher, admin]) {
        await http(c, root, 'GET', undefined, 403);
        await http(c, '/focus/summary', 'GET', undefined, 403);
        await http(c, root, 'POST', first, 403);
      }
      await http({ ...personal, csrf: 'invalid' }, root, 'POST', first, 403);
      await http(personal, root, 'POST', first, 403, 'https://invalid.example');
      for (const patch of [
        { organizationId: personal.organizationId },
        { userId: student.id },
        { title: ' ' },
        { plannedMinutes: 181 },
        { actualSeconds: 14401 },
        { actualSeconds: 0 },
        { actualSeconds: 76 },
        { endedAt: first.startedAt },
        { status: 'RUNNING' },
        { category: 'unknown' },
        { startedAt: '2025-01-01' },
        { reflection: 'x'.repeat(501) },
        { endedAt: new Date(Date.now() + 3600000).toISOString() },
      ])
        await http(personal, root, 'POST', { ...first, ...patch }, 400);
      for (const q of [
        '?page=0',
        '?status=done',
        '?category=unknown',
        '?userId=' + student.id,
        '?page=1&page=2',
      ])
        await http(personal, root + q, 'GET', undefined, 400);
      await http(personal, '/focus/summary?organizationId=' + student.organizationId, 'GET', undefined, 400);
      assert.equal((await history(personal)).total, 0);
      const zero = await summary(personal);
      assert.equal(zero.completedCount, 0);
      assert.equal(zero.days.length, 7);
      assert.ok(zero.days.every((v: { seconds: number }) => v.seconds === 0));
    });
    await t.test('同时重试仅产生一条记录和一次审计，相同开始时间的变更返回409', async () => {
      const [a, b] = await Promise.all([
        http(personal, root, 'POST', first, 201),
        http(personal, root, 'POST', first, 201),
      ]);
      ownId = a.data.id;
      assert.equal(b.data.id, ownId);
      assert.equal((await http(personal, root + '/' + ownId)).data.reflection, first.reflection);
      await http(personal, root, 'POST', { ...first, reflection: '另一个标签页的输入' }, 409);
      assert.equal((await history(personal)).total, 1);
      const events = await db.auditLog.findMany({
        where: { resourceType: 'FocusSession', resourceId: ownId },
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].action, 'focus.session.create');
      assert.deepEqual(events[0].details, {});
      assert.ok(events[0].requestId);
    });
    await t.test('北京时间自然日、周一与连续天数，过滤/分页保留放弃与休息历史', async () => {
      for (const record of [
        payload(-1, 0, 61),
        payload(-2, 0, 29),
        payload(-1, 3600, 300, { mode: 'SHORT_BREAK', category: '自由专注' }),
        payload(-1, 1800, 28, { status: 'ABANDONED' }),
        payload(-1, 1700, 900, { mode: 'LONG_BREAK' }),
      ])
        await http(personal, root, 'POST', record, 201);
      const data = await summary(personal);
      assert.equal(data.todaySeconds, 63);
      assert.equal(data.todayMinutes, 1);
      assert.equal(data.completedCount, 3);
      assert.equal(data.streakDays, 3);
      const weekday = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
      const week = 63 + (weekday >= 1 ? 61 : 0) + (weekday >= 2 ? 29 : 0);
      assert.equal(data.weekSeconds, week);
      assert.equal(data.weekMinutes, Math.floor(week / 60));
      assert.deepEqual(
        data.days.map((v: { seconds: number }) => v.seconds),
        [0, 0, 0, 0, 29, 61, 63],
      );
      assert.equal(data.days[6].date, date);
      const all = await history(personal);
      assert.equal(all.total, 6);
      assert.equal(all.items[0].id, ownId);
      assert.equal((await history(personal, '?category=自由专注')).total, 1);
      assert.equal((await history(personal, '?category=算法练习&status=ABANDONED')).total, 1);
      const second = await history(personal, '?page=2&pageSize=1');
      assert.equal(second.items.length, 1);
      assert.equal(second.total, 6);
      assert.notEqual(second.items[0].id, ownId);
    });
    await t.test('跨账号与跨机构无法读删，拒绝审计仅记录请求方与不可用状态', async () => {
      for (const other of [student, outsider]) {
        await http(other, root + '/' + ownId, 'GET', undefined, 404);
        await http(other, root + '/' + ownId, 'DELETE', undefined, 404);
        const list = await history(other);
        assert.ok(!list.items.some((r: { id: string }) => r.id === ownId));
        const events = await db.auditLog.findMany({
          where: { requestId: { in: [...auditRequests] }, userId: other.id, resourceType: 'FocusSession' },
        });
        assert.deepEqual(events.map((e) => e.action).sort(), [
          'focus.session.delete.denied',
          'focus.session.read.denied',
        ]);
        assert.ok(
          events.every((e) => e.organizationId === other.organizationId && e.resourceId === 'unavailable'),
        );
        assert.ok(!JSON.stringify(events).includes(first.reflection));
      }
      await http(personal, root + '/' + ownId, 'DELETE', { userId: student.id }, 400);
      await http({ ...personal, csrf: 'invalid' }, root + '/' + ownId, 'DELETE', undefined, 403);
    });
    await t.test('同一用户的个人/机构空间分别统计、保存和删除，旧会话撤销', async () => {
      await db.user.update({
        where: { id: personal.id },
        data: {
          accountMode: 'ORGANIZATION',
          organizationId: student.organizationId,
          authVersion: { increment: 1 },
        },
      });
      await http(personal, '/focus/summary', 'GET', undefined, 401);
      const institution = await login(username);
      assert.equal(institution.organizationId, student.organizationId);
      assert.equal((await history(institution)).total, 0);
      assert.equal((await summary(institution)).completedCount, 0);
      await http(institution, root + '/' + ownId, 'GET', undefined, 404);
      await http(institution, root + '/' + ownId, 'DELETE', undefined, 404);
      const { data: institutional } = await http(institution, root, 'POST', first, 201);
      assert.notEqual(institutional.id, ownId);
      const sharedOrgClassmate = await history(student);
      assert.ok(!sharedOrgClassmate.items.some((r: { id: string }) => r.id === institutional.id));
      await http(student, root + '/' + institutional.id, 'GET', undefined, 404);
      assert.deepEqual((await http(institution, root + '/' + institutional.id, 'DELETE')).data, {
        deleted: true,
      });
      assert.equal((await summary(institution)).completedCount, 0);
      await db.user.update({
        where: { id: personal.id },
        data: {
          accountMode: 'PERSONAL',
          organizationId: personal.organizationId,
          authVersion: { increment: 1 },
        },
      });
      const returned = await login(username);
      assert.equal((await history(returned)).total, 6);
      assert.equal((await summary(returned)).completedCount, 3);
      await http(returned, root + '/' + ownId, 'DELETE');
      const updated = await summary(returned);
      assert.equal(updated.completedCount, 2);
      assert.equal(updated.todaySeconds, 0);
      assert.equal(updated.streakDays, 2);
      await http(returned, root + '/' + ownId, 'GET', undefined, 404);
    });
  } finally {
    await db.focusSession.deleteMany({ where: { userId: personal.id } });
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { userId: personal.id },
          { requestId: { in: [...auditRequests] }, resourceType: 'FocusSession' },
        ],
      },
    });
    await db.session.deleteMany({ where: { userId: personal.id } });
    await db.userRole.deleteMany({ where: { userId: personal.id } });
    await db.user.delete({ where: { id: personal.id } });
    await db.organization.delete({ where: { id: personal.organizationId } });
    await db.$disconnect();
  }
});
