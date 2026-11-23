import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export function localGradingReview() {
  try {
    const urls = [
      process.env.DATABASE_URL,
      process.env.TEST_API_URL || process.env.TEST_BASE_URL,
      process.env.WEB_BASE_URL || process.env.TEST_BASE_URL,
    ].map((value) => new URL(value!));
    return (
      process.env.NODE_ENV !== 'production' &&
      /review|test/i.test(urls[0].pathname) &&
      urls.every((url) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

export async function gradingFixture(db: PrismaClient) {
  if (!localGradingReview()) throw new Error('批阅夹具需要隔离的本机测试数据库与服务');
  const tag = randomUUID().slice(0, 8),
    org = 'org-demo',
    teacher = 'u-teacher',
    student = 'u-student';
  const stamp = new Date('2023-09-01T08:00:00+08:00');
  const opensAt = new Date(stamp.getTime() - 3_600_000);
  const c = await db.course.create({
    data: { organizationId: org, title: '批阅实习课 ' + tag, teacherId: teacher, status: 'PUBLISHED' },
  });
  await db.teachingAssignment.create({ data: { courseId: c.id, userId: teacher } });
  const work = await db.assignment.create({
    data: {
      courseId: c.id,
      organizationId: org,
      creatorId: teacher,
      title: '实践报告 ' + tag,
      status: 'published',
      totalCents: 1000,
      attachmentIds: [],
      opensAt,
      dueAt: stamp,
      audience: { create: { userId: student } },
    },
  });
  const submission = await db.assignmentSubmission.create({
    data: {
      userId: student,
      version: 1,
      idempotencyKey: tag,
      assignmentId: work.id,
      submittedAt: stamp,
      answers: [],
      attachmentIds: [],
      late: true,
    },
  });
  const exam = await db.exam.create({
    data: {
      courseId: c.id,
      organizationId: org,
      creatorId: teacher,
      title: '课程测验 ' + tag,
      status: 'published',
      startsAt: opensAt,
      endsAt: stamp,
      entryClosesAt: stamp,
      durationMinutes: 60,
      passCents: 600,
      totalCents: 1000,
      graderIds: [teacher],
      snapshot: { create: {} },
      audience: { create: { userId: student } },
    },
  });
  const attempt = await db.examAttempt.create({
    data: {
      userId: student,
      examId: exam.id,
      number: 1,
      status: 'timed_out',
      submittedAt: stamp,
      deadlineAt: stamp,
      questionOrder: [],
      optionOrder: {},
      flags: [],
    },
  });
  const scored = await db.examAttempt.create({
    data: {
      userId: student,
      examId: exam.id,
      number: 2,
      status: 'submitted',
      submittedAt: stamp,
      deadlineAt: stamp,
      gradingStatus: 'graded',
      scoreCents: 800,
      releaseStatus: 'released',
      questionOrder: [],
      optionOrder: {},
      flags: [],
    },
  });
  const appeal = await db.gradeAppeal.create({
    data: { userId: student, attemptId: scored.id, reason: '请核对步骤评分', createdAt: stamp },
  });
  async function cleanup() {
    await db.gradeAppeal.deleteMany({ where: { attempt: { examId: exam.id } } });
    await db.examAttempt.deleteMany({ where: { examId: exam.id } });
    await db.examPaperSnapshot.deleteMany({ where: { examId: exam.id } });
    await db.exam.delete({ where: { id: exam.id } });
    await db.assignmentFeedback.deleteMany({ where: { submission: { assignmentId: work.id } } });
    await db.assignmentSubmission.deleteMany({ where: { assignmentId: work.id } });
    await db.assignment.delete({ where: { id: work.id } });
    await db.teachingAssignment.deleteMany({ where: { courseId: c.id } });
    await db.course.delete({ where: { id: c.id } });
  }
  return { c, work, exam, appeal, attempt, submission, cleanup };
}
