import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const base = process.env.TEST_API_URL?.replace(/\/$/, '');
if (!base?.endsWith('/api') || !process.env.DATABASE_URL || process.env.NODE_ENV === 'production')
  throw new Error(
    'Notes integration requires TEST_API_URL ending in /api and an isolated development database',
  );
const db = new PrismaClient();
type Session = { cookie: string; csrf: string; id: string };
async function call(session: Session | null, path: string, method = 'GET', body?: unknown, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: process.env.APP_ORIGIN || 'http://localhost:5174',
      ...(session ? { Cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 400)}`);
  return { response, data: text ? JSON.parse(text) : null };
}
async function login(username: string): Promise<Session> {
  const { response, data } = await call(
    null,
    '/auth/login',
    'POST',
    {
      username,
      password: process.env.DEV_SEED_PASSWORD,
    },
    201,
  );
  return {
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
    csrf: data.csrfToken,
    id: data.user.id,
  };
}

test('私人课时笔记：真实 HTTP、数据库唯一约束、并发版本与当前授权', { timeout: 60000 }, async (t) => {
  const suffix = randomUUID();
  const teacher = await login('teacher');
  const student = await login('student');
  const otherStudent = await login('student2');
  const admin = await login('admin');
  const outsider = await login('outsider');
  const organizationId = (await db.user.findUniqueOrThrow({ where: { id: student.id } })).organizationId;
  const courses: string[] = [];
  const lessons: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const course = await db.course.create({
        data: {
          organizationId,
          title: `笔记隔离回归 ${suffix} ${i}`,
          teacherId: teacher.id,
          status: 'PUBLISHED',
        },
      });
      courses.push(course.id);
      await db.teachingAssignment.create({ data: { courseId: course.id, userId: teacher.id } });
      await db.enrollment.createMany({
        data: [student, otherStudent].map((s) => ({ courseId: course.id, userId: s.id })),
      });
      const chapter = await db.chapter.create({ data: { courseId: course.id, title: '笔记章节' } });
      const lesson = await db.lesson.create({
        data: { courseId: course.id, chapterId: chapter.id, title: `笔记来源课时 ${i}` },
      });
      lessons.push(lesson.id);
    }
    const path = `/lessons/${lessons[0]}/note`;
    let revision = 0;
    let noteId = '';
    await t.test('登录与 CSRF 必须有效；首次读取不会创建数据', async () => {
      await call(null, path, 'GET', undefined, 401);
      await call({ ...student, csrf: 'invalid' }, path, 'PUT', { body: 'x', revision: 0 }, 403);
      assert.equal((await call(student, path)).data.note, null);
      assert.equal(await db.lessonNote.count({ where: { lessonId: lessons[0] } }), 0);
    });
    await t.test('每人每课时唯一；纯文本按原样存储并重新读取', async () => {
      const text = '并发学习重点 <img src=x onerror=alert(1)>\n第二行';
      const saved = (await call(student, path, 'PUT', { body: text, pinned: false, revision: 0 })).data.note;
      revision = saved.revision;
      noteId = saved.id;
      assert.equal(saved.body, text);
      assert.equal((await call(student, path)).data.note.body, text);
      await call(student, path, 'PUT', { body: '重复创建', revision: 0 }, 409);
      assert.equal(await db.lessonNote.count({ where: { userId: student.id, lessonId: lessons[0] } }), 1);
    });
    await t.test('同学、教师、管理员只能读写自己同课时的笔记', async () => {
      for (const actor of [otherStudent, teacher, admin]) {
        assert.equal((await call(actor, path)).data.note, null);
        const result = (await call(actor, path, 'PUT', { body: '自己的笔记 ' + actor.id, revision: 0 })).data
          .note;
        assert.equal(result.userId, actor.id);
        const list = (await call(actor, `/notes?courseId=${courses[0]}&userId=${student.id}`)).data;
        assert.equal(list.total, 1);
        assert(!list.items[0].preview.includes('并发学习重点'));
      }
      await call(student, path, 'PUT', { body: '伪造作者', revision, noteId, userId: otherStudent.id }, 400);
      await call(outsider, path, 'GET', undefined, 404);
      assert.equal((await call(outsider, '/notes')).data.total, 0);
    });
    await t.test('空白、过长正文及非法分页输入被拒绝', async () => {
      for (const body of ['', '   ', 'x'.repeat(10001), '非法\u0000字符'])
        await call(student, path, 'PUT', { body, revision, noteId }, 400);
      await call(student, path, 'PUT', { body: '遗漏笔记标识', revision }, 400);
      await call(student, path, 'DELETE', { revision }, 400);
      await call(student, '/notes?pageSize=1000', 'GET', undefined, 400);
      await call(student, '/notes?pinned=maybe', 'GET', undefined, 400);
      const result = (await call(student, path, 'PUT', { body: '字'.repeat(10000), revision, noteId })).data
        .note;
      assert.equal(result.body.length, 10000);
      revision = result.revision;
    });
    await t.test('并发编辑恰好一个成功，旧版本不能覆盖保存或删除', async () => {
      const send = (body: string) =>
        fetch(base + path, {
          method: 'PUT',
          headers: {
            Cookie: student.cookie,
            'x-csrf-token': student.csrf,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ body, revision, noteId }),
        });
      const responses = await Promise.all([send('同一版本 A'), send('同一版本 B')]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      await call(student, path, 'DELETE', { revision, noteId }, 409);
      revision = (await call(student, path)).data.note.revision;
    });
    await t.test('跨课程正文与来源搜索、置顶排序、分页统计一致', async () => {
      revision = (
        await call(student, path, 'PUT', { body: '共同检索词 第一门 %_', pinned: true, revision, noteId })
      ).data.note.revision;
      await call(student, `/lessons/${lessons[1]}/note`, 'PUT', { body: '共同检索词 第二门', revision: 0 });
      const one = (await call(student, '/notes?search=共同检索词&pageSize=1')).data;
      assert.equal(one.total, 2);
      assert.equal(one.items.length, 1);
      assert.equal(one.items[0].lessonId, lessons[0]);
      assert.equal(
        (await call(student, '/notes?search=共同检索词&pageSize=1&page=2')).data.items[0].lessonId,
        lessons[1],
      );
      assert.equal((await call(student, '/notes?search=共同检索词&pinned=true')).data.total, 1);
      assert.equal((await call(student, '/notes?search=' + encodeURIComponent('%_'))).data.total, 1);
      assert.equal(
        (await call(student, '/notes?search=' + encodeURIComponent('笔记来源课时 1'))).data.total,
        1,
      );
    });
    await t.test('重新关闭的课时对学生隐藏，授权教师仍能保存备课笔记', async () => {
      await db.lesson.update({ where: { id: lessons[0] }, data: { opensAt: new Date(Date.now() + 60000) } });
      await call(student, path, 'GET', undefined, 403);
      await call(student, path, 'PUT', { body: '未来课时', revision, noteId }, 403);
      assert.equal((await call(student, `/notes?courseId=${courses[0]}`)).data.total, 0);
      const own = (await call(teacher, path)).data.note;
      await call(teacher, path, 'PUT', {
        body: '教师的未开放课时备课笔记',
        revision: own.revision,
        noteId: own.id,
      });
      await db.lesson.update({ where: { id: lessons[0] }, data: { opensAt: null } });
    });
    await t.test('撤课、课程下架和教师撤权立即阻断读取、保存、删除、搜索', async () => {
      await db.enrollment.update({
        where: { courseId_userId: { courseId: courses[0], userId: student.id } },
        data: { active: false },
      });
      await call(student, path, 'GET', undefined, 403);
      await call(student, path, 'PUT', { body: '撤权后', revision, noteId }, 403);
      await call(student, path, 'DELETE', { revision, noteId }, 403);
      assert.equal((await call(student, '/notes?search=共同检索词')).data.total, 1);
      await call(student, `/notes?courseId=${courses[0]}`, 'GET', undefined, 403);
      await db.enrollment.update({
        where: { courseId_userId: { courseId: courses[0], userId: student.id } },
        data: { active: true },
      });
      await db.course.update({ where: { id: courses[0] }, data: { status: 'UNPUBLISHED' } });
      await call(student, path, 'GET', undefined, 403);
      await db.course.update({ where: { id: courses[0] }, data: { status: 'ARCHIVED' } });
      assert.equal((await call(student, path)).data.note.revision, revision);
      await db.teachingAssignment.update({
        where: { courseId_userId: { courseId: courses[0], userId: teacher.id } },
        data: { active: false },
      });
      await call(teacher, path, 'GET', undefined, 403);
    });
    await t.test('删除只影响本人笔记，其他作者记录仍存在', async () => {
      await call(student, path, 'DELETE', { revision, noteId });
      assert.equal((await call(student, path)).data.note, null);
      assert.equal(await db.lessonNote.count({ where: { lessonId: lessons[0] } }), 3);
    });
    await t.test('删除重建后，旧页面的相同版本号仍不能覆盖或删除新笔记', async () => {
      const replacement = (await call(student, path, 'PUT', { body: '重建后的新笔记', revision: 0 })).data
        .note;
      assert.notEqual(replacement.id, noteId);
      assert.equal(replacement.revision, 1);
      await call(student, path, 'PUT', { body: '旧页面覆盖', revision: 1, noteId }, 409);
      await call(student, path, 'DELETE', { revision: 1, noteId }, 409);
      assert.equal((await call(student, path)).data.note.body, '重建后的新笔记');
    });
  } finally {
    await db.lessonNote.deleteMany({ where: { courseId: { in: courses } } });
    await db.lesson.deleteMany({ where: { courseId: { in: courses } } });
    await db.chapter.deleteMany({ where: { courseId: { in: courses } } });
    await db.enrollment.deleteMany({ where: { courseId: { in: courses } } });
    await db.teachingAssignment.deleteMany({ where: { courseId: { in: courses } } });
    await db.course.deleteMany({ where: { id: { in: courses } } });
    await db.$disconnect();
  }
});
