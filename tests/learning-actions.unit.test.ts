import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { AuthService } from '../apps/api/src/auth/auth.service';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import { LearningActionsService } from '../apps/api/src/planner/actions.service';
import { learningActionDto, type LearningActionRow } from '../apps/api/src/planner/actions.dto';
import {
  learningActionBucket,
  learningActionRange,
  learningActionsQuery,
} from '../apps/api/src/planner/actions.schemas';

const now = new Date('2026-12-31T10:15:00.000Z'); // Shanghai 18:15.
const base: LearningActionRow = {
  id: 'fixture',
  kind: 'personal',
  title: '认真复习',
  dueAt: '2026-12-31T12:00:00.000Z',
  courseId: null,
  courseTitle: null,
  revision: 4,
  originalDueAt: null,
  startsAt: null,
  latestStatus: null,
  latestNumber: null,
  maxAttempts: null,
  extraAttempts: null,
  allowLate: null,
  attemptId: null,
};

test('Shanghai day and next-seven-day boundaries cross year without browser-timezone dependence', () => {
  const range = learningActionRange(now);
  assert.equal(range.todayStart.toISOString(), '2026-12-30T16:00:00.000Z');
  assert.equal(range.tomorrowStart.toISOString(), '2026-12-31T16:00:00.000Z');
  assert.equal(range.upcomingEnd.toISOString(), '2027-01-07T16:00:00.000Z');
  assert.equal(learningActionBucket(new Date(now.getTime() - 1), now), 'overdue');
  assert.equal(learningActionBucket(now, now), 'today');
  assert.equal(learningActionBucket(new Date(range.tomorrowStart.getTime() - 1), now), 'today');
  assert.equal(learningActionBucket(range.tomorrowStart, now), 'upcoming');
  assert.equal(learningActionBucket(new Date(range.upcomingEnd.getTime() - 1), now), 'upcoming');
  assert.equal(learningActionBucket(range.upcomingEnd, now), null);
  const atMidnight = new Date('2027-01-01T16:00:00.000Z');
  assert.equal(learningActionRange(atMidnight).todayStart.toISOString(), atMidnight.toISOString());
});

test('Learning action pagination is bounded and caller-supplied dates and owners are rejected', () => {
  assert.deepEqual(learningActionsQuery.parse({}), { bucket: 'today', page: 1, pageSize: 10 });
  assert.deepEqual(learningActionsQuery.parse({ bucket: 'overdue', page: '10000', pageSize: '20' }), {
    bucket: 'overdue',
    page: 10000,
    pageSize: 20,
  });
  for (const input of [
    { bucket: 'all' },
    { page: 0 },
    { page: -1 },
    { page: 'nan' },
    { page: '1.1' },
    { page: '10001' },
    { pageSize: 21 },
    { pageSize: '' },
    { pageSize: -1 },
    { start: '2000-01-01' },
    { now: '2000-01-01' },
    { userId: 'peer' },
    { organizationId: 'foreign' },
    { type: 'assignment' },
  ])
    assert.equal(learningActionsQuery.safeParse(input).success, false, JSON.stringify(input));
});

test('A personal action exposes only a CAS completion summary, including already-overdue-today tasks', () => {
  const personal = learningActionDto({ ...base, dueAt: '2026-12-31T10:00:00+00:00' }, now);
  assert.deepEqual(personal, {
    id: 'fixture',
    type: 'personal',
    title: '认真复习',
    dueAt: '2026-12-31T10:00:00.000Z',
    overdue: true,
    revision: 4,
    status: 'overdue',
    action: 'complete_task',
    actionLabel: '标为完成',
    path: '/planner',
    reason: null,
  });
  assert.equal('userId' in personal, false);
  assert.equal('description' in personal, false);
});

test('Individual effective deadline preserves the original lateness rule and does not invent completion from a draft', () => {
  const assignment = {
    ...base,
    kind: 'assignment' as const,
    courseId: 'course',
    courseTitle: '数学',
    revision: null,
    originalDueAt: '2026-12-30T10:00:00.000Z',
    maxAttempts: 3,
    extraAttempts: 0,
    latestStatus: null,
    latestNumber: null,
    allowLate: false,
  };
  const dto = learningActionDto(assignment, now);
  assert.equal(dto.status, 'not_submitted');
  assert.equal(dto.action, 'submit');
  assert.equal(dto.overdue, false);
  assert.ok('originalDueAt' in dto);
  assert.equal(dto.originalDueAt, assignment.originalDueAt);
  assert.equal(dto.path, '/assignments/fixture');
  const returned = learningActionDto({ ...assignment, latestStatus: 'returned', latestNumber: 1 }, now);
  assert.equal(returned.action, 'resubmit');
  assert.equal(returned.status, 'returned');
});

test('Closed and exhausted assignments give viewing and teacher-follow-up instead of a false submit action', () => {
  const assignment = {
    ...base,
    kind: 'assignment' as const,
    originalDueAt: base.dueAt,
    maxAttempts: 1,
    extraAttempts: 0,
    latestStatus: 'returned',
    latestNumber: 1,
    allowLate: false,
  };
  const limited = learningActionDto(assignment, now);
  assert.equal(limited.reason, 'attempt_limit');
  assert.equal(limited.action, 'view');
  assert.equal(learningActionDto({ ...assignment, extraAttempts: 1 }, now).action, 'resubmit');
  const closed = learningActionDto({ ...assignment, dueAt: '2026-12-31T10:00:00Z' }, now);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.reason, 'deadline_passed');
  assert.equal(closed.action, 'view');
  const late = learningActionDto(
    { ...assignment, dueAt: '2026-12-31T10:00:00Z', allowLate: true, latestStatus: null, latestNumber: null },
    now,
  );
  assert.equal(late.action, 'submit');
  assert.equal(late.actionLabel, '补交作业');
});

test('An active exam links to its actual answer sheet even when the general start time is past', () => {
  const exam = {
    ...base,
    kind: 'exam' as const,
    startsAt: '2026-12-30T01:00:00Z',
    latestStatus: 'in_progress',
    latestNumber: 1,
    maxAttempts: 1,
    extraAttempts: 0,
    attemptId: 'my-attempt',
  };
  const dto = learningActionDto(exam, now);
  assert.equal(dto.status, 'in_progress');
  assert.equal(dto.action, 'continue_exam');
  assert.equal(dto.path, '/exam-attempts/my-attempt');
  assert.equal(dto.reason, null);
});

test('Upcoming and permitted-repeat exams distinguish viewing from an available start', () => {
  const exam = {
    ...base,
    kind: 'exam' as const,
    startsAt: '2027-01-01T01:00:00Z',
    maxAttempts: 2,
    extraAttempts: 0,
  };
  const future = learningActionDto(exam, now);
  assert.equal(future.action, 'wait_exam');
  assert.equal(future.reason, 'exam_not_started');
  const active = learningActionDto({ ...exam, startsAt: '2026-12-31T01:00:00Z' }, now);
  assert.equal(active.action, 'start_exam');
  const repeated = learningActionDto(
    { ...exam, startsAt: '2026-12-31T01:00:00Z', latestNumber: 1, latestStatus: 'submitted' },
    now,
  );
  assert.equal(repeated.action, 'start_exam');
  assert.equal(repeated.actionLabel, '再次考试');
  assert.equal('scoreCents' in repeated, false);
  assert.equal('questionOrder' in repeated, false);
});

const actor: Actor = {
  id: 'owner',
  name: '同学',
  organizationId: 'my-space',
  role: 'STUDENT',
  permissions: ['learning.use', 'course.read'],
  sessionId: 'my-session',
  csrfToken: 'my-csrf',
};
function guardedService(
  options: {
    fresh?: Actor | null;
    result?: {
      items: LearningActionRow[];
      counts: { today: number; upcoming: number; overdue: number };
      courseIds: string[];
    };
    courseState?: { courses: number; items: number };
  } = {},
) {
  let reads = 0;
  const db = {
    $queryRaw: async () => {
      reads++;
      if (reads === 1)
        return [
          options.result ?? { items: [base], counts: { today: 1, upcoming: 0, overdue: 0 }, courseIds: [] },
        ];
      return [options.courseState ?? { courses: 0, items: 0 }];
    },
  } as unknown as PrismaService;
  const auth = {
    require: (current: Actor, permission: string) => {
      if (!current.permissions.includes(permission)) throw new ForbiddenException('权限已撤销');
    },
    resolveSessionId: async () => (options.fresh === undefined ? actor : options.fresh),
  } as unknown as AuthService;
  return { service: new LearningActionsService(db, auth), reads: () => reads };
}

test('Unauthorized role or missing learning permission is rejected before private facts are read', async () => {
  const guard = guardedService();
  for (const current of [
    { ...actor, role: 'TEACHER' },
    { ...actor, permissions: ['course.read'] },
  ])
    await assert.rejects(guard.service.list(current, {}), (error) => error instanceof ForbiddenException);
  assert.equal(guard.reads(), 0);
});

test('An expired session, changed space, role or session nonce cannot publish a completed private read', async () => {
  for (const fresh of [
    null,
    { ...actor, organizationId: 'another-space' },
    { ...actor, role: 'TEACHER' },
    { ...actor, csrfToken: 'new-session-csrf' },
  ]) {
    const guard = guardedService({ fresh });
    await assert.rejects(guard.service.list(actor, {}), (error) => error instanceof UnauthorizedException);
    assert.equal(guard.reads(), 1);
  }
});

test('Permissions revoked during the read are checked again before counts or items are returned', async () => {
  for (const permissions of [['course.read'], ['learning.use']]) {
    const guard = guardedService({ fresh: { ...actor, permissions } });
    await assert.rejects(guard.service.list(actor, {}), (error) => error instanceof ForbiddenException);
    assert.equal(guard.reads(), 1);
  }
});

test('Course revocation rejects counts from every page, and audience revocation rejects displayed course facts', async () => {
  const result = {
    items: [
      {
        ...base,
        kind: 'assignment' as const,
        courseId: 'course',
        courseTitle: '课程',
        originalDueAt: base.dueAt,
        maxAttempts: 1,
        extraAttempts: 0,
      },
    ],
    counts: { today: 1, upcoming: 0, overdue: 0 },
    courseIds: ['course'],
  };
  for (const courseState of [
    { courses: 0, items: 0 },
    { courses: 1, items: 0 },
  ]) {
    const guard = guardedService({ result, courseState });
    await assert.rejects(guard.service.list(actor, {}), (error) => error instanceof ForbiddenException);
    assert.equal(guard.reads(), 2);
  }
  const emptyPage = guardedService({
    result: { ...result, items: [] },
    courseState: { courses: 0, items: 0 },
  });
  await assert.rejects(
    emptyPage.service.list(actor, { page: 2 }),
    (error) => error instanceof ForbiddenException,
  );
  const accessible = guardedService({ result, courseState: { courses: 1, items: 1 } });
  const data = await accessible.service.list(actor, {});
  assert.equal(data.total, 1);
  assert.equal('courseIds' in data, false);
});

test('Without course.read, personal-only facts do not trigger or inherit unrelated course revocation', async () => {
  const personalActor = { ...actor, permissions: ['learning.use'] };
  const guard = guardedService({ fresh: personalActor });
  const data = await guard.service.list(personalActor, {});
  assert.equal(data.items[0].type, 'personal');
  assert.equal(data.total, 1);
  assert.equal(guard.reads(), 1);
  assert.equal('courseIds' in data, false);
});
