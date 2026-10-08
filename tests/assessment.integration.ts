/** Run against a seeded development server: npx tsx --test tests/assessment.integration.ts */
import 'dotenv/config';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
if (process.env.NODE_ENV === 'production')
  throw new Error('Assessment integration tests require a development database');
const origin = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const db = new PrismaClient();
after(() => db.$disconnect());
type ResponseData = { status: number; body: any };
type Client = {
  user: any;
  download(path: string): Promise<{ status: number; bytes: Buffer }>;
  raw(method: string, path: string, body?: unknown): Promise<ResponseData>;
  call(method: string, path: string, body?: unknown, expected?: number): Promise<any>;
};
async function login(username: string): Promise<Client> {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const payload = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const client: Client = {
    user: payload.user,
    async raw(method, path, body) {
      const result = await fetch(`${origin}/api${path}`, {
        method,
        headers: {
          ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }),
          cookie,
          'x-csrf-token': payload.csrfToken,
        },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });
      const text = await result.text();
      return { status: result.status, body: text ? JSON.parse(text) : null };
    },
    async download(path) {
      const response = await fetch(`${origin}/api${path}`, { headers: { cookie } });
      return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
    },
    async call(method, path, body, expected) {
      const result = await client.raw(method, path, body);
      if (expected !== undefined)
        assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(result.body)}`);
      else
        assert.ok(
          result.status >= 200 && result.status < 300,
          `${method} ${path}: ${result.status} ${JSON.stringify(result.body)}`,
        );
      return result.body;
    },
  };
  return client;
}

// Each run creates its own course and questions, so execution is safe beside root E2E tests.
test('Assessment concurrency, confidential question isolation and grading invariants', async (t) => {
  const [admin, teacher, student, student2, teacher2] = await Promise.all(
    ['admin', 'teacher', 'student', 'student2', 'teacher2'].map(login),
  );
  const suffix = randomUUID().slice(0, 8);
  const course = await admin.call('POST', '/courses', {
    title: `评测并发验收-${suffix}`,
    teacherId: teacher.user.id,
    category: '自动化验收',
  });
  for (const user of [student, student2])
    await admin.call('POST', `/courses/${course.id}/members`, { userId: user.user.id, kind: 'student' });
  await admin.call('POST', `/courses/${course.id}/members`, { userId: teacher2.user.id, kind: 'teacher' });
  const chapter = await teacher.call('POST', `/courses/${course.id}/chapters`, { title: '集成验收章节' });
  await teacher.call('POST', `/chapters/${chapter.id}/lessons`, {
    title: '评测说明',
    type: 'TEXT',
    content: '<p>评测集成验收课程。</p>',
  });
  await teacher.call('PATCH', `/courses/${course.id}`, { status: 'PUBLISHED' });
  const makeQuestion = (stem: string, type = 'single', practiceEnabled = false) =>
    teacher.call('POST', '/questions', {
      courseId: course.id,
      type,
      stem: `${stem}-${suffix}`,
      options:
        type === 'single'
          ? [
              { id: 'A', text: '正确选项' },
              { id: 'B', text: '错误选项' },
            ]
          : [],
      answer: type === 'single' ? 'A' : '内部评分依据，不得提前公开',
      explanation: `秘密解析-${suffix}`,
      scoreCents: 1000,
      practiceEnabled,
      scope: 'private',
    });
  const objective = await makeQuestion('并发测试客观题');
  const subject1 = await makeQuestion('第一道主观题', 'short');
  const subject2 = await makeQuestion('第二道主观题', 'short');
  const versionIds = [objective, subject1, subject2].map((q) => q.versions[0].id);
  const examInput = (title: string, ids: string[]) => ({
    courseId: course.id,
    title: `${title}-${suffix}`,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
    durationMinutes: 30,
    questionVersionIds: ids,
    graderIds: [teacher.user.id],
    passCents: 500,
    shuffleQuestions: true,
    shuffleOptions: true,
    commentReleaseAt: new Date(Date.now() + 7200000).toISOString(),
  });
  await teacher.call(
    'POST',
    '/exams',
    {
      ...examInput('评语不得提前公开', versionIds),
      commentReleaseAt: new Date(Date.now() - 1000).toISOString(),
    },
    400,
  );
  const exam = await teacher.call('POST', '/exams', examInput('并发答题与阅卷', versionIds));
  await teacher.call('POST', `/exams/${exam.id}/publish`, {});
  let attempt: any;

  await t.test('Concurrent begin requests resolve to exactly one active attempt', async () => {
    const starts = await Promise.all(
      Array.from({ length: 5 }, () => student.call('POST', `/exams/${exam.id}/start`, {})),
    );
    assert.equal(new Set(starts.map((row) => row.id)).size, 1);
    attempt = starts[0];
    assert.equal(await db.examAttempt.count({ where: { examId: exam.id, userId: student.user.id } }), 1);
    assert.ok(attempt.items.every((q: any) => !('answer' in q) && !('explanation' in q) && !('rules' in q)));
    assert.ok(!JSON.stringify(attempt).includes(`秘密解析-${suffix}`));
  });

  await t.test('Two stale autosaves cannot overwrite each other; one receives 409', async () => {
    const requests = ['A', 'B'].map((value) => ({
      revision: 0,
      answers: [{ questionVersionId: versionIds[0], value }],
    }));
    const results = await Promise.all(
      requests.map((body) => student.raw('PUT', `/attempts/${attempt.id}/answers`, body)),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const winner = results.findIndex((r) => r.status === 200);
    const restored = await student.call('GET', `/attempts/${attempt.id}`);
    assert.equal(restored.revision, 1);
    assert.equal(restored.answers[0].value, requests[winner]!.answers[0]!.value);
    assert.deepEqual(
      restored.items.map((q: any) => [q.id, q.options]),
      attempt.items.map((q: any) => [q.id, q.options]),
    );
    await student.call('PUT', `/attempts/${attempt.id}/answers`, {
      revision: 1,
      answers: [
        { questionVersionId: versionIds[0], value: 'A' },
        { questionVersionId: versionIds[1], value: '第一题学生答案' },
        { questionVersionId: versionIds[2], value: '第二题学生答案' },
      ],
    });
  });

  await t.test('Practice duplicates create one answer and one mistake increment', async () => {
    const practiceQuestion = await makeQuestion('幂等练习题', 'single', true);
    const session = await student.call('POST', '/practice', {
      courseId: course.id,
      count: 1,
      questionIds: [practiceQuestion.id],
    });
    const answers = await Promise.all(
      Array.from({ length: 5 }, () =>
        student.call('POST', `/practice/${session.id}/answer`, {
          questionVersionId: practiceQuestion.versions[0].id,
          value: 'B',
        }),
      ),
    );
    assert.equal(new Set(answers.map((row) => row.answer.id)).size, 1);
    assert.equal(await db.practiceAnswer.count({ where: { sessionId: session.id } }), 1);
    const mistake = await db.mistakeRecord.findUniqueOrThrow({
      where: { userId_questionId: { userId: student.user.id, questionId: practiceQuestion.id } },
    });
    assert.equal(mistake.wrongCount, 1);
    const flag = practiceQuestion.versions[0].id;
    const progressWrites = await Promise.all([
      student.raw('PUT', `/practice/${session.id}/progress`, {
        revision: 0,
        flags: [flag],
        currentPosition: 0,
      }),
      student.raw('PUT', `/practice/${session.id}/progress`, { revision: 0, flags: [], currentPosition: 0 }),
    ]);
    assert.deepEqual(progressWrites.map((row) => row.status).sort(), [200, 409]);
    const storedProgress = await student.call('GET', `/practice/${session.id}`);
    assert.equal(storedProgress.revision, 1);
    assert.deepEqual(storedProgress.flags, progressWrites.find((row) => row.status === 200)!.body.flags);
    await student.call('PUT', `/practice/${session.id}/progress`, {
      revision: 1,
      flags: [flag, flag],
      currentPosition: 0,
    });
    assert.deepEqual((await student.call('GET', `/practice/${session.id}`)).flags, [flag]);
    await student.call(
      'PUT',
      `/practice/${session.id}/progress`,
      { revision: 2, flags: ['another-question'], currentPosition: 0 },
      400,
    );
    await student.call(
      'PUT',
      `/practice/${session.id}/progress`,
      { revision: 2, flags: [], currentPosition: 1 },
      400,
    );
    await student2.call(
      'PUT',
      `/practice/${session.id}/progress`,
      { revision: 2, flags: [], currentPosition: 0 },
      404,
    );
    await teacher.call('PATCH', `/questions/${practiceQuestion.id}`, {
      expectedVersion: 1,
      practiceEnabled: false,
    });
    const exposedExam = await teacher.call(
      'POST',
      '/exams',
      examInput('曾公开练习题不得转保密考试', [practiceQuestion.versions[0].id]),
    );
    await teacher.call('POST', `/exams/${exposedExam.id}/publish`, {}, 400);
  });

  await t.test(
    'No answer leakage through direct question, practice, assignment or another exam',
    async () => {
      await student.call('GET', `/questions/${objective.id}`, undefined, 403);
      await teacher2.call('GET', `/questions/${objective.id}`, undefined, 403);
      await student.call(
        'POST',
        '/practice',
        { courseId: course.id, questionIds: [objective.id], count: 1 },
        400,
      );
      await teacher.call(
        'PATCH',
        `/questions/${objective.id}`,
        { expectedVersion: 1, practiceEnabled: true },
        409,
      );
      const assignment = await teacher.call('POST', '/assignments', {
        courseId: course.id,
        title: `不允许旁路公开-${suffix}`,
        opensAt: new Date(Date.now() - 1000).toISOString(),
        dueAt: new Date(Date.now() + 7200000).toISOString(),
        questionVersionIds: [versionIds[0]],
      });
      await teacher.call('POST', `/assignments/${assignment.id}/publish`, {}, 409);
      const secondExam = await teacher.call(
        'POST',
        '/exams',
        examInput('不能跨考试复用题目', [versionIds[0]]),
      );
      await teacher.call('POST', `/exams/${secondExam.id}/publish`, {}, 409);
      await student2.call('GET', `/attempts/${attempt.id}`, undefined, 403);
    },
  );

  await t.test('Published assignment questions cannot become confidential exam questions', async () => {
    const assignmentQuestion = await makeQuestion('作业专用题');
    const assignment = await teacher.call('POST', '/assignments', {
      courseId: course.id,
      title: `已发布作业隔离-${suffix}`,
      opensAt: new Date(Date.now() - 1000).toISOString(),
      dueAt: new Date(Date.now() + 7200000).toISOString(),
      questionVersionIds: [assignmentQuestion.versions[0].id],
    });
    await teacher.call('POST', `/assignments/${assignment.id}/publish`, {});
    const sharedExam = await teacher.call(
      'POST',
      '/exams',
      examInput('不能使用已公开作业题', [assignmentQuestion.versions[0].id]),
    );
    await teacher.call('POST', `/exams/${sharedExam.id}/publish`, {}, 400);
    const withoutGrader = await teacher.call('POST', '/exams', {
      ...examInput('主观题缺少阅卷安排', [subject1.versions[0].id]),
      graderIds: [],
    });
    await teacher.call('POST', `/exams/${withoutGrader.id}/publish`, {}, 400);
  });

  await t.test(
    'Concurrent final submissions score once; grading CAS and pending release are enforced',
    async () => {
      const submitted = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          student.call('POST', `/attempts/${attempt.id}/submit`, {
            idempotencyKey: `parallel-submit-${suffix}-${i}`,
          }),
        ),
      );
      assert.equal(new Set(submitted.map((a) => a.id)).size, 1);
      assert.ok(submitted.every((a) => a.gradingStatus === 'pending' && a.scoreCents === null));
      assert.equal(await db.examAnswer.count({ where: { attemptId: attempt.id } }), 3);
      const attemptsAtSubmit = await db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      assert.equal(attemptsAtSubmit.revision, 3);
      const questionAnswersPath = `/exams/${exam.id}/questions/${versionIds[1]}/answers`;
      await student.call('GET', questionAnswersPath, undefined, 403);
      await teacher2.call('GET', questionAnswersPath, undefined, 403);
      await teacher.call('GET', `/exams/${exam.id}/questions/not-part-of-this-exam/answers`, undefined, 404);
      const questionAnswers = await teacher.call('GET', `${questionAnswersPath}?pageSize=1`);
      assert.equal(questionAnswers.question.id, versionIds[1]);
      assert.equal(questionAnswers.total, 1);
      assert.equal(questionAnswers.items[0].id, attempt.id);
      assert.equal(questionAnswers.items[0].gradingRevision, 0);
      assert.equal(questionAnswers.items[0].answer.value, '第一题学生答案');
      assert.equal(questionAnswers.items[0].answer.scoreCents, null);
      assert.ok(!JSON.stringify(questionAnswers).includes('第二题学生答案'));
      const marks = await Promise.all(
        [600, 800].map((scoreCents) =>
          teacher.raw('PUT', `/attempts/${attempt.id}/grade`, {
            revision: 0,
            items: [{ questionVersionId: versionIds[1], scoreCents, comment: '第一题批阅' }],
            comment: '全卷评语应在自己的公开时间才可见',
          }),
        ),
      );
      assert.deepEqual(marks.map((r) => r.status).sort(), [200, 409]);
      const partial = await teacher.call('GET', `/attempts/${attempt.id}`);
      assert.equal(partial.gradingRevision, 1);
      assert.equal(partial.gradingStatus, 'pending');
      assert.equal(partial.scoreCents, null);
      assert.equal(partial.feedback, '全卷评语应在自己的公开时间才可见');
      const byQuestionAfterMark = await teacher.call('GET', questionAnswersPath);
      assert.equal(byQuestionAfterMark.items[0].gradingRevision, 1);
      assert.ok([600, 800].includes(byQuestionAfterMark.items[0].answer.scoreCents));
      assert.equal(await db.gradingRecord.count({ where: { attemptId: attempt.id } }), 1);
      // Move only this isolated fixture's window into the past, avoiding wall-clock sleeps.
      await db.exam.update({
        where: { id: exam.id },
        data: { endsAt: new Date(Date.now() - 1000), entryClosesAt: new Date(Date.now() - 2000) },
      });
      await teacher.call('POST', `/exams/${exam.id}/release`, {}, 409);
      await teacher2.call(
        'PUT',
        `/attempts/${attempt.id}/grade`,
        { revision: 1, items: [{ questionVersionId: versionIds[2], scoreCents: 900 }] },
        403,
      );
      const completed = await teacher.call('PUT', `/attempts/${attempt.id}/grade`, {
        revision: 1,
        items: [{ questionVersionId: versionIds[2], scoreCents: 900, comment: '第二题批阅' }],
      });
      assert.equal(completed.gradingStatus, 'graded');
      assert.ok([2500, 2700].includes(completed.scoreCents));
      assert.equal(completed.feedback, partial.feedback, '按题批阅省略总体评语时必须保留原意见');
      const gradingHistory = await db.gradingRecord.findMany({
        where: { attemptId: attempt.id },
        orderBy: { revision: 'asc' },
      });
      assert.equal(gradingHistory.length, 2);
      assert.ok(gradingHistory.every((record) => record.comment === partial.feedback));
      const beforeRelease = await student.call('GET', `/attempts/${attempt.id}`);
      assert.equal(beforeRelease.scoreCents, null);
      assert.ok(beforeRelease.answers.every((a: any) => !('scoreCents' in a) && !('comment' in a)));
      await teacher.call('POST', `/exams/${exam.id}/release`, {});
      const released = await student.call('GET', `/attempts/${attempt.id}`);
      assert.equal(released.scoreCents, completed.scoreCents);
      assert.ok(released.items.every((q: any) => !('answer' in q) && !('explanation' in q)));
      assert.ok(released.answers.every((answer: any) => !('comment' in answer)));
      assert.ok(!('feedback' in released));
      assert.ok(!JSON.stringify(released).includes('第一题批阅'));
      assert.ok(!JSON.stringify(released).includes('全卷评语应在自己的公开时间才可见'));
      await db.exam.update({
        where: { id: exam.id },
        data: { commentReleaseAt: new Date(Date.now() - 500) },
      });
      const commentsReleased = await student.call('GET', `/attempts/${attempt.id}`);
      assert.equal(commentsReleased.scoreCents, completed.scoreCents);
      assert.equal(
        commentsReleased.answers.find((answer: any) => answer.questionVersionId === versionIds[1]).comment,
        '第一题批阅',
      );
      assert.equal(commentsReleased.feedback, '全卷评语应在自己的公开时间才可见');
      assert.ok(
        commentsReleased.items.every(
          (question: any) => !('answer' in question) && !('explanation' in question),
        ),
      );
      await db.exam.update({
        where: { id: exam.id },
        data: { scoreReleaseAt: new Date(Date.now() + 3600000) },
      });
      const onlyComments = await student.call('GET', `/attempts/${attempt.id}`);
      assert.equal(onlyComments.scoreCents, null);
      assert.ok(onlyComments.answers.every((answer: any) => !('scoreCents' in answer)));
      assert.equal(onlyComments.feedback, partial.feedback, '评语可按自己的时间开放，不能受成绩时间覆盖');
      await db.exam.update({ where: { id: exam.id }, data: { scoreReleaseAt: new Date(Date.now() - 500) } });
      await teacher.call(
        'PUT',
        `/attempts/${attempt.id}/grade`,
        { revision: 2, items: [{ questionVersionId: versionIds[2], scoreCents: 0 }] },
        409,
      );
    },
  );

  await t.test('Question import rejects entire invalid batch and exports a compatible page', async () => {
    const count = await db.question.count({ where: { courseId: course.id } });
    const valid = {
      courseId: course.id,
      type: 'single',
      stem: `导入校验-${suffix}`,
      options: [
        { id: 'A', text: '甲' },
        { id: 'B', text: '乙' },
      ],
      answer: 'A',
      scoreCents: 100,
    };
    const preview = await teacher.call('POST', '/questions/import', {
      rows: [valid, { ...valid, answer: '不存在的选项' }],
      commit: false,
    });
    assert.equal(preview.items[1].success, false);
    assert.equal(preview.items[1].row, 2);
    await teacher.call(
      'POST',
      '/questions/import',
      { rows: [valid, { ...valid, answer: '不存在的选项' }], commit: true },
      400,
    );
    assert.equal(await db.question.count({ where: { courseId: course.id } }), count);
    const imported = await teacher.call('POST', '/questions/import', {
      rows: [valid, { ...valid, stem: `导入第二题-${suffix}` }],
      commit: true,
    });
    assert.equal(imported.items.length, 2);
    assert.ok(imported.items.every((row: any) => row.success && row.id));
    const exported = await teacher.call('GET', `/questions/export?courseId=${course.id}&pageSize=100`);
    assert.ok(exported.items.length >= 2);
    const validate = await teacher.call('POST', '/questions/import', { rows: exported.items, commit: false });
    assert.ok(validate.items.every((row: any) => row.success));
  });

  await t.test('Rich question stems retain safe HTTPS images in frozen practice content', async () => {
    const graphical = await makeQuestion(
      '<p>观察<strong>图形</strong></p><img src="https://example.com/triangle.png" alt="三角形" onerror="alert(1)"><script>alert(2)</script>',
      'single',
      true,
    );
    const sanitized = graphical.versions[0].stem;
    assert.ok(sanitized.includes('<strong>图形</strong>'));
    assert.ok(sanitized.includes('https://example.com/triangle.png'));
    assert.ok(!sanitized.includes('onerror'));
    assert.ok(!sanitized.includes('script'));
    const session = await student.call('POST', '/practice', {
      courseId: course.id,
      questionIds: [graphical.id],
      count: 1,
    });
    assert.equal(session.items[0].stem, sanitized);
    assert.equal(session.items[0].answer, undefined);
  });

  await t.test(
    'Recoverable assignment archive preserves versions and rechecks export permissions on old links',
    async () => {
      const exportUser = await admin.call('POST', '/admin/users', {
        username: `export-${suffix}`,
        name: `归档验收教师-${suffix}`,
        password: process.env.DEV_SEED_PASSWORD,
        roles: ['TEACHER'],
      });
      await admin.call('POST', `/courses/${course.id}/members`, { userId: exportUser.id, kind: 'teacher' });
      const exporter = await login(exportUser.username);
      const superadmin = await login('superadmin');
      const question = await makeQuestion('归档版本题');
      const assignment = await teacher.call('POST', '/assignments', {
        courseId: course.id,
        title: `归档保留重交历史-${suffix}`,
        opensAt: new Date(Date.now() - 1000).toISOString(),
        dueAt: new Date(Date.now() + 7200000).toISOString(),
        maxAttempts: 2,
        questionVersionIds: [question.versions[0].id],
      });
      await teacher.call('POST', `/assignments/${assignment.id}/publish`, {});
      const form = new FormData();
      form.set('assignmentId', assignment.id);
      form.set('file', new Blob([`archive-private-file-${suffix}`], { type: 'text/plain' }), '验收作业.txt');
      const file = await student.call('POST', '/attachments', form);
      const first = await student.call('POST', `/assignments/${assignment.id}/submit`, {
        answers: [{ questionVersionId: question.versions[0].id, value: 'B' }],
        attachmentIds: [file.id],
        idempotencyKey: `archive-first-${suffix}`,
      });
      await teacher.call('PUT', `/submissions/${first.id}/grade`, {
        revision: 0,
        items: [{ questionVersionId: question.versions[0].id, scoreCents: 0, comment: '此批注绑定第一版' }],
        comment: '第一版反馈',
      });
      const second = await student.call('POST', `/assignments/${assignment.id}/submit`, {
        answers: [{ questionVersionId: question.versions[0].id, value: 'A' }],
        attachmentIds: [file.id],
        idempotencyKey: `archive-second-${suffix}`,
      });
      const clientId = randomUUID();
      await exporter.call('POST', `/attachments/assignments/${assignment.id}/export`, { clientId }, 403);
      let grant = await superadmin.call('POST', '/admin/grants', {
        userId: exportUser.id,
        permissionId: 'data.export',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        reason: '独立验收账号授权下载作业归档',
      });
      const job = await exporter.call('POST', `/attachments/assignments/${assignment.id}/export`, {
        clientId,
      });
      const duplicate = await exporter.call('POST', `/attachments/assignments/${assignment.id}/export`, {
        clientId,
      });
      assert.equal(job.jobId, duplicate.jobId);
      let state = await exporter.call('GET', `/attachments/exports/${job.jobId}`);
      const until = Date.now() + 30000;
      while (state.status !== 'SUCCEEDED' && state.status !== 'FAILED' && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        state = await exporter.call('GET', `/attachments/exports/${job.jobId}`);
      }
      assert.equal(state.status, 'SUCCEEDED', JSON.stringify(state));
      assert.ok(state.attachmentId);
      const downloaded = await exporter.download(`/attachments/${state.attachmentId}/download`);
      assert.equal(downloaded.status, 200);
      const tar = gunzipSync(downloaded.bytes);
      assert.equal(tar.subarray(0, 100).toString().replace(/\0.*$/, ''), 'manifest.json');
      const manifestLength = parseInt(tar.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
      const manifest = JSON.parse(tar.subarray(512, 512 + manifestLength).toString());
      assert.equal(manifest.assignment.id, assignment.id);
      assert.equal(manifest.submissions.length, 2);
      const previous = manifest.submissions.find((row: any) => row.id === first.id);
      const latest = manifest.submissions.find((row: any) => row.id === second.id);
      assert.equal(previous.version, 1);
      assert.equal(previous.answers[0].value, 'B');
      assert.equal(previous.gradingHistory[0].comment, '第一版反馈');
      assert.equal(latest.version, 2);
      assert.equal(latest.answers[0].value, 'A');
      assert.ok(tar.includes(Buffer.from(`archive-private-file-${suffix}`)));
      assert.equal((await student2.download(`/attachments/${state.attachmentId}/download`)).status, 403);
      await superadmin.call('DELETE', `/admin/grants/${grant.id}`, {
        reason: '验收撤销授权后旧下载链接必须失效',
      });
      assert.equal((await exporter.download(`/attachments/${state.attachmentId}/download`)).status, 403);
      await exporter.call('GET', `/attachments/exports/${job.jobId}`, undefined, 403);
      grant = await superadmin.call('POST', '/admin/grants', {
        userId: exportUser.id,
        permissionId: 'data.export',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        reason: '再次授权验证授课关系撤销边界',
      });
      await admin.call('DELETE', `/courses/${course.id}/members/${exportUser.id}?kind=teacher`);
      assert.equal((await exporter.download(`/attachments/${state.attachmentId}/download`)).status, 403);
      await superadmin.call('DELETE', `/admin/grants/${grant.id}`, {
        reason: '集成测试结束回收临时导出授权',
      });
    },
  );
});
