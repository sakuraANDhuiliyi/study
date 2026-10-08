import 'dotenv/config';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
if (process.env.NODE_ENV === 'production') throw new Error('Development verification only');
const db = new PrismaClient();
const origin = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
async function login(username: string) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  const headers = {
    'content-type': 'application/json',
    'x-csrf-token': data.csrfToken,
    cookie: response.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; '),
  };
  return async (method: string, path: string, body?: unknown) => {
    const result = await fetch(`${origin}/api${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, data: await result.json() };
  };
}
let student: Awaited<ReturnType<typeof login>>,
  other: typeof student,
  admin: typeof student,
  teacher: typeof student,
  outsider: typeof student;
const suffix = randomUUID();
const start = '2029-02-01T00:00:00+08:00',
  end = '2029-03-01T00:00:00+08:00';
const query = (type = 'all') => `/planner?${new URLSearchParams({ start, end, type })}`;
let courseId = '',
  assignmentId = '',
  examId = '';
before(async () => {
  [student, other, admin, teacher, outsider] = await Promise.all(
    ['student', 'student2', 'admin', 'teacher', 'outsider'].map(login),
  );
  const c = await db.course.create({
    data: {
      organizationId: 'org-demo',
      teacherId: 'u-teacher',
      title: '学习计划验收-' + suffix,
      status: 'PUBLISHED',
    },
  });
  courseId = c.id;
  await db.teachingAssignment.create({ data: { courseId, userId: 'u-teacher' } });
  await db.enrollment.createMany({
    data: ['u-student', 'u-student2'].map((userId) => ({ courseId, userId })),
  });
  const assignment = await db.assignment.create({
    data: {
      organizationId: 'org-demo',
      courseId,
      creatorId: 'u-teacher',
      title: '补交计划-' + suffix,
      status: 'published',
      opensAt: new Date('2029-01-01T00:00:00Z'),
      dueAt: new Date('2029-01-31T12:00:00Z'),
      totalCents: 100,
      attachmentIds: [],
      audience: { create: { userId: 'u-student' } },
      exceptions: {
        create: {
          userId: 'u-student',
          approvedBy: 'u-teacher',
          reason: '延期验证',
          allowUntil: new Date('2029-02-02T12:00:00Z'),
        },
      },
      submissions: {
        create: [
          {
            userId: 'u-student',
            version: 1,
            idempotencyKey: suffix + '-1',
            answers: { secret: '不能出现在日历' },
            attachmentIds: [],
            late: false,
            status: 'submitted',
          },
          {
            userId: 'u-student',
            version: 2,
            idempotencyKey: suffix + '-2',
            answers: {},
            attachmentIds: [],
            late: false,
            status: 'returned',
          },
        ],
      },
    },
  });
  assignmentId = assignment.id;
  const exam = await db.exam.create({
    data: {
      organizationId: 'org-demo',
      courseId,
      creatorId: 'u-teacher',
      title: '跨月考试-' + suffix,
      status: 'published',
      startsAt: new Date('2029-01-31T01:00:00Z'),
      endsAt: new Date('2029-01-31T03:00:00Z'),
      entryClosesAt: new Date('2029-01-31T02:00:00Z'),
      durationMinutes: 60,
      passCents: 60,
      totalCents: 100,
      graderIds: [],
      audience: { create: { userId: 'u-student' } },
      extensions: {
        create: {
          userId: 'u-student',
          approvedBy: 'u-teacher',
          reason: '个人延期测试',
          deadlineAt: new Date('2029-02-04T03:00:00Z'),
        },
      },
      attempts: {
        create: {
          userId: 'u-student',
          number: 1,
          startedAt: new Date('2029-01-31T02:00:00Z'),
          deadlineAt: new Date('2029-02-05T03:00:00Z'),
          questionOrder: [],
          optionOrder: {},
          flags: [],
        },
      },
    },
  });
  examId = exam.id;
});
after(async () => {
  await db.$disconnect();
});

test('Private planner tasks persist, remain private across roles, use CAS and can be reopened/deleted', async () => {
  const created = await student('POST', '/planner/tasks', {
    title: '复习安排-' + suffix,
    description: '个人备忘',
    dueAt: '2029-02-08T12:00:00+08:00',
  });
  assert.equal(created.status, 201);
  let task = created.data;
  assert.equal(task.revision, 0);
  for (const client of [other, admin, outsider]) {
    assert.equal((await client('GET', `/planner/tasks/${task.id}`)).status, 404);
    assert.equal(
      (await client('PATCH', `/planner/tasks/${task.id}`, { revision: 0, title: '越权' })).status,
      404,
    );
    assert.equal((await client('DELETE', `/planner/tasks/${task.id}`, { revision: 0 })).status, 404);
    assert(!(await client('GET', query('personal'))).data.items.some((e: any) => e.id === task.id));
  }
  const races = await Promise.all([
    student('PATCH', `/planner/tasks/${task.id}`, { revision: 0, completed: true }),
    student('PATCH', `/planner/tasks/${task.id}`, { revision: 0, title: '并发修改' }),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  task = (await student('GET', `/planner/tasks/${task.id}`)).data;
  assert.equal(task.revision, 1);
  assert.equal((await student('DELETE', `/planner/tasks/${task.id}`, { revision: 0 })).status, 409);
  task = (await student('PATCH', `/planner/tasks/${task.id}`, { revision: task.revision, completed: true }))
    .data;
  assert(task.completedAt);
  const events = (await student('GET', query('personal'))).data.items;
  assert.equal(events.find((e: any) => e.id === task.id).status, 'completed');
  task = (await student('PATCH', `/planner/tasks/${task.id}`, { revision: task.revision, completed: false }))
    .data;
  assert.equal(task.completedAt, null);
  assert.equal(
    (await student('DELETE', `/planner/tasks/${task.id}`, { revision: task.revision })).status,
    200,
  );
  assert.equal((await student('GET', `/planner/tasks/${task.id}`)).status, 404);
});

test('Calendar distinguishes individual extensions, returned work and active attempt deadlines without answers', async () => {
  const response = await student('GET', query());
  assert.equal(response.status, 200);
  const assignment = response.data.items.find((e: any) => e.id === `assignment:${assignmentId}`);
  assert.equal(assignment.startAt, '2029-02-02T12:00:00.000Z');
  assert.equal(assignment.originalDueAt, '2029-01-31T12:00:00.000Z');
  assert.equal(assignment.status, 'returned');
  const exam = response.data.items.find((e: any) => e.id === `exam:${examId}`);
  assert.equal(exam.endAt, '2029-02-05T03:00:00.000Z');
  assert.equal(exam.entryClosesAt, '2029-02-04T03:00:00.000Z');
  assert.equal(exam.status, 'in_progress');
  assert(exam.path.startsWith('/exam-attempts/'));
  assert(!/secret|questionOrder|scoreCents|answers|snapshot|csrfToken/.test(JSON.stringify(response.data)));
  assert(
    (await teacher('GET', query())).data.items.every((e: any) => e.id !== `assignment:${assignmentId}`),
    'teacher original due outside month',
  );
  for (const client of [other, outsider, admin]) {
    const events = (await client('GET', query())).data.items;
    assert(events.every((e: any) => e.id !== `exam:${examId}` && e.id !== `assignment:${assignmentId}`));
  }
  await db.examAudience.update({
    where: { examId_userId: { examId, userId: 'u-student' } },
    data: { eligible: false },
  });
  assert(!(await student('GET', query('exam'))).data.items.some((e: any) => e.id === `exam:${examId}`));
  await db.examAudience.update({
    where: { examId_userId: { examId, userId: 'u-student' } },
    data: { eligible: true },
  });
  await db.enrollment.update({
    where: { courseId_userId: { courseId, userId: 'u-student' } },
    data: { active: false },
  });
  assert(!(await student('GET', query())).data.items.some((e: any) => e.courseId === courseId));
  await db.enrollment.update({
    where: { courseId_userId: { courseId, userId: 'u-student' } },
    data: { active: true },
  });
});

test('Planner enforces half-open dates, input limits and strict ownership fields', async () => {
  for (const q of [
    '',
    `?start=${encodeURIComponent(end)}&end=${encodeURIComponent(start)}`,
    `?start=2029-01-01T00:00:00Z&end=2030-01-01T00:00:00Z`,
  ])
    assert.equal((await student('GET', '/planner' + q)).status, 400);
  assert.equal((await student('POST', '/planner/tasks', { title: '', dueAt: start })).status, 400);
  assert.equal(
    (await student('POST', '/planner/tasks', { title: '非法', dueAt: start, userId: 'u-student2' })).status,
    400,
  );
  assert.equal(
    (await student('POST', '/planner/tasks', { title: '非法', dueAt: '2029-02-01T12:00' })).status,
    400,
  );
  const task = (await student('POST', '/planner/tasks', { title: '边界-' + suffix, dueAt: end })).data;
  assert(!(await student('GET', query('personal'))).data.items.some((e: any) => e.id === task.id));
  const updated = (await student('PATCH', `/planner/tasks/${task.id}`, { revision: 0, dueAt: start })).data;
  assert((await student('GET', query('personal'))).data.items.some((e: any) => e.id === task.id));
  await student('DELETE', `/planner/tasks/${task.id}`, { revision: updated.revision });
});

test('Extensions outside selected month are excluded and exempt assignments are marked', async () => {
  await db.assignmentException.update({
    where: { assignmentId_userId: { assignmentId, userId: 'u-student' } },
    data: { allowUntil: new Date(end) },
  });
  assert(
    !(await student('GET', query('assignment'))).data.items.some(
      (e: any) => e.id === `assignment:${assignmentId}`,
    ),
  );
  await db.assignmentException.update({
    where: { assignmentId_userId: { assignmentId, userId: 'u-student' } },
    data: { allowUntil: new Date('2029-02-02T12:00:00Z'), exempt: true },
  });
  assert.equal(
    (await student('GET', query('assignment'))).data.items.find(
      (e: any) => e.id === `assignment:${assignmentId}`,
    ).status,
    'exempt',
  );
});

test('Chinese text limits work with PostgreSQL UTF8 and legacy development encodings', async () => {
  const created = await student('POST', '/planner/tasks', {
    title: '计'.repeat(160),
    description: '划'.repeat(10000),
    dueAt: start,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(
    (await student('POST', '/planner/tasks', { title: '计'.repeat(161), dueAt: start })).status,
    400,
  );
  assert.equal(
    (
      await student('POST', '/planner/tasks', {
        title: '计划',
        description: '划'.repeat(10001),
        dueAt: start,
      })
    ).status,
    400,
  );
  await student('DELETE', `/planner/tasks/${created.data.id}`, { revision: 0 });
});
