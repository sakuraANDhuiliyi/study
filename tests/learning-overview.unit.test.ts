import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { AuthService } from '../apps/api/src/auth/auth.service';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import { StudentOverviewService } from '../apps/api/src/analytics/student-overview.service';

const now = new Date('2028-12-31T10:15:00.000Z');
const actor: Actor = {
  id: 'student',
  organizationId: 'org',
  accountMode: 'ORGANIZATION',
  role: 'STUDENT',
  name: '学习者',
  majorId: null,
  sessionId: 'session',
  csrfToken: 'csrf',
  permissions: ['learning.use', 'course.read'],
};

function setup(
  options: {
    fresh?: (index: number) => Actor | null;
    final?: { assignmentCount: number; examCount: number; courses: number; tasks: number };
    afterRead?: (index: number) => void;
  } = {},
) {
  let reads = 0;
  let resolutions = 0;
  const sql: Prisma.Sql[] = [];
  const operations: string[] = [];
  const db = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(Prisma.sql(strings, ...values));
      reads += 1;
      operations.push(`read${reads}`);
      options.afterRead?.(reads);
      return reads === 1
        ? [{ assignmentCount: 999, examCount: 998 }]
        : [options.final ?? { assignmentCount: 501, examCount: 502, courses: 1, tasks: 0 }];
    },
  } as unknown as PrismaService;
  const auth = {
    require: (a: Actor, permission: string) => {
      if (!a.permissions.includes(permission)) throw new ForbiddenException('缺少权限');
    },
    resolveSessionId: async (session: string) => {
      assert.equal(session, actor.sessionId);
      resolutions += 1;
      operations.push(`fresh${resolutions}`);
      return options.fresh ? options.fresh(resolutions) : actor;
    },
  } as unknown as AuthService;
  return { db, auth, sql, operations, service: new StudentOverviewService(db, auth), reads: () => reads };
}

test('Return the final exact aggregate and one captured server instant, never the first snapshot', async () => {
  const fixture = setup();
  const result = await fixture.service.read(actor, now, ['course', 'course'], []);
  assert.deepEqual(result, {
    assignmentCount: 501,
    examCount: 502,
    metadata: { serverTime: now.toISOString(), timezone: 'Asia/Shanghai', scope: 'actionable_now' },
  });
  assert.deepEqual(fixture.operations, ['read1', 'fresh1', 'read2', 'fresh2']);
  assert.match(fixture.sql[0].sql.slice(0, 200), /student_learning_overview_initial_counts/);
  assert.match(fixture.sql[1].sql.slice(0, 200), /student_learning_overview_final_counts/);
  for (const statement of fixture.sql) {
    const instants = statement.values.filter((value) => value instanceof Date);
    assert.ok(instants.length > 0);
    for (const value of instants) assert.equal(value, now);
    assert.match(statement.sql, /COUNT\(\*\) FILTER/);
    assert.doesNotMatch(statement.sql, /upcomingEnd|OFFSET|LIMIT\s+500|AssignmentDraft/);
  }
  assert.ok(fixture.sql[1].values.includes('["course"]'));
  assert.equal('items' in result, false);
});

test('A newly revoked audience affects the final aggregate even if the old totals are still positive', async () => {
  const fixture = setup({ final: { assignmentCount: 0, examCount: 0, courses: 1, tasks: 0 } });
  const data = await fixture.service.read(actor, now, ['course'], []);
  assert.equal(data.assignmentCount, 0);
  assert.equal(data.examCount, 0);
});

test('Empty-course users still receive a fresh zero aggregate and final identity guard', async () => {
  const fixture = setup({ final: { assignmentCount: 0, examCount: 0, courses: 0, tasks: 0 } });
  const result = await fixture.service.read(actor, now, [], []);
  assert.equal(result.assignmentCount, 0);
  assert.deepEqual(fixture.operations, ['read1', 'fresh1', 'read2', 'fresh2']);
});

test('Missing student learning/course permissions and other roles reject before database reads', async () => {
  for (const candidate of [
    { ...actor, role: 'TEACHER' },
    { ...actor, role: 'ADMIN' },
    { ...actor, permissions: ['course.read'] },
    { ...actor, permissions: ['learning.use'] },
  ]) {
    const fixture = setup();
    await assert.rejects(fixture.service.read(candidate, now, [], []), ForbiddenException);
    assert.equal(fixture.reads(), 0);
  }
});

for (const stage of [1, 2]) {
  test(`Session or scope changes at fresh stage ${stage} deny every aggregate`, async () => {
    for (const fresh of [
      null,
      { ...actor, id: 'peer' },
      { ...actor, role: 'TEACHER' },
      { ...actor, organizationId: 'other' },
      { ...actor, csrfToken: 'new-session-csrf' },
      { ...actor, accountMode: 'PERSONAL' },
    ]) {
      const fixture = setup({ fresh: (index) => (index === stage ? fresh : actor) });
      await assert.rejects(fixture.service.read(actor, now, ['course'], []), UnauthorizedException);
      assert.equal(fixture.reads(), stage);
    }
  });
  test(`Current effective permission withdrawal at fresh stage ${stage} denies old totals`, async () => {
    for (const permissions of [['learning.use'], ['course.read'], []]) {
      const fixture = setup({ fresh: (index) => (index === stage ? { ...actor, permissions } : actor) });
      await assert.rejects(fixture.service.read(actor, now, ['course'], []), ForbiddenException);
      assert.equal(fixture.reads(), stage);
    }
  });
}

test('Every legacy course and displayed source must still be authorized, including empty task pages', async () => {
  for (const final of [
    { assignmentCount: 0, examCount: 0, courses: 0, tasks: 0 },
    { assignmentCount: 0, examCount: 0, courses: 1, tasks: 0 },
  ]) {
    const fixture = setup({ final });
    await assert.rejects(
      fixture.service.read(
        actor,
        now,
        ['course'],
        [{ id: 'assigned', type: 'assignment', courseId: 'course' }],
      ),
      ForbiddenException,
    );
  }
  const emptyPage = setup({ final: { assignmentCount: 0, examCount: 0, courses: 0, tasks: 0 } });
  await assert.rejects(emptyPage.service.read(actor, now, ['course'], []), ForbiddenException);
});
