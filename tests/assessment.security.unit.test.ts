import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssessmentService } from '../apps/api/src/assessment/assessment.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';

const actor = (id: string, role = 'TEACHER'): Actor => ({
  id,
  role,
  organizationId: 'review-org',
  name: id,
  permissions: ['assessment.grade', 'learning.use'],
});
const service = (db: unknown) =>
  new AssessmentService(
    db as never,
    {
      require() {},
      async course() {},
    } as never,
    {} as never,
  ) as Omit<AssessmentService, never> & {
    finalizeAttempt: (id: string, source: string) => Promise<unknown>;
    attemptAccess: (actor: Actor, id: string, grade?: boolean) => Promise<unknown>;
  };

test('截止任务隔离单份失败，并避开失败的100份以处理下一页健康答卷', async () => {
  const records = [...Array.from({ length: 100 }, (_, index) => ({ id: `bad-${index}` })), { id: 'healthy' }];
  const jobs: { status?: string; processed?: number; error?: string | null }[] = [];
  const seen: string[] = [];
  const target = service({
    examAttempt: {
      async findMany({ where, take }: { where: { id: { notIn: string[] } }; take: number }) {
        return records.filter((record) => !where.id.notIn.includes(record.id)).slice(0, take);
      },
    },
    assessmentJobRun: {
      async create() {
        return { id: 'job' };
      },
      async update({ data }: { data: (typeof jobs)[number] }) {
        jobs.push(data);
      },
    },
  });
  // Exercise the actual scheduler while injecting transaction failure boundaries.
  Reflect.set(target, 'logger', { error() {} });
  Reflect.set(target, 'finalizeAttempt', async (id: string) => {
    seen.push(id);
    if (id.startsWith('bad-')) throw new Error('isolated transaction failure');
  });
  await target.sweepDueAttempts();
  assert.equal(seen.length, 100);
  assert.equal(jobs[0].status, 'failed');
  assert.equal(jobs[0].processed, 0);
  assert.equal(JSON.parse(jobs[0].error!).failedAttemptIds.length, 100);
  await target.sweepDueAttempts();
  assert.equal(seen.at(-1), 'healthy');
  assert.equal(seen.length, 101);
  assert.equal(jobs[1].status, 'completed');
  assert.equal(jobs[1].processed, 1);
});

test('隔离是短暂退避；到重试时间后恢复交卷且清除隔离记录', async () => {
  let finished = false;
  let calls = 0;
  const target = service({
    examAttempt: {
      async findMany({ where }: { where: { id: { notIn: string[] } } }) {
        return finished || where.id.notIn.includes('transient') ? [] : [{ id: 'transient' }];
      },
    },
    assessmentJobRun: {
      async create() {
        return { id: 'job' };
      },
      async update() {},
    },
  });
  Reflect.set(target, 'logger', { error() {} });
  Reflect.set(target, 'finalizeAttempt', async () => {
    if (++calls === 1) throw new Error('transient database error');
    finished = true;
  });
  await target.sweepDueAttempts();
  await target.sweepDueAttempts();
  assert.equal(calls, 1);
  const retries = Reflect.get(target, 'deadlineRetries') as Map<string, number>;
  retries.set('transient', Date.now() - 1);
  await target.sweepDueAttempts();
  assert.equal(calls, 2);
  assert.equal(finished, true);
  assert.equal(retries.size, 0);
});

test('非指定教师在所有答卷与成绩入口都在读取业务数据前被拒绝', async () => {
  const exam = {
    id: 'exam',
    organizationId: 'review-org',
    courseId: 'course',
    graderIds: ['assigned'],
    audience: [],
  };
  const attempt = { id: 'attempt', userId: 'student', exam };
  const target = service({
    exam: {
      async findFirst() {
        return exam;
      },
    },
    examAttempt: {
      async findUnique() {
        return attempt;
      },
    },
    gradeAppeal: {
      async findUnique() {
        return { attemptId: 'attempt' };
      },
    },
  });
  const unassigned = actor('other');
  const page = { page: 1, pageSize: 20 };
  for (const operation of [
    () => target.attempt(unassigned, 'attempt'),
    () => target.examAttempts(unassigned, 'exam', page),
    () => target.examRoster(unassigned, 'exam', page),
    () => target.examItemAnalysis(unassigned, 'exam', page),
    () => target.examQuestionAnswers(unassigned, 'exam', 'question', page),
    () => target.releaseExam(unassigned, 'exam'),
    () => target.gradeHistory(unassigned, 'attempt', page),
    () => target.resolveAppeal(unassigned, 'appeal', { resolution: '复核结论' }),
  ])
    await assert.rejects(operation(), /未被指定为本考试阅卷教师/);
  assert.equal(await target.attemptAccess(actor('assigned'), 'attempt'), attempt);
  assert.equal(await target.attemptAccess(actor('student', 'STUDENT'), 'attempt'), attempt);
});
