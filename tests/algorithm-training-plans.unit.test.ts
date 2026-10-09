import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { algorithmProblems } from '../apps/api/src/algorithms/algorithms.catalog';
import {
  trainingPlanCreate,
  trainingPlanDelete,
  trainingPlanPatch,
} from '../apps/api/src/algorithms/training-plan.schemas';
import {
  AlgorithmTrainingPlansService,
  trainingPlanDto,
  trainingPlanProblemSummary,
} from '../apps/api/src/algorithms/training-plan.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';

const actor: Actor = {
  id: 'student-owner',
  organizationId: 'learning-space',
  role: 'STUDENT',
  permissions: ['learning.use'],
  name: '学生',
  sessionId: 'student-session',
};
const ids = algorithmProblems.slice(0, 3).map((problem) => problem.id);

test('私人计划严格验证文本、已知且不重复的题目、布尔状态和必要版本', () => {
  assert.deepEqual(trainingPlanCreate.parse({ title: '  周末训练  ', problemIds: [ids[1], ids[0]] }), {
    title: '周末训练',
    description: '',
    problemIds: [ids[1], ids[0]],
  });
  assert.equal(
    trainingPlanCreate.parse({ title: '纯文本', description: '<vector>\nO(n)', problemIds: ids }).description,
    '<vector>\nO(n)',
  );
  for (const body of [
    { title: ' ' },
    { title: '计划', problemIds: [] },
    { title: '计'.repeat(121), problemIds: ids },
    { title: '计划', description: '注'.repeat(801), problemIds: ids },
    { title: '计划\0', problemIds: ids },
    { title: '计划', problemIds: [ids[0], ids[0]] },
    { title: '计划', problemIds: ['missing-problem'] },
    { title: '计划', problemIds: algorithmProblems.slice(0, 51).map((problem) => problem.id) },
    { title: '计划', problemIds: ids, userId: 'other' },
    { title: '计划', problemIds: ids, archived: true },
  ])
    assert.equal(trainingPlanCreate.safeParse(body).success, false, JSON.stringify(body).slice(0, 150));
  assert.deepEqual(trainingPlanPatch.parse({ revision: 0, description: '', archived: false }), {
    revision: 0,
    description: '',
    archived: false,
  });
  for (const body of [
    { revision: 0 },
    { title: '改名' },
    { revision: '0', title: '改名' },
    { revision: -1, title: '改名' },
    { revision: 0, archived: 'true' },
    { revision: 0, organizationId: 'elsewhere', title: '改名' },
    { revision: 0, problemIds: [ids[0], ids[0]] },
  ])
    assert.equal(trainingPlanPatch.safeParse(body).success, false);
  assert.equal(trainingPlanDelete.safeParse({ revision: 0 }).success, true);
  assert.equal(trainingPlanDelete.safeParse({ revision: 0, force: true }).success, false);
});

function fixture() {
  let sequence = 0;
  const rows: any[] = [],
    submissions: any[] = [],
    trace: string[] = [];
  const state = {
    active: true,
    organizationId: actor.organizationId,
    authVersion: 0,
    passwordHash: 'fixture-only-hash',
    organizationActive: true,
    session: true,
    studentSession: true,
    permission: true,
    practice: true,
  };
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
  const tx: any = {
    user: { findUnique: async () => ({ id: actor.id, ...state }) },
    session: {
      findFirst: async (query: any) => {
        trace.push('session');
        assert.equal(query.where.id, actor.sessionId);
        assert.equal(query.where.userId, actor.id);
        if (!state.session || (query.where.role && !state.studentSession)) return null;
        return { id: actor.sessionId };
      },
    },
    organization: { findUnique: async () => ({ active: state.organizationActive }) },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM "User"')) {
        trace.push('user-lock');
        assert.ok(sql.includes('FOR UPDATE'));
        return [{ id: actor.id, ...state }];
      }
      if (sql.includes('"UserRole"')) {
        trace.push('permissions');
        assert.ok(sql.includes('FOR SHARE OF u, p'));
        return state.permission ? [{ permissionId: 'learning.use' }] : [];
      }
      if (sql.includes('"Organization"')) return [{ active: state.organizationActive }];
      if (sql.includes('"SystemSetting"')) {
        trace.push('practice');
        return [{ value: { practice: state.practice } }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    algorithmTrainingPlan: {
      findFirst: async (query: any) => {
        trace.push('own');
        assert.equal(query.where.organizationId, actor.organizationId);
        assert.equal(query.where.userId, actor.id);
        return rows.find((row) => matches(row, query.where)) ?? null;
      },
      findMany: async (query: any) => rows.filter((row) => matches(row, query.where)),
      count: async (query: any) => {
        trace.push('quota');
        assert.ok(trace.includes('user-lock'));
        return rows.filter((row) => matches(row, query.where)).length;
      },
      create: async ({ data }: any) => {
        trace.push('create');
        const row = {
          id: `plan-${++sequence}`,
          revision: 0,
          archived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        trace.push('update');
        const row = rows.find((item) => matches(item, where));
        if (!row) return { count: 0 };
        const revision = row.revision + data.revision.increment;
        Object.assign(row, data, { revision, updatedAt: new Date() });
        return { count: 1 };
      },
      deleteMany: async ({ where }: any) => {
        trace.push('delete');
        const index = rows.findIndex((row) => matches(row, where));
        if (index < 0) return { count: 0 };
        rows.splice(index, 1);
        return { count: 1 };
      },
    },
    algorithmSubmission: {
      groupBy: async ({ where }: any) => {
        trace.push('progress');
        assert.equal(where.organizationId, actor.organizationId);
        assert.equal(where.userId, actor.id);
        assert.equal(where.mode, 'submit');
        assert.equal(where.customInput, false);
        assert.equal(where.createdAt, undefined, 'Earlier accepted formal submissions count');
        return submissions.filter(
          (row) =>
            row.organizationId === where.organizationId &&
            row.userId === where.userId &&
            row.mode === where.mode &&
            row.customInput === where.customInput &&
            where.problemId.in.includes(row.problemId),
        );
      },
    },
  };
  let beforeTransaction: (() => void) | undefined;
  let tail = Promise.resolve();
  const db: any = {
    $transaction: async (run: (value: any) => Promise<unknown>) => {
      beforeTransaction?.();
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((done) => {
        release = done;
      });
      await previous;
      trace.push('transaction');
      try {
        return await run(tx);
      } finally {
        release();
      }
    },
  };
  const service = new AlgorithmTrainingPlansService(db, {
    require: (value: Actor, permission: string) => {
      if (!value.permissions.includes(permission)) throw new ForbiddenException();
    },
    checkFeature: async () => {},
  } as any);
  return {
    service,
    state,
    rows,
    submissions,
    trace,
    beforeTransaction: (hook: () => void) => {
      beforeTransaction = hook;
    },
  };
}

test('计划进度只来自同空间本人正式提交，保留选择顺序和创建前通过，公开投影无源码或身份', async () => {
  const f = fixture();
  const base = { organizationId: actor.organizationId, userId: actor.id, mode: 'submit', customInput: false };
  f.submissions.push(
    { ...base, problemId: ids[0], status: 'accepted', createdAt: new Date('2020-01-01') },
    { ...base, problemId: ids[1], status: 'wrong_answer' },
    { ...base, problemId: ids[2], status: 'accepted', mode: 'run' },
    { ...base, problemId: ids[2], status: 'accepted', customInput: true },
    { ...base, problemId: ids[2], status: 'accepted', userId: 'other-student' },
    { ...base, problemId: ids[2], status: 'accepted', organizationId: 'former-space' },
  );
  const plan = await f.service.create(actor, { title: '有序训练', problemIds: [ids[2], ids[0], ids[1]] });
  assert.deepEqual(plan.problemIds, [ids[2], ids[0], ids[1]]);
  assert.deepEqual(
    plan.problems.map((item) => item.status),
    ['todo', 'solved', 'attempted'],
  );
  assert.equal(plan.total, 3);
  assert.equal(plan.solved, 1);
  assert.equal(plan.nextProblemId, ids[2]);
  assert.ok(f.trace.indexOf('user-lock') < f.trace.indexOf('permissions'));
  assert.ok(f.trace.indexOf('permissions') < f.trace.indexOf('quota'));
  assert.ok(f.trace.indexOf('practice') < f.trace.indexOf('create'));
  const listed = await f.service.list(actor);
  assert.deepEqual(listed.limits, { maxPlans: 20, maxProblems: 50 });
  assert.equal(listed.catalog.length, algorithmProblems.length);
  assert.deepEqual(Object.keys(listed.catalog[0]), ['id', 'number', 'title', 'difficulty', 'tags']);
  assert.equal('userId' in listed.items[0], false);
  assert.equal('organizationId' in listed.items[0], false);
  const serialized = JSON.stringify(listed);
  for (const key of ['testCases', 'starterCode', 'solution', 'passwordHash', 'sessionId', 'code'])
    assert.equal(serialized.includes(`"${key}"`), false, key);
  assert.deepEqual(trainingPlanProblemSummary(algorithmProblems[0]), listed.catalog[0]);
  const done = trainingPlanDto(f.rows[0], new Map(ids.map((id) => [id, 'solved' as const])));
  assert.equal(done.nextProblemId, null);
  assert.equal(done.solved, 3);
});

test('部分更新保留遗漏字段，归档可恢复，陈旧写入或删除不会覆盖且越权ID统一404', async () => {
  const f = fixture();
  const plan = await f.service.create(actor, { title: '初始', description: '笔记', problemIds: ids });
  const archive = await f.service.patch(actor, plan.id, { revision: 0, archived: true });
  assert.equal(archive.revision, 1);
  assert.equal(archive.description, '笔记');
  await assert.rejects(f.service.patch(actor, plan.id, { revision: 0, title: '覆盖' }), ConflictException);
  await assert.rejects(f.service.delete(actor, plan.id, { revision: 0 }), ConflictException);
  const restore = await f.service.patch(actor, plan.id, {
    revision: 1,
    description: '',
    archived: false,
    problemIds: [ids[1], ids[0]],
  });
  assert.equal(restore.title, '初始');
  assert.equal(restore.description, '');
  assert.equal(restore.archived, false);
  assert.deepEqual(restore.problemIds, [ids[1], ids[0]]);
  for (const owner of [{ userId: 'peer' }, { organizationId: 'other-space' }]) {
    f.rows.push({ ...f.rows[0], ...owner, id: 'foreign-plan' });
    await assert.rejects(
      f.service.patch(actor, 'foreign-plan', { revision: 2, title: '越权' }),
      NotFoundException,
    );
    await assert.rejects(f.service.delete(actor, 'foreign-plan', { revision: 2 }), NotFoundException);
    f.rows.pop();
  }
  assert.deepEqual(await f.service.delete(actor, plan.id, { revision: 2 }), { ok: true });
  assert.equal(f.rows.length, 0);
});

test('User锁中的配额包括归档计划，并发创建只留下20份，CAS只接受一位写者', async () => {
  const f = fixture();
  const input = { title: '训练', problemIds: [ids[0]] };
  const attempts = await Promise.allSettled(Array.from({ length: 21 }, () => f.service.create(actor, input)));
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 20);
  assert.equal(f.rows.length, 20);
  const first = f.rows[0];
  await f.service.patch(actor, first.id, { revision: 0, archived: true });
  await assert.rejects(f.service.create(actor, input), ConflictException);
  const writers = await Promise.allSettled([
    f.service.patch(actor, first.id, { revision: 1, title: '窗口一' }),
    f.service.patch(actor, first.id, { revision: 1, title: '窗口二' }),
  ]);
  assert.equal(writers.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(first.revision, 2);
  await f.service.delete(actor, first.id, { revision: 2 });
  await f.service.create(actor, input);
  assert.equal(f.rows.length, 20);
});

test('写入在事务User锁后重新验证会话、空间、学生身份、权限、机构和功能开关', async () => {
  for (const [key, value, error] of [
    ['active', false, ForbiddenException],
    ['organizationId', 'former-space', ForbiddenException],
    ['session', false, UnauthorizedException],
    ['studentSession', false, UnauthorizedException],
    ['permission', false, ForbiddenException],
    ['organizationActive', false, ForbiddenException],
    ['practice', false, ForbiddenException],
  ] as const) {
    const f = fixture();
    f.beforeTransaction(() => {
      (f.state as any)[key] = value;
    });
    await assert.rejects(f.service.create(actor, { title: '排队的写入', problemIds: ids }), error);
    assert.equal(f.rows.length, 0, key);
    assert.equal(f.trace.includes('quota'), false, key);
  }
  const f = fixture();
  await assert.rejects(f.service.list({ ...actor, role: 'TEACHER' }), ForbiddenException);
  await assert.rejects(
    f.service.create({ ...actor, permissions: [] }, { title: '无权限', problemIds: ids }),
    ForbiddenException,
  );
  assert.equal(f.trace.includes('transaction'), false);
});
