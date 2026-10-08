import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.TEST_API_URL?.replace(/\/$/, '');
const password = process.env.DEV_SEED_PASSWORD;
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
type Session = { cookie: string; csrf: string; id: string };
async function call(session: Session | null, path: string, method = 'GET', body?: unknown, status = 200) {
  const form = body instanceof FormData;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(session ? { Cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
      ...(!form && body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const raw = await res.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  assert.equal(res.status, status, `${method} ${path}: ${raw.slice(0, 500)}`);
  return { data, res };
}
async function login(username: string): Promise<Session> {
  const { data, res } = await call(null, '/auth/login', 'POST', { username, password }, 201);
  return { id: data.user.id, cookie: res.headers.get('set-cookie')!.split(';')[0], csrf: data.csrfToken };
}
async function file(session: Session, name: string, scope: Record<string, string> = {}) {
  const form = new FormData();
  form.append('file', new Blob([name]), name + '.txt');
  for (const [key, value] of Object.entries(scope)) form.append(key, value);
  return (await call(session, '/attachments', 'POST', form, 201)).data;
}

test(
  '附件下载使用正式业务引用和当前授权，而非文件编号或任意首个提交',
  { skip: !base || !password, timeout: 60000 },
  async (t) => {
    assert.notEqual(
      process.env.NODE_ENV,
      'production',
      'Security integration must use an isolated development database',
    );
    assert(base!.endsWith('/api'), 'TEST_API_URL must include /api');
    const admin = await login('admin');
    const suffix = Date.now().toString(36) + randomUUID().slice(0, 4);
    const accounts: Session[] = [];
    const courses: any[] = [];
    const assignments: any[] = [];
    try {
      for (const [index, role] of ['TEACHER', 'TEACHER', 'STUDENT', 'STUDENT'].entries()) {
        const username = `filesec_${suffix}_${index}`;
        await call(
          admin,
          '/admin/users',
          'POST',
          { username, name: `附件安全审查${index}`, password, roles: [role] },
          201,
        );
        accounts.push(await login(username));
      }
      const [teacher, otherTeacher, student, otherStudent] = accounts;
      for (const owner of [teacher, otherTeacher]) {
        const course = (
          await call(owner, '/courses', 'POST', { title: `附件审查-${suffix}-${courses.length}` }, 201)
        ).data;
        courses.push(course);
        const chapter = (
          await call(owner, `/courses/${course.id}/chapters`, 'POST', { title: '授权边界' }, 201)
        ).data;
        await call(
          owner,
          `/chapters/${chapter.id}/lessons`,
          'POST',
          { title: '课时', content: '<p>授权边界</p>' },
          201,
        );
        await call(owner, `/courses/${course.id}`, 'PATCH', { status: 'PUBLISHED' });
        for (const target of [student, otherStudent])
          await call(owner, `/courses/${course.id}/members`, 'POST', { userId: target.id }, 201);
        const question = (
          await call(
            owner,
            '/questions',
            'POST',
            {
              courseId: course.id,
              type: 'single',
              stem: '附件验证',
              options: [
                { id: 'A', text: 'A' },
                { id: 'B', text: 'B' },
              ],
              answer: 'A',
              scoreCents: 100,
              practiceEnabled: false,
            },
            201,
          )
        ).data;
        const assignment = (
          await call(
            owner,
            '/assignments',
            'POST',
            {
              courseId: course.id,
              title: '附件权限作业',
              questionVersionIds: [question.versions[0].id],
              opensAt: new Date(Date.now() - 60000).toISOString(),
              dueAt: new Date(Date.now() + 3600000).toISOString(),
              maxAttempts: 5,
            },
            201,
          )
        ).data;
        await call(owner, `/assignments/${assignment.id}/publish`, 'POST', {}, 201);
        assignments.push({ ...assignment, questionVersionId: question.versions[0].id });
      }
      const submit = (assignment: any, attachmentId: string) =>
        call(
          student,
          `/assignments/${assignment.id}/submit`,
          'POST',
          {
            answers: [{ questionVersionId: assignment.questionVersionId, value: 'A' }],
            attachmentIds: [attachmentId],
            idempotencyKey: randomUUID(),
          },
          201,
        );

      await t.test('学生作业草稿附件提交前对教师保密，正式提交后开放且退课后失效', async () => {
        const attachment = await file(student, '尚未提交的草稿', { assignmentId: assignments[0].id });
        assert.equal((await call(student, `/attachments/${attachment.id}/download`)).data, '尚未提交的草稿');
        await call(teacher, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
        await call(student, `/assignments/${assignments[0].id}/draft`, 'PUT', {
          revision: 0,
          answers: [],
          attachmentIds: [attachment.id],
        });
        await call(teacher, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
        await submit(assignments[0], attachment.id);
        assert.equal((await call(teacher, `/attachments/${attachment.id}/download`)).data, '尚未提交的草稿');
        await call(otherStudent, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
        await call(teacher, `/courses/${courses[0].id}/members/${student.id}`, 'DELETE');
        await call(student, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
        await call(teacher, `/courses/${courses[0].id}/members`, 'POST', { userId: student.id }, 201);
        const futureFile = await file(teacher, '未到开放时间的说明文件');
        const future = (
          await call(
            teacher,
            '/assignments',
            'POST',
            {
              courseId: courses[0].id,
              title: '未来开放的说明',
              questionVersionIds: [assignments[0].questionVersionId],
              attachmentIds: [futureFile.id],
              audienceIds: [student.id],
              opensAt: new Date(Date.now() + 3600000).toISOString(),
              dueAt: new Date(Date.now() + 7200000).toISOString(),
            },
            201,
          )
        ).data;
        await call(teacher, `/assignments/${future.id}/publish`, 'POST', {}, 201);
        await call(student, `/attachments/${futureFile.id}/download`, 'GET', undefined, 403);
      });

      await t.test(
        '课程文件也须有效引用；教师不能读取未发送草稿，管理权限可读隐藏讨论及未来课时附件',
        async () => {
          const draft = await file(student, '未发帖的课程草稿', { courseId: courses[0].id });
          await call(teacher, `/attachments/${draft.id}/download`, 'GET', undefined, 403);
          await call(
            student,
            `/assignments/${assignments[0].id}/submit`,
            'POST',
            {
              answers: [{ questionVersionId: assignments[0].questionVersionId, value: 'A' }],
              attachmentIds: [draft.id],
              idempotencyKey: randomUUID(),
            },
            403,
          );
          const post = (
            await call(
              student,
              '/communication/posts',
              'POST',
              {
                courseId: courses[0].id,
                title: '公开后可读',
                body: '课程附件验证',
                attachmentIds: [draft.id],
              },
              201,
            )
          ).data;
          await call(teacher, `/attachments/${draft.id}/download`);
          const report = (
            await call(
              otherStudent,
              '/communication/reports',
              'POST',
              { targetType: 'post', targetId: post.id, reason: '验证隐藏后当前权限' },
              201,
            )
          ).data;
          await call(
            admin,
            `/communication/reports/${report.id}/resolve`,
            'POST',
            { action: 'hide', reason: '附件安全回归隐藏测试' },
            201,
          );
          await call(otherStudent, `/attachments/${draft.id}/download`, 'GET', undefined, 403);
          await call(teacher, `/attachments/${draft.id}/download`);

          await call(
            admin,
            `/courses/${courses[0].id}/members`,
            'POST',
            { userId: otherTeacher.id, kind: 'teacher' },
            201,
          );
          const managed = await file(teacher, '未来课时管理资源', { courseId: courses[0].id });
          await call(otherTeacher, `/attachments/${managed.id}/download`, 'GET', undefined, 403);
          const chapter = (
            await call(teacher, `/courses/${courses[0].id}/chapters`, 'POST', { title: '未开放的资源' }, 201)
          ).data;
          const lesson = (
            await call(
              teacher,
              `/chapters/${chapter.id}/lessons`,
              'POST',
              {
                title: '未来课时',
                attachmentId: managed.id,
                opensAt: new Date(Date.now() + 3600000).toISOString(),
              },
              201,
            )
          ).data;
          await call(otherTeacher, `/attachments/${managed.id}/download`);
          await call(student, `/attachments/${managed.id}/download`, 'GET', undefined, 403);
          await call(teacher, `/lessons/${lesson.id}`, 'PATCH', { attachmentId: null });
          await call(otherTeacher, `/attachments/${managed.id}/download`, 'GET', undefined, 403);
          await call(admin, `/courses/${courses[0].id}/members/${otherTeacher.id}?kind=teacher`, 'DELETE');
        },
      );

      await t.test('个人上传文件作为已开放作业说明时可下载；未开放和非参考学生不能下载', async () => {
        const attachment = await file(teacher, '作业说明文件');
        const assignment = (
          await call(
            teacher,
            '/assignments',
            'POST',
            {
              courseId: courses[0].id,
              title: '私有文件作业说明',
              questionVersionIds: [assignments[0].questionVersionId],
              attachmentIds: [attachment.id],
              audienceIds: [student.id],
              opensAt: new Date(Date.now() - 60000).toISOString(),
              dueAt: new Date(Date.now() + 3600000).toISOString(),
            },
            201,
          )
        ).data;
        await call(student, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
        await call(teacher, `/assignments/${assignment.id}/publish`, 'POST', {}, 201);
        assert.equal((await call(student, `/attachments/${attachment.id}/download`)).data, '作业说明文件');
        await call(otherStudent, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
        await call(teacher, `/courses/${courses[0].id}/members/${student.id}`, 'DELETE');
        await call(student, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
        await call(teacher, `/courses/${courses[0].id}/members`, 'POST', { userId: student.id }, 201);
      });

      await t.test('同一个人附件复用两课程提交时按请求教师当前课程挑选有效引用', async () => {
        const attachment = await file(student, '两个独立课程的本人提交');
        await submit(assignments[0], attachment.id);
        await submit(assignments[1], attachment.id);
        await call(teacher, `/attachments/${attachment.id}/download`);
        await call(otherTeacher, `/attachments/${attachment.id}/download`);
        await call(otherStudent, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
        await call(admin, `/courses/${courses[1].id}`, 'PATCH', { teacherId: teacher.id });
        await call(otherTeacher, `/attachments/${attachment.id}/download`, 'GET', undefined, 403);
      });
    } finally {
      for (const course of courses)
        await call(admin, `/courses/${course.id}`, 'PATCH', { status: 'ARCHIVED' }).catch(() => undefined);
      for (const user of accounts)
        await call(admin, `/admin/users/${user.id}`, 'PATCH', { active: false }).catch(() => undefined);
    }
  },
);
