import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password';

if (!process.env.TEST_BASE_URL || process.env.NODE_ENV === 'production')
  throw new Error('Security tests require TEST_BASE_URL and an isolated development database');
const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
after(() => db.$disconnect());

async function login(username: string) {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
  return {
    get: async (path: string) => {
      const r = await fetch(base + '/api' + path, { headers: { cookie } });
      assert.equal(r.status, 200, await r.clone().text());
      return r;
    },
    csrf: body.csrfToken,
  };
}

test('Analytics filters the selected class roster consistently in details, statistics and CSV', async () => {
  const suffix = randomUUID();
  const teacherUser = await db.user.create({
    data: {
      organizationId: 'org-demo',
      username: 'analytics-' + suffix,
      name: '统计审查教师',
      passwordHash: hashPassword(process.env.DEV_SEED_PASSWORD!),
      roles: { create: { roleId: 'TEACHER' } },
    },
  });
  const course = await db.course.create({
    data: {
      organizationId: 'org-demo',
      title: '班级范围审查-' + suffix,
      teacherId: teacherUser.id,
      status: 'PUBLISHED',
    },
  });
  await db.teachingAssignment.create({ data: { courseId: course.id, userId: teacherUser.id } });
  await db.enrollment.createMany({
    data: ['u-student', 'u-student2'].map((userId) => ({ courseId: course.id, userId })),
  });
  const classes = await Promise.all(
    ['A', 'B', 'empty'].map((name) =>
      db.class.create({
        data: {
          organizationId: 'org-demo',
          name: '范围-' + name + suffix,
          grade: '审查',
        },
      }),
    ),
  );
  await db.courseClass.createMany({
    data: classes.map((c) => ({ courseId: course.id, classId: c.id, name: c.name })),
  });
  await db.classMember.createMany({
    data: [
      { classId: classes[0].id, userId: 'u-student' },
      { classId: classes[1].id, userId: 'u-student2' },
    ],
  });
  const task = await db.assignment.create({
    data: {
      organizationId: 'org-demo',
      courseId: course.id,
      creatorId: teacherUser.id,
      title: '班级成绩-' + suffix,
      status: 'published',
      opensAt: new Date(Date.now() - 3600000),
      dueAt: new Date(Date.now() + 3600000),
      totalCents: 1000,
      attachmentIds: [],
      audience: { create: [{ userId: 'u-student' }, { userId: 'u-student2' }] },
    },
  });
  await db.assignmentSubmission.createMany({
    data: ['u-student', 'u-student2'].map((userId, i) => ({
      assignmentId: task.id,
      userId,
      version: 1,
      idempotencyKey: suffix + i,
      answers: {},
      attachmentIds: [],
      late: false,
      gradingStatus: 'graded',
      scoreCents: i ? 900 : 500,
      releasedAt: new Date(Date.now() - 1000),
    })),
  });
  const teacher = await login(teacherUser.username);
  const path = `/analytics?courseId=${course.id}&classId=${classes[0].id}`;
  const report = await (await teacher.get(path)).json();
  assert.deepEqual(
    report.students.map((x: any) => x.id),
    ['u-student'],
  );
  assert.deepEqual(
    report.scoreTrend.map((x: any) => x.userId),
    ['u-student'],
  );
  assert.equal(report.metrics[0].value, 50);
  assert.equal(report.taskSummary.expectedSubmissions, 1);
  assert.equal(report.taskSummary.submitted, 1);
  assert.deepEqual(
    report.classComparison.map((x: any) => x.id),
    [classes[0].id],
  );
  const empty = await (await teacher.get(`/analytics?courseId=${course.id}&classId=${classes[2].id}`)).json();
  assert.equal(empty.students.length, 0);
  assert.equal(empty.scoreTrend.length, 0);
  assert.equal(empty.taskSummary.expectedSubmissions, 0);
  const grant = await db.sensitiveGrant.create({
    data: {
      organizationId: 'org-demo',
      userId: teacherUser.id,
      grantedBy: 'u-super',
      permissionId: 'data.export',
      reason: '隔离库班级范围回归',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  try {
    const csv = await (await teacher.get(path.replace('/analytics?', '/analytics/export?'))).text();
    assert(csv.includes('u-student'));
    assert(!csv.includes('u-student2'));
    assert.equal(csv.trim().split('\r\n').length, 2);
  } finally {
    await db.sensitiveGrant.delete({ where: { id: grant.id } });
  }
});

test('Dashboard upcoming tasks are not hidden behind more than 100 expired tasks', async () => {
  const suffix = randomUUID();
  const studentUser = await db.user.create({
    data: {
      organizationId: 'org-demo',
      username: 'dashboard-' + suffix,
      name: '待办审查学生',
      passwordHash: hashPassword(process.env.DEV_SEED_PASSWORD!),
      roles: { create: { roleId: 'STUDENT' } },
    },
  });
  const course = await db.course.create({
    data: {
      organizationId: 'org-demo',
      title: '待办分页-' + suffix,
      teacherId: 'u-teacher',
      status: 'PUBLISHED',
    },
  });
  await db.teachingAssignment.create({ data: { courseId: course.id, userId: 'u-teacher' } });
  await db.enrollment.create({ data: { courseId: course.id, userId: studentUser.id } });
  const taskIds = Array.from({ length: 102 }, () => randomUUID());
  await db.assignment.createMany({
    data: taskIds.map((id, i) => ({
      id,
      organizationId: 'org-demo',
      courseId: course.id,
      creatorId: 'u-teacher',
      title: '分页-' + suffix + '-' + i,
      status: 'published',
      opensAt: new Date(Date.now() - 86400000),
      dueAt: new Date(Date.now() + (i === 101 ? 600000 : -3600000)),
      totalCents: 100,
      attachmentIds: [],
    })),
  });
  await db.assignmentAudience.createMany({
    data: taskIds.map((assignmentId) => ({ assignmentId, userId: studentUser.id })),
  });
  const student = await login(studentUser.username);
  const dashboard = await (await student.get('/dashboard')).json();
  assert(
    dashboard.tasks.some((x: any) => x.id === taskIds[101]),
    'An upcoming task was hidden by expired rows',
  );
});
