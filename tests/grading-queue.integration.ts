import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { gradingFixture, localGradingReview } from './helpers/grading-fixture';
if (!localGradingReview()) throw new Error('批阅集成测试必须使用隔离的本机 PostgreSQL 与 HTTP 服务');
const base = (process.env.TEST_API_URL || process.env.TEST_BASE_URL + '/api')!.replace(/\/$/, '');
async function login(username: string) {
  const res = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
  });
  assert.equal(res.status, 201);
  const cookie = res.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
  return (path: string) => fetch(base + path, { headers: { cookie } });
}
test('批阅队列通过真实 HTTP 限定教师课程、指定阅卷人与机构范围', async (t) => {
  const db = new PrismaClient();
  const f = await gradingFixture(db);
  const path = '/grading/queue?courseId=' + f.c.id;
  const teacher = await login('teacher'),
    peer = await login('teacher2'),
    admin = await login('admin'),
    student = await login('student');
  const get = async (suffix = '') => {
    const res = await teacher(path + suffix);
    assert.equal(res.status, 200);
    return res.json();
  };
  try {
    await t.test('统计、类型过滤、稳定分页与工作台同源，行仅包含办事信息', async () => {
      const all = await get();
      assert.deepEqual(
        [all.pendingAssignments, all.pendingExams, all.pendingAppeals, all.totalPending, all.total],
        [1, 1, 1, 3, 3],
      );
      assert.deepEqual(
        all.items.map((row: any) => row.type),
        ['appeal', 'assignment', 'exam'],
      );
      assert.deepEqual(
        all.items.map((row: any) => row.id),
        [f.appeal.id, f.submission.id, f.attempt.id],
      );
      const page = await get('&page=2&pageSize=1');
      assert.equal(page.total, 3);
      assert.deepEqual(page.items, [all.items[1]]);
      assert.equal(page.items[0].late, true);
      assert.deepEqual((await get('&page=4&pageSize=1')).items, []);
      const selected = await get('&type=exam');
      assert.deepEqual(
        [selected.total, selected.totalPending, selected.items[0].targetPath],
        [1, 3, '/grading/exam/' + f.attempt.id],
      );
      assert.equal(selected.items[0].courseTitle, f.c.title);
      assert.ok(selected.items[0].studentName);
      assert.equal(selected.items[0].status, 'timed_out');
      for (const row of all.items)
        for (const key of ['answers', 'reason', 'scoreCents', 'userId']) assert.equal(key in row, false);
      const dashboard = await (await teacher('/dashboard')).json(),
        whole = await (await teacher('/grading/queue')).json();
      assert.equal(dashboard.gradingQueue.totalPending, whole.totalPending);
      assert.equal(
        dashboard.metrics.find((x: any) => x.label === '待批改作业').value,
        whole.pendingAssignments,
      );
      assert.equal(dashboard.metrics.find((x: any) => x.label === '待阅卷答卷').value, whole.pendingExams);
    });
    await t.test(
      '未登录、普通学生、无权管理员、非授课与跨机构课程拒绝，不接受身份和任意分页参数',
      async () => {
        assert.equal((await fetch(base + '/grading/queue')).status, 401);
        for (const read of [student, peer, admin]) assert.equal((await read(path)).status, 403);
        const foreign = await db.organization.create({ data: { name: '批阅隔离', kind: 'INSTITUTION' } });
        const c = await db.course.create({
          data: { organizationId: foreign.id, teacherId: 'u-teacher', title: '其他机构课程' },
        });
        try {
          assert.equal((await teacher('/grading/queue?courseId=' + c.id)).status, 403);
        } finally {
          await db.course.delete({ where: { id: c.id } });
          await db.organization.delete({ where: { id: foreign.id } });
        }
        for (const params of [
          'page=0',
          'pageSize=101',
          'type=private',
          'organizationId=other',
          'userId=other',
        ])
          assert.equal((await teacher('/grading/queue?' + params)).status, 400);
      },
    );
    await t.test('同课另一位教师与获授权的管理员只看到自己可处理的事项，撤权即时生效', async () => {
      const grant = { roleId: 'ADMIN', permissionId: 'assessment.grade' };
      await db.teachingAssignment.create({ data: { courseId: f.c.id, userId: 'u-teacher2' } });
      await db.rolePermission.create({ data: grant });
      try {
        for (const read of [peer, admin]) {
          const got = await read(path);
          assert.equal(got.status, 200);
          assert.deepEqual(
            (await got.json()).items.map((r: any) => r.id),
            [f.submission.id],
          );
        }
        await db.exam.update({ where: { id: f.exam.id }, data: { graderIds: [] } });
        assert.equal((await (await admin(path)).json()).total, 3);
        await db.teachingAssignment.updateMany({
          where: { courseId: f.c.id, userId: 'u-teacher2' },
          data: { active: false },
        });
        assert.equal((await peer(path)).status, 403);
      } finally {
        await db.rolePermission.delete({ where: { roleId_permissionId: grant } });
      }
      assert.equal((await admin(path)).status, 403);
    });
    await t.test('已批改、已退回、已处理与归档课程立即退出待办', async () => {
      await db.assignmentSubmission.update({ where: { id: f.submission.id }, data: { status: 'returned' } });
      await db.examAttempt.update({ where: { id: f.attempt.id }, data: { gradingStatus: 'graded' } });
      await db.gradeAppeal.update({ where: { id: f.appeal.id }, data: { status: 'resolved' } });
      assert.equal((await get()).totalPending, 0);
      await db.course.update({ where: { id: f.c.id }, data: { status: 'ARCHIVED' } });
      await db.gradeAppeal.update({ where: { id: f.appeal.id }, data: { status: 'pending' } });
      assert.equal((await get()).total, 0);
    });
  } finally {
    try {
      await f.cleanup();
    } finally {
      await db.$disconnect();
    }
  }
});
