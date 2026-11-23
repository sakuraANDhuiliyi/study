import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture, liveWait } from './live.fixture';
import { MobileApiError, MobileClient } from '../apps/mobile/src/client';
import {
  focusApi,
  startFocus,
  finishFocus,
  personalNotesApi as notes,
  type FocusInput,
} from '../apps/mobile/src/personal-learning-model';
import { notesApi as lessons } from '../apps/mobile/src/notes-model';
test(
  'native personal notes, teacher lesson notes and focus match website scope and versions',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string, fetcher: typeof fetch = fetch) => {
      let raw: string | null = null;
      const client = new MobileClient(
        f.origin,
        {
          get: async () => raw,
          set: async (value) => {
            raw = value;
          },
          remove: async () => {
            raw = null;
          },
        },
        () => {},
        fetcher,
      );
      await client.login(username, f.password);
      return client;
    };
    const denied = (work: Promise<unknown>, status: number) =>
      assert.rejects(work, (e) => e instanceof MobileApiError && e.status === status);
    try {
      const student = await mobile(f.users.student.username),
        other = await mobile(f.users.student2.username),
        teacher = await mobile(f.users.teacher.username),
        foreign = await mobile(f.users.outsider.username),
        admin = await mobile(f.users.admin.username);
      const chapter = await f.db.chapter.create({
          data: { courseId: f.course.id, title: 'Personal note chapter' },
        }),
        lesson = await f.db.lesson.create({
          data: { courseId: f.course.id, chapterId: chapter.id, title: 'Private teacher lesson' },
        });
      await t.test('new native endpoints do not widen old student-only routes or admin access', async () => {
        await denied(teacher.request('/mobile/notes'), 403);
        await denied(lessons.read(teacher, lesson.id), 403);
        await denied(focusApi.list(teacher), 403);
        await denied(notes.create(admin, { title: 'no', category: null, body: 'no', pinned: false }), 403);
        await f.call(f.clients.student, '/mobile/personal/notes', 'GET', undefined, 403);
        await denied(student.request('/mobile/personal/notes?pageSize=21'), 400);
        await denied(student.request('/mobile/personal/notes?page=1&page=2'), 400);
        await denied(student.request('/mobile/personal/notes?userId=other'), 400);
        await denied(student.request('/mobile/personal/focus/sessions?userId=other'), 400);
      });
      await t.test(
        'student and institutional teacher standalone notes remain private and share website CAS',
        async () => {
          const original = await notes.create(student, {
            title: '手机私人笔记',
            category: '研究',
            body: ' <vector>\n私人😀 ',
            pinned: true,
          });
          assert.equal(original.revision, 1);
          assert.equal(original.body, ' <vector>\n私人😀 ');
          assert.equal(
            (await f.call(f.clients.student, '/notes/standalone/' + original.id)).body.body,
            original.body,
          );
          await denied(notes.read(other, original.id), 404);
          await denied(notes.read(foreign, original.id), 404);
          await denied(notes.read(teacher, original.id), 404);
          const changed = await notes.save(student, original, { ...original, title: '新版' });
          assert.equal(changed.revision, 2);
          await denied(notes.save(student, original, { ...original, body: 'stale' }), 409);
          assert.equal((await notes.read(student, original.id)).title, '新版');
          const teacherNote = await notes.create(teacher, {
            title: '教师私人教研',
            category: null,
            body: '本人教研笔记',
            pinned: false,
          });
          assert.equal((await notes.read(teacher, teacherNote.id)).body, '本人教研笔记');
          await denied(notes.read(student, teacherNote.id), 404);
          const list = await notes.list(teacher, { source: 'standalone', page: 1, search: '' });
          assert.equal(list.total, 1);
          assert.equal(list.items[0].id, teacherNote.id);
          assert.equal(Object.hasOwn(teacherNote, 'organizationId'), false);
          assert.equal(Object.hasOwn(teacherNote, 'userId'), false);
          await denied(
            student.request(
              '/mobile/personal/notes/standalone',
              { title: 'bad', body: 'bad', userId: 'other' },
              'POST',
            ),
            400,
          );
          await denied(notes.remove(student, original), 409);
          await notes.remove(student, changed);
          await denied(notes.read(student, original.id), 404);
        },
      );
      await t.test(
        'teacher lesson notes use actual course permission and private safe DTO while student route remains supported',
        async () => {
          const first = await lessons.save(teacher, lesson.id, '教师私有课时心得', true, null, true);
          assert.ok(first.note);
          assert.deepEqual(
            Object.keys(first.note!).sort(),
            ['id', 'body', 'pinned', 'revision', 'updatedAt'].sort(),
          );
          assert.equal(
            (await f.call(f.clients.teacher, '/lessons/' + lesson.id + '/note')).body.note.body,
            '教师私有课时心得',
          );
          assert.equal((await lessons.read(student, lesson.id)).note, null);
          const anotherTeacher = await mobile(f.users.otherTeacher.username);
          await denied(lessons.read(anotherTeacher, lesson.id, true), 403);
          const next = await lessons.save(teacher, lesson.id, '教师第二版', false, first.note, true);
          assert.equal(next.note!.revision, 2);
          await denied(lessons.save(teacher, lesson.id, '旧版本覆盖', false, first.note, true), 409);
          const list = await notes.list(teacher, { source: 'lesson', page: 1, search: '教师第二版' });
          assert.equal(list.total, 1);
          assert.equal(list.items[0].lessonId, lesson.id);
          await lessons.remove(teacher, lesson.id, next.note!, true);
          assert.equal((await lessons.read(teacher, lesson.id, true)).note, null);
        },
      );
      let completed: FocusInput;
      await t.test(
        'focus completed/interrupted/break records share website history and only completed focus contributes',
        async () => {
          const at = Date.now() - 600000;
          completed = finishFocus(startFocus('手机学习', '自由专注', 'FOCUS', 1, at), at + 60000);
          const first = await focusApi.create(student, completed);
          const duplicate = await focusApi.create(student, completed);
          assert.equal(first.id, duplicate.id);
          const abandoned = finishFocus(
            startFocus('中断练习', '算法练习', 'FOCUS', 1, at + 120000),
            at + 140000,
          );
          assert.equal(abandoned.status, 'ABANDONED');
          await focusApi.create(student, abandoned);
          const rest = finishFocus(startFocus('短休息', null, 'SHORT_BREAK', 1, at + 180000), at + 240000);
          await focusApi.create(student, rest);
          assert.equal((await focusApi.list(student)).total, 3);
          const summary = await focusApi.summary(student);
          assert.equal(summary.completedCount, 1);
          const beijingDate = (date: Date) =>
            new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
          assert.equal(
            summary.todayMinutes,
            beijingDate(new Date(completed.endedAt)) === beijingDate(new Date()) ? 1 : 0,
          );
          assert.equal((await f.call(f.clients.student, '/focus/sessions')).body.total, 3);
          await denied(other.request('/mobile/personal/focus/sessions/' + first.id), 404);
          await denied(foreign.request('/mobile/personal/focus/sessions/' + first.id), 404);
          assert.equal((await focusApi.list(other)).total, 0);
          assert.equal(Object.hasOwn(first, 'userId'), false);
          await denied(focusApi.create(student, { ...completed, reflection: 'different replay' }), 409);
          await denied(
            student.request(
              '/mobile/personal/focus/sessions',
              { ...completed, organizationId: 'other' },
              'POST',
            ),
            400,
          );
          await denied(focusApi.create(student, { ...completed, actualSeconds: 61 }), 400);
        },
      );
      await t.test(
        'lost focus save retries the frozen payload idempotently without adding another session',
        async () => {
          let lost = true;
          const flaky = await mobile(f.users.student.username, async (input, init) => {
            const response = await fetch(input, init);
            if (lost && init?.method === 'POST' && String(input).endsWith('/focus/sessions')) {
              lost = false;
              await response.text();
              throw new Error('lost focus response');
            }
            return response;
          });
          const at = Date.now() - 300000,
            payload = finishFocus(startFocus('丢响应核对', null, 'FOCUS', 25, at), at + 30000),
            before = (await focusApi.list(student)).total;
          await denied(focusApi.create(flaky, payload), 0);
          assert.equal((await focusApi.list(student)).total, before + 1);
          const recovered = await focusApi.create(flaky, payload);
          assert.equal(recovered.actualSeconds, 30);
          assert.equal((await focusApi.list(student)).total, before + 1);
        },
      );
      await t.test(
        'queued focus write rechecks a revoked mobile session after the shared private lock',
        async () => {
          const student3 = await mobile(f.users.student3.username);
          let release: (() => void) | undefined, locked: (() => void) | undefined;
          const ready = new Promise<void>((resolve) => {
              locked = resolve;
            }),
            gate = new Promise<void>((resolve) => {
              release = resolve;
            });
          const owner = f.db.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'focus:' + f.organization.id + ':' + f.users.student3.id}))`;
              locked!();
              await gate;
            },
            { timeout: 10000 },
          );
          await ready;
          const result = denied(focusApi.create(student3, completed!), 401);
          try {
            await liveWait(100);
            await f.db.user.update({
              where: { id: f.users.student3.id },
              data: { authVersion: { increment: 1 } },
            });
          } finally {
            release!();
          }
          await owner;
          await result;
          assert.equal(await f.db.focusSession.count({ where: { userId: f.users.student3.id } }), 0);
          await denied(focusApi.create(student3, completed!), 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
