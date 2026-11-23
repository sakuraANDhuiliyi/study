import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture, liveWait } from './live.fixture';
import { MobileClient, MobileApiError } from '../apps/mobile/src/client';
import {
  communicationFilesApi,
  type CommunicationFile,
  type CommunicationFileScope,
} from '../apps/mobile/src/communication-files-model';
import { discussionsApi, type DiscussionDetail } from '../apps/mobile/src/discussions-model';
import { messagesApi, prepareMessage, type MessagePage } from '../apps/mobile/src/messages-model';

test(
  'native communication attachments retain private upload, publication, ownership and current-session checks',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string, fetcher: typeof fetch = fetch) => {
      let saved: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => saved,
          set: async (v) => {
            saved = v;
          },
          remove: async () => {
            saved = null;
          },
        },
        () => {},
        fetcher,
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number) =>
      assert.rejects(p, (e) => e instanceof MobileApiError && e.status === status);
    const path = (s: CommunicationFileScope) =>
      s.kind === 'course'
        ? '/mobile/discussions/courses/' + s.id + '/files'
        : '/mobile/messages/conversations/' + s.id + '/files';
    const bytes = new TextEncoder().encode('原生通信附件\n');
    const form = (extra?: [string, string]) => {
      const body = new FormData();
      body.append('file', new Blob([bytes], { type: 'text/plain' }), 'learning.txt');
      if (extra) body.append(...extra);
      return body;
    };
    const upload = (c: MobileClient, s: CommunicationFileScope, b = form()) =>
      c.request<CommunicationFile>(path(s), b, 'POST', { multipart: true });
    try {
      const student = await mobile(f.users.student.username),
        student2 = await mobile(f.users.student2.username),
        teacher = await mobile(f.users.teacher.username),
        outsider = await mobile(f.users.outsider.username);
      const course: CommunicationFileScope = { kind: 'course', id: f.course.id },
        direct = await messagesApi.direct(student, f.users.teacher.id),
        conversation: CommunicationFileScope = { kind: 'conversation', id: direct.id };
      let postFile: CommunicationFile,
        replyFile: CommunicationFile,
        messageFile: CommunicationFile,
        postId: string,
        replyId: string,
        messageId: string;
      await t.test(
        'native multipart whitelist and file inspection reject forged scope and keep browser CSRF separate',
        async () => {
          await f.call(f.clients.student, path(course), 'GET', undefined, 403);
          await denied(upload(teacher, course), 403);
          await denied(upload(student, course, form(['courseId', f.foreign.id])), 400);
          const bad = new FormData();
          bad.append('file', new Blob(['<html>not an image</html>'], { type: 'image/png' }), 'fake.png');
          await denied(upload(student, course, bad), 400);
          await denied(upload(outsider, course), 404);
          assert.equal(await f.db.attachment.count(), 0);
          const settings = await f.db.systemSetting.upsert({
            where: { organizationId_key: { organizationId: f.organization.id, key: 'allowedFileTypes' } },
            create: { organizationId: f.organization.id, key: 'allowedFileTypes', value: ['png'] },
            update: { value: ['png'] },
          });
          await denied(upload(student, course), 403);
          await f.db.systemSetting.delete({ where: { id: settings.id } });
        },
      );
      await t.test(
        'student upload is private until topic publication; owner-only list and attachment-bound idempotency are exact',
        async () => {
          postFile = await upload(student, course);
          assert.deepEqual(Object.keys(postFile).sort(), ['id', 'name', 'mime', 'size'].sort());
          assert.equal(postFile.size, bytes.length);
          const list = await communicationFilesApi.list(student, course);
          assert.equal(list.items.length, 1);
          assert.equal(list.items[0].id, postFile.id);
          assert.ok(list.maxUploadBytes > 0);
          assert.equal((await communicationFilesApi.list(student2, course)).items.length, 0);
          const input = {
            kind: 'post' as const,
            input: {
              courseId: f.course.id,
              title: '附件话题',
              body: '公开课程附件',
              key: 'topic_with_file_001',
              attachmentIds: [postFile.id],
            },
          };
          await denied(discussionsApi.publish(student2, input), 403);
          const receipt = await discussionsApi.publish(student, input);
          postId = receipt.postId;
          assert.equal((await discussionsApi.publish(student, input)).id, receipt.id);
          await denied(
            discussionsApi.publish(student, { ...input, input: { ...input.input, attachmentIds: [] } }),
            409,
          );
          const detail = await student2.request<DiscussionDetail>('/mobile/discussions/' + postId);
          assert.deepEqual(detail.attachments, [postFile]);
          assert.deepEqual(
            await student2.request<Uint8Array>(
              '/mobile/discussions/' + postId + '/files/' + postFile.id,
              undefined,
              'GET',
              { binary: true },
            ),
            bytes,
          );
          await denied(communicationFilesApi.remove(student, course, postFile.id), 409);
          await denied(communicationFilesApi.remove(student2, course, postFile.id), 404);
          await denied(outsider.request('/mobile/discussions/' + postId + '/files/' + postFile.id), 404);
        },
      );
      await t.test(
        'reply attachment visibility follows both parent and reply; unpublished and hidden files cannot download',
        async () => {
          replyFile = await upload(student2, course);
          await denied(student.request('/mobile/discussions/' + postId + '/files/' + replyFile.id), 404);
          const r = await discussionsApi.publish(student2, {
            kind: 'reply',
            postId,
            input: { body: '回复附件', key: 'reply_with_file_001', attachmentIds: [replyFile.id] },
          });
          replyId = r.id;
          assert.deepEqual(
            (await student.request<DiscussionDetail>('/mobile/discussions/' + postId)).replies[0].attachments,
            [replyFile],
          );
          await f.db.discussionReply.update({ where: { id: replyId }, data: { hidden: true } });
          await denied(student2.request('/mobile/discussions/' + postId + '/files/' + replyFile.id), 404);
          await f.db.discussionReply.update({ where: { id: replyId }, data: { hidden: false } });
          await f.db.discussionPost.update({ where: { id: postId }, data: { hidden: true } });
          await denied(student.request('/mobile/discussions/' + postId + '/files/' + postFile.id), 404);
          await f.db.discussionPost.update({ where: { id: postId }, data: { hidden: false, closed: true } });
          await denied(
            discussionsApi.publish(student2, {
              kind: 'reply',
              postId,
              input: { body: '关闭后回复', key: 'reply_after_closed', attachmentIds: [replyFile.id] },
            }),
            409,
          );
        },
      );
      await t.test(
        'message upload/publish/download keeps private counterpart and attachment owner scope; hidden/retracted files disappear',
        async () => {
          messageFile = await upload(teacher, conversation);
          assert.equal((await communicationFilesApi.list(student, conversation)).items.length, 0);
          await denied(messagesApi.file(student, direct.id, messageFile.id), 404);
          await denied(
            messagesApi.send(
              student,
              prepareMessage(direct.id, '盗用附件', 'stolen_message_file', [messageFile.id]),
            ),
            403,
          );
          await denied(
            messagesApi.send(
              student,
              prepareMessage(direct.id, '跨范围', 'wrong_scope_message', [postFile.id]),
            ),
            403,
          );
          const attempt = prepareMessage(direct.id, '教师原生附件', 'message_with_file_001', [
            messageFile.id,
          ]);
          const receipt = await messagesApi.send(teacher, attempt);
          messageId = receipt.id;
          assert.equal((await messagesApi.send(teacher, attempt)).id, messageId);
          assert.equal(
            (await student.request<MessagePage>('/mobile/messages/conversations/' + direct.id + '/messages'))
              .items[0].attachments[0].id,
            messageFile.id,
          );
          assert.deepEqual(await messagesApi.file(student, direct.id, messageFile.id), bytes);
          await denied(messagesApi.file(student2, direct.id, messageFile.id), 403);
          await denied(communicationFilesApi.remove(teacher, conversation, messageFile.id), 409);
          await f.db.message.update({ where: { id: messageId }, data: { hidden: true } });
          await denied(messagesApi.file(teacher, direct.id, messageFile.id), 404);
          await f.db.message.update({ where: { id: messageId }, data: { hidden: false } });
          await messagesApi.retract(teacher, messageId);
          await denied(messagesApi.file(student, direct.id, messageFile.id), 404);
        },
      );
      await t.test(
        'lost upload acknowledgement is recoverable from an explicit private list with no automatic retransmission',
        async () => {
          let lost = true;
          const uncertain = await mobile(f.users.student.username, async (url, options) => {
            const r = await fetch(url, options);
            if (lost && options?.method === 'POST' && String(url).endsWith(path(conversation)) && r.ok) {
              lost = false;
              await r.arrayBuffer();
              throw new Error('response lost');
            }
            return r;
          });
          const before = await f.db.attachment.count({
            where: { ownerId: f.users.student.id, conversationId: direct.id },
          });
          await denied(upload(uncertain, conversation), 0);
          const rows = await communicationFilesApi.list(uncertain, conversation);
          assert.equal(rows.items.length, before + 1);
          assert.equal(rows.items[0].name, 'learning.txt');
          assert.equal(
            await f.db.attachment.count({
              where: { ownerId: f.users.student.id, conversationId: direct.id },
            }),
            before + 1,
          );
          await communicationFilesApi.remove(uncertain, conversation, rows.items[0].id);
          assert.equal(await f.db.attachment.count({ where: { id: rows.items[0].id } }), 0);
        },
      );
      await t.test(
        'queueing an upload cannot survive credential revocation before its transaction commits',
        async () => {
          const current = await mobile(f.users.student.username);
          let unlock!: () => void, locked!: () => void;
          const ready = new Promise<void>((r) => (locked = r)),
            release = new Promise<void>((r) => (unlock = r));
          const holding = f.db.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${f.users.student.id} FOR NO KEY UPDATE`;
              locked();
              await release;
              await tx.user.update({
                where: { id: f.users.student.id },
                data: { authVersion: { increment: 1 } },
              });
            },
            { timeout: 20000 },
          );
          await ready;
          const before = await f.db.attachment.count({
            where: { ownerId: f.users.student.id, conversationId: direct.id },
          });
          const pending = upload(current, conversation);
          const checked = denied(pending, 403);
          let observedStoredLease = false;
          try {
            for (let i = 0; i < 60; i++) {
              const lease = await f.db.uploadOperation.findFirst({
                where: { ownerId: f.users.student.id, status: 'pending' },
              });
              if (lease && existsSync(join(f.env.UPLOAD_DIR, lease.storageKey))) {
                observedStoredLease = true;
                break;
              }
              await liveWait(20);
            }
          } finally {
            unlock();
          }
          await holding;
          await checked;
          assert.ok(
            observedStoredLease,
            'Upload must write its private object before waiting at the commit identity lock',
          );
          assert.equal(
            await f.db.attachment.count({
              where: { ownerId: f.users.student.id, conversationId: direct.id },
            }),
            before,
          );
          assert.equal(
            await f.db.uploadOperation.count({ where: { ownerId: f.users.student.id, status: 'pending' } }),
            0,
          );
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
