import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createLiveFixture, liveWait } from './live.fixture';
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { saveLessonProgress } from '../apps/api/src/courses/lesson-progress';
import { attachLogin } from './live-browser.fixture';
test(
  'native course resources and cross-device learning progress respect current scope and versions',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const chapter = await f.db.chapter.create({
      data: { courseId: f.course.id, title: 'Native course chapter' },
    });
    const lesson = await f.db.lesson.create({
      data: { courseId: f.course.id, chapterId: chapter.id, title: 'Native course video', type: 'VIDEO' },
    });
    const path = '/mobile/lessons/' + lesson.id;
    const login = async (username: string) => {
      const r = await fetch(f.origin + '/api/mobile/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: f.password, deviceName: 'course review' }),
      });
      assert.equal(r.status, 201);
      return (await r.json()).accessToken as string;
    };
    const call = async (p: string, token?: string, method = 'GET', body?: unknown) => {
      const r = await fetch(f.origin + '/api' + p, {
        method,
        headers: {
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    let native: string, other: string, foreign: string, teacher: string, file: any;
    try {
      native = await login(f.users.student.username);
      other = await login(f.users.student2.username);
      foreign = await login(f.users.outsider.username);
      teacher = await login(f.users.teacher.username);
      await t.test('only enrolled student mobile sessions access released lesson details', async () => {
        assert.equal((await call(path)).status, 401);
        assert.equal((await call(path, foreign)).status, 404);
        assert.equal((await call(path, teacher)).status, 403);
        assert.equal((await call(path, native)).status, 200);
        assert.equal((await f.call(f.clients.student, path, 'GET', undefined, 403)).status, 403);
        await f.db.lesson.update({
          where: { id: lesson.id },
          data: { opensAt: new Date(Date.now() + 60000) },
        });
        assert.equal((await call(path, native)).status, 403);
        await f.db.lesson.update({ where: { id: lesson.id }, data: { opensAt: null } });
      });
      await t.test(
        'private video bytes require an exact lesson reference; arbitrary and unreferenced files stay private',
        async () => {
          const video = readFileSync('tests/fixtures/mobile-course.mp4');
          const form = new FormData();
          form.append('courseId', f.course.id);
          form.append('file', new Blob([video], { type: 'video/mp4' }), 'course.mp4');
          const r = await fetch(f.origin + '/api/attachments', {
            method: 'POST',
            headers: {
              cookie: f.clients.teacher.cookie,
              'x-csrf-token': f.clients.teacher.csrf,
              origin: f.origin,
            },
            body: form,
          });
          assert.equal(r.status, 201);
          file = await r.json();
          assert.equal((await call(path + '/files/' + file.id, native)).status, 404);
          await f.db.lesson.update({ where: { id: lesson.id }, data: { attachmentId: file.id } });
          const detail = await call(path, native);
          assert.equal(detail.body.files[0].name, 'course.mp4');
          assert.ok(!JSON.stringify(detail.body).includes('storageKey'));
          const download = await fetch(f.origin + '/api' + path + '/files/' + file.id, {
            headers: { authorization: 'Bearer ' + native },
          });
          assert.equal(download.status, 200);
          assert.equal(download.headers.get('cache-control'), 'private, no-store');
          assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
          assert.equal(
            createHash('sha256')
              .update(new Uint8Array(await download.arrayBuffer()))
              .digest('hex'),
            createHash('sha256').update(video).digest('hex'),
          );
          assert.equal((await call('/attachments/' + file.id + '/preview', native)).status, 403);
          await f.db.attachment.update({ where: { id: file.id }, data: { size: 50 * 1024 * 1024 + 1 } });
          assert.equal((await call(path + '/files/' + file.id, native)).status, 400);
          await f.db.attachment.update({ where: { id: file.id }, data: { size: video.length } });
        },
      );
      await t.test(
        'authorized MP4 byte ranges permit browser seeking without exposing private files',
        async () => {
          const bytes = readFileSync('tests/fixtures/mobile-course.mp4');
          const headers = { cookie: f.clients.student.cookie, range: 'bytes=16-31' };
          const r = await fetch(f.origin + '/api/attachments/' + file.id + '/preview', { headers });
          assert.equal(r.status, 206);
          assert.equal(r.headers.get('accept-ranges'), 'bytes');
          assert.equal(r.headers.get('content-range'), `bytes 16-31/${bytes.length}`);
          assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes.subarray(16, 32));
          const invalid = await fetch(f.origin + '/api/attachments/' + file.id + '/preview', {
            headers: { ...headers, range: 'bytes=999999999-' },
          });
          assert.equal(invalid.status, 416);
          assert.equal(
            (
              await fetch(f.origin + '/api/attachments/' + file.id + '/preview', {
                headers: { range: 'bytes=0-1' },
              })
            ).status,
            401,
          );
        },
      );
      await t.test(
        'simultaneous native/web saves cannot overwrite; positions and completion remain per-user',
        async () => {
          assert.equal(
            (await call(path + '/progress', native, 'PUT', { completed: false, positionSeconds: 3 })).status,
            400,
          );
          const results = await Promise.all([
            call(path + '/progress', native, 'PUT', {
              completed: false,
              positionSeconds: 12,
              expectedUpdatedAt: null,
            }),
            f.call(
              f.clients.student,
              '/lessons/' + lesson.id + '/progress',
              'PUT',
              { completed: true, positionSeconds: 20, expectedUpdatedAt: null },
              [200, 409],
            ),
          ]);
          assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
          const latest = (await call(path, native)).body.progress;
          assert.equal((await call(path, other)).body.progress, null);
          assert.equal(
            (
              await call(path + '/progress', native, 'PUT', {
                completed: true,
                positionSeconds: 30,
                expectedUpdatedAt: latest.updatedAt,
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await call(path + '/progress', native, 'PUT', {
                completed: false,
                positionSeconds: 0,
                expectedUpdatedAt: latest.updatedAt,
              })
            ).status,
            409,
          );
        },
      );
      await t.test(
        'progress validation uses the transaction connection even with a single-connection pool',
        async () => {
          const url = new URL(f.env.DATABASE_URL);
          url.searchParams.set('connection_limit', '1');
          url.searchParams.set('pool_timeout', '2');
          const single = new PrismaService({ datasourceUrl: url.href });
          try {
            const auth = new AuthService(single);
            const actor = await auth.resolveMobileAccess(native);
            assert.ok(actor);
            const before = await single.learningProgress.findUniqueOrThrow({
              where: { userId_lessonId: { userId: actor.id, lessonId: lesson.id } },
            });
            const result = await saveLessonProgress(single, actor, lesson.id, {
              completed: true,
              positionSeconds: 30,
              expectedUpdatedAt: before.updatedAt.toISOString(),
            });
            assert.equal(result.positionSeconds, 30);
            assert.ok(result.updatedAt > before.updatedAt);
          } finally {
            await single.$disconnect();
          }
        },
      );
      await t.test('website displays native position and rejects stale completion updates', async () => {
        const browser = await chromium.launch({
          headless: true,
          // MP4 acceptance needs the licensed H.264 decoder in stock Chrome.
          channel: 'chrome',
        });
        try {
          const context = await browser.newContext();
          await attachLogin(context, f.clients.student, f.origin);
          const page = await context.newPage();
          await page.goto(f.origin + '/courses/' + f.course.id + '?lesson=' + lesson.id);
          await expect(page.locator('video')).toBeVisible();
          await expect
            .poll(() =>
              page.locator('video').evaluate((v) => Math.floor((v as HTMLVideoElement).currentTime)),
            )
            .toBe(30);
          const p = (await call(path, native)).body.progress;
          assert.equal(
            (
              await call(path + '/progress', native, 'PUT', {
                completed: true,
                positionSeconds: 35,
                expectedUpdatedAt: p.updatedAt,
              })
            ).status,
            200,
          );
          await page.getByRole('button', { name: '取消完成标记', exact: true }).click();
          await expect(
            page.getByText('学习进度已在其他设备更新，请重新加载后继续。', { exact: true }),
          ).toBeVisible();
          assert.equal((await call(path, native)).body.progress.positionSeconds, 35);
        } finally {
          await browser.close();
        }
      });
      await t.test(
        'scope and session revoked while waiting for the progress lock are rechecked before writing',
        async () => {
          const latest = (await call(path, native)).body.progress;
          let release!: () => void, locked!: () => void;
          const go = new Promise<void>((r) => (release = r)),
            acquired = new Promise<void>((r) => (locked = r));
          const lock = f.db.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'lesson-progress:' + f.users.student.id + ':' + lesson.id},0))`;
              locked();
              await go;
            },
            { timeout: 20000 },
          );
          await acquired;
          const write = call(path + '/progress', native, 'PUT', {
            completed: false,
            positionSeconds: 1,
            expectedUpdatedAt: latest.updatedAt,
          });
          await liveWait(150);
          await f.db.enrollment.updateMany({
            where: { courseId: f.course.id, userId: f.users.student.id },
            data: { active: false },
          });
          release();
          await lock;
          assert.equal((await write).status, 403);
          assert.equal((await call(path + '/files/' + file.id, native)).status, 403);
          await f.db.enrollment.updateMany({
            where: { courseId: f.course.id, userId: f.users.student.id },
            data: { active: true },
          });
          await f.db.session.deleteMany({ where: { userId: f.users.student.id, clientType: 'MOBILE' } });
          assert.equal((await call(path, native)).status, 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
