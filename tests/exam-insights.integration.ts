import 'dotenv/config';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createInsightsFixture, insightsLogin } from './exam-insights.fixture';
const db = new PrismaClient();
after(() => db.$disconnect());

test('Teacher exam item analysis: isolated HTTP security and denominator regression', async (t) => {
  const f = await createInsightsFixture(db);
  const path = `/exams/${f.exam.id}/item-analysis`;
  const report = () => f.teacher.call('GET', path);
  await t.test('empty published exam keeps undefined statistics null', () => {
    assert.equal(f.emptyReport.participantCount, 0);
    assert.equal(f.emptyReport.submittedAttemptCount, 0);
    for (const item of f.emptyReport.items) {
      assert.equal(item.correctRate, null);
      assert.equal(item.averageScoreCents, null);
      assert.equal(item.scoreRate, null);
      assert.equal(item.answeredCount, 0);
    }
  });
  await t.test(
    'latest finished attempt per student, timeout included, active and cancelled excluded',
    async () => {
      const result = await report();
      assert.equal(result.participantCount, 2);
      assert.equal(result.submittedAttemptCount, 3);
      assert.equal(result.smallSample, true);
      assert.equal(result.items.length, 4);
      const [single, multiple, boolean, short] = result.items;
      assert.equal(single.correctRate, 50);
      assert.equal(single.averageScoreCents, 200);
      assert.equal(single.scoreRate, 20);
      assert.equal(single.answeredCount, 1);
      assert.equal(single.unansweredCount, 1);
      assert.equal(multiple.correctRate, 50);
      assert.equal(multiple.scoreRate, 75);
      assert.deepEqual(
        multiple.options.map((o: any) => o.percent),
        [100, 50],
      );
      assert.equal(boolean.correctRate, 50);
      assert.equal(boolean.options.find((o: any) => o.id === 'false').count, 1);
      assert.equal(short.correctRate, null);
      assert.equal(short.averageScoreCents, 600);
      assert.equal(short.gradedCount, 1);
      assert.equal(short.pendingCount, 1);
    },
  );
  await t.test(
    'aggregate whitelist omits student identities, original responses, answer keys and explanation',
    async () => {
      const text = JSON.stringify(await report());
      for (const secret of [
        f.student.user.id,
        f.student2.user.id,
        f.first.id,
        f.secret,
        `保密参考-${f.suffix}`,
        `保密解析-${f.suffix}`,
      ])
        assert.ok(!text.includes(secret), secret);
      assert.ok(!text.includes('"answer":'));
      assert.ok(!text.includes('"userId":'));
    },
  );
  await t.test('student and unassigned grader are refused even before grade release', async () => {
    await f.student.call('GET', path, undefined, 403);
    await f.teacher2.call('GET', path, undefined, 403);
    await f.admin.call('GET', path, undefined, 403);
  });
  await t.test('question pagination is deterministic and caps pageSize at 50', async () => {
    const page = await f.teacher.call('GET', `${path}?page=2&pageSize=2`);
    assert.deepEqual(
      page.items.map((q: any) => q.questionVersionId),
      f.ids.slice(2),
    );
    assert.equal(page.total, 4);
    assert.equal(page.participantCount, 2);
    assert.equal((await f.teacher.call('GET', `${path}?pageSize=100`)).pageSize, 50);
    assert.deepEqual((await f.teacher.call('GET', `${path}?page=100`)).items, []);
    await f.teacher.call('GET', `${path}?page=0`, undefined, 400);
  });
  await t.test(
    'a later marking update changes the mean immediately without turning pending answers into zero',
    async () => {
      await f.teacher.call('PUT', `/attempts/${f.second.id}/grade`, {
        revision: 0,
        items: [{ questionVersionId: f.ids[3], scoreCents: 1000 }],
      });
      const short = (await report()).items[3];
      assert.equal(short.averageScoreCents, 800);
      assert.equal(short.pendingCount, 0);
      assert.equal(short.answeredCount, 1);
    },
  );
  await t.test('analysis uses frozen exam content when the source bank changes', async () => {
    await db.questionVersion.update({ where: { id: f.ids[0] }, data: { answer: 'B', stem: '后续题库文字' } });
    const single = (await report()).items[0];
    assert.equal(single.correctRate, 50);
    assert.ok(single.stem.includes(f.suffix));
  });
  await t.test('course authorization revocation and cross-organization access are refused', async () => {
    await db.teachingAssignment.updateMany({
      where: { courseId: f.course.id, userId: f.teacher.user.id },
      data: { active: false },
    });
    try {
      await f.teacher.call('GET', path, undefined, 403);
    } finally {
      await db.teachingAssignment.updateMany({
        where: { courseId: f.course.id, userId: f.teacher.user.id },
        data: { active: true },
      });
    }
    const original = await db.user.findUniqueOrThrow({ where: { id: f.teacher.user.id } });
    const org = await db.organization.create({ data: { name: `分析隔离机构-${f.suffix}` } });
    const outsider = await db.user.create({
      data: {
        organizationId: org.id,
        username: `insight-outside-${f.suffix}`,
        name: '其他机构教师',
        passwordHash: original.passwordHash,
        roles: { create: { roleId: 'TEACHER' } },
      },
    });
    await (await insightsLogin(outsider.username)).call('GET', path, undefined, 404);
  });
  await t.test(
    'sensitive grant alone does not elevate the default administrator into an exam grader',
    async () => {
      const original = await db.user.findUniqueOrThrow({ where: { id: f.admin.user.id } });
      const user = await db.user.create({
        data: {
          organizationId: original.organizationId,
          username: `insight-admin-${f.suffix}`,
          name: '分析授权管理员',
          passwordHash: original.passwordHash,
          roles: { create: { roleId: 'ADMIN' } },
        },
      });
      const admin = await insightsLogin(user.username);
      await admin.call('GET', path, undefined, 403);
      await db.sensitiveGrant.create({
        data: {
          organizationId: original.organizationId,
          userId: user.id,
          permissionId: 'analysis.sensitive',
          grantedBy: f.admin.user.id,
          reason: '自动化隔离验收',
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      await admin.call('GET', path, undefined, 403);
      await db.exam.update({ where: { id: f.exam.id }, data: { graderIds: [f.teacher.user.id, user.id] } });
      await admin.call('GET', path, undefined, 403);
      assert.equal(
        await db.auditLog.count({
          where: { userId: user.id, action: 'analysis.sensitive.read', resourceId: f.exam.id },
        }),
        0,
      );
      await db.sensitiveGrant.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await admin.call('GET', path, undefined, 403);
    },
  );
  await t.test('1000-row aggregation boundary neither skips nor duplicates answers', async () => {
    const attemptIds = Array.from(
      { length: 250 },
      (_, index) => `insight-batch-${f.suffix}-${index.toString().padStart(3, '0')}`,
    );
    const source = await db.user.findUniqueOrThrow({ where: { id: f.student.user.id } });
    await db.user.createMany({
      data: attemptIds.map((id) => ({
        id,
        username: id,
        name: '批次边界验收学生',
        organizationId: source.organizationId,
        passwordHash: source.passwordHash,
      })),
    });
    await db.examAttempt.createMany({
      data: attemptIds.map((id) => ({
        id,
        examId: f.exam.id,
        userId: id,
        number: 1,
        status: 'submitted',
        deadlineAt: new Date(),
        submittedAt: new Date(),
        questionOrder: f.ids,
        optionOrder: {},
      })),
    });
    try {
      await db.examAnswer.createMany({
        data: attemptIds.flatMap((attemptId) =>
          f.ids.map((questionVersionId) => ({
            attemptId,
            questionVersionId,
            value: 'A',
            graded: true,
            scoreCents: 1000,
          })),
        ),
      });
      const result = await report();
      assert.equal(result.participantCount, 252);
      assert.equal(result.submittedAttemptCount, 253);
      assert.equal(result.items[0].gradedCount, 252);
      assert.equal(result.items[0].correctCount, 251);
      assert.equal(result.items[0].answeredCount, 251);
      assert.equal(result.smallSample, false);
    } finally {
      await db.examAnswer.deleteMany({ where: { attemptId: { in: attemptIds } } });
      await db.examAttempt.deleteMany({ where: { id: { in: attemptIds } } });
      await db.user.deleteMany({ where: { id: { in: attemptIds } } });
    }
  });
  await t.test(
    'a cancelled exam reports explicit historical status and retains only finished attempts',
    async () => {
      await f.teacher.call('POST', `/exams/${f.exam.id}/cancel`, { reason: '取消统计验收考试' });
      const result = await report();
      assert.equal(result.exam.status, 'cancelled');
      assert.equal(result.participantCount, 2);
      assert.ok(result.rules.some((rule: string) => rule.includes('已取消')));
    },
  );
});
