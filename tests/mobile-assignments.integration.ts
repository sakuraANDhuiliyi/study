import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createLiveFixture, liveWait } from './live.fixture';

test(
  'Android assignment workflow: authentic course scopes, immutable submissions, drafts, feedback and private files',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    const call = async (path: string, method = 'GET', body?: unknown, token?: string) => {
      const form = body instanceof FormData;
      const r = await fetch(f.origin + '/api' + path, {
        method,
        headers: {
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...(body === undefined || form ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const login = async (username: string) => {
      const r = await call('/mobile/auth/login', 'POST', {
        username,
        password: f.password,
        deviceName: 'Android作业验收',
      });
      assert.equal(r.status, 201);
      return r.body.accessToken as string;
    };
    const prefix = (id: string) => '/mobile/assignments/' + id;
    const question = async (type: string, extra: Record<string, unknown> = {}) =>
      (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type,
          stem: `<p>原生${type}验收题</p>`,
          scoreCents: 100,
          options:
            type === 'single' || type === 'multiple'
              ? [
                  { id: 'A', text: '选项A' },
                  { id: 'B', text: '选项B' },
                ]
              : [],
          answer:
            type === 'multiple'
              ? ['A', 'B']
              : type === 'boolean'
                ? false
                : type === 'blank'
                  ? [['one'], ['two']]
                  : 'A',
          explanation: '发布后才能看见的评分解析',
          ...extra,
        })
      ).body;
    const make = async (ids: string[], extra: Record<string, unknown> = {}) => {
      const r = await f.call(f.clients.teacher, '/assignments', 'POST', {
        courseId: f.course.id,
        title: 'Android完整作业',
        opensAt: new Date(Date.now() - 60000).toISOString(),
        dueAt: new Date(Date.now() + 3600000).toISOString(),
        maxAttempts: 3,
        questionVersionIds: ids,
        audienceIds: [f.users.student.id],
        ...extra,
      });
      await f.call(f.clients.teacher, '/assignments/' + r.body.id + '/publish', 'POST');
      return r.body;
    };
    const upload = async (
      token: string,
      id: string,
      name = 'native-answer.txt',
      text = '原生私有附件验收',
    ) => {
      const form = new FormData();
      form.append('file', new Blob([text], { type: 'text/plain' }), name);
      return call(prefix(id) + '/files', 'POST', form, token);
    };
    let native: string,
      other: string,
      foreign: string,
      teacher: string,
      task: any,
      qs: any[],
      answers: any[],
      submission: any,
      file: any;
    try {
      native = await login(f.users.student.username);
      other = await login(f.users.student2.username);
      foreign = await login(f.users.outsider.username);
      teacher = await login(f.users.teacher.username);
      qs = [];
      for (const type of ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'])
        qs.push(
          await question(
            type,
            type === 'composite'
              ? {
                  answer: {},
                  children: [
                    {
                      id: 'child-one',
                      type: 'short',
                      stem: '<p>综合题子题</p>',
                      scoreCents: 100,
                      answer: 'child-reference',
                    },
                  ],
                }
              : {},
          ),
        );
      const ids = qs.map((q) => q.versions[0].id);
      answers = ids.map((questionVersionId, i) => ({
        questionVersionId,
        value: ['A', ['A', 'B'], false, ['one', 'two'], '原生简答过程', { 'child-one': '综合题答案' }][i],
      }));
      task = await make(ids);
      await t.test(
        'native list, search and all question types preserve publication and role boundaries',
        async () => {
          const r = await call(
            '/mobile/assignments?search=' + encodeURIComponent(task.title),
            'GET',
            undefined,
            native,
          );
          assert.equal(r.status, 200);
          assert.equal(r.body.total, 1);
          assert.equal(r.body.items[0].latest, null);
          assert.equal(r.body.items[0].audience, undefined);
          const d = (await call(prefix(task.id), 'GET', undefined, native)).body;
          assert.deepEqual(
            d.items.map((i: any) => i.question.type),
            ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'],
          );
          for (const i of d.items) {
            assert.equal(i.question.answer, undefined);
            assert.equal(i.question.explanation, undefined);
          }
          assert.equal(d.items[5].question.children[0].answer, undefined);
          for (const unauthorized of [other, foreign, teacher]) {
            assert.ok(
              [403, 404].includes((await call(prefix(task.id), 'GET', undefined, unauthorized)).status),
            );
          }
          assert.equal((await call('/assignments/' + task.id, 'GET', undefined, native)).status, 403);
          assert.equal((await call(prefix(task.id) + '/roster', 'GET', undefined, native)).status, 404);
          assert.equal(
            (await call('/mobile/assignments?pageSize=100', 'GET', undefined, native)).status,
            400,
          );
        },
      );
      await t.test(
        'native file upload uses quota/type checks and never grants general or cross-assignment file access',
        async () => {
          const r = await upload(native, task.id);
          assert.equal(r.status, 201);
          file = r.body;
          assert.equal(file.name, 'native-answer.txt');
          assert.equal(file.mime, 'text/plain');
          const response = await fetch(f.origin + '/api' + prefix(task.id) + '/files/' + file.id, {
            headers: { authorization: 'Bearer ' + native },
          });
          assert.equal(response.status, 200);
          assert.match(response.headers.get('cache-control')!, /no-store/);
          assert.equal(await response.text(), '原生私有附件验收');
          assert.equal(
            (await call('/attachments/' + file.id + '/download', 'GET', undefined, native)).status,
            403,
          );
          assert.ok(
            [403, 404].includes(
              (await call(prefix(task.id) + '/files/' + file.id, 'GET', undefined, other)).status,
            ),
          );
          const otherTask = await make([ids[0]], { title: '另一个原生作业' });
          assert.equal(
            (await call(prefix(otherTask.id) + '/files/' + file.id, 'GET', undefined, native)).status,
            404,
          );
          assert.equal((await upload(native, task.id, 'malicious.exe', 'MZ invalid')).status, 400);
          const missing = await f.db.attachment.create({
            data: {
              organizationId: f.organization.id,
              ownerId: f.users.student.id,
              assignmentId: task.id,
              originalName: 'missing.txt',
              mime: 'text/plain',
              size: 1,
              sha256: 'a'.repeat(64),
              storageKey: randomUUID(),
            },
          });
          const absent = await call(prefix(task.id) + '/files/' + missing.id, 'GET', undefined, native);
          assert.equal(absent.status, 404);
          assert.equal(
            (await fetch(f.origin + '/api/health')).status,
            200,
            'Missing storage must not crash the API',
          );
          assert.ok(!JSON.stringify(absent.body).includes(missing.storageKey));

          for (let attempt = 0; attempt < 20; attempt++) {
            if (
              !(await f.db.uploadOperation.count({
                where: { ownerId: f.users.student.id, status: 'pending' },
              }))
            )
              break;
            await liveWait(25);
          }
          assert.equal(
            await f.db.uploadOperation.count({ where: { ownerId: f.users.student.id, status: 'pending' } }),
            0,
          );
        },
      );
      await t.test(
        'native saves all answer types and files; web sees them; simultaneous revision updates cannot overwrite',
        async () => {
          const r = await call(
            prefix(task.id) + '/draft',
            'PUT',
            { revision: 0, answers, attachmentIds: [file.id] },
            native,
          );
          assert.equal(r.status, 200);
          assert.equal(r.body.revision, 1);
          const web = (await f.call(f.clients.student, '/assignments/' + task.id)).body;
          assert.deepEqual(web.draft.answers, answers);
          assert.deepEqual(web.draft.attachmentIds, [file.id]);
          const results = await Promise.all([
            call(
              prefix(task.id) + '/draft',
              'PUT',
              { revision: 1, answers, attachmentIds: [file.id] },
              native,
            ),
            f.call(
              f.clients.student,
              '/assignments/' + task.id + '/draft',
              'PUT',
              { revision: 1, answers, attachmentIds: [file.id] },
              [200, 409],
            ),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
          assert.equal((await call(prefix(task.id), 'GET', undefined, native)).body.draft.revision, 2);
          assert.equal(
            (
              await call(
                prefix(task.id) + '/submit',
                'POST',
                {
                  answers,
                  attachmentIds: [file.id],
                  idempotencyKey: 'old-draft-key',
                  expectedDraftRevision: 1,
                  expectedSubmissionVersion: 0,
                },
                native,
              )
            ).status,
            409,
          );
        },
      );
      await t.test(
        'formal submission is idempotent across response loss and validates both draft and submission generations',
        async () => {
          const body = {
            answers,
            attachmentIds: [file.id],
            idempotencyKey: 'native-stable-key',
            expectedDraftRevision: 2,
            expectedSubmissionVersion: 0,
          };
          const first = await call(prefix(task.id) + '/submit', 'POST', body, native);
          assert.equal(first.status, 201);
          submission = first.body;
          const retried = await call(prefix(task.id) + '/submit', 'POST', body, native);
          assert.equal(retried.status, 201);
          assert.equal(retried.body.id, submission.id);
          assert.equal(
            await f.db.assignmentSubmission.count({
              where: { assignmentId: task.id, userId: f.users.student.id },
            }),
            1,
          );
          assert.equal(
            (
              await call(
                prefix(task.id) + '/submit',
                'POST',
                { ...body, idempotencyKey: 'unexpected-second-key', expectedDraftRevision: 0 },
                native,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                prefix(task.id) + '/submit',
                'POST',
                { ...body, answers: [], idempotencyKey: 'native-stable-key' },
                native,
              )
            ).status,
            409,
          );
          const d = (await call(prefix(task.id), 'GET', undefined, native)).body;
          assert.equal(d.draft, null);
          assert.equal(d.mySubmissions[0].scoreCents, null);
          assert.deepEqual(d.mySubmissions[0].grading, []);
          assert.equal(d.items[0].question.answer, undefined);
        },
      );
      await t.test(
        'only published grades and feedback become visible, including composite reference answers',
        async () => {
          await f.call(f.clients.teacher, '/submissions/' + submission.id + '/grade', 'PUT', {
            revision: 0,
            items: ids.map((questionVersionId) => ({
              questionVersionId,
              scoreCents: 80,
              comment: '教师逐题反馈',
            })),
            comment: '教师总体反馈',
          });
          let d = (await call(prefix(task.id), 'GET', undefined, native)).body;
          assert.equal(d.mySubmissions[0].scoreCents, null);
          assert.equal(d.mySubmissions[0].feedback, '');
          assert.deepEqual(d.mySubmissions[0].grading, []);
          await f.call(f.clients.teacher, '/assignments/' + task.id + '/release', 'POST');
          d = (await call(prefix(task.id), 'GET', undefined, native)).body;
          assert.equal(d.mySubmissions[0].scoreCents, 480);
          assert.ok(d.mySubmissions[0].releasedAt);
          assert.equal(d.mySubmissions[0].feedback, '教师总体反馈');
          assert.ok(d.mySubmissions[0].grading.length);
          assert.equal(d.items[5].question.children[0].answer, 'child-reference');
        },
      );
      await t.test(
        'return grants a controlled resubmission and retains the first released version',
        async () => {
          await f.call(f.clients.teacher, '/submissions/' + submission.id + '/return', 'POST', {
            reason: '请补充解题思路后重新提交',
          });
          const d = (await call(prefix(task.id), 'GET', undefined, native)).body;
          assert.equal(d.mySubmissions[0].status, 'returned');
          assert.equal(d.exception.extraAttempts, 1);
          const r = await call(
            prefix(task.id) + '/submit',
            'POST',
            {
              answers,
              attachmentIds: [file.id],
              idempotencyKey: 'native-returned-key',
              expectedDraftRevision: 0,
              expectedSubmissionVersion: 1,
            },
            native,
          );
          assert.equal(r.status, 201);
          assert.equal(r.body.version, 2);
          const current = (await call(prefix(task.id), 'GET', undefined, native)).body;
          assert.equal(current.mySubmissions.length, 2);
          assert.equal(current.mySubmissions[0].scoreCents, null);
          assert.equal(current.mySubmissions[1].scoreCents, 480);
        },
      );
      await t.test(
        'deadline, personal extension, exemption, not-open and attempt limits remain authoritative',
        async () => {
          const expired = await make([ids[0]], { maxAttempts: 1 });
          await f.db.assignment.update({
            where: { id: expired.id },
            data: { opensAt: new Date(Date.now() - 600000), dueAt: new Date(Date.now() - 60000) },
          });
          const body = {
            answers: [answers[0]],
            attachmentIds: [],
            idempotencyKey: 'native-expired-key',
            expectedDraftRevision: 0,
            expectedSubmissionVersion: 0,
          };
          assert.equal((await call(prefix(expired.id) + '/submit', 'POST', body, native)).status, 409);
          await f.call(f.clients.teacher, '/assignments/' + expired.id + '/exceptions', 'POST', {
            userId: f.users.student.id,
            reason: '允许原生验收补交',
            allowUntil: new Date(Date.now() + 600000).toISOString(),
          });
          const r = await call(prefix(expired.id) + '/submit', 'POST', body, native);
          assert.equal(r.status, 201);
          assert.equal(r.body.late, true);
          assert.equal(
            (
              await call(
                prefix(expired.id) + '/submit',
                'POST',
                { ...body, idempotencyKey: 'native-limit-key', expectedSubmissionVersion: 1 },
                native,
              )
            ).status,
            409,
          );
          await f.call(f.clients.teacher, '/assignments/' + expired.id + '/exceptions', 'POST', {
            userId: f.users.student.id,
            reason: '免交原生验收',
            exempt: true,
          });
          assert.equal(
            (
              await call(
                prefix(expired.id) + '/draft',
                'PUT',
                { revision: 0, answers: [], attachmentIds: [] },
                native,
              )
            ).status,
            409,
          );
          assert.equal((await upload(native, expired.id)).status, 409);
          const future = await make([ids[0]], { opensAt: new Date(Date.now() + 600000).toISOString() });
          const hidden = (await call(prefix(future.id), 'GET', undefined, native)).body;
          assert.deepEqual(hidden.items, []);
          assert.deepEqual(hidden.attachmentIds, []);
          assert.equal(
            (
              await call(
                prefix(future.id) + '/draft',
                'PUT',
                { revision: 0, answers: [], attachmentIds: [] },
                native,
              )
            ).status,
            403,
          );
        },
      );
      await t.test(
        'queued native write rechecks course and session after the lock wait, preserving web CSRF',
        async () => {
          const waitTask = await make([ids[0]], { title: '原生锁后撤权验收' });
          let release!: () => void, locked!: () => void;
          const ready = new Promise<void>((r) => {
              locked = r;
            }),
            held = new Promise<void>((r) => {
              release = r;
            });
          const lock = f.db.$transaction(
            async (tx) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assignment:${waitTask.id}:${f.users.student.id}`}))`;
              locked();
              await held;
            },
            { timeout: 15000 },
          );
          await ready;
          const pending = call(
            prefix(waitTask.id) + '/draft',
            'PUT',
            { revision: 0, answers: [], attachmentIds: [] },
            native,
          );
          await liveWait(150);
          await f.db.enrollment.updateMany({
            where: { userId: f.users.student.id, courseId: f.course.id },
            data: { active: false },
          });
          release();
          await lock;
          try {
            assert.equal((await pending).status, 403);
            assert.equal(await f.db.assignmentDraft.count({ where: { assignmentId: waitTask.id } }), 0);
            assert.ok(
              [403, 404].includes(
                (await call(prefix(task.id) + '/files/' + file.id, 'GET', undefined, native)).status,
              ),
            );
          } finally {
            await f.db.enrollment.updateMany({
              where: { userId: f.users.student.id, courseId: f.course.id },
              data: { active: true },
            });
          }
          await f.call(
            f.clients.student,
            '/assignments/' + waitTask.id + '/draft',
            'PUT',
            { revision: 0, answers: [], attachmentIds: [] },
            403,
            false,
          );
          const credential = await f.db.mobileCredential.findUniqueOrThrow({
            where: { accessHash: createHash('sha256').update(native).digest('hex') },
          });
          await f.db.session.delete({ where: { id: credential.sessionId } });
          assert.equal((await call(prefix(task.id), 'GET', undefined, native)).status, 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
