import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

// Run against an actual seeded API: npx tsx --test tests/communication.integration.ts
// The suite creates isolated accounts/course/class and retains history for audit inspection.
const base = process.env.TEST_API_URL || 'http://127.0.0.1:3001/api';
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const password = process.env.DEV_SEED_PASSWORD;
type Session = { cookie: string; csrf: string; user: { id: string } };

async function request(
  session: Session | null,
  path: string,
  method = 'GET',
  body?: unknown,
  expected = 200,
) {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(session ? { Cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
      ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    result = text;
  }
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${typeof result === 'string' ? result.slice(0, 150) : JSON.stringify(result)}`,
  );
  return { body: result, response };
}
async function login(username: string): Promise<Session> {
  const result = await request(null, '/auth/login', 'POST', { username, password }, 201);
  return {
    cookie: result.response.headers.get('set-cookie')!.split(';')[0],
    csrf: result.body.csrfToken,
    user: result.body.user,
  };
}
function socketFor(session: Session, socketOrigin = origin, csrf = session.csrf): Socket {
  return io(`${new URL(base).origin}/notifications`, {
    transports: ['websocket'],
    auth: { csrfToken: csrf },
    extraHeaders: { Cookie: session.cookie, Origin: socketOrigin },
    autoConnect: false,
    reconnection: false,
    timeout: 3000,
  });
}
function socketEvent(socket: Socket, event: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const listener = (value: unknown) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Socket event timed out: ${event}`));
    }, timeout);
    socket.once(event, listener);
  });
}

test('真实数据库交流闭环、幂等、权限撤销和附件访问', { skip: !password, timeout: 120000 }, async (suite) => {
  const admin = await login('admin');
  const existingTeacher2 = await login('teacher2');
  const outsider = await login('outsider');
  const suffix = Date.now().toString(36);
  const created: string[] = [];
  for (const role of ['TEACHER', 'STUDENT', 'STUDENT'] as const) {
    const index = created.length;
    const username = `comm_${suffix}_${index}`;
    const result = await request(
      admin,
      '/admin/users',
      'POST',
      { username, name: `交流验收${index}`, password, roles: [role] },
      201,
    );
    created.push(result.body.id);
  }
  const [teacher, student, student2] = await Promise.all([
    login(`comm_${suffix}_0`),
    login(`comm_${suffix}_1`),
    login(`comm_${suffix}_2`),
  ]);
  const course = (await request(teacher, '/courses', 'POST', { title: `交流验收课程 ${suffix}` }, 201)).body;
  const chapter = (
    await request(teacher, `/courses/${course.id}/chapters`, 'POST', { title: '交流与安全' }, 201)
  ).body;
  await request(
    teacher,
    `/chapters/${chapter.id}/lessons`,
    'POST',
    { title: '验收课时', content: '<p>真实课时</p>' },
    201,
  );
  await request(teacher, `/courses/${course.id}`, 'PATCH', { status: 'PUBLISHED' });
  for (const userId of [student.user.id, student2.user.id])
    await request(teacher, `/courses/${course.id}/members`, 'POST', { userId }, 201);
  const classroom = (
    await request(admin, '/admin/classes', 'POST', { name: `交流验收班 ${suffix}`, grade: '验证班' }, 201)
  ).body;
  for (const userId of [student.user.id, student2.user.id])
    await request(admin, `/admin/classes/${classroom.id}/members`, 'POST', { userId }, 201);
  await request(admin, `/admin/classes/${classroom.id}/courses`, 'POST', { courseId: course.id }, 201);
  let postId = '',
    conversationId = '',
    classConversationId = '',
    courseFileId = '',
    messageFileId = '';

  try {
    await suite.test('讨论发帖、同帖引用、学生不能置顶、关闭后拒绝回复', async () => {
      const post = (
        await request(
          student,
          '/communication/posts',
          'POST',
          { courseId: course.id, title: '课程问题', body: '<script>evil()</script><p>如何复习？</p>' },
          201,
        )
      ).body;
      postId = post.id;
      assert(!post.body.includes('script'));
      assert(!post.body.includes('evil'));
      const reply = (
        await request(
          teacher,
          `/communication/posts/${post.id}/replies`,
          'POST',
          { body: '先复习基础定义。' },
          201,
        )
      ).body;
      await request(
        student,
        `/communication/posts/${post.id}/replies`,
        'POST',
        { body: '明白了', quoteReplyId: reply.id },
        201,
      );
      await request(student, `/communication/posts/${post.id}`, 'PATCH', { pinned: true }, 403);
      await request(student, `/communication/posts/${post.id}`, 'PATCH', { solved: true });
      await request(teacher, `/communication/posts/${post.id}`, 'PATCH', { pinned: true, closed: true });
      await request(student, `/communication/posts/${post.id}/replies`, 'POST', { body: '关闭后回复' }, 409);
      const detail = (await request(student, `/communication/posts/${post.id}`)).body;
      assert.equal(detail.replyPage.total, 2);
      assert.equal(detail.replies[1].quote.id, reply.id);
      await request(teacher, `/communication/posts/${post.id}`, 'PATCH', { closed: false });
      const at = encodeURIComponent(post.createdAt);
      const boundary = (
        await request(student, `/communication/posts?courseId=${course.id}&createdFrom=${at}&createdTo=${at}`)
      ).body;
      assert.equal(boundary.total, 1);
      assert.equal(boundary.items[0].id, post.id);
      const later = encodeURIComponent(new Date(new Date(post.createdAt).getTime() + 1).toISOString());
      assert.equal(
        (await request(student, `/communication/posts?courseId=${course.id}&createdFrom=${later}`)).body
          .total,
        0,
      );
      await request(
        student,
        `/communication/posts?createdFrom=${later}&createdTo=${at}`,
        'GET',
        undefined,
        400,
      );
      await request(student, '/communication/posts?createdFrom=invalid-date', 'GET', undefined, 400);
    });

    await suite.test('附件真实上传下载；关联前、跨机构、未来课时不可访问', async () => {
      const form = new FormData();
      form.append('courseId', course.id);
      form.append('file', new Blob(['真实课程附件'], { type: 'text/plain' }), '课程笔记.txt');
      const uploaded = (await request(student, '/attachments', 'POST', form, 201)).body;
      courseFileId = uploaded.id;
      assert.equal(uploaded.storageKey, undefined);
      await request(student2, `/attachments/${uploaded.id}/download`, 'GET', undefined, 403);
      await request(
        student,
        `/communication/posts/${postId}/replies`,
        'POST',
        { body: '学习笔记', attachmentIds: [uploaded.id] },
        201,
      );
      assert.equal((await request(student2, `/attachments/${uploaded.id}/download`)).body, '真实课程附件');
      await request(outsider, `/attachments/${uploaded.id}/download`, 'GET', undefined, 404);
      const bad = new FormData();
      bad.append('file', new Blob(['<html>伪装图片</html>'], { type: 'image/png' }), 'fake.png');
      await request(student, '/attachments', 'POST', bad, 400);
      const futureForm = new FormData();
      futureForm.append('courseId', course.id);
      futureForm.append('file', new Blob(['尚未开放内容'], { type: 'text/plain' }), 'future.txt');
      const futureFile = (await request(teacher, '/attachments', 'POST', futureForm, 201)).body;
      const lesson = (
        await request(
          teacher,
          `/chapters/${chapter.id}/lessons`,
          'POST',
          {
            title: '未来开放课时',
            attachmentId: futureFile.id,
            opensAt: new Date(Date.now() + 86400000).toISOString(),
          },
          201,
        )
      ).body;
      await request(student, `/attachments/${futureFile.id}/download`, 'GET', undefined, 403);
      await request(teacher, `/lessons/${lesson.id}`, 'PATCH', { opensAt: null });
      assert.equal((await request(student, `/attachments/${futureFile.id}/download`)).body, '尚未开放内容');
    });

    await suite.test('讲义内联图片跟随课时开放、移除引用与当前课程授权', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFAAAAAASUVORK5CYII=',
        'base64',
      );
      const form = new FormData();
      form.append('courseId', course.id);
      form.append('file', new Blob([png], { type: 'image/png' }), '教学图示.png');
      const file = (await request(teacher, '/attachments', 'POST', form, 201)).body;
      await request(student, `/attachments/${file.id}/preview`, 'GET', undefined, 403);
      const content = `<p>配图说明</p><img src="/api/attachments/${file.id}/preview" alt="教学图示">`;
      const lesson = (
        await request(
          teacher,
          `/chapters/${chapter.id}/lessons`,
          'POST',
          { title: '带图片的讲义', content, opensAt: new Date(Date.now() + 86400000).toISOString() },
          201,
        )
      ).body;
      assert.deepEqual(lesson.attachmentIds, [file.id]);
      await request(student, `/attachments/${file.id}/preview`, 'GET', undefined, 403);
      await request(teacher, `/lessons/${lesson.id}`, 'PATCH', { opensAt: null });
      const preview = await request(student, `/attachments/${file.id}/preview`);
      assert.equal(preview.response.headers.get('content-type'), 'image/png');
      await request(outsider, `/attachments/${file.id}/preview`, 'GET', undefined, 404);
      await request(existingTeacher2, `/attachments/${file.id}/preview`, 'GET', undefined, 403);
      await request(teacher, `/lessons/${lesson.id}`, 'PATCH', { content: '<p>已移除图片</p>' });
      await request(student, `/attachments/${file.id}/preview`, 'GET', undefined, 403);
    });

    await suite.test('私人会话仅当前同课师生；管理员和其他学生不得浏览', async () => {
      conversationId = (
        await request(student, '/communication/conversations', 'POST', { userId: teacher.user.id }, 201)
      ).body.id;
      assert.equal(
        (await request(student, '/communication/conversations', 'POST', { userId: teacher.user.id }, 201))
          .body.id,
        conversationId,
      );
      await request(student, '/communication/conversations', 'POST', { userId: student2.user.id }, 403);
      await request(
        student2,
        `/communication/conversations/${conversationId}/messages`,
        'GET',
        undefined,
        403,
      );
      await request(admin, `/communication/conversations/${conversationId}/messages`, 'GET', undefined, 403);
      await request(
        existingTeacher2,
        `/communication/conversations/${conversationId}/messages`,
        'GET',
        undefined,
        403,
      );
      const form = new FormData();
      form.append('conversationId', conversationId);
      form.append('file', new Blob(['私人消息附件'], { type: 'text/plain' }), 'private.txt');
      messageFileId = (await request(student, '/attachments', 'POST', form, 201)).body.id;
      await request(teacher, `/attachments/${messageFileId}/download`, 'GET', undefined, 403);
    });

    await suite.test('并发幂等发送、补取、未读游标不回退、撤回附件立即失效', async () => {
      const socket = socketFor(teacher);
      const ready = socketEvent(socket, 'ready');
      socket.connect();
      await ready;
      const invalidation = socketEvent(socket, 'invalidate');
      const payload = { body: '并发发送只保留一条', clientId: randomUUID(), attachmentIds: [messageFileId] };
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          request(student, `/communication/conversations/${conversationId}/messages`, 'POST', payload, 201),
        ),
      );
      assert((await invalidation).resources.includes('messages'));
      socket.disconnect();
      assert.equal(new Set(results.map((result) => result.body.id)).size, 1);
      const first = results[0].body;
      await request(
        student,
        `/communication/conversations/${conversationId}/messages`,
        'POST',
        { ...payload, body: '冲突内容' },
        409,
      );
      const second = (
        await request(
          student,
          `/communication/conversations/${conversationId}/messages`,
          'POST',
          { body: '第二条消息', clientId: randomUUID() },
          201,
        )
      ).body;
      assert.equal(
        (await request(teacher, '/communication/conversations')).body.items.find(
          (item: any) => item.id === conversationId,
        ).unreadCount,
        2,
      );
      const caught = (
        await request(teacher, `/communication/conversations/${conversationId}/messages?afterId=${first.id}`)
      ).body;
      assert.equal(caught.items.length, 1);
      assert.equal(caught.items[0].id, second.id);
      await request(
        teacher,
        `/communication/conversations/${conversationId}/read`,
        'POST',
        { messageId: second.id },
        201,
      );
      await request(
        teacher,
        `/communication/conversations/${conversationId}/read`,
        'POST',
        { messageId: first.id },
        201,
      );
      assert.equal(
        (await request(teacher, '/communication/conversations')).body.items.find(
          (item: any) => item.id === conversationId,
        ).unreadCount,
        0,
      );
      assert.equal((await request(teacher, `/attachments/${messageFileId}/download`)).body, '私人消息附件');
      await request(teacher, `/communication/messages/${first.id}`, 'DELETE', undefined, 403);
      await request(student, `/communication/messages/${first.id}`, 'DELETE');
      await request(teacher, `/attachments/${messageFileId}/download`, 'GET', undefined, 403);
      const history = (await request(teacher, `/communication/conversations/${conversationId}/messages`))
        .body;
      assert.equal(history.total, 2);
      assert(history.items[0].retractedAt);
      assert.deepEqual(history.items[0].attachmentIds, []);
    });

    await suite.test('真实WebSocket握手拒绝伪造来源和错误CSRF', async () => {
      for (const [socketOrigin, csrf] of [
        ['https://evil.invalid', teacher.csrf],
        [origin, 'invalid-csrf'],
      ]) {
        const socket = socketFor(teacher, socketOrigin, csrf);
        let leakedReady = false;
        socket.on('ready', () => {
          leakedReady = true;
        });
        try {
          const disconnected = socketEvent(socket, 'disconnect');
          socket.connect();
          await disconnected;
          assert.equal(leakedReady, false);
        } finally {
          socket.disconnect();
        }
      }
    });

    await suite.test('屏蔽阻止发送；班级房间检查当前成员', async () => {
      await request(student, '/communication/blocks', 'POST', { userId: teacher.user.id }, 201);
      await request(
        teacher,
        `/communication/conversations/${conversationId}/messages`,
        'POST',
        { body: '屏蔽中', clientId: randomUUID() },
        403,
      );
      await request(student, `/communication/blocks/${teacher.user.id}`, 'DELETE');
      await request(
        teacher,
        `/communication/conversations/${conversationId}/messages`,
        'POST',
        { body: '恢复交流', clientId: randomUUID() },
        201,
      );
      classConversationId = (
        await request(student, `/communication/classes/${classroom.id}/conversation`, 'POST', {}, 201)
      ).body.id;
      await request(
        student,
        `/communication/conversations/${classConversationId}/messages`,
        'POST',
        { body: '班级交流', clientId: randomUUID() },
        201,
      );
      await request(
        existingTeacher2,
        `/communication/conversations/${classConversationId}/messages`,
        'GET',
        undefined,
        403,
      );
      await request(
        admin,
        `/admin/classes/${classroom.id}/members`,
        'POST',
        { userId: student.user.id, active: false },
        201,
      );
      await request(
        student,
        `/communication/conversations/${classConversationId}/messages`,
        'GET',
        undefined,
        403,
      );
    });

    await suite.test('举报处理隐藏内容且保留审计；教师禁言限制范围', async () => {
      const report = (
        await request(
          student2,
          '/communication/reports',
          'POST',
          { targetType: 'post', targetId: postId, reason: '测试内容治理闭环' },
          201,
        )
      ).body;
      await request(
        teacher,
        '/communication/mutes',
        'POST',
        {
          userId: student2.user.id,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          reason: '不能全机构禁言',
        },
        403,
      );
      const mute = (
        await request(
          teacher,
          '/communication/mutes',
          'POST',
          {
            userId: student2.user.id,
            courseId: course.id,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            reason: '测试课程范围禁言',
          },
          201,
        )
      ).body;
      await request(student2, `/communication/posts/${postId}/replies`, 'POST', { body: '禁言中回复' }, 403);
      await request(teacher, `/communication/mutes/${mute.id}`, 'DELETE');
      await request(
        admin,
        `/communication/reports/${report.id}/resolve`,
        'POST',
        { action: 'hide', reason: '验收隐藏与审计事务' },
        201,
      );
      await request(student, `/communication/posts/${postId}`, 'GET', undefined, 404);
      await request(student2, `/attachments/${courseFileId}/download`, 'GET', undefined, 403);
    });

    await suite.test('退课后旧私信、发送与文件链接立即失去权限', async () => {
      await request(teacher, `/courses/${course.id}/members/${student.user.id}`, 'DELETE');
      await request(
        student,
        `/communication/conversations/${conversationId}/messages`,
        'GET',
        undefined,
        403,
      );
      await request(
        student,
        `/communication/conversations/${conversationId}/messages`,
        'POST',
        { body: '已退课', clientId: randomUUID() },
        403,
      );
      await request(student, `/attachments/${courseFileId}/download`, 'GET', undefined, 403);
      const listed = (await request(student, '/communication/conversations')).body.items;
      assert(!listed.some((item: any) => item.id === conversationId));
      await request(student, '/notifications/read-all', 'POST', {}, 201);
      assert.equal((await request(student, '/notifications')).body.unreadCount, 0);
      await request({ ...student, csrf: 'invalid-csrf' }, '/notifications/read-all', 'POST', {}, 403);
    });

    await suite.test('已有WebSocket在会话被注销后主动断开', async () => {
      const socket = socketFor(student);
      try {
        const ready = socketEvent(socket, 'ready');
        socket.connect();
        await ready;
        const disconnected = socketEvent(socket, 'disconnect', 20000);
        await request(student, '/auth/logout', 'POST', {}, 201);
        await disconnected;
      } finally {
        socket.disconnect();
      }
    });
  } finally {
    await request(admin, `/courses/${course.id}`, 'PATCH', { status: 'ARCHIVED' }).catch(() => undefined);
    for (const id of created)
      await request(admin, `/admin/users/${id}`, 'PATCH', { active: false }).catch(() => undefined);
  }
});
