import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createLiveFixture } from './live.fixture';
import { MobileClient } from '../apps/mobile/src/client';
test(
  'native lesson media ranges preserve exact enrollment, file and mobile session scope',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const login = async (username: string) => {
      let raw: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => raw,
          set: async (v) => {
            raw = v;
          },
          remove: async () => {
            raw = null;
          },
        },
        () => {},
      );
      await c.login(username, f.password);
      return c;
    };
    try {
      const student = await login(f.users.student.username),
        outsider = await login(f.users.outsider.username),
        teacher = await login(f.users.teacher.username),
        chapter = await f.db.chapter.create({ data: { courseId: f.course.id, title: '原生媒体章节' } }),
        lesson = await f.db.lesson.create({
          data: { courseId: f.course.id, chapterId: chapter.id, title: '原生长视频', type: 'VIDEO' },
        }),
        bytes = await readFile('tests/fixtures/mobile-course.mp4');
      const form = new FormData();
      form.append('courseId', f.course.id);
      form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'course.mp4');
      const uploaded = await fetch(f.origin + '/api/attachments', {
        method: 'POST',
        headers: {
          cookie: f.clients.teacher.cookie,
          'x-csrf-token': f.clients.teacher.csrf,
          origin: f.origin,
        },
        body: form,
      });
      assert.equal(uploaded.status, 201);
      const file = (await uploaded.json()) as { id: string };
      await f.db.lesson.update({ where: { id: lesson.id }, data: { attachmentId: file.id } });
      let source: Awaited<ReturnType<MobileClient['lessonVideoSource']>>;
      await t.test(
        'private player gets only same-platform source after actual current attachment access',
        async () => {
          source = await student.lessonVideoSource(lesson.id, file.id);
          assert.equal(source.uri, f.origin + '/api/mobile/lessons/' + lesson.id + '/media/' + file.id);
          assert.equal(source.useCaching, false);
          assert.equal(new URL(source.uri).search, '');
          await assert.rejects(outsider.lessonVideoSource(lesson.id, file.id));
          await assert.rejects(teacher.lessonVideoSource(lesson.id, file.id));
          await assert.rejects(student.lessonVideoSource(lesson.id, 'unrelated'));
          assert.equal((await fetch(source.uri)).status, 401);
          await f.call(
            f.clients.student,
            '/mobile/lessons/' + lesson.id + '/media/' + file.id,
            'GET',
            undefined,
            403,
          );
        },
      );
      await t.test(
        'actual partial bytes, suffix, HEAD and invalid range use the controlled MP4 endpoint',
        async () => {
          const response = await fetch(source.uri, { headers: { ...source.headers, Range: 'bytes=16-31' } });
          assert.equal(response.status, 206);
          assert.equal(response.headers.get('content-range'), `bytes 16-31/${bytes.length}`);
          assert.equal(response.headers.get('content-length'), '16');
          assert.equal(response.headers.get('accept-ranges'), 'bytes');
          assert.equal(response.headers.get('cache-control'), 'private, no-store');
          assert.equal(response.headers.get('location'), null);
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(16, 32));
          const suffix = await fetch(source.uri, { headers: { ...source.headers, Range: 'bytes=-8' } });
          assert.equal(suffix.status, 206);
          assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-8));
          const head = await fetch(source.uri, { method: 'HEAD', headers: source.headers });
          assert.equal(head.status, 200);
          assert.equal(head.headers.get('content-length'), String(bytes.length));
          assert.equal((await head.arrayBuffer()).byteLength, 0);
          for (const range of ['bytes=999999999-', 'bytes=0-2,4-8', 'bytes=-0']) {
            const invalid = await fetch(source.uri, { headers: { ...source.headers, Range: range } });
            assert.equal(invalid.status, 416);
            assert.equal(invalid.headers.get('content-range'), `bytes */${bytes.length}`);
          }
        },
      );
      await t.test(
        'authorized long video streams a small requested range without raising the complete-download limit',
        async () => {
          const metadata = await f.db.attachment.findUniqueOrThrow({ where: { id: file.id } }),
            size = 51 * 1024 * 1024,
            handle = await open(join(f.env.UPLOAD_DIR, metadata.storageKey), 'r+');
          try {
            await handle.truncate(size);
            await f.db.attachment.update({ where: { id: file.id }, data: { size } });
            const ranged = await fetch(source.uri, { headers: { ...source.headers, Range: 'bytes=0-31' } });
            assert.equal(ranged.status, 206);
            assert.equal(ranged.headers.get('content-range'), `bytes 0-31/${size}`);
            assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(0, 32));
            await assert.rejects(
              student.download('/mobile/lessons/' + lesson.id + '/files/' + file.id),
              (e) => (e as { status: number }).status === 400,
            );
          } finally {
            await handle.truncate(bytes.length);
            await handle.close();
            await f.db.attachment.update({ where: { id: file.id }, data: { size: bytes.length } });
          }
        },
      );
      await t.test(
        'future release, withdrawn enrollment, replaced attachment and revoked mobile credential stop new ranges',
        async () => {
          const read = () => fetch(source.uri, { headers: { ...source.headers, Range: 'bytes=0-15' } });
          await f.db.lesson.update({
            where: { id: lesson.id },
            data: { opensAt: new Date(Date.now() + 60000) },
          });
          assert.equal((await read()).status, 403);
          await f.db.lesson.update({ where: { id: lesson.id }, data: { opensAt: null, attachmentId: null } });
          assert.equal((await read()).status, 404);
          await f.db.lesson.update({ where: { id: lesson.id }, data: { attachmentId: file.id } });
          await f.db.enrollment.updateMany({
            where: { userId: f.users.student.id, courseId: f.course.id },
            data: { active: false },
          });
          const withdrawn = await read();
          assert.equal(withdrawn.status, 403);
          assert.equal(withdrawn.headers.get('content-range'), null);
          assert.match(withdrawn.headers.get('content-type') || '', /application\/json/);
          assert.equal((await withdrawn.json()).message, '当前没有此课程的访问资格');
          await f.db.enrollment.updateMany({
            where: { userId: f.users.student.id, courseId: f.course.id },
            data: { active: true },
          });
          const session = await f.db.session.findFirstOrThrow({
            where: { userId: f.users.student.id, clientType: 'MOBILE' },
            orderBy: { createdAt: 'desc' },
          });
          await f.db.mobileCredential.delete({ where: { sessionId: session.id } });
          assert.equal((await read()).status, 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
