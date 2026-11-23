import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLiveFixture } from './live.fixture';

test(
  'Android teacher, institution administrator and platform administrator workflows',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    async function call(
      token: string,
      path: string,
      method = 'GET',
      body?: unknown,
      expected = method === 'POST' ? 201 : 200,
    ) {
      const response = await fetch(f.origin + '/api' + path, {
        method,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json().catch(() => null);
      assert.equal(response.status, expected, method + ' ' + path + ' ' + String(result?.message ?? ''));
      return result;
    }
    const login = async (username: string) =>
      (
        await call('', '/mobile/auth/login', 'POST', {
          username,
          password: f.password,
          deviceName: '教学工作流验收',
        })
      ).accessToken as string;
    const root = '/mobile/staff',
      suffix = randomUUID().slice(0, 8);
    try {
      const [admin, teacher, student, other] = await Promise.all(
        [f.users.admin, f.users.teacher, f.users.student, f.users.otherTeacher].map((u) => login(u.username)),
      );
      await t.test('native route restrictions, current role and tenant scope', async () => {
        await f.call(f.clients.admin, root + '/users', 'GET', undefined, 403);
        await call(student, root + '/users', 'GET', undefined, 403);
        await call(teacher, root + '/users', 'GET', undefined, 403);
        await call(admin, '/admin/users', 'GET', undefined, 403);
        const list = await call(admin, root + '/users');
        assert.ok(list.items.some((x: { id: string }) => x.id === f.users.student.id));
        assert.ok(!list.items.some((x: { id: string }) => x.id === f.users.outsider.id));
      });
      await t.test('administrator assigns and changes an actual student major', async () => {
        const subject = await f.db.academicsSubject.create({
          data: { name: '工程学科', organizationId: f.organization.id },
        });
        const major = await f.db.academicsMajor.create({
          data: { subjectId: subject.id, name: '工程专业', organizationId: f.organization.id },
        });
        const catalog = await call(admin, root + '/majors');
        assert.ok(catalog.items.some((m: { id: string }) => m.id === major.id));
        const u = await call(admin, root + '/users', 'POST', {
          name: '工程学生',
          username: 'engineer_' + suffix,
          password: f.password,
          roles: ['STUDENT'],
          majorId: major.id,
        });
        assert.equal((await f.db.user.findUniqueOrThrow({ where: { id: u.id } })).majorId, major.id);
        await call(admin, root + '/users/' + u.id + '/major', 'PATCH', { majorId: null });
        assert.equal((await f.db.user.findUniqueOrThrow({ where: { id: u.id } })).majorId, null);
      });
      await t.test(
        'teacher builds a course, enrolls a student, publishes an assignment and an exam',
        async () => {
          const course = await call(teacher, root + '/courses', 'POST', { title: '移动端教学验收' });
          await call(other, root + '/courses/' + course.id + '/chapters', 'POST', { title: '其他教师' }, 403);
          const chapter = await call(teacher, root + '/courses/' + course.id + '/chapters', 'POST', {
            title: '第一章',
          });
          const lesson = await call(teacher, root + '/chapters/' + chapter.id + '/lessons', 'POST', {
            title: '概念',
            content: '基础概念',
            type: 'TEXT',
          });
          assert.equal(lesson.chapterId, chapter.id);
          await call(teacher, root + '/courses/' + course.id + '/members', 'POST', {
            userId: f.users.student.id,
            kind: 'student',
          });
          await call(teacher, root + '/courses/' + course.id + '/status', 'PATCH', { status: 'PUBLISHED' });
          const membership = await call(teacher, root + '/courses/' + course.id + '/members');
          assert.ok(membership.items.some((x: { id: string }) => x.id === f.users.student.id));
          const opens = new Date(Date.now() - 60000).toISOString(),
            ends = new Date(Date.now() + 3600000).toISOString();
          const makeQuestion = async (stem: string) =>
            (
              await call(teacher, root + '/questions', 'POST', {
                courseId: course.id,
                stem,
                type: 'boolean',
                answer: true,
                scoreCents: 100,
              })
            ).versions[0].id;
          const questionVersionId = (
              await call(teacher, root + '/questions', 'POST', {
                courseId: course.id,
                stem: '描述变量的用途',
                type: 'short',
                answer: '保存一个值',
                scoreCents: 100,
              })
            ).versions[0].id,
            examQuestion = await makeQuestion('二乘二等于四');
          const common = { courseId: course.id, title: '教学验收' };
          const assignment = await call(teacher, root + '/assignments', 'POST', {
            ...common,
            opensAt: opens,
            dueAt: ends,
            questionVersionIds: [questionVersionId],
          });
          await call(teacher, root + '/assignments/' + assignment.id + '/publish', 'POST', {});
          const exam = await call(teacher, root + '/exams', 'POST', {
            ...common,
            startsAt: opens,
            endsAt: ends,
            entryClosesAt: ends,
            durationMinutes: 15,
            passCents: 60,
            questionVersionIds: [examQuestion],
          });
          await call(teacher, root + '/exams/' + exam.id + '/publish', 'POST', {});
          const submission = await call(student, '/mobile/assignments/' + assignment.id + '/submit', 'POST', {
            answers: [{ questionVersionId, value: '存储数值' }],
            attachmentIds: [],
            idempotencyKey: 'android-staff-submit',
            expectedDraftRevision: 0,
            expectedSubmissionVersion: 0,
          });
          const queue = await call(teacher, root + '/grading');
          const entry = queue.items.find((e: { id: string }) => e.id === submission.id);
          assert.equal(entry.parentId, assignment.id);
          const paper = await call(teacher, root + '/grading/assignments/' + entry.parentId + '/' + entry.id);
          assert.equal(paper.assignment.items[0].questionVersionId, questionVersionId);
          assert.equal(paper.submission.answers[0].value, '存储数值');
          const mark = {
            revision: paper.submission.revision,
            comment: '反馈',
            items: [{ questionVersionId, scoreCents: 80, comment: '部分正确' }],
            finalize: true,
          };
          await call(teacher, root + '/grading/submissions/' + entry.id, 'PUT', mark);
          await call(teacher, root + '/grading/submissions/' + entry.id, 'PUT', mark, 409);
          await call(teacher, root + '/assignments/' + assignment.id + '/release', 'POST', {});
          assert.ok(
            (await f.db.assignmentSubmission.findUniqueOrThrow({ where: { id: entry.id } })).releasedAt,
          );
          await call(student, root + '/grading', 'GET', undefined, 403);
          assert.equal((await call(student, '/mobile/assignments/' + assignment.id)).id, assignment.id);
        },
      );
      await t.test(
        'a personal learner joins an institution by invitation and returns to personal study',
        async () => {
          const join = await call(admin, root + '/join-settings', 'PATCH', { joinEnabled: true });
          const username = 'personal_' + suffix;
          const fresh = await call('', '/mobile/auth/register', 'POST', {
            name: '自由学习者',
            username,
            password: f.password,
            deviceName: '学生手机',
          });
          const path = '/mobile/organization',
            req = await call(fresh.accessToken, path + '/requests', 'POST', {
              inviteCode: join.inviteCode,
              note: '选修课程',
            });
          await call(admin, root + '/join-requests/' + req.id, 'PATCH', { status: 'APPROVED' });
          const orgToken = await login(username);
          assert.equal((await call(orgToken, path)).organization.id, f.organization.id);
          await call(orgToken, path + '/leave', 'POST', {});
          assert.equal((await call(await login(username), path)).accountMode, 'PERSONAL');
        },
      );
      await t.test('only platform administrator can create another institution', async () => {
        await call(admin, root + '/organizations', 'POST', { name: '新设机构' }, 403);
        const username = 'platform_' + suffix;
        await f.db.user.create({
          data: {
            username,
            name: '平台管理员',
            organizationId: f.organization.id,
            passwordHash: f.users.admin.passwordHash,
            roles: { create: { roleId: 'SUPER_ADMIN' } },
          },
        });
        const token = await login(username);
        const result = await call(token, root + '/organizations', 'POST', { name: '新设机构' });
        assert.ok(
          (await call(token, root + '/organizations')).items.some((x: { id: string }) => x.id === result.id),
        );
      });
    } finally {
      await f.cleanup();
    }
  },
);
