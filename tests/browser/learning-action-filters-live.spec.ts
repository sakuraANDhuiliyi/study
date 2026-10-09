import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashPasswordAsync } from '../../apps/api/src/auth/password';

const api = process.env.TEST_BASE_URL;
const web = process.env.WEB_BASE_URL || 'http://localhost:5173';
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
function permittedReview() {
  try {
    const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/none');
    return (
      process.env.NODE_ENV !== 'production' &&
      !!api &&
      loopback(new URL(api).hostname) &&
      loopback(new URL(web).hostname) &&
      loopback(database.hostname) &&
      ['postgres:', 'postgresql:'].includes(database.protocol) &&
      /review/i.test(database.pathname)
    );
  } catch {
    return false;
  }
}
test.skip(!permittedReview(), 'Live filters require loopback web/API and a review PostgreSQL database');
// Random credentials stay in memory/API calls; no input, trace, screenshot or video stores them.
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15_000,
  timezoneId: 'America/Los_Angeles',
  viewport: { width: 1440, height: 1000 },
});
type Client = {
  api: APIRequestContext;
  csrf: string;
  user: { id: string; organizationId: string; role: string; permissions: string[] };
};
type Identity = { user: Client['user']; csrfToken: string };
type Source = 'all' | 'personal' | 'assignment' | 'exam';
type Filters = { type: Source; courseId?: string };
type Actions = {
  items: {
    id: string;
    type: string;
    title: string;
    courseId?: string;
    revision?: number;
    action: string;
    actionLabel: string;
    path: string;
  }[];
  counts: { today: number; upcoming: number; overdue: number };
  total: number;
  page: number;
  pageSize: number;
  filters: { type: Source; courseId: string | null };
  range: { tomorrowStart: string; upcomingEnd: string };
};
type Courses = { items: { id: string; title: string }[]; total: number; page: number; pageSize: number };
type Task = { id: string; title: string; revision: number; dueAt: string };
type Dashboard = { metrics: { label: string; value: number; detail: string }[] };
const board = (page: Page) => page.getByRole('region', { name: '我的学习行动清单', exact: true });
const picker = (page: Page) => board(page).getByRole('region', { name: '授权课程选择', exact: true });
const form = (page: Page) => board(page).getByRole('form', { name: '学习行动筛选', exact: true });
const applied = (page: Page) => board(page).locator('[aria-label="已应用的学习筛选"]');
const card = (page: Page, kind: string, id: string) =>
  board(page).getByTestId(`learning-action-${kind}-${id}`);
const sourceControl = (page: Page) => form(page).getByRole('combobox', { name: '学习行动来源', exact: true });
const courseControl = (page: Page) => form(page).getByRole('combobox', { name: '学习行动课程', exact: true });
const queryMatches = (url: URL, filters: Filters, page = 1) =>
  url.searchParams.get('bucket') === 'upcoming' &&
  (url.searchParams.get('type') ?? 'all') === filters.type &&
  (url.searchParams.get('courseId') || undefined) === filters.courseId &&
  url.searchParams.get('page') === String(page);
const actionResponse = (page: Page, filters: Filters, currentPage = 1) =>
  page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/planner/actions' &&
      response.request().method() === 'GET' &&
      queryMatches(new URL(response.url()), filters, currentPage),
  );
const courseResponse = (page: Page, search: string, currentPage = 1) =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/planner/actions/courses' &&
      response.request().method() === 'GET' &&
      url.searchParams.get('search') === search &&
      url.searchParams.get('page') === String(currentPage)
    );
  });
async function login(context: APIRequestContext, username: string, password: string): Promise<Client> {
  let response;
  try {
    response = await context.post(`${web}/api/auth/login`, {
      headers: { Origin: web },
      data: { username, password },
    });
  } catch {
    throw new Error('Owned filters fixture authentication request failed');
  }
  expect(response.status(), 'Owned fixture login must succeed').toBe(201);
  const body = await response.json();
  return { api: context, csrf: body.csrfToken, user: body.user };
}
async function call<T = any>(
  client: Client,
  path: string,
  method = 'GET',
  data?: unknown,
  expected = method === 'POST' ? 201 : 200,
): Promise<T> {
  const response = await client.api.fetch(`${web}/api${path}`, {
    method,
    headers: { Origin: web, 'x-csrf-token': client.csrf },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), `${method} ${path} must return ${expected}`).toBe(expected);
  expect(response.headers()['cache-control']).toBe('no-store');
  return response.json();
}
const list = (client: Client, filters: Filters = { type: 'all' }, page = 1, pageSize = 20) =>
  call<Actions>(
    client,
    '/planner/actions?' +
      new URLSearchParams({
        bucket: 'upcoming',
        type: filters.type,
        ...(filters.courseId ? { courseId: filters.courseId } : {}),
        page: String(page),
        pageSize: String(pageSize),
      }),
  );
function expectCounts(data: Actions, upcoming: number, filters: Filters, page = 1, pageSize = 10) {
  expect(data).toMatchObject({
    total: upcoming,
    page,
    pageSize,
    counts: { today: 0, upcoming, overdue: 0 },
    filters: { type: filters.type, courseId: filters.courseId ?? null },
  });
}
function ids(data: Actions[]) {
  return data.flatMap((page) => page.items.map((item) => item.id)).sort();
}
async function matchCount(page: Page, total: number, currentPage = 1) {
  await expect(board(page).getByRole('status', { name: '行动匹配数量', exact: true })).toHaveText(
    `未来7天共 ${total} 项${total ? ` · 第 ${currentPage} 页` : ''}`,
  );
}
async function show(page: Page) {
  await page.goto(`${web}/`, { waitUntil: 'domcontentloaded' });
  await expect(board(page)).toBeVisible();
  await expect(board(page).getByRole('status', { name: '行动匹配数量', exact: true })).toBeVisible();
  const pending = actionResponse(page, { type: 'all' });
  const tab = board(page).getByRole('tab', { name: /^未来7天(?:\s|$)/ });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(board(page).getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
  return response.json() as Promise<Actions>;
}
async function apply(page: Page, filters: Filters) {
  const pending = actionResponse(page, filters);
  await form(page).getByRole('button', { name: '应用学习筛选', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Actions;
  await matchCount(page, data.total);
  return data;
}
async function lookup(page: Page, search: string, refresh = false) {
  if (!(await picker(page).count())) {
    await form(page).getByRole('button', { name: '选择课程', exact: true }).click();
    await expect(picker(page)).toBeVisible();
  }
  await picker(page).getByRole('textbox', { name: '查找授权课程', exact: true }).fill(search);
  const pending = courseResponse(page, search);
  const button = picker(page).getByRole('button', {
    name: refresh ? '刷新课程选项' : '查找课程',
    exact: true,
  });
  await expect(button).toBeEnabled();
  await button.click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Courses;
  await expect(picker(page).getByRole('status', { name: '课程选项匹配数量', exact: true })).toContainText(
    `找到 ${data.total} 门授权课程；第 1 页`,
  );
  return data;
}
async function pageTwo(page: Page, filters: Filters) {
  const pending = actionResponse(page, filters, 2);
  await board(page).locator('.ant-pagination-item-2').click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Actions;
  await matchCount(page, data.total, 2);
  return data;
}
async function overview(page: Page, assignments: number, exams: number) {
  const area = page.getByRole('region', { name: '学生学习概览', exact: true });
  for (const [label, count] of [
    ['当前待交作业', assignments],
    ['当前可作答考试', exams],
  ] as const)
    await expect(area.getByRole('link', { name: `查看${label}`, exact: true }).locator('strong')).toHaveText(
      String(count),
    );
}
async function switchRole(page: Page, label: string): Promise<Identity> {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/role' && response.request().method() === 'POST',
  );
  const control = page.getByRole('combobox', { name: '切换角色', exact: true });
  await control.focus();
  await control.press('Enter');
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.ant-select-item-option-content').getByText(label, { exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  return response.json() as Promise<Identity>;
}
class OwnedFixtures {
  readonly db = new PrismaClient();
  readonly suffix = randomBytes(8).toString('hex');
  readonly password = `Filters-${randomBytes(24).toString('base64url')}!`;
  readonly organizations: string[] = [];
  readonly users: string[] = [];
  readonly courses: string[] = [];
  readonly contexts: BrowserContext[] = [];
  readonly requests: APIRequestContext[] = [];
  readonly releases: (() => void)[] = [];
  readonly errors: string[] = [];
  private sequence = 0;
  private hash = '';
  failure(error: unknown) {
    const message = error instanceof Error ? error.message : 'Owned filters live validation failed';
    return new Error(
      [this.password, this.hash]
        .filter(Boolean)
        .reduce((value, secret) => value.split(secret).join('[redacted]'), message)
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
        .replace(
          /("(?:csrf[-_]?token|session[-_]?token|token|password|authorization|cookie|set-cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
          '$1"[redacted]"',
        )
        .replace(/lms_session=[^;\s"]+/gi, 'lms_session=[redacted]'),
    );
  }
  observe(page: Page) {
    page.on('pageerror', (failure) => this.errors.push(failure.message));
    page.on('console', (entry) => {
      if (
        entry.type() === 'error' &&
        /content security policy|violat.*policy|refused to (?:load|execute|create)/i.test(entry.text())
      )
        this.errors.push(entry.text());
    });
  }
  async organization(name: string) {
    const row = await this.db.organization.create({ data: { name: `${name}-${this.suffix}` } });
    this.organizations.push(row.id);
    return row;
  }
  async user(organizationId: string, roleIds: string[], name: string) {
    if (!this.hash) this.hash = await hashPasswordAsync(this.password);
    const row = await this.db.user.create({
      data: {
        organizationId,
        name,
        username: `filters_live_${this.suffix}_${++this.sequence}`,
        passwordHash: this.hash,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
    this.users.push(row.id);
    return row;
  }
  async apiClient(username: string) {
    const context = await request.newContext();
    this.requests.push(context);
    return login(context, username, this.password);
  }
  async browserClient(browser: Browser, username: string) {
    const context = await browser.newContext({
      baseURL: web,
      timezoneId: 'America/Los_Angeles',
      viewport: { width: 1440, height: 1000 },
    });
    this.contexts.push(context);
    const client = await login(context.request, username, this.password);
    const page = await context.newPage();
    this.observe(page);
    return { client, page };
  }
  async course(
    organizationId: string,
    teacherId: string,
    learners: string[],
    title: string,
    status: 'PUBLISHED' | 'ARCHIVED' = 'PUBLISHED',
  ) {
    const row = await this.db.course.create({
      data: {
        organizationId,
        teacherId,
        title,
        status,
      },
    });
    this.courses.push(row.id);
    await this.db.teachingAssignment.create({ data: { courseId: row.id, userId: teacherId } });
    await this.db.enrollment.createMany({ data: learners.map((userId) => ({ courseId: row.id, userId })) });
    return row;
  }
  async verify(client: Client) {
    expect(
      await this.db.user.findFirst({
        where: { id: client.user.id, organizationId: client.user.organizationId },
        select: { id: true },
      }),
      'Browser API proxy must point at the configured review database',
    ).not.toBeNull();
  }
  async question(teacher: Client, courseId: string) {
    const created = await call<{ id: string; versions: { id: string }[] }>(teacher, '/questions', 'POST', {
      courseId,
      type: 'single',
      stem: `选择正确选项-${this.suffix}`,
      options: [
        { id: 'A', text: '正确' },
        { id: 'B', text: '错误' },
      ],
      answer: 'A',
      explanation: `PRIVATE_EXPLANATION_${this.suffix}`,
      scoreCents: 100,
      practiceEnabled: false,
      scope: 'private',
    });
    return created.versions[0].id;
  }
  async assignment(
    teacher: Client,
    courseId: string,
    questionVersionId: string,
    userId: string,
    title: string,
    dueAt: Date,
  ) {
    const result = await call<{ id: string }>(teacher, '/assignments', 'POST', {
      courseId,
      title: `${title}-${this.suffix}`,
      opensAt: new Date(Date.now() - 86400_000).toISOString(),
      dueAt: dueAt.toISOString(),
      questionVersionIds: [questionVersionId],
      audienceIds: [userId],
      maxAttempts: 2,
    });
    await call(teacher, `/assignments/${result.id}/publish`, 'POST', {});
    return result;
  }
  async exam(
    teacher: Client,
    courseId: string,
    questionVersionId: string,
    userId: string,
    title: string,
    entryClosesAt: Date,
  ) {
    const startsAt = new Date(Date.now() - 60_000);
    const result = await call<{ id: string }>(teacher, '/exams', 'POST', {
      courseId,
      title: `${title}-${this.suffix}`,
      startsAt: startsAt.toISOString(),
      entryClosesAt: entryClosesAt.toISOString(),
      endsAt: new Date(entryClosesAt.getTime() + 2 * 3600_000).toISOString(),
      durationMinutes: 60,
      questionVersionIds: [questionVersionId],
      audienceIds: [userId],
      maxAttempts: 2,
      passCents: 60,
    });
    await call(teacher, `/exams/${result.id}/publish`, 'POST', {});
    expect(
      await this.db.examPaperItem.count({ where: { snapshot: { examId: result.id } } }),
      'Actual exam publication must create a valid snapshot',
    ).toBe(1);
    return result;
  }
  async cleanup() {
    this.releases.forEach((release) => release());
    const failures: string[] = [];
    const resources = await Promise.allSettled([
      ...this.contexts.map((context) => context.close()),
      ...this.requests.map((context) => context.dispose()),
    ]);
    if (resources.some((result) => result.status === 'rejected'))
      failures.push('Owned filters browser/API resource cleanup failed');
    try {
      // Physical RESTRICT FKs apply even to scalar-only Prisma models. Every
      // delete is bounded to random owned organizations/courses/users, in child order.
      await this.db.$transaction(
        async (tx) => {
          const assignments = await tx.assignment.findMany({
            where: { courseId: { in: this.courses }, organizationId: { in: this.organizations } },
            select: { id: true },
          });
          const assignmentIds = assignments.map((item) => item.id);
          const submissions = await tx.assignmentSubmission.findMany({
            where: { assignmentId: { in: assignmentIds } },
            select: { id: true },
          });
          const exams = await tx.exam.findMany({
            where: { courseId: { in: this.courses }, organizationId: { in: this.organizations } },
            select: { id: true },
          });
          const examIds = exams.map((item) => item.id);
          const attempts = await tx.examAttempt.findMany({
            where: { examId: { in: examIds } },
            select: { id: true },
          });
          const attemptIds = attempts.map((item) => item.id);
          const snapshots = await tx.examPaperSnapshot.findMany({
            where: { examId: { in: examIds } },
            select: { id: true },
          });
          const questions = await tx.question.findMany({
            where: { courseId: { in: this.courses }, organizationId: { in: this.organizations } },
            select: { id: true },
          });
          const questionIds = questions.map((item) => item.id);
          await tx.assignmentFeedback.deleteMany({
            where: { submissionId: { in: submissions.map((item) => item.id) } },
          });
          await tx.assignmentSubmission.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
          await tx.assignmentException.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
          await tx.assignmentDraft.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
          await tx.assignmentAudience.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
          await tx.assignmentItem.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
          await tx.assignment.deleteMany({ where: { id: { in: assignmentIds } } });
          await tx.examAnswer.deleteMany({ where: { attemptId: { in: attemptIds } } });
          await tx.gradingRecord.deleteMany({ where: { attemptId: { in: attemptIds } } });
          await tx.gradeRevision.deleteMany({ where: { attemptId: { in: attemptIds } } });
          await tx.gradeAppeal.deleteMany({ where: { attemptId: { in: attemptIds } } });
          await tx.examAttempt.deleteMany({ where: { examId: { in: examIds } } });
          await tx.examPaperItem.deleteMany({
            where: { snapshotId: { in: snapshots.map((item) => item.id) } },
          });
          await tx.examPaperSnapshot.deleteMany({ where: { examId: { in: examIds } } });
          await tx.examExtension.deleteMany({ where: { examId: { in: examIds } } });
          await tx.examAudience.deleteMany({ where: { examId: { in: examIds } } });
          await tx.exam.deleteMany({ where: { id: { in: examIds } } });
          await tx.mistakeRecord.deleteMany({
            where: { courseId: { in: this.courses }, userId: { in: this.users } },
          });
          await tx.questionFavorite.deleteMany({
            where: { questionId: { in: questionIds }, userId: { in: this.users } },
          });
          await tx.questionVersion.deleteMany({ where: { questionId: { in: questionIds } } });
          await tx.question.deleteMany({ where: { id: { in: questionIds } } });
          await tx.enrollment.deleteMany({
            where: { courseId: { in: this.courses }, userId: { in: this.users } },
          });
          await tx.teachingAssignment.deleteMany({
            where: { courseId: { in: this.courses }, userId: { in: this.users } },
          });
          await tx.learningProgress.deleteMany({
            where: { courseId: { in: this.courses }, userId: { in: this.users } },
          });
          await tx.course.deleteMany({
            where: { id: { in: this.courses }, organizationId: { in: this.organizations } },
          });
          await tx.personalTask.deleteMany({
            where: { userId: { in: this.users }, organizationId: { in: this.organizations } },
          });
          await tx.session.deleteMany({ where: { userId: { in: this.users } } });
          await tx.sensitiveGrant.deleteMany({ where: { userId: { in: this.users } } });
          await tx.notification.deleteMany({ where: { organizationId: { in: this.organizations } } });
          await tx.backgroundJob.deleteMany({ where: { organizationId: { in: this.organizations } } });
          await tx.auditLog.deleteMany({ where: { organizationId: { in: this.organizations } } });
          await tx.systemSetting.deleteMany({ where: { organizationId: { in: this.organizations } } });
          await tx.userRole.deleteMany({ where: { userId: { in: this.users } } });
          await tx.user.deleteMany({ where: { id: { in: this.users } } });
          await tx.organization.deleteMany({ where: { id: { in: this.organizations } } });
        },
        { timeout: 20_000 },
      );
    } catch {
      failures.push('Owned filters database fixture cleanup failed');
    } finally {
      try {
        await this.db.$disconnect();
      } catch {
        failures.push('Filters fixture database disconnect failed');
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  }
}

test('真实课程与来源筛选包含零行动课程和完整分页；个人CAS不改变全量概览且隔离他人与机构', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const fixture = new OwnedFixtures();
  fixture.observe(page);
  try {
    const a = await fixture.organization('筛选甲机构'),
      b = await fixture.organization('筛选乙机构');
    const teacherUser = await fixture.user(a.id, ['TEACHER'], '筛选教师'),
      studentUser = await fixture.user(a.id, ['STUDENT'], '筛选学生'),
      peerUser = await fixture.user(a.id, ['STUDENT'], '同机构其他学生'),
      foreignTeacherUser = await fixture.user(b.id, ['TEACHER'], '另一机构教师'),
      foreignStudentUser = await fixture.user(b.id, ['STUDENT'], '另一机构学生');
    const teacher = await fixture.apiClient(teacherUser.username),
      foreignTeacher = await fixture.apiClient(foreignTeacherUser.username),
      student = await login(page.request, studentUser.username, fixture.password);
    await fixture.verify(student);
    const prefix = `筛选课程-${fixture.suffix}`;
    const courseA = await fixture.course(
        a.id,
        teacherUser.id,
        [studentUser.id, peerUser.id],
        `${prefix}-00课程甲`,
      ),
      courseB = await fixture.course(
        a.id,
        teacherUser.id,
        [studentUser.id, peerUser.id],
        `${prefix}-01课程乙`,
      );
    for (let i = 2; i < 20; i++)
      await fixture.course(
        a.id,
        teacherUser.id,
        [studentUser.id],
        `${prefix}-${String(i).padStart(2, '0')}空课程`,
      );
    const empty = await fixture.course(
        a.id,
        teacherUser.id,
        [studentUser.id],
        `${prefix}-20零行动归档课`,
        'ARCHIVED',
      ),
      foreignCourse = await fixture.course(
        b.id,
        foreignTeacherUser.id,
        [foreignStudentUser.id],
        `其他机构课程-${fixture.suffix}`,
      );
    // Keep all deadlines in the upcoming bucket even if this small test crosses Shanghai midnight.
    const anchor = await list(student);
    const due = new Date(Date.parse(anchor.range.tomorrowStart) + 36 * 3600_000);
    expect(due.getTime()).toBeLessThan(Date.parse(anchor.range.upcomingEnd));
    const publicQuestionA = await fixture.question(teacher, courseA.id),
      publicQuestionB = await fixture.question(teacher, courseB.id);
    const courseAAssignments: { id: string }[] = [];
    for (let i = 0; i < 12; i++)
      courseAAssignments.push(
        await fixture.assignment(teacher, courseA.id, publicQuestionA, studentUser.id, `甲课程作业${i}`, due),
      );
    const assignmentB = await fixture.assignment(
      teacher,
      courseB.id,
      publicQuestionB,
      studentUser.id,
      '乙课程作业',
      due,
    );
    // A secret exam must never reuse a question already published in an assignment.
    const confidentialQuestionA = await fixture.question(teacher, courseA.id);
    const examA = await fixture.exam(
      teacher,
      courseA.id,
      confidentialQuestionA,
      studentUser.id,
      '甲课程考试',
      due,
    );
    const foreignQuestion = await fixture.question(foreignTeacher, foreignCourse.id);
    const foreignAssignment = await fixture.assignment(
      foreignTeacher,
      foreignCourse.id,
      foreignQuestion,
      foreignStudentUser.id,
      '他机构作业',
      due,
    );
    const personal: Task[] = [];
    for (let i = 0; i < 12; i++)
      personal.push(
        await call<Task>(student, '/planner/tasks', 'POST', {
          title: `个人无课程待办${i}-${fixture.suffix}`,
          dueAt: due.toISOString(),
        }),
      );
    const peer = await fixture.browserClient(browser, peerUser.username),
      foreign = await fixture.browserClient(browser, foreignStudentUser.username);
    await fixture.verify(peer.client);
    await fixture.verify(foreign.client);
    const peerTask = await call<Task>(peer.client, '/planner/tasks', 'POST', {
      title: `其他学生待办-${fixture.suffix}`,
      dueAt: due.toISOString(),
    });
    const whole = await list(student),
      wholeSecond = await list(student, { type: 'all' }, 2);
    expectCounts(whole, 26, { type: 'all' }, 1, 20);
    expectCounts(wholeSecond, 26, { type: 'all' }, 2, 20);
    expect(whole.items).toHaveLength(20);
    expect(wholeSecond.items).toHaveLength(6);
    expect(ids([whole, wholeSecond])).toEqual(
      [...courseAAssignments, assignmentB, examA, ...personal].map((item) => item.id).sort(),
    );
    expect(whole.items.filter((item) => item.type === 'personal').every((item) => !item.courseId)).toBe(true);
    await show(page);
    await matchCount(page, 26);
    await overview(page, 13, 1);
    const choices = await lookup(page, prefix);
    expect(choices).toMatchObject({ total: 21, page: 1, pageSize: 20 });
    expect(choices.items).toHaveLength(20);
    expect(choices.items.map((item) => item.id)).not.toContain(empty.id);
    const next = courseResponse(page, prefix, 2);
    await picker(page).getByRole('button', { name: '课程下一页', exact: true }).click();
    const second = await next;
    expect(second.status()).toBe(200);
    expect(await second.json()).toMatchObject({
      total: 21,
      page: 2,
      pageSize: 20,
      items: [{ id: empty.id, title: empty.title }],
    });
    await expect(picker(page).getByRole('status', { name: '课程选项匹配数量', exact: true })).toContainText(
      '找到 21 门授权课程；第 2 页',
    );
    await courseControl(page).selectOption(empty.id);
    const noActions = await apply(page, { type: 'all', courseId: empty.id });
    expectCounts(noActions, 0, { type: 'all', courseId: empty.id });
    expect(noActions.items).toEqual([]);
    await expect(applied(page)).toContainText(empty.title);
    await overview(page, 13, 1);
    expect((await lookup(page, `${prefix}-00`)).items).toEqual([{ id: courseA.id, title: courseA.title }]);
    await courseControl(page).selectOption(courseA.id);
    const onlyA = await apply(page, { type: 'all', courseId: courseA.id });
    expectCounts(onlyA, 13, { type: 'all', courseId: courseA.id });
    expect(onlyA.items).toHaveLength(10);
    const onlyASecond = await pageTwo(page, { type: 'all', courseId: courseA.id });
    expectCounts(onlyASecond, 13, { type: 'all', courseId: courseA.id }, 2);
    expect(onlyASecond.items).toHaveLength(3);
    expect(ids([onlyA, onlyASecond])).toEqual([...courseAAssignments, examA].map((item) => item.id).sort());
    expect(
      [...onlyA.items, ...onlyASecond.items].every(
        (item) => item.courseId === courseA.id && item.type !== 'personal',
      ),
    ).toBe(true);
    await sourceControl(page).selectOption('exam');
    const onlyExam = await apply(page, { type: 'exam', courseId: courseA.id });
    expectCounts(onlyExam, 1, { type: 'exam', courseId: courseA.id });
    expect(onlyExam.items).toMatchObject([
      { id: examA.id, type: 'exam', courseId: courseA.id, action: 'start_exam' },
    ]);
    await expect(card(page, 'exam', examA.id)).toBeVisible();
    const requests: string[] = [];
    page.on('request', (entry) => {
      const url = new URL(entry.url());
      if (url.pathname === '/api/planner/actions' && entry.method() === 'GET')
        requests.push(url.searchParams.get('type') ?? 'all');
    });
    await sourceControl(page).selectOption('personal');
    await expect(courseControl(page)).toHaveValue('');
    await expect(courseControl(page)).toBeDisabled();
    await expect(applied(page)).toContainText('考试');
    await expect(applied(page)).toContainText(courseA.title);
    await expect(card(page, 'exam', examA.id)).toBeVisible();
    expect(requests).not.toContain('personal');
    const onlyPersonal = await apply(page, { type: 'personal' });
    expectCounts(onlyPersonal, 12, { type: 'personal' });
    const personalSecond = await pageTwo(page, { type: 'personal' });
    expectCounts(personalSecond, 12, { type: 'personal' }, 2);
    expect(personalSecond.items).toHaveLength(2);
    expect(ids([onlyPersonal, personalSecond])).toEqual(personal.map((task) => task.id).sort());
    const selected = personalSecond.items[0];
    expect(selected.type).toBe('personal');
    expect(selected.courseId).toBeUndefined();
    const mutation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/planner/tasks/${selected.id}` &&
        response.request().method() === 'PATCH',
    );
    const refreshed = actionResponse(page, { type: 'personal' }, 2);
    await card(page, 'personal', selected.id)
      .getByRole('button', { name: `标为完成 ${selected.title}`, exact: true })
      .click();
    const changed = await mutation;
    expect(changed.status()).toBe(200);
    expect(changed.request().postDataJSON()).toEqual({ revision: selected.revision, completed: true });
    expect(await changed.json()).toMatchObject({ id: selected.id, revision: selected.revision! + 1 });
    const after = await refreshed;
    expect(after.status()).toBe(200);
    expectCounts(await after.json(), 11, { type: 'personal' }, 2);
    await matchCount(page, 11, 2);
    await expect(card(page, 'personal', selected.id)).toHaveCount(0);
    const persisted = await fixture.db.personalTask.findUniqueOrThrow({ where: { id: selected.id } });
    expect(persisted.revision).toBe(selected.revision! + 1);
    expect(persisted.completedAt).toBeInstanceOf(Date);
    expectCounts(await list(student), 25, { type: 'all' }, 1, 20);
    expectCounts(
      await list(student, { type: 'all', courseId: courseA.id }),
      13,
      { type: 'all', courseId: courseA.id },
      1,
      20,
    );
    const completeOverview = await call<Dashboard>(student, '/dashboard');
    expect(completeOverview.metrics[1]).toMatchObject({ label: '当前待交作业', value: 13 });
    expect(completeOverview.metrics[2]).toMatchObject({ label: '当前可作答考试', value: 1 });
    await overview(page, 13, 1);
    expectCounts(await show(peer.page), 1, { type: 'all' });
    await expect(card(peer.page, 'personal', peerTask.id)).toBeVisible();
    await overview(peer.page, 0, 0);
    expectCounts(await show(foreign.page), 1, { type: 'all' });
    await expect(card(foreign.page, 'assignment', foreignAssignment.id)).toBeVisible();
    await overview(foreign.page, 1, 0);
    await expect(board(page)).not.toContainText(peerTask.title);
    await expect(board(page)).not.toContainText(foreignCourse.title);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(form(page)).toBeVisible();
    await matchCount(page, 11, 2);
    expect(fixture.errors).toEqual([]);
  } catch (error) {
    throw fixture.failure(error);
  } finally {
    await fixture.cleanup();
  }
});

test('真实退课后403隐藏旧课程且保留所选范围；角色及CSRF变化后的实际迟到200不污染新个人筛选', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fixture = new OwnedFixtures();
  fixture.observe(page);
  try {
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      (window as any).__filterArrivals = [];
      (window as any).__filterExpiry = 0;
      window.addEventListener('auth-expired', () => {
        (window as any).__filterExpiry++;
      });
      window.fetch = async (input, init) => {
        const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const target = new URL(raw, window.location.href).pathname === '/api/planner/actions';
        // Keep only this real transport alive so guards must reject delivered data after remount.
        const response = await nativeFetch(input, target ? { ...init, signal: undefined } : init);
        if (target)
          (window as any).__filterArrivals.push({
            status: response.status,
            body: await response.clone().text(),
          });
        return response;
      };
    });
    const org = await fixture.organization('退课隔离机构'),
      teacherUser = await fixture.user(org.id, ['TEACHER'], '课程资格教师'),
      learner = await fixture.user(org.id, ['STUDENT', 'TEACHER'], '双身份学习者');
    const teacher = await fixture.apiClient(teacherUser.username),
      client = await login(page.request, learner.username, fixture.password);
    if (client.user.role !== 'STUDENT') {
      const selected = await call<Identity>(client, '/auth/role', 'POST', { role: 'STUDENT' });
      client.csrf = selected.csrfToken;
      client.user = selected.user;
    }
    await fixture.verify(client);
    const course = await fixture.course(
      org.id,
      teacherUser.id,
      [learner.id],
      `仅旧课程可见名称-${fixture.suffix}`,
    );
    const anchor = await list(client),
      due = new Date(Date.parse(anchor.range.tomorrowStart) + 36 * 3600_000);
    const question = await fixture.question(teacher, course.id),
      assignment = await fixture.assignment(teacher, course.id, question, learner.id, '所选旧课程作业', due);
    const task = await call<Task>(client, '/planner/tasks', 'POST', {
      title: `新个人范围待办-${fixture.suffix}`,
      dueAt: due.toISOString(),
    });
    const observed: { courseId: string | null; type: string }[] = [];
    page.on('request', (entry) => {
      const url = new URL(entry.url());
      if (url.pathname === '/api/planner/actions' && entry.method() === 'GET')
        observed.push({
          courseId: url.searchParams.get('courseId'),
          type: url.searchParams.get('type') ?? 'all',
        });
    });
    await show(page);
    await lookup(page, course.title);
    await courseControl(page).selectOption(course.id);
    expectCounts(await apply(page, { type: 'all', courseId: course.id }), 1, {
      type: 'all',
      courseId: course.id,
    });
    await expect(card(page, 'assignment', assignment.id)).toBeVisible();
    await call(teacher, `/courses/${course.id}/members/${learner.id}?kind=student`, 'DELETE');
    expect(
      await fixture.db.enrollment.findUniqueOrThrow({
        where: { courseId_userId: { courseId: course.id, userId: learner.id } },
      }),
    ).toMatchObject({ active: false });
    const withdrawalIndex = observed.length,
      denial = actionResponse(page, { type: 'all', courseId: course.id });
    await board(page).getByRole('button', { name: '刷新学习行动清单', exact: true }).click();
    expect((await denial).status()).toBe(403);
    await expect(card(page, 'assignment', assignment.id)).toHaveCount(0);
    await expect(board(page)).not.toContainText(course.title);
    await expect(board(page)).not.toContainText(`所选旧课程作业-${fixture.suffix}`);
    await expect(courseControl(page)).toHaveValue(course.id);
    await expect(applied(page)).toContainText('所选课程（等待权限确认）');
    expect(observed.slice(withdrawalIndex).length).toBeGreaterThan(0);
    expect(
      observed.slice(withdrawalIndex).every((entry) => entry.courseId === course.id && entry.type === 'all'),
    ).toBe(true);
    const reset = actionResponse(page, { type: 'all' });
    await form(page).getByRole('button', { name: '重置学习筛选', exact: true }).click();
    const resetResponse = await reset;
    expect(resetResponse.status()).toBe(200);
    const resetBody = (await resetResponse.json()) as Actions;
    expectCounts(resetBody, 1, { type: 'all' });
    expect(resetBody.items).toMatchObject([{ id: task.id, type: 'personal' }]);
    await matchCount(page, 1);
    await expect(courseControl(page)).toHaveValue('');
    await call(teacher, `/courses/${course.id}/members`, 'POST', { userId: learner.id, kind: 'student' });
    expect(
      await fixture.db.enrollment.findUniqueOrThrow({
        where: { courseId_userId: { courseId: course.id, userId: learner.id } },
      }),
    ).toMatchObject({ active: true });
    // Same lookup key needs a real explicit refetch after eligibility is restored.
    await lookup(page, course.title, true);
    await courseControl(page).selectOption(course.id);
    expectCounts(await apply(page, { type: 'all', courseId: course.id }), 1, {
      type: 'all',
      courseId: course.id,
    });
    await expect(applied(page)).toContainText(course.title);
    let armed = true,
      release!: () => void,
      seen!: () => void,
      routeError: Error | null = null;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const started = new Promise<void>((done) => {
      seen = done;
    });
    fixture.releases.push(release);
    await page.route(/\/api\/planner\/actions(?:\?|$)/, async (route) => {
      if (
        !armed ||
        route.request().method() !== 'GET' ||
        !queryMatches(new URL(route.request().url()), { type: 'all', courseId: course.id })
      ) {
        await route.continue().catch(() => {});
        return;
      }
      armed = false;
      try {
        // Obtain the actual authorized JSON before switching role; only delivery is delayed.
        const actual = await route.fetch();
        expect(actual.status()).toBe(200);
        const body = (await actual.json()) as Actions;
        expectCounts(body, 1, { type: 'all', courseId: course.id });
        expect(body.items).toMatchObject([{ id: assignment.id, type: 'assignment', courseId: course.id }]);
        seen();
        await gate;
        await route.fulfill({ response: actual }).catch(() => {});
      } catch (error) {
        routeError = fixture.failure(error);
        seen();
        await route.abort().catch(() => {});
      }
    });
    await board(page).getByRole('button', { name: '刷新学习行动清单', exact: true }).click();
    await started;
    if (routeError) throw routeError;
    const arrivalIndex = await page.evaluate(() => (window as any).__filterArrivals.length);
    const oldCsrf = client.csrf;
    const teacherIdentity = await switchRole(page, '教师');
    expect(teacherIdentity.user.role).toBe('TEACHER');
    expect(
      teacherIdentity.csrfToken !== oldCsrf,
      'Teacher role changes the real CSRF without printing tokens',
    ).toBe(true);
    await expect(board(page)).toHaveCount(0);
    const studentIdentity = await switchRole(page, '学生');
    expect(studentIdentity.user.role).toBe('STUDENT');
    expect(studentIdentity.csrfToken !== oldCsrf, 'Student return changes the real CSRF').toBe(true);
    expect(
      studentIdentity.csrfToken !== teacherIdentity.csrfToken,
      'Each actual role transition rotates CSRF',
    ).toBe(true);
    client.csrf = studentIdentity.csrfToken;
    client.user = studentIdentity.user;
    await expect(board(page)).toBeVisible();
    // The default bucket resets on the new real auth lifetime, without unloading this document.
    const upcoming = actionResponse(page, { type: 'all' });
    const tab = board(page).getByRole('tab', { name: /^未来7天(?:\s|$)/ });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    expect((await upcoming).status()).toBe(200);
    await sourceControl(page).selectOption('personal');
    const current = await apply(page, { type: 'personal' });
    expectCounts(current, 1, { type: 'personal' });
    expect(current.items).toMatchObject([{ id: task.id, type: 'personal' }]);
    await expect(card(page, 'personal', task.id)).toBeVisible();
    const expiry = await page.evaluate(() => (window as any).__filterExpiry);
    release();
    await expect
      .poll(() =>
        page.evaluate(
          ({ from, id, courseId }) =>
            (window as any).__filterArrivals.slice(from).some((entry: any) => {
              if (entry.status !== 200) return false;
              const body = JSON.parse(entry.body);
              return body.filters?.courseId === courseId && body.items?.some((item: any) => item.id === id);
            }),
          { from: arrivalIndex, id: assignment.id, courseId: course.id },
        ),
      )
      .toBe(true);
    if (routeError) throw routeError;
    await matchCount(page, 1);
    await expect(card(page, 'personal', task.id)).toBeVisible();
    await expect(card(page, 'assignment', assignment.id)).toHaveCount(0);
    await expect(board(page)).not.toContainText(course.title);
    await expect(applied(page)).toContainText('本人个人待办');
    await expect(courseControl(page)).toHaveValue('');
    expect(await page.evaluate(() => (window as any).__filterExpiry)).toBe(expiry);
    const identity = await call<Identity>(client, '/auth/me');
    expect(identity.user).toMatchObject({ id: learner.id, organizationId: org.id, role: 'STUDENT' });
    expect(
      identity.csrfToken === studentIdentity.csrfToken,
      'The delayed response must preserve current CSRF',
    ).toBe(true);
    expect(fixture.errors).toEqual([]);
  } catch (error) {
    throw fixture.failure(error);
  } finally {
    await fixture.cleanup();
  }
});
