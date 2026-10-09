import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { AuthService } from '../apps/api/src/auth/auth.service';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import { LearningActionsService } from '../apps/api/src/planner/actions.service';
import {
  learningActionCoursesQuery,
  learningActionsQuery,
  learningCourseSearchPattern,
} from '../apps/api/src/planner/actions.schemas';
import { courseActionFacts } from '../apps/api/src/planner/course-action-facts';

const actor: Actor = {
  id: 'student',
  organizationId: 'org-a',
  accountMode: 'ORGANIZATION',
  name: '本人',
  role: 'STUDENT',
  sessionId: 'session',
  csrfToken: 'csrf',
  permissions: ['learning.use', 'course.read'],
};
const zero = { today: 0, upcoming: 0, overdue: 0 };
const actionPage = { items: [], counts: zero, courseIds: [], selectedCourseAllowed: true };
function fixture(options: { rows?: any[]; current?: (read: number) => Actor | null } = {}) {
  const sql: Prisma.Sql[] = [];
  const operations: string[] = [];
  let freshReads = 0;
  const db = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      operations.push('query');
      sql.push(Prisma.sql(strings, ...values));
      return [options.rows?.[sql.length - 1] ?? actionPage];
    },
  } as unknown as PrismaService;
  const auth = {
    require: (current: Actor, permission: string) => {
      if (!current.permissions.includes(permission)) throw new ForbiddenException('权限已撤销');
    },
    resolveSessionId: async (id: string) => {
      assert.equal(id, actor.sessionId);
      operations.push('fresh');
      return options.current ? options.current(++freshReads) : actor;
    },
  } as unknown as AuthService;
  return { service: new LearningActionsService(db, auth), sql, operations };
}

test('Action defaults retain old horizon/paging and add explicit all/null filter contract', () => {
  assert.deepEqual(learningActionsQuery.parse({}), {
    bucket: 'today',
    page: 1,
    pageSize: 10,
    type: 'all',
  });
  assert.equal(learningActionsQuery.parse({ courseId: '' }).courseId, undefined);
  assert.equal(learningActionsQuery.parse({ courseId: '  ' }).courseId, '  ');
  assert.equal(learningActionsQuery.parse({ page: '10000', pageSize: 20 }).page, 10000);
  assert.equal(learningActionsQuery.parse({ type: 'exam', courseId: '课' }).type, 'exam');
});

test('Action filters reject duplicate/coercible-array, unknown authority and invalid intersections', () => {
  for (const input of [
    { type: ['all'] },
    { type: 'other' },
    { type: 'EXAM' },
    { courseId: ['course'] },
    { courseId: {} },
    { courseId: 1 },
    { courseId: 'x'.repeat(129) },
    { courseId: 'bad\0id' },
    { type: 'personal', courseId: 'course' },
    { page: ['1'] },
    { pageSize: ['10'] },
    { page: {} },
    { page: 1.5 },
    { page: '10001' },
    { pageSize: '21' },
    { page: '' },
    { userId: 'peer' },
    { organizationId: 'foreign' },
    { role: 'ADMIN' },
    { permissions: ['course.read'] },
    { scope: 'platform' },
    { now: '2028-01-01' },
  ])
    assert.equal(learningActionsQuery.safeParse(input).success, false, JSON.stringify(input));
  assert.equal(learningActionsQuery.safeParse({ type: 'personal', courseId: '' }).success, true);
});

test('Picker has independent bounded scalar paging and retains meaningful whitespace', () => {
  assert.deepEqual(learningActionCoursesQuery.parse({}), { search: '', page: 1, pageSize: 20 });
  assert.deepEqual(learningActionCoursesQuery.parse({ search: '  ', page: '2', pageSize: '50' }), {
    search: '  ',
    page: 2,
    pageSize: 50,
  });
  for (const input of [
    { search: ['x'] },
    { search: {} },
    { search: 1 },
    { search: 'x'.repeat(101) },
    { search: 'a\0b' },
    { pageSize: '51' },
    { page: '10001' },
    { page: ['1'] },
    { courseId: 'foreign' },
    { type: 'assignment' },
    { bucket: 'today' },
    { userId: 'peer' },
  ])
    assert.equal(learningActionCoursesQuery.safeParse(input).success, false, JSON.stringify(input));
});

test('Picker literal search escapes wildcard and escape characters without trimming or SQL interpolation', () => {
  assert.equal(learningCourseSearchPattern(' %_\\ '), '% \\%\\_\\\\ %');
  assert.equal(learningCourseSearchPattern("'中文😀"), "%'中文😀%");
});

test('Only students with learning permission can start either private read', async () => {
  const context = fixture();
  for (const candidate of [
    { ...actor, role: 'TEACHER' },
    { ...actor, permissions: ['course.read'] },
  ]) {
    await assert.rejects(context.service.list(candidate, {}), ForbiddenException);
    await assert.rejects(context.service.courses(candidate, {}), ForbiddenException);
  }
  assert.equal(context.sql.length, 0);
});

test('Explicit course sources require course.read but personal/default all remain usable without it', async () => {
  const personal = { ...actor, permissions: ['learning.use'] };
  const context = fixture({ current: () => personal });
  for (const query of [{ type: 'assignment' }, { type: 'exam' }, { courseId: 'course' }])
    await assert.rejects(context.service.list(personal, query), ForbiddenException);
  await assert.rejects(context.service.courses(personal, {}), ForbiddenException);
  assert.equal(context.sql.length, 0);
  assert.deepEqual((await context.service.list(personal, {})).filters, { type: 'all', courseId: null });
  assert.deepEqual((await context.service.list(personal, { type: 'personal' })).filters, {
    type: 'personal',
    courseId: null,
  });
});

test('Selected course is validated independently of matching rows and page size', async () => {
  const denied = fixture({ rows: [{ ...actionPage, selectedCourseAllowed: false }] });
  await assert.rejects(
    denied.service.list(actor, { courseId: 'foreign', page: '10000' }),
    ForbiddenException,
  );
  assert.equal(denied.sql.length, 1);
  const context = fixture({ rows: [actionPage, { courses: 1, items: 0 }] });
  const data = await context.service.list(actor, { courseId: 'empty-course', type: 'exam' });
  assert.deepEqual(data.counts, zero);
  assert.deepEqual(data.items, []);
  assert.deepEqual(data.filters, { type: 'exam', courseId: 'empty-course' });
  assert.deepEqual(context.operations, ['query', 'query', 'fresh']);
  assert.ok(
    context.sql[1].values.includes('empty-course'),
    'zero-row selected course still gets fresh ACL query',
  );
  assert.equal('courseIds' in data, false);
  assert.equal('selectedCourseAllowed' in data, false);
});

test('Selected zero-action course revoked during first read rejects entire response', async () => {
  const context = fixture({ rows: [actionPage, { courses: 0, items: 0 }] });
  await assert.rejects(context.service.list(actor, { courseId: 'empty-course' }), ForbiddenException);
});

test('Filtered counts/selected rows share SQL facts, bound source/course and preserve broad overview call', async () => {
  const context = fixture({ rows: [actionPage, { courses: 1, items: 0 }] });
  await context.service.list(actor, { type: 'assignment', courseId: "bound-course'", bucket: 'upcoming' });
  const sql = context.sql[0];
  assert.ok(sql.values.includes("bound-course'"));
  assert.doesNotMatch(sql.sql, /bound-course'/);
  assert.match(sql.sql, /EXISTS \(SELECT 1 FROM allowed_courses\)/);
  assert.match(sql.sql, /FROM course_action_facts[\s\S]*AND \(\? OR kind = \?\)/);
  assert.match(sql.sql, /FROM classified WHERE bucket = \?/);
  assert.match(sql.sql, /'today', \(SELECT COUNT\(\*\) FROM classified/);
  assert.match(sql.sql, /t\."dueAt" < \?[\s\S]*AND \?/);
  const broad = courseActionFacts(actor, new Date('2028-01-01'));
  assert.doesNotMatch(broad.sql, /AND c\.id =|upcomingEnd|LIMIT 500/);
});

test('Displayed audience and every contributing course remain guarded before final identity read', async () => {
  const context = fixture({
    rows: [
      { ...actionPage, courseIds: ['course-with-off-page-actions'], counts: { ...zero, today: 501 } },
      { courses: 0, items: 0 },
    ],
  });
  await assert.rejects(context.service.list(actor, { page: '10000' }), ForbiddenException);
  assert.equal(context.sql.length, 2);
});

test('Final action identity guard includes account mode and runs after selected-course qualification', async () => {
  for (const current of [
    null,
    { ...actor, id: 'peer' },
    { ...actor, sessionId: 'replacement-session' },
    { ...actor, organizationId: 'org-b' },
    { ...actor, accountMode: 'PERSONAL' },
    { ...actor, role: 'TEACHER' },
    { ...actor, csrfToken: 'new-login' },
  ]) {
    const context = fixture({ rows: [actionPage, { courses: 1, items: 0 }], current: () => current });
    await assert.rejects(context.service.list(actor, { courseId: 'course' }), UnauthorizedException);
    assert.deepEqual(context.operations, ['query', 'query', 'fresh']);
  }
});

test('Permission withdrawal after all action reads denies course filters; personal scope stays independent', async () => {
  for (const permissions of [['learning.use'], ['course.read']]) {
    const context = fixture({
      rows: [actionPage, { courses: 1, items: 0 }],
      current: () => ({ ...actor, permissions }),
    });
    await assert.rejects(context.service.list(actor, { courseId: 'course' }), ForbiddenException);
  }
  const personal = fixture({ current: () => ({ ...actor, permissions: ['learning.use'] }) });
  assert.deepEqual((await personal.service.list(actor, { type: 'personal' })).counts, zero);
});

test('Picker returns second complete exact total/page, allowlists only id/title and binds literal pattern', async () => {
  const context = fixture({
    rows: [
      { items: [{ id: 'old', title: '旧标题' }], total: 502, verified: 0 },
      {
        items: [{ id: 'new', title: '当前标题', teacherId: 'private', studentCount: 7 }],
        total: 501,
        verified: 1,
      },
    ],
  });
  const data = await context.service.courses(actor, { search: '%_\\', page: '2', pageSize: '50' });
  assert.deepEqual(data, { items: [{ id: 'new', title: '当前标题' }], total: 501, page: 2, pageSize: 50 });
  assert.deepEqual(context.operations, ['query', 'fresh', 'query', 'fresh']);
  assert.ok(context.sql[0].values.includes('%\\%\\_\\\\%'));
  assert.ok(context.sql[0].values.includes('\\'));
  assert.match(context.sql[0].sql, /ORDER BY title ASC, id ASC/);
  assert.ok(context.sql[1].values.includes('["old"]'));
  assert.doesNotMatch(context.sql[0].sql, /Assignment|PersonalTask|Exam|teacherId/);
});

test('Picker no matches still rechecks current identity and full count without an unbounded ID list', async () => {
  const context = fixture({
    rows: [
      { items: [], total: 501, verified: 0 },
      { items: [], total: 500, verified: 0 },
    ],
  });
  const data = await context.service.courses(actor, { page: '10000' });
  assert.equal(data.total, 500);
  assert.deepEqual(data.items, []);
  assert.deepEqual(context.operations, ['query', 'fresh', 'query', 'fresh']);
});

test('Picker source revocation rejects even when new page no longer contains the revoked course', async () => {
  const context = fixture({
    rows: [
      { items: [{ id: 'revoked', title: '不能发布旧标题' }], total: 501, verified: 0 },
      { items: [{ id: 'replacement', title: '新行' }], total: 500, verified: 0 },
    ],
  });
  await assert.rejects(context.service.courses(actor, {}), ForbiddenException);
});

test('Picker refuses changed identity/nonce/permissions at either boundary without publishing options', async () => {
  for (const step of [1, 2])
    for (const current of [
      null,
      { ...actor, organizationId: 'foreign' },
      { ...actor, accountMode: 'PERSONAL' },
      { ...actor, csrfToken: 'new-nonce' },
      { ...actor, permissions: ['learning.use'] },
      { ...actor, permissions: ['course.read'] },
    ]) {
      const context = fixture({
        rows: [
          { items: [{ id: 'course', title: '私有标题' }], total: 1, verified: 0 },
          { items: [{ id: 'course', title: '私有标题' }], total: 1, verified: 1 },
        ],
        current: (read) => (read === step ? current : actor),
      });
      await assert.rejects(
        context.service.courses(actor, {}),
        (error) => error instanceof UnauthorizedException || error instanceof ForbiddenException,
      );
      assert.equal(context.sql.length, step === 1 ? 1 : 2);
    }
});
