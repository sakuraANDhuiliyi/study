import 'dotenv/config';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';

const base = process.env.TEST_BASE_URL;
if (
  !base ||
  process.env.NODE_ENV === 'production' ||
  !new URL(process.env.DATABASE_URL!).pathname.includes('review')
)
  throw new Error(
    'Security regressions require an explicitly selected isolated review database and TEST_BASE_URL',
  );
const db = new PrismaClient();
after(() => db.$disconnect());
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function client(username: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
  });
  assert.equal(response.status, 201);
  const session = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  async function raw(method: string, path: string, body?: unknown) {
    const result = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        cookie,
        'x-csrf-token': session.csrfToken,
        ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    return { status: result.status, body: await result.json() };
  }
  return {
    user: session.user,
    raw,
    async call(method: string, path: string, body?: unknown, status?: number) {
      const result = await raw(method, path, body);
      if (status) assert.equal(result.status, status, JSON.stringify(result.body));
      else
        assert.ok(
          result.status >= 200 && result.status < 300,
          `${path}: ${result.status} ${JSON.stringify(result.body)}`,
        );
      return result.body;
    },
  };
}
async function waitForBlockedAttemptQuery() {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const rows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
      AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
      AND query LIKE '%ExamAttempt%'`;
    if (Number(rows[0]?.count) > 0) return;
    await delay(20);
  }
  throw new Error('The API request did not reach the intended database lock boundary');
}
async function holdRow(table: 'User' | 'ExamAttempt', id: string) {
  let ready!: () => void;
  let release!: (mutate?: (tx: Prisma.TransactionClient) => Promise<void>) => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const releasePromise = new Promise<((tx: Prisma.TransactionClient) => Promise<void>) | undefined>(
    (resolve) => {
      release = resolve;
    },
  );
  const finished = db.$transaction(
    async (tx) => {
      if (table === 'User') await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "ExamAttempt" WHERE id = ${id} FOR UPDATE`;
      ready();
      const mutate = await releasePromise;
      if (mutate) await mutate(tx);
    },
    { timeout: 15000 },
  );
  await readyPromise;
  return { release, finished };
}

test('Assessment security regressions use independent data and real PostgreSQL lock boundaries', async (t) => {
  const [admin, teacher] = await Promise.all(['admin', 'teacher'].map(client));
  const suffix = randomUUID().slice(0, 8);
  const studentUser = await admin.call('POST', '/admin/users', {
    username: `review-assessment-${suffix}`,
    name: '隔离安全测试学生',
    password: process.env.DEV_SEED_PASSWORD,
    roles: ['STUDENT'],
  });
  const student = await client(studentUser.username);
  async function makeCourse(name: string) {
    const course = await admin.call('POST', '/courses', {
      title: `${name}-${suffix}`,
      teacherId: teacher.user.id,
    });
    const chapter = await teacher.call('POST', `/courses/${course.id}/chapters`, { title: '安全审查' });
    await teacher.call('POST', `/chapters/${chapter.id}/lessons`, {
      title: '测试说明',
      type: 'TEXT',
      content: '<p>隔离测试</p>',
    });
    await admin.call('POST', `/courses/${course.id}/members`, { userId: student.user.id, kind: 'student' });
    await teacher.call('PATCH', `/courses/${course.id}`, { status: 'PUBLISHED' });
    return course;
  }
  const course = await makeCourse('评测安全回归');
  async function question(name: string) {
    return teacher.call('POST', '/questions', {
      courseId: course.id,
      stem: `${name}-${randomUUID()}`,
      type: 'single',
      options: [
        { id: 'A', text: '甲' },
        { id: 'B', text: '乙' },
      ],
      answer: 'A',
      explanation: '保密解析',
      scoreCents: 100,
    });
  }
  async function makeExam(name: string, options: Record<string, unknown> = {}) {
    const questions = await Promise.all([question(name), question(name)]);
    const versions = questions.map((q) => q.versions[0].id);
    const exam = await teacher.call('POST', '/exams', {
      courseId: course.id,
      title: name,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
      durationMinutes: 30,
      passCents: 100,
      questionVersionIds: versions,
      ...options,
    });
    await teacher.call('POST', `/exams/${exam.id}/publish`, {});
    return { exam, versions };
  }

  for (const operation of ['cancel', 'revoke'] as const)
    await t.test(
      `Concurrent ${operation} cannot leave a new active attempt after its authorization check`,
      async () => {
        const { exam } = await makeExam(`并发${operation}`);
        const lock = await holdRow('User', student.user.id);
        const start = student.raw('POST', `/exams/${exam.id}/start`, {});
        let revoke: Promise<unknown> | undefined;
        try {
          await waitForBlockedAttemptQuery();
          revoke =
            operation === 'cancel'
              ? teacher.call('POST', `/exams/${exam.id}/cancel`, { reason: '安全测试取消考试' })
              : teacher.call('PUT', `/exams/${exam.id}/eligibility`, {
                  userId: student.user.id,
                  eligible: false,
                  reason: '安全测试撤销资格',
                });
          await delay(150);
        } finally {
          lock.release();
          await lock.finished;
        }
        await Promise.all([start, revoke]);
        const attempts = await db.examAttempt.findMany({
          where: { examId: exam.id, userId: student.user.id },
        });
        assert.ok(attempts.length > 0);
        assert.ok(
          attempts.every((row) => row.status === 'cancelled'),
          JSON.stringify(attempts.map(({ id, status }) => ({ id, status }))),
        );
      },
    );

  await t.test('Guessing the next revision cannot bypass the no-backtracking policy', async () => {
    const { exam, versions } = await makeExam('不可回退', { allowBacktrack: false });
    const attempt = await student.call('POST', `/exams/${exam.id}/start`, {});
    const lock = await holdRow('ExamAttempt', attempt.id);
    const stale = student.raw('PUT', `/attempts/${attempt.id}/answers`, {
      revision: 1,
      currentPosition: 0,
      answers: [{ questionVersionId: versions[0], value: 'A' }],
    });
    try {
      await waitForBlockedAttemptQuery();
    } finally {
      lock.release(async (tx) => {
        await tx.examAttempt.update({ where: { id: attempt.id }, data: { revision: 1, currentPosition: 1 } });
      });
      await lock.finished;
    }
    assert.equal((await stale).status, 409);
    assert.equal((await db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).currentPosition, 1);
  });

  await t.test(
    'Previously exposed questions stay unusable for a confidential exam after cancellation',
    async () => {
      const { exam, versions } = await makeExam('已公开旧考试');
      const attempt = await student.call('POST', `/exams/${exam.id}/start`, {});
      await student.call('POST', `/attempts/${attempt.id}/submit`, {
        idempotencyKey: `security-submit-${suffix}`,
      });
      await db.exam.update({
        where: { id: exam.id },
        data: {
          endsAt: new Date(Date.now() - 1000),
          entryClosesAt: new Date(Date.now() - 2000),
          answerReleaseAt: new Date(Date.now() - 500),
        },
      });
      assert.equal((await student.call('GET', `/attempts/${attempt.id}`)).items[0].answer, 'A');
      await teacher.call('POST', `/exams/${exam.id}/cancel`, { reason: '保留历史的取消测试' });
      const next = await teacher.call('POST', '/exams', {
        courseId: course.id,
        title: '不得复用已暴露试题',
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
        durationMinutes: 30,
        passCents: 100,
        questionVersionIds: versions,
      });
      await teacher.call('POST', `/exams/${next.id}/publish`, {}, 409);
    },
  );

  await t.test('Assignment attachments cannot silently move between course scopes', async () => {
    const otherCourse = await makeCourse('附件来源课程');
    const file = new FormData();
    file.set('courseId', otherCourse.id);
    file.set('file', new Blob(['different course scope'], { type: 'text/plain' }), 'scope.txt');
    const attachment = await teacher.call('POST', '/attachments', file);
    const q = await question('附件边界');
    await teacher.call(
      'POST',
      '/assignments',
      {
        courseId: course.id,
        title: '不允许跨课程绑定',
        opensAt: new Date(Date.now() - 1000).toISOString(),
        dueAt: new Date(Date.now() + 3600000).toISOString(),
        questionVersionIds: [q.versions[0].id],
        attachmentIds: [attachment.id],
      },
      403,
    );
  });
  await t.test('Publishing a draft rechecks whether its fixed question version is still usable', async () => {
    const q = await question('发布前停用题');
    const assignment = await teacher.call('POST', '/assignments', {
      courseId: course.id,
      title: '停用试题草稿',
      opensAt: new Date(Date.now() - 1000).toISOString(),
      dueAt: new Date(Date.now() + 3600000).toISOString(),
      questionVersionIds: [q.versions[0].id],
    });
    await teacher.call('PATCH', `/questions/${q.id}`, { expectedVersion: 1, active: false });
    await teacher.call('POST', `/assignments/${assignment.id}/publish`, {}, 403);
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, 'draft');
  });
});
