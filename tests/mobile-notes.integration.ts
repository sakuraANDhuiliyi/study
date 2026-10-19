import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createLiveFixture, liveWait } from './live.fixture';
import { attachLogin } from './live-browser.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import { notesApi, reconcileNote, type NotesList } from '../apps/mobile/src/notes-model';
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { NotesService } from '../apps/api/src/notes/notes.service';
test(
  'native private notes: real database, website sharing, CAS, current authorization and uncertain outcomes',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string, fetcher: typeof fetch = fetch) => {
      let raw: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => raw,
          set: async (s) => {
            raw = s;
          },
          remove: async () => {
            raw = null;
          },
        },
        () => {},
        fetcher,
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = async (work: Promise<unknown>, status: number) =>
      assert.rejects(work, (e) => (e as { status: number }).status === status);
    try {
      const chapter = await f.db.chapter.create({ data: { courseId: f.course.id, title: 'Notes chapter' } });
      const lessons = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          f.db.lesson.create({
            data: {
              courseId: f.course.id,
              chapterId: chapter.id,
              title: 'Private lesson ' + i,
              sortOrder: i,
            },
          }),
        ),
      );
      const student = await mobile(f.users.student.username),
        other = await mobile(f.users.student2.username),
        teacher = await mobile(f.users.teacher.username),
        outsider = await mobile(f.users.outsider.username);
      const list = (q = '') => student.request<NotesList>('/mobile/notes' + q);
      const path = '/lessons/' + lessons[0].id + '/note';
      await t.test(
        'student mobile only, safe detail DTO and private authorship on the shared website record',
        async () => {
          assert.equal((await fetch(f.origin + '/api/mobile/notes')).status, 401);
          await f.call(f.clients.student, '/mobile/notes', 'GET', undefined, 403);
          await denied(teacher.request('/mobile/notes'), 403);
          await denied(student.request('/notes'), 403);
          assert.equal((await notesApi.read(student, lessons[0].id)).note, null);
          const d = await notesApi.save(
            student,
            lessons[0].id,
            '我的私密重点 <script>alert(1)</script>',
            true,
            null,
          );
          assert.ok(d.note);
          assert.equal(d.note.revision, 1);
          assert.deepEqual(
            Object.keys(d.note).sort(),
            ['id', 'body', 'pinned', 'revision', 'updatedAt'].sort(),
          );
          assert.equal((await f.call(f.clients.student, path)).body.note.body, d.note.body);
          assert.equal((await notesApi.read(other, lessons[0].id)).note, null);
          await denied(notesApi.read(outsider, lessons[0].id), 404);
          const foreignCourse = await f.db.course.create({
            data: {
              organizationId: f.foreign.id,
              teacherId: f.users.outsider.id,
              title: 'Foreign notes',
              status: 'PUBLISHED',
            },
          });
          const foreignChapter = await f.db.chapter.create({
            data: { courseId: foreignCourse.id, title: 'Foreign' },
          });
          const foreignLesson = await f.db.lesson.create({
            data: { courseId: foreignCourse.id, chapterId: foreignChapter.id, title: 'Foreign secret' },
          });
          await f.db.lessonNote.create({
            data: {
              organizationId: f.foreign.id,
              userId: f.users.student.id,
              courseId: foreignCourse.id,
              lessonId: foreignLesson.id,
              body: 'Foreign-secret-note',
            },
          });
          await denied(notesApi.read(student, foreignLesson.id), 404);
          assert.ok(!JSON.stringify(await list()).includes('Foreign-secret-note'));

          await denied(
            student.request(
              '/mobile/lessons/' + lessons[0].id + '/note',
              { body: 'forged', revision: 0, userId: f.users.student2.id },
              'PUT',
            ),
            400,
          );
          assert.equal(await f.db.lessonNote.count({ where: { lessonId: lessons[0].id } }), 1);
        },
      );
      await t.test(
        'literal substring search, pinned ordering, stable pages and strict query/input bounds',
        async () => {
          for (const lesson of lessons.slice(1))
            await notesApi.save(student, lesson.id, '共同检索词 %_ ' + lesson.title, false, null);
          const a = await list('?pageSize=10'),
            b = await list('?pageSize=10&page=2');
          assert.equal(a.total, 12);
          assert.equal(a.items[0].lessonId, lessons[0].id);
          assert.equal(b.items.length, 2);
          assert.equal(new Set([...a.items, ...b.items].map((n) => n.id)).size, 12);
          assert.equal((await list('?pinned=true')).total, 1);
          assert.equal((await list('?search=' + encodeURIComponent('%_'))).total, 11);
          assert.equal((await list('?search=' + encodeURIComponent('Private lesson 11'))).total, 1);
          for (const q of ['?userId=x', '?page=0', '?pageSize=51', '?pinned=1', '?search=' + 'a'.repeat(121)])
            await denied(list(q), 400);
          for (const body of ['', ' ', 'x'.repeat(10001), 'a\0b'])
            await denied(student.request('/mobile' + path, { body, revision: 0 }, 'PUT'), 400);
        },
      );
      await t.test(
        'website and native editor race has one winner; deletion/recreation keeps ABA protection',
        async () => {
          const base = (await notesApi.read(student, lessons[0].id)).note!;
          const outcomes = await Promise.all([
            notesApi.save(student, lessons[0].id, '手机改动', false, base).then(
              () => 200,
              (e) => e.status,
            ),
            fetch(f.origin + '/api' + path, {
              method: 'PUT',
              headers: {
                cookie: f.clients.student.cookie,
                'x-csrf-token': f.clients.student.csrf,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                body: '网页改动',
                pinned: true,
                revision: base.revision,
                noteId: base.id,
              }),
            }).then((r) => r.status),
          ]);
          assert.deepEqual(outcomes.sort(), [200, 409]);
          const next = (await notesApi.read(student, lessons[0].id)).note!;
          assert.equal(next.revision, base.revision + 1);
          await denied(notesApi.remove(student, lessons[0].id, base), 409);
          await notesApi.remove(student, lessons[0].id, next);
          const replacement = (await notesApi.save(student, lessons[0].id, '重建新笔记', false, null)).note!;
          assert.notEqual(replacement.id, base.id);
          assert.equal(replacement.revision, 1);
          await denied(notesApi.save(student, lessons[0].id, '旧页面覆盖', false, base), 409);
          await denied(notesApi.remove(student, lessons[0].id, base), 409);
          assert.equal((await notesApi.read(student, lessons[0].id)).note?.body, '重建新笔记');
        },
      );
      await t.test(
        'lost create/update/delete responses recover by read only and never duplicate a mutation',
        async () => {
          let fail = false,
            writes = 0;
          const client = await mobile(f.users.student.username, async (url, init) => {
            const r = await fetch(url, init);
            if (fail && ['PUT', 'DELETE'].includes(init?.method || '')) {
              writes++;
              await r.arrayBuffer();
              throw new TypeError('simulated lost response after commit');
            }
            return r;
          });
          const id = lessons[1].id;
          let base = (await notesApi.read(client, id)).note!;
          fail = true;
          await assert.rejects(notesApi.save(client, id, '响应丢失已保存', true, base));
          let fresh = (await notesApi.read(client, id)).note!;
          assert.equal(
            reconcileNote({ kind: 'save', base, body: '响应丢失已保存', pinned: true }, fresh),
            'applied',
          );
          base = fresh;
          await assert.rejects(notesApi.remove(client, id, base));
          assert.equal(
            reconcileNote({ kind: 'delete', base }, (await notesApi.read(client, id)).note),
            'applied',
          );
          await assert.rejects(notesApi.save(client, id, '新建响应丢失', false, null));
          fresh = (await notesApi.read(client, id)).note!;
          assert.equal(
            reconcileNote({ kind: 'save', base: null, body: '新建响应丢失', pinned: false }, fresh),
            'applied',
          );
          assert.equal(writes, 3);
          assert.equal(
            await f.db.lessonNote.count({ where: { lessonId: id, userId: f.users.student.id } }),
            1,
          );
        },
      );
      await t.test(
        'real browser edits the native note; literal HTML text does not execute and mobile observes new revision',
        async () => {
          const browser = await chromium.launch({
            headless: true,
            channel: 'chrome',
            args: ['--no-sandbox'],
          });
          try {
            const context = await browser.newContext();
            await attachLogin(context, f.clients.student, f.origin);
            const page = await context.newPage();
            await page.goto(f.origin + '/notes');
            const row = page
              .locator('.note-card')
              .filter({ has: page.getByRole('heading', { name: lessons[0].title, exact: true }) });
            await expect(row).toBeVisible();
            await row.getByRole('button', { name: '编辑笔记', exact: true }).click();
            const dialog = page.getByRole('dialog');
            const editor = dialog.getByRole('textbox', { name: '笔记内容' });
            await expect(editor).toHaveValue('重建新笔记');
            await editor.fill('网页已同步 <img src=x onerror=alert(1)>');
            await dialog.getByRole('button', { name: '保存笔记', exact: true }).click();
            await expect(dialog.getByRole('status')).toContainText('已保存');
            assert.equal(
              (await notesApi.read(student, lessons[0].id)).note?.body,
              '网页已同步 <img src=x onerror=alert(1)>',
            );
            assert.equal(await dialog.locator('img').count(), 0);
          } finally {
            await browser.close();
          }
        },
      );
      await t.test(
        'withdrawn enrollment, future lesson, hidden course and foreign records cannot be read or mutated',
        async () => {
          const base = (await notesApi.read(student, lessons[0].id)).note!;
          await f.db.lesson.update({
            where: { id: lessons[0].id },
            data: { opensAt: new Date(Date.now() + 60000) },
          });
          await denied(notesApi.read(student, lessons[0].id), 403);
          await denied(notesApi.save(student, lessons[0].id, 'closed', false, base), 403);
          await denied(notesApi.remove(student, lessons[0].id, base), 403);
          assert.equal((await list()).total, 11);
          await f.db.lesson.update({ where: { id: lessons[0].id }, data: { opensAt: null } });
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
            data: { active: false },
          });
          assert.equal((await list()).total, 0);
          await denied(notesApi.read(student, lessons[0].id), 403);
          await f.db.enrollment.update({
            where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
            data: { active: true },
          });
          await f.db.course.update({ where: { id: f.course.id }, data: { status: 'UNPUBLISHED' } });
          await denied(notesApi.read(student, lessons[0].id), 403);
          await f.db.course.update({ where: { id: f.course.id }, data: { status: 'PUBLISHED' } });
        },
      );
      await t.test(
        'single-connection transaction has no nested authentication pool acquisition',
        async () => {
          const url = new URL(f.env.DATABASE_URL);
          url.searchParams.set('connection_limit', '1');
          const db = new PrismaService({ datasources: { db: { url: url.href } } });
          try {
            const session = await f.db.session.findFirstOrThrow({
              where: { userId: f.users.student.id, clientType: 'MOBILE' },
              orderBy: { createdAt: 'desc' },
            });
            const actor = await new AuthService(db).resolveMobileSessionId(session.id);
            assert.ok(actor);
            const service = new NotesService(db);
            assert.ok((await service.read(actor, lessons[0].id)).note);
            await service.list(actor, {}, true);
          } finally {
            await db.$disconnect();
          }
        },
      );
      await t.test(
        'queued save rechecks current session and current enrollment after shared editor lock',
        async () => {
          for (const kind of ['enrollment', 'session']) {
            const c = await mobile(f.users.student.username);
            const base = (await notesApi.read(c, lessons[0].id)).note!;
            let release!: () => void, ready!: () => void;
            const gate = new Promise<void>((r) => {
                release = r;
              }),
              acquired = new Promise<void>((r) => {
                ready = r;
              });
            const lock = f.db.$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'lesson-notes:' + f.organization.id + ':' + f.users.student.id}))`;
                ready();
                await gate;
              },
              { timeout: 20000 },
            );
            await acquired;
            const result = denied(
              notesApi.save(c, lessons[0].id, 'must not save', false, base),
              kind === 'session' ? 401 : 403,
            );
            try {
              let waited = false;
              for (let i = 0; i < 100; i++) {
                const rows = await f.db.$queryRaw<
                  { n: bigint }[]
                >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`;
                if (Number(rows[0].n)) {
                  waited = true;
                  break;
                }
                await liveWait(25);
              }
              assert.ok(waited);
              if (kind === 'session')
                await f.db.session.deleteMany({
                  where: { userId: f.users.student.id, clientType: 'MOBILE' },
                });
              else
                await f.db.enrollment.update({
                  where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
                  data: { active: false },
                });
            } finally {
              release();
              await lock;
            }
            await result;
            assert.equal(
              (await f.db.lessonNote.findUniqueOrThrow({ where: { id: base.id } })).revision,
              base.revision,
            );
            if (kind === 'enrollment')
              await f.db.enrollment.update({
                where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
                data: { active: true },
              });
          }
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
