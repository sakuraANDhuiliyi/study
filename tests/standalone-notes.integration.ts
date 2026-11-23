import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const base = process.env.TEST_API_URL;
const database = new URL(process.env.DATABASE_URL!);
assert.ok(
  base?.endsWith('/api') &&
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname) &&
    ['localhost', '127.0.0.1'].includes(database.hostname) &&
    /review|test/i.test(database.pathname) &&
    process.env.NODE_ENV !== 'production',
  'Standalone notes integration requires an isolated loopback review/test database and API',
);
const db = new PrismaClient();
const root = '/notes/standalone';
const password = process.env.DEV_SEED_PASSWORD!;
type Client = { cookie: string; csrf: string; id: string; organizationId: string };
async function request(
  client: Client | null,
  path: string,
  method = 'GET',
  body?: unknown,
  expected: number | number[] = 200,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: process.env.APP_ORIGIN || 'http://localhost:5174',
      ...(client ? { Cookie: client.cookie, 'x-csrf-token': client.csrf } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(
    [expected].flat().includes(response.status),
    `${method} ${path}: HTTP ${response.status}, expected ${expected}`,
  );
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
}
async function session(username: string, register = false): Promise<Client> {
  const { data, cookie } = await request(
    null,
    register ? '/auth/register' : '/auth/login',
    'POST',
    {
      username,
      password,
      ...(register ? { name: '独立笔记测试' } : {}),
    },
    201,
  );
  return { cookie, csrf: data.csrfToken, id: data.user.id, organizationId: data.user.organizationId };
}

test('独立笔记真实 HTTP、PostgreSQL 及课时协议兼容', { timeout: 90000 }, async (t) => {
  const marker = 'standalone_' + randomUUID().replaceAll('-', '').slice(0, 10);
  const student = await session('student');
  const teacher = await session('teacher');
  const classmate = await session('student2');
  const outsider = await session('outsider');
  const admin = await session('admin');
  const personal = await session(marker, true);
  const created: string[] = [];
  const course = await db.course.create({
    data: {
      organizationId: student.organizationId,
      teacherId: teacher.id,
      title: marker,
      status: 'PUBLISHED',
    },
  });
  const chapter = await db.chapter.create({ data: { courseId: course.id, title: '章节' } });
  const lesson = await db.lesson.create({
    data: { courseId: course.id, chapterId: chapter.id, title: '样例课时' },
  });
  await db.enrollment.create({ data: { courseId: course.id, userId: student.id } });
  const create = async (client: Client, suffix: string) => {
    const { data } = await request(
      client,
      root,
      'POST',
      {
        title: marker + suffix,
        body: '  <b>原文</b>\n  ' + marker + ' 隐私内容\n',
        category: ' 分类甲 ',
      },
      201,
    );
    created.push(data.id);
    return data;
  };
  let id: string;
  try {
    await t.test('登录、CSRF、严格参数、个人/机构有效角色和独立正文', async () => {
      await request(null, root, 'GET', undefined, 401);
      await request({ ...student, csrf: 'wrong' }, root, 'POST', { title: 'a', body: 'x' }, 403);
      for (const extra of [
        { organizationId: personal.organizationId },
        { userId: classmate.id },
        { body: '   ' },
        { title: 'x'.repeat(121) },
      ]) {
        await request(student, root, 'POST', { title: 'a', body: 'x', ...extra }, 400);
      }
      const note = await create(student, '学生');
      id = note.id;
      assert.equal(note.category, '分类甲');
      assert.equal(note.revision, 1);
      assert.equal(note.pinned, false);
      assert.equal(note.body, '  <b>原文</b>\n  ' + marker + ' 隐私内容\n');
      assert.deepEqual((await request(student, root + '/' + id)).data, note);
      await create(teacher, '教师');
      await create(personal, '个人');
      await request(admin, root, 'POST', { title: 'a', body: 'x' }, 403);
      await request(student, '/notes?source=all&userId=spoof', 'GET', undefined, 400);
    });
    await t.test('同班同学、授课教师、管理员及其他空间均不能读取或修改别人的笔记', async () => {
      for (const client of [classmate, teacher, outsider, personal, admin]) {
        const status = client === admin ? 403 : 404;
        const path = root + '/' + id;
        await request(client, path, 'GET', undefined, status);
        await request(client, path, 'PATCH', { revision: 1, title: '覆盖尝试' }, status);
        await request(client, path, 'DELETE', { revision: 1 }, status);
        assert.ok(
          !(await request(client, '/notes?source=all&search=' + marker)).data.items.some(
            (row: { id: string }) => row.id === id,
          ),
        );
      }
    });
    await t.test('并发同版本写入仅成功一次，置顶补丁不重置其他字段，过期删除保留原文', async () => {
      const path = root + '/' + id;
      const writes = await Promise.all(
        ['甲', '乙'].map((label) =>
          request(student, path, 'PATCH', { revision: 1, title: marker + label }, [200, 409]),
        ),
      );
      assert.deepEqual(writes.map((item) => item.status).sort(), [200, 409]);
      const winner = writes.find((item) => item.status === 200)!.data;
      const pinned = (await request(student, path, 'PATCH', { pinned: true, revision: 2 })).data;
      assert.equal(pinned.revision, 3);
      assert.equal(pinned.title, winner.title);
      assert.equal(pinned.body, winner.body);
      assert.equal(pinned.category, winner.category);
      await request(student, path, 'DELETE', { revision: 2 }, 409);
      assert.deepEqual((await request(student, path)).data, pinned);
    });
    await t.test('统一搜索/置顶/来源/分类、跨来源稳定分页以及原课时和手机协议', async () => {
      const lessonPath = '/lessons/' + lesson.id + '/note';
      const legacy = (await request(student, lessonPath, 'PUT', { body: marker + ' 课时正文', revision: 0 }))
        .data.note;
      const filter = '/notes?search=' + marker;
      const first = (await request(student, filter + '&source=all&pageSize=1')).data;
      const second = (await request(student, filter + '&source=all&pageSize=1&page=2')).data;
      assert.equal(first.total, 2);
      assert.equal(first.items[0].id, id);
      assert.equal(first.items[0].source, 'standalone');
      assert.equal(first.items[0].body, undefined);
      assert.equal(second.items[0].source, 'lesson');
      assert.equal(second.items[0].id, legacy.id);
      assert.equal(second.items[0].lessonTitle, lesson.title);
      assert.deepEqual((await request(student, filter + '&source=all&page=3&pageSize=1')).data, {
        items: [],
        total: 2,
        page: 3,
        pageSize: 1,
      });
      for (const suffix of ['&pinned=true', '&category=' + encodeURIComponent('分类甲')]) {
        assert.deepEqual(
          (await request(student, filter + '&source=all' + suffix)).data.items.map(
            (row: { id: string }) => row.id,
          ),
          [id],
        );
      }
      for (const suffix of ['&source=lesson', '&source=all&courseId=' + course.id, '']) {
        const list = (await request(student, filter + suffix)).data;
        assert.deepEqual(
          list.items.map((row: { id: string }) => row.id),
          [legacy.id],
        );
        if (suffix === '') assert.equal(list.items[0].source, undefined);
      }
      assert.equal(
        (await request(student, root + '?search=' + encodeURIComponent('%_' + marker))).data.total,
        0,
      );
      const mobile = await fetch(base + '/mobile/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'student', password, deviceName: 'notes review' }),
      });
      assert.equal(mobile.status, 201);
      const headers = { Authorization: 'Bearer ' + (await mobile.json()).accessToken };
      const response = await fetch(base + '/mobile/notes?search=' + marker, { headers });
      assert.equal(response.status, 200);
      assert.deepEqual(
        (await response.json()).items.map((row: { id: string }) => row.id),
        [legacy.id],
      );
      assert.equal((await fetch(base + root, { headers })).status, 403);
      assert.equal((await fetch(base + '/mobile/notes?source=all', { headers })).status, 400);
      await db.enrollment.update({
        where: { courseId_userId: { courseId: course.id, userId: student.id } },
        data: { active: false },
      });
      assert.equal((await request(student, filter + '&source=all')).data.total, 1);
    });
    await t.test('同一账号切换个人和机构空间不串读，旧会话失效', async () => {
      const own = created[2];
      assert.equal(
        (await db.standaloneNote.findUniqueOrThrow({ where: { id: own } })).organizationId,
        personal.organizationId,
      );
      await db.user.update({
        where: { id: personal.id },
        data: {
          accountMode: 'ORGANIZATION',
          organizationId: student.organizationId,
          authVersion: { increment: 1 },
        },
      });
      await request(personal, root + '/' + own, 'GET', undefined, 401);
      const joined = await session(marker);
      await request(joined, root + '/' + own, 'GET', undefined, 404);
      assert.equal((await request(joined, root)).data.total, 0);
      const institutionNote = await create(joined, '机构空间');
      await db.user.update({
        where: { id: personal.id },
        data: {
          accountMode: 'PERSONAL',
          organizationId: personal.organizationId,
          authVersion: { increment: 1 },
        },
      });
      const returned = await session(marker);
      assert.equal((await request(returned, root + '/' + own)).data.id, own);
      await request(returned, root + '/' + institutionNote.id, 'GET', undefined, 404);
    });
    await t.test('删除只影响本人，审计事务只保留成功变更与版本', async () => {
      const path = root + '/' + id;
      assert.deepEqual((await request(student, path, 'DELETE', { revision: 3 })).data, { deleted: true });
      await request(student, path, 'GET', undefined, 404);
      assert.equal(await db.standaloneNote.count({ where: { id: created[1] } }), 1);
      const entries = await db.auditLog.findMany({
        where: { resourceType: 'StandaloneNote', resourceId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      assert.deepEqual(
        entries.map((row) => row.action),
        [
          'note.standalone.create',
          'note.standalone.update',
          'note.standalone.update',
          'note.standalone.delete',
        ],
      );
      assert.deepEqual(
        entries.map((row) => row.details),
        [{ revision: 1 }, { revision: 2 }, { revision: 3 }, { revision: 3 }],
      );
      assert.ok(
        entries.every(
          (row) =>
            row.userId === student.id && row.organizationId === student.organizationId && !!row.requestId,
        ),
      );
      const audit = (await request(admin, '/admin/audit?resourceType=StandaloneNote&resourceId=' + id)).data;
      assert.equal(audit.total, 4);
      assert.ok(!JSON.stringify(audit).includes(marker));
      assert.ok(!JSON.stringify(audit).includes('隐私内容'));
    });
  } finally {
    await db.standaloneNote.deleteMany({ where: { id: { in: created } } });
    await db.lessonNote.deleteMany({ where: { courseId: course.id } });
    await db.lesson.delete({ where: { id: lesson.id } });
    await db.chapter.delete({ where: { id: chapter.id } });
    await db.enrollment.deleteMany({ where: { courseId: course.id } });
    await db.course.delete({ where: { id: course.id } });
    await db.auditLog.deleteMany({
      where: {
        OR: [{ resourceType: 'StandaloneNote', resourceId: { in: created } }, { userId: personal.id }],
      },
    });
    await db.session.deleteMany({ where: { userId: personal.id } });
    await db.userRole.deleteMany({ where: { userId: personal.id } });
    await db.user.delete({ where: { id: personal.id } });
    await db.organization.delete({ where: { id: personal.organizationId } });
    await db.$disconnect();
  }
});
