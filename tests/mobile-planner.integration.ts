import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture } from './live.fixture';
import { learningActionRange } from '../apps/api/src/planner/actions.schemas';

test(
  'Android planner: native/web synchronization, deadline rules, concurrency and isolation',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const native = async (path: string, method = 'GET', body?: unknown, token?: string) => {
      const response = await fetch(f.origin + '/api' + path, {
        method,
        headers: {
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, body: await response.json() };
    };
    const login = async (username: string) => {
      const r = await native('/mobile/auth/login', 'POST', {
        username,
        password: f.password,
        deviceName: '原生计划验收',
      });
      assert.equal(r.status, 201);
      return r.body.accessToken as string;
    };
    const now = new Date(),
      range = learningActionRange(now);
    const due = new Date(now.getTime() + 5 * 60000);
    const tomorrow = new Date(range.tomorrowStart.getTime() + 3600000);
    const overdue = new Date(now.getTime() - 60000);
    const calendar =
      '/planner?' +
      new URLSearchParams({
        start: new Date(now.getTime() - 86400000).toISOString(),
        end: new Date(now.getTime() + 10 * 86400000).toISOString(),
      });
    let token: string, task: any;
    try {
      token = await login(f.users.student.username);
      const other = await login(f.users.student2.username),
        foreign = await login(f.users.outsider.username);
      await t.test(
        'create native personal plan, see on web, edit on web and read latest on native',
        async () => {
          const created = await native(
            '/planner/tasks',
            'POST',
            { title: '原生跨端计划', description: '仅本人可见', dueAt: due.toISOString() },
            token,
          );
          assert.equal(created.status, 201);
          task = created.body;
          const web = (await f.call(f.clients.student, calendar)).body;
          assert.ok(web.items.some((x: any) => x.id === task.id && x.title === task.title));
          task = (
            await f.call(f.clients.student, '/planner/tasks/' + task.id, 'PATCH', {
              revision: task.revision,
              title: '网页已更新计划',
            })
          ).body;
          const read = await native('/planner/tasks/' + task.id, 'GET', undefined, token);
          assert.equal(read.status, 200);
          assert.equal(read.body.title, task.title);
          assert.equal(read.body.revision, 1);
          for (const unauthorized of [other, foreign]) {
            assert.equal(
              (await native('/planner/tasks/' + task.id, 'GET', undefined, unauthorized)).status,
              404,
            );
            assert.equal(
              (
                await native(
                  '/planner/tasks/' + task.id,
                  'PATCH',
                  { revision: task.revision, title: '越权编辑' },
                  unauthorized,
                )
              ).status,
              404,
            );
            assert.equal(
              (await native('/planner/tasks/' + task.id, 'DELETE', { revision: task.revision }, unauthorized))
                .status,
              404,
            );
            assert.ok(
              !(await native(calendar, 'GET', undefined, unauthorized)).body.items.some(
                (x: any) => x.id === task.id,
              ),
            );
          }
        },
      );
      await t.test(
        'simultaneous native and website updates consume a revision once and never overwrite silently',
        async () => {
          const results = await Promise.all([
            native(
              '/planner/tasks/' + task.id,
              'PATCH',
              { revision: task.revision, title: '原生并发修改' },
              token,
            ),
            f.call(
              f.clients.student,
              '/planner/tasks/' + task.id,
              'PATCH',
              { revision: task.revision, title: '网页并发修改' },
              [200, 409],
            ),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
          task = (await native('/planner/tasks/' + task.id, 'GET', undefined, token)).body;
          assert.equal(task.revision, 2);
          assert.equal(
            (await native('/planner/tasks/' + task.id, 'DELETE', { revision: 1 }, token)).status,
            409,
          );
          assert.equal(await f.db.personalTask.count({ where: { id: task.id } }), 1);
        },
      );
      await t.test(
        'native actions use true counts and pages, complete removes action, agenda preserves it and reopen restores it',
        async () => {
          const initial = (
            await native('/planner/actions?bucket=today&type=personal', 'GET', undefined, token)
          ).body;
          // Five-minute fixture may cross midnight, so find using the due date's actual server bucket.
          const bucket = due >= range.tomorrowStart ? 'upcoming' : 'today';
          const actions = (
            await native('/planner/actions?bucket=' + bucket + '&type=personal', 'GET', undefined, token)
          ).body;
          assert.equal(actions.total, 1);
          assert.equal(actions.counts[bucket], 1);
          assert.equal(actions.items[0].id, task.id);
          assert.equal(initial.timezone, 'Asia/Shanghai');
          task = (
            await native(
              '/planner/tasks/' + task.id,
              'PATCH',
              { revision: task.revision, completed: true },
              token,
            )
          ).body;
          assert.ok(task.completedAt);
          assert.equal(
            (await native('/planner/actions?bucket=' + bucket + '&type=personal', 'GET', undefined, token))
              .body.total,
            0,
          );
          assert.equal(
            (await f.call(f.clients.student, calendar)).body.items.find((x: any) => x.id === task.id).status,
            'completed',
          );
          task = (
            await native(
              '/planner/tasks/' + task.id,
              'PATCH',
              { revision: task.revision, completed: false },
              token,
            )
          ).body;
          assert.equal(task.completedAt, null);
          for (let i = 0; i < 12; i++)
            await f.db.personalTask.create({
              data: {
                userId: f.users.student.id,
                organizationId: f.organization.id,
                title: '分页计划' + i,
                dueAt: tomorrow,
              },
            });
          const page = (
            await native(
              '/planner/actions?bucket=upcoming&type=personal&page=2&pageSize=10',
              'GET',
              undefined,
              token,
            )
          ).body;
          assert.equal(page.counts.upcoming, due >= range.tomorrowStart ? 13 : 12);
          assert.equal(page.items.length, page.total - 10);
        },
      );
      await t.test(
        'assignment extensions, exemptions and course revocation keep the same deadline and audience policy as web',
        async () => {
          const assignment = await f.db.assignment.create({
            data: {
              organizationId: f.organization.id,
              courseId: f.course.id,
              creatorId: f.users.teacher.id,
              title: '个人补交验收',
              status: 'published',
              opensAt: new Date(now.getTime() - 86400000),
              dueAt: overdue,
              totalCents: 100,
              attachmentIds: [],
              allowLate: false,
              audience: { create: { userId: f.users.student.id } },
              exceptions: {
                create: {
                  userId: f.users.student.id,
                  allowUntil: tomorrow,
                  reason: '验收延期',
                  approvedBy: f.users.teacher.id,
                },
              },
            },
          });
          let result = (
            await native('/planner/actions?bucket=upcoming&type=assignment', 'GET', undefined, token)
          ).body;
          const row = result.items.find((x: any) => x.id === assignment.id);
          assert.ok(row);
          assert.equal(row.dueAt, tomorrow.toISOString());
          assert.equal(row.originalDueAt, overdue.toISOString());
          const web = (await f.call(f.clients.student, '/planner/actions?bucket=upcoming&type=assignment'))
            .body;
          assert.deepEqual(result.items, web.items);
          assert.deepEqual(result.counts, web.counts);
          await f.db.assignmentException.update({
            where: { assignmentId_userId: { assignmentId: assignment.id, userId: f.users.student.id } },
            data: { exempt: true },
          });
          result = (await native('/planner/actions?bucket=upcoming&type=assignment', 'GET', undefined, token))
            .body;
          assert.equal(result.total, 0);
          await f.db.assignmentException.update({
            where: { assignmentId_userId: { assignmentId: assignment.id, userId: f.users.student.id } },
            data: { exempt: false },
          });
          const courses = (
            await native(
              '/planner/actions/courses?search=' + encodeURIComponent(f.course.title),
              'GET',
              undefined,
              token,
            )
          ).body;
          assert.ok(courses.items.some((x: any) => x.id === f.course.id));
          await f.db.enrollment.updateMany({
            where: { userId: f.users.student.id, courseId: f.course.id },
            data: { active: false },
          });
          try {
            assert.equal(
              (await native('/planner/actions?courseId=' + f.course.id, 'GET', undefined, token)).status,
              403,
            );
            assert.ok(
              !(await native(calendar, 'GET', undefined, token)).body.items.some(
                (x: any) => x.id === 'assignment:' + assignment.id,
              ),
            );
            assert.equal((await native('/planner/actions/courses', 'GET', undefined, token)).body.total, 0);
          } finally {
            await f.db.enrollment.updateMany({
              where: { userId: f.users.student.id, courseId: f.course.id },
              data: { active: true },
            });
          }
        },
      );
      await t.test(
        'exam calendar keeps personalized extension and cancellation visible without exposing attempt answers',
        async () => {
          const exam = await f.db.exam.create({
            data: {
              organizationId: f.organization.id,
              courseId: f.course.id,
              creatorId: f.users.teacher.id,
              title: '考试延期日程',
              status: 'published',
              startsAt: overdue,
              endsAt: due,
              entryClosesAt: due,
              durationMinutes: 30,
              passCents: 60,
              totalCents: 100,
              graderIds: [],
              audience: { create: { userId: f.users.student.id } },
              extensions: {
                create: {
                  userId: f.users.student.id,
                  deadlineAt: tomorrow,
                  reason: '个人延期',
                  approvedBy: f.users.teacher.id,
                },
              },
            },
          });
          let item = (await native(calendar, 'GET', undefined, token)).body.items.find(
            (x: any) => x.id === 'exam:' + exam.id,
          );
          assert.equal(item.endAt, tomorrow.toISOString());
          assert.equal(item.entryClosesAt, tomorrow.toISOString());
          assert.equal(item.answers, undefined);
          assert.equal(item.correctAnswers, undefined);
          await f.db.exam.update({ where: { id: exam.id }, data: { status: 'cancelled' } });
          item = (await native(calendar, 'GET', undefined, token)).body.items.find(
            (x: any) => x.id === 'exam:' + exam.id,
          );
          assert.equal(item.status, 'cancelled');
        },
      );
      await t.test(
        'native mutation validation, teacher restrictions, permission changes and web CSRF stay enforced',
        async () => {
          assert.equal(
            (
              await native(
                '/planner/tasks',
                'POST',
                { title: '不合法计划', dueAt: due.toISOString(), userId: f.users.student2.id },
                token,
              )
            ).status,
            400,
          );
          assert.equal(
            (await native('/planner/tasks/' + task.id, 'PUT', { revision: task.revision }, token)).status,
            404,
          );
          const teacher = await login(f.users.teacher.username);
          assert.equal((await native('/planner/actions', 'GET', undefined, teacher)).status, 403);
          assert.equal((await native(calendar, 'GET', undefined, teacher)).status, 200);
          await f.call(
            f.clients.student,
            '/planner/tasks/' + task.id,
            'PATCH',
            { revision: task.revision, completed: true },
            403,
            false,
          );
          await f.db.user.update({ where: { id: f.users.student.id }, data: { active: false } });
          try {
            assert.equal((await native(calendar, 'GET', undefined, token)).status, 401);
          } finally {
            await f.db.user.update({ where: { id: f.users.student.id }, data: { active: true } });
          }
          assert.equal(
            (await native('/planner/tasks/' + task.id, 'DELETE', { revision: task.revision }, token)).status,
            200,
          );
          assert.equal((await native('/planner/tasks/' + task.id, 'GET', undefined, token)).status, 404);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
