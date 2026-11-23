import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture } from './live.fixture';
import { MobileClient, MobileApiError } from '../apps/mobile/src/client';
import {
  messagesApi,
  prepareMessage,
  type Conversation,
  type MessagePage,
  type MessageReceipt,
} from '../apps/mobile/src/messages-model';

test(
  'native communication: real contacts, shared messages, explicit reads and scoped private files',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string) => {
      let saved: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => saved,
          set: async (value) => {
            saved = value;
          },
          remove: async () => {
            saved = null;
          },
        },
        () => {},
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = (promise: Promise<unknown>, status: number) =>
      assert.rejects(promise, (e) => e instanceof MobileApiError && e.status === status);
    try {
      const student = await mobile(f.users.student.username),
        teacher = await mobile(f.users.teacher.username),
        student2 = await mobile(f.users.student2.username),
        outsider = await mobile(f.users.outsider.username),
        admin = await mobile(f.users.admin.username);
      let direct: Conversation, classRoom: Conversation, sent: MessageReceipt;
      const root = '/mobile/messages';
      const listing = (client: MobileClient) =>
        client.request<{ items: Conversation[]; total: number }>(root + '/conversations');
      const read = (client: MobileClient, id: string, q = '') =>
        client.request<MessagePage>(root + '/conversations/' + id + '/messages' + q);
      const classroom = await f.db.class.create({
        data: { organizationId: f.organization.id, name: '原生交流班', grade: '一年级' },
      });
      await f.db.courseClass.create({
        data: { courseId: f.course.id, classId: classroom.id, name: classroom.name },
      });
      await f.db.classMember.create({ data: { classId: classroom.id, userId: f.users.student.id } });

      await t.test(
        'native-only strict routes retain browser CSRF and reject authority/query injection',
        async () => {
          assert.equal((await fetch(f.origin + '/api' + root + '/contacts')).status, 401);
          await f.call(f.clients.student, root + '/contacts', 'GET', undefined, 403);
          await denied(student.request('/communication/contacts'), 403);
          for (const query of ['?page=0', '?page=true', '?page=1&page=2', '?pageSize=51', '?userId=other'])
            await denied(student.request(root + '/contacts' + query), 400);
          await denied(
            student.request(
              root + '/conversations',
              { userId: f.users.teacher.id, organizationId: f.foreign.id },
              'POST',
            ),
            400,
          );
          await f.call(
            f.clients.student,
            '/communication/conversations',
            'POST',
            { userId: f.users.teacher.id },
            403,
            false,
          );
        },
      );
      await t.test(
        'contacts are actual current course counterparts; administrators never browse private conversations',
        async () => {
          const peers = await student.request<{
            items: { id: string; courseNames: string[] }[];
            total: number;
          }>(root + '/contacts');
          assert.deepEqual(
            peers.items.map((p) => p.id),
            [f.users.teacher.id],
          );
          assert.deepEqual(peers.items[0].courseNames, [f.course.title]);
          const pupils = await teacher.request<{ items: { id: string }[] }>(root + '/contacts');
          assert.deepEqual(
            pupils.items.map((p) => p.id).sort(),
            [f.users.student.id, f.users.student2.id, f.users.student3.id].sort(),
          );
          assert.deepEqual((await admin.request<{ items: unknown[] }>(root + '/contacts')).items, []);
          assert.deepEqual((await outsider.request<{ items: unknown[] }>(root + '/contacts')).items, []);
          await denied(messagesApi.direct(student, f.users.student2.id), 403);
          await denied(messagesApi.direct(student, f.users.outsider.id), 403);
          direct = await messagesApi.direct(student, f.users.teacher.id);
          assert.equal((await messagesApi.direct(teacher, f.users.student.id)).id, direct.id);
          await denied(read(admin, direct.id), 403);
          await denied(read(student2, direct.id), 403);
          await denied(read(outsider, direct.id), 404);
        },
      );
      await t.test(
        'same clientId sends exactly once, changed content conflicts, and receipts never reveal hidden raw content',
        async () => {
          const attempt = prepareMessage(
            direct.id,
            '第一条原生消息 <script>literal</script>',
            'native_msg_key_001',
          );
          const [first, replay] = await Promise.all([
            messagesApi.send(student, attempt),
            messagesApi.send(student, attempt),
          ]);
          sent = first;
          assert.equal(replay.id, first.id);
          assert.equal(
            await f.db.message.count({ where: { conversationId: direct.id, clientId: attempt.clientId } }),
            1,
          );
          assert.deepEqual(
            Object.keys(first).sort(),
            ['id', 'conversationId', 'clientId', 'createdAt'].sort(),
          );
          await denied(messagesApi.send(student, { ...attempt, body: '不一致正文' }), 409);
          await denied(
            student.request(
              root + '/conversations/' + direct.id + '/messages',
              { ...attempt, senderId: f.users.teacher.id },
              'POST',
            ),
            400,
          );
          await f.db.message.update({ where: { id: first.id }, data: { hidden: true } });
          const hiddenReplay = await messagesApi.send(student, attempt);
          assert.equal(hiddenReplay.id, first.id);
          assert.equal('body' in hiddenReplay, false);
          assert.equal((await read(teacher, direct.id)).items[0].body, '[内容已隐藏]');
          await f.db.message.update({ where: { id: first.id }, data: { hidden: false } });
        },
      );
      await t.test(
        'reading never marks messages read; explicit cursors are monotonic and bound to the conversation',
        async () => {
          const before = await listing(teacher);
          assert.equal(before.items.find((c) => c.id === direct.id)?.unreadCount, 1);
          await read(teacher, direct.id);
          assert.equal(
            await f.db.messageReadCursor.count({
              where: { conversationId: direct.id, userId: f.users.teacher.id },
            }),
            0,
          );
          const reply = await messagesApi.send(
            teacher,
            prepareMessage(direct.id, '教师回复', 'native_reply_key_001'),
          );
          await messagesApi.read(teacher, direct.id, reply.id);
          await messagesApi.read(teacher, direct.id, sent.id);
          const cursor = await f.db.messageReadCursor.findUniqueOrThrow({
            where: { conversationId_userId: { conversationId: direct.id, userId: f.users.teacher.id } },
          });
          assert.equal(cursor.messageId, reply.id);
          assert.equal((await listing(teacher)).items.find((c) => c.id === direct.id)?.unreadCount, 0);
          const after = await read(student, direct.id, '?afterId=' + sent.id + '&pageSize=1');
          assert.deepEqual(
            after.items.map((m) => m.id),
            [reply.id],
          );
          await denied(messagesApi.read(student, direct.id, 'unknown-message'), 400);
          await denied(read(student, direct.id, '?afterId=unknown-message'), 400);
        },
      );
      await t.test('class conversations re-evaluate membership and current teaching scope', async () => {
        const classes = await student.request<{ items: { id: string }[] }>(root + '/classes');
        assert.deepEqual(
          classes.items.map((c) => c.id),
          [classroom.id],
        );
        classRoom = await messagesApi.classroom(student, classroom.id);
        assert.equal((await messagesApi.classroom(teacher, classroom.id)).id, classRoom.id);
        await denied(messagesApi.classroom(student2, classroom.id), 403);
        await denied(messagesApi.classroom(outsider, classroom.id), 404);
        const classMessage = await messagesApi.send(
          teacher,
          prepareMessage(classRoom.id, '班级学习提醒', 'native_class_key_001'),
        );
        assert.equal((await read(student, classRoom.id)).items[0].id, classMessage.id);
        await denied(messagesApi.read(student, direct.id, classMessage.id), 400);
        await f.db.classMember.update({
          where: { classId_userId: { classId: classroom.id, userId: f.users.student.id } },
          data: { active: false },
        });
        await denied(read(student, classRoom.id), 403);
        assert.equal(
          (await listing(student)).items.some((c) => c.id === classRoom.id),
          false,
        );
        await f.db.classMember.update({
          where: { classId_userId: { classId: classroom.id, userId: f.users.student.id } },
          data: { active: true },
        });
      });
      await t.test(
        'published private attachments download with authorization, disappear when hidden, and reports preserve private scope',
        async () => {
          const bytes = new TextEncoder().encode('独立私信附件\n');
          const form = new FormData();
          form.append('conversationId', direct.id);
          form.append('file', new Blob([bytes], { type: 'text/plain' }), 'message.txt');
          const response = await fetch(f.origin + '/api/attachments', {
            method: 'POST',
            headers: {
              origin: f.origin,
              cookie: f.clients.teacher.cookie,
              'x-csrf-token': f.clients.teacher.csrf,
            },
            body: form,
            signal: AbortSignal.timeout(15000),
          });
          assert.equal(response.status, 201, 'Shared authorized upload must succeed');
          const file = (await response.json()) as { id: string };
          await denied(messagesApi.file(student, direct.id, file.id), 404);
          const posted = (
            await f.call(
              f.clients.teacher,
              '/communication/conversations/' + direct.id + '/messages',
              'POST',
              { body: '附件消息', attachmentIds: [file.id], clientId: 'native_web_file_001' },
            )
          ).body;
          const list = await read(student, direct.id);
          const metadata = list.items.find((m) => m.id === posted.id)?.attachments[0];
          assert.equal(metadata?.id, file.id);
          assert.deepEqual(Object.keys(metadata!).sort(), ['id', 'name', 'mime', 'size'].sort());
          assert.deepEqual(await messagesApi.file(student, direct.id, file.id), bytes);
          await denied(messagesApi.file(student2, direct.id, file.id), 403);
          await denied(messagesApi.file(student, classRoom.id, file.id), 404);
          const report = await messagesApi.report(
            student,
            { targetType: 'message', targetId: posted.id },
            '需要管理人员复核',
          );
          const stored = await f.db.contentReport.findUniqueOrThrow({ where: { id: report.id } });
          assert.equal(stored.isPrivate, true);
          assert.equal(stored.reporterId, f.users.student.id);
          await denied(
            messagesApi.report(student2, { targetType: 'message', targetId: posted.id }, '未授权举报'),
            403,
          );
          await f.db.message.update({ where: { id: posted.id }, data: { hidden: true } });
          assert.deepEqual(
            (await read(student, direct.id)).items.find((m) => m.id === posted.id)?.attachments,
            [],
          );
          await denied(messagesApi.file(student, direct.id, file.id), 404);
          const topic = (
            await f.call(f.clients.teacher, '/communication/posts', 'POST', {
              courseId: f.course.id,
              title: '举报验收话题',
              body: '讨论正文',
            })
          ).body;
          const reported = await messagesApi.report(
            student,
            { targetType: 'post', targetId: topic.id },
            '内容需要复核',
          );
          assert.equal(
            (await f.db.contentReport.findUniqueOrThrow({ where: { id: reported.id } })).courseId,
            f.course.id,
          );
          await denied(messagesApi.retract(student, posted.id), 403);
          await messagesApi.retract(student, sent.id);
          assert.equal(
            (await read(teacher, direct.id)).items.find((m) => m.id === sent.id)?.body,
            '[消息已撤回]',
          );
        },
      );
      await t.test(
        'blocks, mutes, lost enrollment, communication switch and role permissions remain effective',
        async () => {
          const attempt = prepareMessage(direct.id, '不应发布', 'refused_native_key');
          const before = await f.db.message.count();
          const block = await f.db.communicationBlock.create({
            data: {
              organizationId: f.organization.id,
              userId: f.users.teacher.id,
              blockedUserId: f.users.student.id,
            },
          });
          await denied(messagesApi.send(student, attempt), 403);
          await f.db.communicationBlock.delete({ where: { id: block.id } });
          const mute = await f.db.communicationMute.create({
            data: {
              organizationId: f.organization.id,
              userId: f.users.student.id,
              expiresAt: new Date(Date.now() + 60000),
              createdBy: f.users.admin.id,
              reason: '验收禁言',
            },
          });
          await denied(messagesApi.send(student, attempt), 403);
          await f.db.communicationMute.delete({ where: { id: mute.id } });
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
            data: { active: false },
          });
          await denied(read(student, direct.id), 403);
          assert.equal((await student.request<{ total: number }>(root + '/contacts')).total, 0);
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
            data: { active: true },
          });
          await f.db.systemSetting.upsert({
            where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
            create: { organizationId: f.organization.id, key: 'features', value: { communication: false } },
            update: { value: { communication: false } },
          });
          for (const path of ['/contacts', '/classes', '/conversations'])
            await denied(student.request(root + path), 403);
          await denied(messagesApi.send(student, attempt), 403);
          await f.db.systemSetting.deleteMany({
            where: { organizationId: f.organization.id, key: 'features' },
          });
          await f.db.rolePermission.delete({
            where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'communication.write' } },
          });
          await denied(messagesApi.send(student, attempt), 403);
          assert.equal((await read(student, direct.id)).total > 0, true);
          await f.db.rolePermission.create({
            data: { roleId: 'STUDENT', permissionId: 'communication.write' },
          });
          assert.equal(await f.db.message.count(), before);
          await f.db.session.deleteMany({ where: { userId: f.users.student.id, clientType: 'MOBILE' } });
          await denied(read(student, direct.id), 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
