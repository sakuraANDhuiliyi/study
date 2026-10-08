import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

export const insightsOrigin =
  process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://127.0.0.1:3001';
export function assertInsightsReviewEnvironment() {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(
    new URL(process.env.DATABASE_URL!).pathname.includes('review'),
    'Use the isolated review database',
  );
  const apiUrl = new URL(insightsOrigin);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname), 'Use a loopback test API');
  assert.ok(
    apiUrl.port === '3002' || (process.env.CI === 'true' && apiUrl.port === '3001'),
    'Use review API 3002, or explicitly enable CI=true for the isolated CI API 3001',
  );
}
export async function insightsLogin(username: string) {
  const response = await fetch(`${insightsOrigin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const payload = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  return {
    user: payload.user,
    async call(method: string, path: string, body?: unknown, status = method === 'POST' ? 201 : 200) {
      const result = await fetch(`${insightsOrigin}/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': payload.csrfToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await result.json();
      assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
      return data;
    },
  };
}
export async function createInsightsFixture(db: PrismaClient) {
  assertInsightsReviewEnvironment();
  const suffix = randomUUID().slice(0, 8);
  const [admin, teacher, student, student2, teacher2] = await Promise.all(
    ['admin', 'teacher', 'student', 'student2', 'teacher2'].map(insightsLogin),
  );
  const course = await admin.call('POST', '/courses', {
    title: `题目分析验收-${suffix}`,
    teacherId: teacher.user.id,
  });
  for (const client of [student, student2])
    await admin.call('POST', `/courses/${course.id}/members`, { userId: client.user.id, kind: 'student' });
  await admin.call('POST', `/courses/${course.id}/members`, { userId: teacher2.user.id, kind: 'teacher' });
  const chapter = await teacher.call('POST', `/courses/${course.id}/chapters`, { title: '分析验收' });
  await teacher.call('POST', `/chapters/${chapter.id}/lessons`, {
    title: '考试说明',
    type: 'TEXT',
    content: '<p>题目分析验收</p>',
  });
  await teacher.call('PATCH', `/courses/${course.id}`, { status: 'PUBLISHED' });
  const secret = `不得回传学生原文-${suffix}`;
  const questions = [];
  for (const type of ['single', 'multiple', 'boolean', 'short']) {
    questions.push(
      await teacher.call('POST', '/questions', {
        courseId: course.id,
        type,
        stem: `${type}统计题-${suffix}`,
        scoreCents: 1000,
        options: ['single', 'multiple'].includes(type)
          ? [
              { id: 'A', text: '选项甲' },
              { id: 'B', text: '选项乙' },
            ]
          : [],
        answer:
          type === 'single'
            ? 'A'
            : type === 'multiple'
              ? ['A', 'B']
              : type === 'boolean'
                ? false
                : `保密参考-${suffix}`,
        explanation: `保密解析-${suffix}`,
        rules: { partialCredit: true },
      }),
    );
  }
  const ids = questions.map((q) => q.versions[0].id);
  const exam = await teacher.call('POST', '/exams', {
    courseId: course.id,
    title: `考试题目分析-${suffix}`,
    questionVersionIds: ids,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
    durationMinutes: 30,
    maxAttempts: 3,
    passCents: 1000,
    graderIds: [teacher.user.id],
    shuffleQuestions: true,
    shuffleOptions: true,
  });
  await teacher.call('POST', `/exams/${exam.id}/publish`, {});
  const emptyReport = await teacher.call('GET', `/exams/${exam.id}/item-analysis`);
  const complete = async (client: typeof student, values: unknown[]) => {
    const attempt = await client.call('POST', `/exams/${exam.id}/start`, {});
    await client.call('PUT', `/attempts/${attempt.id}/answers`, {
      revision: attempt.revision,
      answers: values.map((value, index) => ({ questionVersionId: ids[index], value })),
    });
    await client.call('POST', `/attempts/${attempt.id}/submit`, { idempotencyKey: randomUUID() });
    return attempt;
  };
  await complete(student, ['B', ['B'], true, '旧答卷']);
  const first = await complete(student, ['A', ['A'], false, secret]);
  const second = await complete(student2, [null, ['A', 'B'], true, null]);
  await db.examAttempt.update({ where: { id: second.id }, data: { status: 'timed_out' } });
  await teacher.call('PUT', `/attempts/${first.id}/grade`, {
    revision: 0,
    items: [
      { questionVersionId: ids[0], scoreCents: 400 },
      { questionVersionId: ids[3], scoreCents: 600 },
    ],
  });
  await student.call('POST', `/exams/${exam.id}/start`, {});
  await db.examAttempt.create({
    data: {
      examId: exam.id,
      userId: student2.user.id,
      number: 2,
      status: 'cancelled',
      deadlineAt: new Date(),
      questionOrder: ids,
      optionOrder: {},
      answers: {
        create: ids.map((questionVersionId) => ({
          questionVersionId,
          value: 'A',
          graded: true,
          scoreCents: 1000,
        })),
      },
    },
  });
  return {
    admin,
    teacher,
    teacher2,
    student,
    student2,
    course,
    exam,
    questions,
    ids,
    first,
    second,
    secret,
    suffix,
    emptyReport,
  };
}
