import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
if (process.env.NODE_ENV === 'production') throw new Error('E2E tests require a development database');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const db = new PrismaClient();
after(() => db.$disconnect());
type Client = {
  cookie: string;
  csrf: string;
  user: any;
  call: (method: string, path: string, body?: unknown, status?: number) => Promise<any>;
};
async function login(username: string, password = process.env.DEV_SEED_PASSWORD!): Promise<Client> {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const result = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const client = {
    cookie,
    csrf: result.csrfToken,
    user: result.user,
    call: async (method: string, path: string, body?: unknown, status?: number) => {
      const r = await fetch(base + '/api' + path, {
        method,
        headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': client.csrf },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      if (status !== undefined) assert.equal(r.status, status, `${method} ${path}: ${text}`);
      else assert(r.ok, `${method} ${path}: ${r.status} ${text}`);
      return text ? JSON.parse(text) : null;
    },
  };
  return client;
}
test('Real PostgreSQL workflow: organization → course → learning → assignment versions → practice → exam → grade appeal, with authorization boundaries', async (t) => {
  const [admin, teacher, student, student2, teacher2, superadmin] = await Promise.all(
    ['admin', 'teacher', 'student', 'student2', 'teacher2', 'superadmin'].map((x) => login(x)),
  );
  const suffix = randomUUID().slice(0, 8);
  let course: any, lesson: any, assignment: any, submission: any, exam: any, attempt: any, q1: any, q2: any;
  await t.test('Cookie session, CSRF, role ceilings, robust import preview', async () => {
    assert.equal((await fetch(base + '/api/auth/me')).status, 401);
    const malformed = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(malformed.status, 400);
    assert((await malformed.json()).error.requestId);
    assert.equal(
      (
        await fetch(base + '/api/auth/profile', {
          method: 'PATCH',
          headers: { cookie: student.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'blocked' }),
        })
      ).status,
      403,
    );
    await admin.call(
      'POST',
      '/admin/users',
      {
        username: 'forbidden-' + suffix,
        name: '禁止提权',
        password: 'E2e_password_123!',
        roles: ['SUPER_ADMIN'],
      },
      403,
    );
    await admin.call('PATCH', '/admin/users/' + admin.user.id, { roles: ['SUPER_ADMIN'] }, 403);
    await student.call('POST', '/auth/role', { role: 'TEACHER' }, 403);
    const preview = await admin.call('POST', '/admin/users/import', {
      rows: [null, { username: 123 }, {}],
      commit: true,
    });
    assert.equal(preview.committed, false);
    assert(preview.errors.length >= 3);
    const u = await admin.call('POST', '/admin/users', {
      username: 'e2e-' + suffix,
      name: '验收学生',
      password: 'E2e_password_123!',
      studentNo: 'e2e-' + suffix,
      roles: ['STUDENT'],
    });
    assert(!JSON.stringify(u).includes('passwordHash'));
    const temporary = await login(u.username, 'E2e_password_123!');
    await admin.call('PATCH', '/admin/users/' + u.id, { active: false });
    await temporary.call('GET', '/auth/me', undefined, 401);
  });
  await t.test('Institution data dictionary persists and remains permission scoped', async () => {
    const previous = await db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: admin.user.organizationId, key: 'dataDictionary' } },
    });
    const value = { courseCategories: ['验收分类-' + suffix], grades: ['验收年级-' + suffix] };
    try {
      await teacher.call(
        'PATCH',
        '/admin/settings',
        { key: 'dataDictionary', value, reason: '越权配置应被服务端拒绝' },
        403,
      );
      await admin.call('PATCH', '/admin/settings', {
        key: 'dataDictionary',
        value,
        reason: '验收机构字典持久化与使用',
      });
      const catalog = await student.call('GET', '/catalog');
      assert.deepEqual(catalog, value);
    } finally {
      if (previous)
        await db.systemSetting.update({ where: { id: previous.id }, data: { value: previous.value! } });
      else
        await db.systemSetting.deleteMany({
          where: { organizationId: admin.user.organizationId, key: 'dataDictionary' },
        });
    }
  });
  await t.test('Teacher assignment, course publish, enrollment and learning resume', async () => {
    const cl = await admin.call('POST', '/admin/classes', { name: '验收班-' + suffix, grade: '2026' });
    await admin.call('POST', `/admin/classes/${cl.id}/members`, { userId: student.user.id });
    course = await admin.call('POST', '/courses', {
      title: '完整流程验收-' + suffix,
      teacherId: teacher.user.id,
      category: '验收',
    });
    const chapter = await teacher.call('POST', `/courses/${course.id}/chapters`, {
      title: '第一章',
      sortOrder: 0,
    });
    lesson = await teacher.call('POST', `/chapters/${chapter.id}/lessons`, {
      title: '学习与练习',
      content: '<p>测试课时</p><script>alert(1)</script>',
      type: 'TEXT',
    });
    await admin.call('POST', `/admin/classes/${cl.id}/courses`, { courseId: course.id });
    await admin.call('POST', `/courses/${course.id}/members`, { userId: student2.user.id, kind: 'student' });
    await student.call('GET', `/courses/${course.id}`, undefined, 403);
    await teacher.call('PATCH', `/courses/${course.id}`, { status: 'PUBLISHED' });
    await teacher2.call('PATCH', `/courses/${course.id}`, { title: 'unauthorized' }, 403);
    await student.call('PUT', `/lessons/${lesson.id}/progress`, { completed: true, positionSeconds: 45 });
    const detail = await student.call('GET', `/courses/${course.id}`);
    assert.equal(detail.progress.completed, 1);
    assert.equal(detail.chapters[0].lessons[0].progress.positionSeconds, 45);
    assert(!detail.chapters[0].lessons[0].content.includes('<script>'));
  });
  await t.test('Assignment immutable versions, idempotency, feedback and re-submission', async () => {
    q1 = await teacher.call('POST', '/questions', {
      courseId: course.id,
      type: 'single',
      stem: '1 + 1 = ?',
      options: [
        { id: 'A', text: '2' },
        { id: 'B', text: '3' },
      ],
      answer: 'A',
      scoreCents: 500,
      knowledgePoints: ['加法'],
      practiceEnabled: false,
    });
    q2 = await teacher.call('POST', '/questions', {
      courseId: course.id,
      type: 'short',
      stem: '说明计算过程',
      answer: '将两个一相加',
      scoreCents: 500,
      practiceEnabled: false,
    });
    const ids = [q1.versions[0].id, q2.versions[0].id];
    assignment = await teacher.call('POST', '/assignments', {
      courseId: course.id,
      title: '验收作业',
      opensAt: new Date(Date.now() - 60000).toISOString(),
      dueAt: new Date(Date.now() + 3600000).toISOString(),
      questionVersionIds: ids,
      maxAttempts: 2,
    });
    await teacher.call('POST', `/assignments/${assignment.id}/publish`, {});
    const answers = [
      { questionVersionId: ids[0], value: 'A' },
      { questionVersionId: ids[1], value: '两个一合为二' },
    ];
    const draft = await student.call('PUT', `/assignments/${assignment.id}/draft`, { answers, revision: 0 });
    assert.equal(draft.revision, 1);
    await student.call('PUT', `/assignments/${assignment.id}/draft`, { answers, revision: 0 }, 409);
    const body = { answers, idempotencyKey: 'assign-' + suffix };
    submission = await student.call('POST', `/assignments/${assignment.id}/submit`, body);
    const duplicate = await student.call('POST', `/assignments/${assignment.id}/submit`, body);
    assert.equal(duplicate.id, submission.id);
    assert.equal(submission.scoreCents, null);
    await teacher.call('PUT', `/submissions/${submission.id}/grade`, {
      revision: 0,
      items: [{ questionVersionId: ids[1], scoreCents: 400, comment: '表达清楚' }],
      comment: '继续保持',
    });
    let detail = await student.call('GET', `/assignments/${assignment.id}`);
    assert.equal(detail.mySubmissions[0].scoreCents, null);
    await teacher.call('POST', `/assignments/${assignment.id}/release`, {});
    detail = await student.call('GET', `/assignments/${assignment.id}`);
    assert.equal(detail.mySubmissions[0].scoreCents, 900);
    await teacher.call('PATCH', `/questions/${q1.id}`, {
      expectedVersion: 1,
      stem: '新版题干不应影响旧提交',
    });
    detail = await student.call('GET', `/assignments/${assignment.id}`);
    assert.equal(detail.items[0].question.stem, '1 + 1 = ?');
    const second = await student.call('POST', `/assignments/${assignment.id}/submit`, {
      answers,
      idempotencyKey: 'resubmit-' + suffix,
    });
    assert.equal(second.version, 2);
    const history = await student.call('GET', `/assignments/${assignment.id}/submissions`);
    assert.equal(history.total, 2);
    assert(
      history.items.some(
        (s: any) => s.id === submission.id && s.grading.length === 1 && s.scoreCents === 900,
      ),
    );
    const another = await student2.call('GET', `/assignments/${assignment.id}/submissions`);
    assert.equal(another.total, 0);
  });
  await t.test('Practice updates mistakes and favorites without accessing secret questions', async () => {
    const q = await teacher.call('POST', '/questions', {
      courseId: course.id,
      type: 'single',
      stem: '2 + 2 = ?',
      options: [
        { id: 'A', text: '4' },
        { id: 'B', text: '5' },
      ],
      answer: 'A',
      explanation: '两个二相加为四',
      scoreCents: 100,
      knowledgePoints: ['加法'],
      practiceEnabled: true,
    });
    const practice = await student.call('POST', '/practice', {
      courseId: course.id,
      count: 1,
      questionIds: [q.id],
    });
    const result = await student.call('POST', `/practice/${practice.id}/answer`, {
      questionVersionId: q.versions[0].id,
      value: 'B',
    });
    assert.equal(result.answer.correct, false);
    assert.equal(result.question.answer, 'A');
    const mistakes = await student.call('GET', `/mistakes?courseId=${course.id}`);
    assert(mistakes.items.some((m: any) => m.questionId === q.id));
    await student.call('PUT', `/questions/${q.id}/favorite`, { favorite: true });
    const favorites = await student.call('GET', `/favorites?courseId=${course.id}`);
    assert(favorites.items.some((f: any) => f.questionId === q.id));
    await student.call('POST', '/practice', { courseId: course.id, count: 1, questionIds: [q1.id] }, 400);
  });
  await t.test('Exam eligibility, answer redaction, stable shuffle, CAS and idempotent submit', async () => {
    const question = await teacher.call('POST', '/questions', {
      courseId: course.id,
      type: 'single',
      stem: '考试专用：3 + 3 = ?',
      options: [
        { id: 'A', text: '6' },
        { id: 'B', text: '7' },
      ],
      answer: 'A',
      explanation: '保密解析',
      scoreCents: 1000,
      practiceEnabled: false,
    });
    const subject = await teacher.call('POST', '/questions', {
      courseId: course.id,
      type: 'short',
      stem: '说明考试推导过程',
      answer: '参考评分要点',
      scoreCents: 1000,
      practiceEnabled: false,
    });
    exam = await teacher.call('POST', '/exams', {
      courseId: course.id,
      title: '可靠性验收考试',
      startsAt: new Date(Date.now() - 3600000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
      durationMinutes: 30,
      questionVersionIds: [question.versions[0].id, subject.versions[0].id],
      passCents: 1200,
      shuffleQuestions: true,
      shuffleOptions: true,
      graderIds: [teacher.user.id],
      answerReleaseAt: new Date(Date.now() + 7200000).toISOString(),
      explanationReleaseAt: new Date(Date.now() + 7200000).toISOString(),
      appealDeadline: new Date(Date.now() + 86400000).toISOString(),
    });
    await teacher.call('POST', `/exams/${exam.id}/publish`, {});
    attempt = await student.call('POST', `/exams/${exam.id}/start`, {});
    assert(attempt.items.every((q: any) => !('answer' in q) && !('explanation' in q) && !('rules' in q)));
    await student.call('GET', `/questions/${question.id}`, undefined, 403);
    await student2.call('GET', `/attempts/${attempt.id}`, undefined, 403);
    await teacher2.call('GET', `/attempts/${attempt.id}`, undefined, 403);
    const saved = await student.call('PUT', `/attempts/${attempt.id}/answers`, {
      revision: 0,
      answers: [
        { questionVersionId: question.versions[0].id, value: 'A' },
        { questionVersionId: subject.versions[0].id, value: '三个与三个相加' },
      ],
    });
    assert.equal(saved.revision, 1);
    await student.call('PUT', `/attempts/${attempt.id}/answers`, { revision: 0, answers: [] }, 409);
    const restored = await student.call('GET', `/attempts/${attempt.id}`);
    assert.equal(restored.answers.length, 2);
    assert.deepEqual(
      restored.items.map((q: any) => [q.id, q.options]),
      attempt.items.map((q: any) => [q.id, q.options]),
    );
    const [s1, s2] = await Promise.all([
      student.call('POST', `/attempts/${attempt.id}/submit`, { idempotencyKey: 'exam-' + suffix }),
      student.call('POST', `/attempts/${attempt.id}/submit`, { idempotencyKey: 'exam-' + suffix }),
    ]);
    assert.equal(s1.id, s2.id);
    assert.equal(s1.gradingStatus, 'pending');
    assert.equal(s1.scoreCents, null);
    await student.call('PUT', `/attempts/${attempt.id}/answers`, { revision: s1.revision, answers: [] }, 409);
    const graded = await teacher.call('PUT', `/attempts/${attempt.id}/grade`, {
      revision: 0,
      items: [{ questionVersionId: subject.versions[0].id, scoreCents: 800, comment: '思路正确' }],
    });
    assert.equal(graded.scoreCents, 1800);
    await db.exam.update({
      where: { id: exam.id },
      data: {
        endsAt: new Date(Date.now() - 1000),
        entryClosesAt: new Date(Date.now() - 2000),
        scoreReleaseAt: new Date(Date.now() - 500),
      },
    });
    await teacher.call('POST', `/exams/${exam.id}/release`, {});
    const released = await student.call('GET', `/attempts/${attempt.id}`);
    assert.equal(released.scoreCents, 1800);
    assert(released.items.every((q: any) => !('answer' in q) && !('explanation' in q)));
    await db.exam.update({ where: { id: exam.id }, data: { answerReleaseAt: new Date(Date.now() - 1000) } });
    const answers = await student.call('GET', `/attempts/${attempt.id}`);
    assert(answers.items.every((q: any) => 'answer' in q && !('explanation' in q)));
    await db.exam.update({
      where: { id: exam.id },
      data: { explanationReleaseAt: new Date(Date.now() - 1000) },
    });
  });
  await t.test('Appeal changes require independent grant and retain score history', async () => {
    const appeal = await student.call('POST', `/attempts/${attempt.id}/appeals`, {
      reason: '请复核第二题的评分标准',
    });
    await teacher.call(
      'POST',
      `/appeals/${appeal.id}/resolve`,
      { resolution: '复核后增加一分', scoreCents: 1900 },
      403,
    );
    await superadmin.call('POST', '/admin/grants', {
      userId: teacher.user.id,
      permissionId: 'grade.revise',
      reason: '验收：授权教师处理本次复核',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    await teacher.call('POST', `/appeals/${appeal.id}/resolve`, {
      resolution: '复核后增加一分',
      scoreCents: 1900,
    });
    const history = await teacher.call('GET', `/attempts/${attempt.id}/revisions`);
    assert(history.items.some((h: any) => h.oldScoreCents === 1800 && h.newScoreCents === 1900));
    const analytics = await student.call('GET', `/analytics?courseId=${course.id}`);
    assert(analytics.scoreTrend.some((s: any) => s.score === 95));
    await db.sensitiveGrant.deleteMany({ where: { userId: teacher.user.id, permissionId: 'grade.revise' } });
  });
  await t.test(
    'Analytics export matches authorized published score detail and revocation is immediate',
    async () => {
      const grant = await superadmin.call('POST', '/admin/grants', {
        userId: teacher.user.id,
        permissionId: 'data.export',
        reason: '验收：核对课程成绩明细与报表',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      try {
        const report = await teacher.call('GET', `/analytics?courseId=${course.id}`);
        const response = await fetch(base + `/api/analytics/export?courseId=${course.id}`, {
          headers: { cookie: teacher.cookie },
        });
        assert.equal(response.status, 200);
        const csv = await response.text();
        assert.equal(csv.trim().split('\r\n').length, report.scoreTrend.length + 1);
        assert(csv.includes('"95"'));
        for (const row of report.scoreTrend) {
          assert(csv.includes(row.userId));
          assert(csv.includes('"' + row.score + '"'));
        }
      } finally {
        await superadmin.call('DELETE', `/admin/grants/${grant.id}`, {
          reason: '验收完成，撤销临时导出授权',
        });
      }
      const revoked = await fetch(base + `/api/analytics/export?courseId=${course.id}`, {
        headers: { cookie: teacher.cookie },
      });
      assert.equal(revoked.status, 403);
    },
  );
  await t.test('Membership revocation removes subsequent data access', async () => {
    await admin.call('DELETE', `/courses/${course.id}/members/${student.user.id}?kind=student`);
    await student.call('GET', `/courses/${course.id}`, undefined, 403);
    await student.call('GET', `/attempts/${attempt.id}`, undefined, 403);
    await admin.call('POST', `/courses/${course.id}/members`, { userId: student.user.id, kind: 'student' });
  });
  await t.test('Lesson task links enforce course scope, visibility and paged current members', async () => {
    const links = [
      { type: 'assignment', id: assignment.id },
      { type: 'exam', id: exam.id },
      { type: 'practice', id: lesson.chapterId },
    ];
    await teacher.call('PATCH', `/lessons/${lesson.id}`, { relatedTasks: links });
    const visible = await student.call('GET', `/courses/${course.id}`);
    assert.equal(visible.chapters[0].lessons[0].relatedTasks.length, 3);
    await teacher.call(
      'PATCH',
      `/lessons/${lesson.id}`,
      { relatedTasks: [{ type: 'exam', id: 'demo-exam' }] },
      400,
    );
    const hidden = await teacher.call('POST', '/assignments', {
      courseId: course.id,
      title: '未发布关联任务',
      opensAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 3600000).toISOString(),
      questionVersionIds: [q1.versions[0].id],
    });
    await teacher.call('PATCH', `/lessons/${lesson.id}`, {
      relatedTasks: [...links, { type: 'assignment', id: hidden.id }],
    });
    const after = await student.call('GET', `/courses/${course.id}`);
    assert(!after.chapters[0].lessons[0].relatedTasks.some((task: any) => task.id === hidden.id));
    const first = await teacher.call('GET', `/courses/${course.id}/members?page=1&pageSize=1&kind=student`);
    const second = await teacher.call('GET', `/courses/${course.id}/members?page=2&pageSize=1&kind=student`);
    assert.equal(first.total, 2);
    assert.equal(first.items.length, 1);
    assert.notEqual(first.items[0].id, second.items[0].id);
    await student.call('GET', `/courses/${course.id}/members`, undefined, 403);
  });
});

test('Deadline worker completes expired exam without browser interaction and restarts safely', async () => {
  const [teacher, student] = await Promise.all([login('teacher'), login('student')]);
  const q = await teacher.call('POST', '/questions', {
    courseId: 'course-math',
    type: 'boolean',
    stem: '服务端到期测试',
    answer: true,
    scoreCents: 100,
    practiceEnabled: false,
  });
  const exam = await teacher.call('POST', '/exams', {
    courseId: 'course-math',
    title: '到期验收-' + randomUUID().slice(0, 8),
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 600000).toISOString(),
    entryClosesAt: new Date(Date.now() + 300000).toISOString(),
    durationMinutes: 1,
    questionVersionIds: [q.versions[0].id],
    passCents: 60,
  });
  await teacher.call('POST', `/exams/${exam.id}/publish`, {});
  const attempt = await student.call('POST', `/exams/${exam.id}/start`, {});
  await db.examAttempt.update({
    where: { id: attempt.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });
  const until = Date.now() + 20000;
  let stored = await db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  while (stored.status === 'in_progress' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500));
    stored = await db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }
  assert.equal(stored.status, 'timed_out');
  assert.equal(stored.gradingStatus, 'graded');
  assert.equal(stored.scoreCents, 0);
  await student.call('POST', `/attempts/${attempt.id}/submit`, { idempotencyKey: 'timeout-retry-key' });
  assert.equal(await db.examAttempt.count({ where: { examId: exam.id, userId: student.user.id } }), 1);
});
