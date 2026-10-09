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
test.skip(!permittedReview(), 'Live overview requires loopback web/API and a review PostgreSQL database');
// Random credentials exist only in memory/API requests, never in page inputs or artifacts.
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
type Actions = {
  items: { id: string; type: string; action: string; actionLabel: string; path: string }[];
  counts: { today: number; upcoming: number; overdue: number };
  serverTime: string;
  range: { tomorrowStart: string; upcomingEnd: string };
};
type Dashboard = {
  metrics: { label: string; value: number; detail: string }[];
  learningOverview: { serverTime: string; timezone: string; scope: string };
  tasks: { id: string }[];
};
type Task = { id: string; title: string; revision: number; dueAt: string };
type ExamAttempt = { id: string; number: number; status: string; deadlineAt: string };
const panel = (page: Page) => page.getByRole('region', { name: '学生学习概览', exact: true });
const board = (page: Page) => page.getByRole('region', { name: '我的学习行动清单', exact: true });
const card = (page: Page, kind: string, id: string) => page.getByTestId(`learning-action-${kind}-${id}`);
const metric = (page: Page, label: string) =>
  panel(page)
    .getByRole('link', { name: `查看${label}`, exact: true })
    .locator('strong');

async function login(context: APIRequestContext, username: string, password: string): Promise<Client> {
  let response;
  try {
    response = await context.post(`${web}/api/auth/login`, {
      headers: { Origin: web },
      data: { username, password },
    });
  } catch {
    throw new Error('Owned overview fixture authentication request failed');
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
const list = (client: Client, bucket = 'today') =>
  call<Actions>(client, `/planner/actions?bucket=${bucket}&pageSize=20`);
const dashboard = (client: Client) => call<Dashboard>(client, '/dashboard');
function counts(data: Dashboard) {
  expect(data.metrics[1]).toMatchObject({ label: '当前待交作业', detail: '未交或退回且现在可提交，不限7天' });
  expect(data.metrics[2]).toMatchObject({
    label: '当前可作答考试',
    detail: '现在可进入或继续作答，尚未开始不计入',
  });
  expect(data.learningOverview).toMatchObject({ timezone: 'Asia/Shanghai', scope: 'actionable_now' });
  expect(Number.isFinite(Date.parse(data.learningOverview.serverTime))).toBe(true);
  return [data.metrics[1].value, data.metrics[2].value];
}
async function show(page: Page) {
  await page.goto(`${web}/`, { waitUntil: 'domcontentloaded' });
  await expect(board(page)).toBeVisible();
  await expect(board(page).getByRole('status', { name: '行动匹配数量', exact: true })).toBeVisible();
}
async function expectMetrics(page: Page, assignments: number, exams: number) {
  await expect(metric(page, '当前待交作业')).toHaveText(String(assignments));
  await expect(metric(page, '当前可作答考试')).toHaveText(String(exams));
}
async function refreshOverview(page: Page) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/dashboard' && response.request().method() === 'GET',
  );
  const button = panel(page).getByRole('button', { name: '刷新学习概览', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  const response = await pending;
  expect(response.status()).toBe(200);
  return response.json() as Promise<Dashboard>;
}
async function selectBucket(page: Page, bucket: string) {
  const tab = board(page).getByRole('tab', { name: new RegExp(`^${bucket}(?:\\s|$)`) });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(board(page).getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
}
async function refreshActions(page: Page) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/planner/actions' && response.request().method() === 'GET',
  );
  const button = board(page).getByRole('button', { name: '刷新学习行动清单', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  expect((await pending).status()).toBe(200);
  await expect(board(page).getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
}
async function locateActionBucket(page: Page, id: string) {
  for (const label of ['今日', '未来7天', '逾期']) {
    await selectBucket(page, label);
    if (await card(page, 'exam', id).count()) return;
  }
  throw new Error('Owned actionable exam must appear in a current planner bucket');
}

class OwnedFixtures {
  readonly db = new PrismaClient();
  readonly suffix = randomBytes(8).toString('hex');
  readonly password = `Overview-${randomBytes(24).toString('base64url')}!`;
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
    const message = error instanceof Error ? error.message : 'Owned overview live validation failed';
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
  async user(organizationId: string, roleId: string, name: string) {
    if (!this.hash) this.hash = await hashPasswordAsync(this.password);
    const row = await this.db.user.create({
      data: {
        organizationId,
        name,
        username: `overview_live_${this.suffix}_${++this.sequence}`,
        passwordHash: this.hash,
        roles: { create: { roleId } },
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
      viewport: { width: 390, height: 844 },
    });
    this.contexts.push(context);
    const client = await login(context.request, username, this.password);
    const page = await context.newPage();
    this.observe(page);
    return { client, page };
  }
  async course(organizationId: string, teacherId: string, learners: string[]) {
    const row = await this.db.course.create({
      data: {
        organizationId,
        teacherId,
        title: `独立概览课程-${this.suffix}-${this.courses.length}`,
        status: 'PUBLISHED',
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
    startsAt = new Date(Date.now() - 60_000),
  ) {
    const now = Date.now();
    const entryClosesAt = new Date(Math.max(now, startsAt.getTime()) + 2 * 3600_000);
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
  async holdDashboard(page: Page) {
    let held = true,
      seen!: () => void,
      release!: () => void;
    const started = new Promise<void>((done) => {
      seen = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const resume = () => {
      held = false;
      release();
    };
    this.releases.push(resume);
    await page.route(/\/api\/dashboard(?:\?|$)/, async (route) => {
      if (held && route.request().method() === 'GET') {
        seen();
        await gate;
      }
      // Delay real transport only. No fabricated successful body, counts or status.
      await route.continue().catch(() => {});
    });
    return { started, release: resume };
  }
  async cleanup() {
    this.releases.forEach((release) => release());
    const failures: string[] = [];
    const resources = await Promise.allSettled([
      ...this.contexts.map((context) => context.close()),
      ...this.requests.map((context) => context.dispose()),
    ]);
    if (resources.some((result) => result.status === 'rejected'))
      failures.push('Owned overview browser/API resource cleanup failed');
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
      failures.push('Owned overview database fixture cleanup failed');
    } finally {
      try {
        await this.db.$disconnect();
      } catch {
        failures.push('Overview fixture database disconnect failed');
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  }
}

test('真实概览不限7天，个人延期/草稿/退回状态和跨用户机构隔离；统计冷加载不挡行动CAS', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const fixture = new OwnedFixtures();
  fixture.observe(page);
  try {
    const a = await fixture.organization('概览甲机构'),
      b = await fixture.organization('概览乙机构');
    const teacherUser = await fixture.user(a.id, 'TEACHER', '概览甲教师');
    const studentUser = await fixture.user(a.id, 'STUDENT', '概览本人');
    const peerUser = await fixture.user(a.id, 'STUDENT', '概览同机构同学');
    const foreignTeacherUser = await fixture.user(b.id, 'TEACHER', '概览乙教师');
    const foreignUser = await fixture.user(b.id, 'STUDENT', '概览外机构同学');
    const student = await login(page.request, studentUser.username, fixture.password);
    await fixture.verify(student);
    const teacher = await fixture.apiClient(teacherUser.username),
      foreignTeacher = await fixture.apiClient(foreignTeacherUser.username);
    const peer = await fixture.browserClient(browser, peerUser.username),
      foreign = await fixture.apiClient(foreignUser.username);
    const course = await fixture.course(a.id, teacherUser.id, [studentUser.id, peerUser.id]);
    const foreignCourse = await fixture.course(b.id, foreignTeacherUser.id, [foreignUser.id]);
    const question = await fixture.question(teacher, course.id),
      foreignQuestion = await fixture.question(foreignTeacher, foreignCourse.id);
    const range = await list(student),
      now = Date.parse(range.serverTime);
    const upcoming = new Date(Date.parse(range.range.tomorrowStart) + 2 * 3600_000);
    const far = await fixture.assignment(
      teacher,
      course.id,
      question,
      studentUser.id,
      '超过7天仍已开放',
      new Date(now + 30 * 86400_000),
    );
    const extended = await fixture.assignment(
      teacher,
      course.id,
      question,
      studentUser.id,
      '本人个别延期',
      new Date(now + 3600_000),
    );
    await fixture.db.assignment.update({
      where: { id: extended.id },
      data: { opensAt: new Date(now - 2 * 86400_000), dueAt: new Date(now - 86400_000) },
    });
    await call(teacher, `/assignments/${extended.id}/exceptions`, 'POST', {
      userId: studentUser.id,
      reason: '本人延期真实验收',
      allowUntil: upcoming.toISOString(),
    });
    const draft = await fixture.assignment(
      teacher,
      course.id,
      question,
      studentUser.id,
      '只有草稿仍待交',
      new Date(now + 2 * 86400_000),
    );
    await call(student, `/assignments/${draft.id}/draft`, 'PUT', {
      revision: 0,
      answers: [{ questionVersionId: question, value: 'A' }],
    });
    const returned = await fixture.assignment(
      teacher,
      course.id,
      question,
      studentUser.id,
      '正式退回后重新待交',
      new Date(now + 3600_000),
    );
    const submission = await call<{ id: string }>(student, `/assignments/${returned.id}/submit`, 'POST', {
      answers: [{ questionVersionId: question, value: 'A' }],
      idempotencyKey: `overview-live-first-${fixture.suffix}`,
    });
    await call(teacher, `/submissions/${submission.id}/return`, 'POST', { reason: '真实退回验证再次待交' });
    expect(
      await fixture.db.assignmentSubmission.findUniqueOrThrow({ where: { id: submission.id } }),
    ).toMatchObject({ status: 'returned' });
    const closed = await fixture.assignment(
      teacher,
      course.id,
      question,
      studentUser.id,
      '截止只读不算当前待交',
      new Date(now + 3600_000),
    );
    await fixture.db.assignment.update({
      where: { id: closed.id },
      data: { dueAt: new Date(now - 3600_000) },
    });
    const peerAssignment = await fixture.assignment(
      teacher,
      course.id,
      question,
      peerUser.id,
      '同学私有待交',
      new Date(now + 2 * 86400_000),
    );
    const foreignAssignment = await fixture.assignment(
      foreignTeacher,
      foreignCourse.id,
      foreignQuestion,
      foreignUser.id,
      '外机构私有待交',
      new Date(now + 2 * 86400_000),
    );
    // Public assignment questions cannot be reused in confidential exam snapshots.
    const availableQuestion = await fixture.question(teacher, course.id);
    const futureQuestion = await fixture.question(teacher, course.id);
    const available = await fixture.exam(
      teacher,
      course.id,
      availableQuestion,
      studentUser.id,
      '现在可进入考试',
    );
    const future = await fixture.exam(
      teacher,
      course.id,
      futureQuestion,
      studentUser.id,
      '明天尚未开始考试',
      new Date(upcoming.getTime() + 3600_000),
    );
    const personal = await call<Task>(student, '/planner/tasks', 'POST', {
      title: `统计冷加载时仍可完成-${fixture.suffix}`,
      dueAt: upcoming.toISOString(),
    });
    expect(counts(await dashboard(student))).toEqual([4, 1]);
    expect(counts(await dashboard(peer.client))).toEqual([1, 0]);
    expect(counts(await dashboard(foreign))).toEqual([1, 0]);
    await call(student, `/assignments/${peerAssignment.id}`, 'GET', undefined, 403);
    await call(student, `/assignments/${foreignAssignment.id}`, 'GET', undefined, 404);
    const union = (
      await Promise.all(['today', 'upcoming', 'overdue'].map((bucket) => list(student, bucket)))
    ).flatMap((data) => data.items);
    for (const id of [extended.id, draft.id, returned.id, closed.id, available.id, future.id])
      expect(union.some((item) => item.id === id)).toBe(true);
    for (const id of [far.id, peerAssignment.id, foreignAssignment.id])
      expect(union.some((item) => item.id === id)).toBe(false);
    expect(union.find((item) => item.id === future.id)?.action).toBe('wait_exam');
    expect(union.find((item) => item.id === closed.id)?.action).toBe('view');

    const held = await fixture.holdDashboard(page);
    await show(page);
    await held.started;
    await expect(panel(page).getByRole('status', { name: '学习概览加载状态', exact: true })).toBeVisible();
    await expect(metric(page, '当前待交作业')).toHaveCount(0);
    await selectBucket(page, '未来7天');
    const patch = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/planner/tasks/${personal.id}` &&
        response.request().method() === 'PATCH',
    );
    await card(page, 'personal', personal.id)
      .getByRole('button', { name: `标为完成 ${personal.title}`, exact: true })
      .click();
    expect((await patch).status()).toBe(200);
    await expect(card(page, 'personal', personal.id)).toHaveCount(0);
    expect(await fixture.db.personalTask.findUniqueOrThrow({ where: { id: personal.id } })).toMatchObject({
      revision: personal.revision + 1,
      completedAt: expect.any(Date),
    });
    held.release();
    await expectMetrics(page, 4, 1);
    await expect(panel(page).getByRole('status', { name: '概览统计时间', exact: true })).toContainText(
      '服务器北京时间',
    );
    await expect(card(page, 'assignment', extended.id)).toContainText('已采用你的个人延期安排');
    for (const label of ['今日', '未来7天', '逾期']) {
      await selectBucket(page, label);
      for (const id of [far.id, peerAssignment.id, foreignAssignment.id])
        await expect(card(page, 'assignment', id)).toHaveCount(0);
    }
    await show(peer.page);
    await expectMetrics(peer.page, 1, 0);
    for (const label of ['今日', '未来7天', '逾期']) {
      await selectBucket(peer.page, label);
      await expect(card(peer.page, 'assignment', extended.id)).toHaveCount(0);
    }

    // A real formal submission removes the previously draft-only pending item.
    await call(student, `/assignments/${draft.id}/submit`, 'POST', {
      answers: [{ questionVersionId: question, value: 'A' }],
      idempotencyKey: `overview-live-draft-formal-${fixture.suffix}`,
    });
    expect(counts(await refreshOverview(page))).toEqual([3, 1]);
    await expectMetrics(page, 3, 1);
    expect(fixture.errors).toEqual([]);
  } catch (error) {
    throw fixture.failure(error);
  } finally {
    await fixture.cleanup();
  }
});

test('真实考试资格取消恢复后再次进入，个人有效答卷续答不受入场关闭影响；额度与本体取消均排除', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fixture = new OwnedFixtures();
  fixture.observe(page);
  try {
    const organization = await fixture.organization('资格恢复概览机构');
    const teacherUser = await fixture.user(organization.id, 'TEACHER', '资格验收教师');
    const studentUser = await fixture.user(organization.id, 'STUDENT', '资格恢复本人');
    const student = await login(page.request, studentUser.username, fixture.password);
    await fixture.verify(student);
    const teacher = await fixture.apiClient(teacherUser.username);
    const course = await fixture.course(organization.id, teacherUser.id, [studentUser.id]);
    const question = await fixture.question(teacher, course.id);
    const exam = await fixture.exam(teacher, course.id, question, studentUser.id, '取消历史可再进入考试');
    const eligibility = (eligible: boolean) =>
      call(teacher, `/exams/${exam.id}/eligibility`, 'PUT', {
        userId: studentUser.id,
        eligible,
        reason: eligible ? '恢复资格保留历史次数' : '撤资格取消本人有效答卷',
      });
    await show(page);
    await expectMetrics(page, 0, 1);
    const first = await call<ExamAttempt>(student, `/exams/${exam.id}/start`, 'POST', {});
    expect(first).toMatchObject({ number: 1, status: 'in_progress' });
    await eligibility(false);
    expect(await fixture.db.examAttempt.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      status: 'cancelled',
      number: 1,
    });
    expect(counts(await refreshOverview(page))).toEqual([0, 0]);
    await refreshActions(page);
    for (const label of ['今日', '未来7天', '逾期']) {
      await selectBucket(page, label);
      await expect(card(page, 'exam', exam.id)).toHaveCount(0);
    }
    await call(student, `/exams/${exam.id}/start`, 'POST', {}, 403);

    await eligibility(true);
    expect(counts(await refreshOverview(page))).toEqual([0, 1]);
    await refreshActions(page);
    await locateActionBucket(page, exam.id);
    await expect(
      card(page, 'exam', exam.id).getByRole('link', { name: '再次考试', exact: true }),
    ).toHaveAttribute('href', `/exams/${exam.id}`);
    const second = await call<ExamAttempt>(student, `/exams/${exam.id}/start`, 'POST', {});
    expect(second).toMatchObject({ number: 2, status: 'in_progress' });
    expect(second.id).not.toBe(first.id);
    expect(await fixture.db.examAttempt.count({ where: { examId: exam.id, userId: studentUser.id } })).toBe(
      2,
    );

    // Mutate only this owned exam's general entry time, leaving its live personal
    // deadline untouched. No expired attempt is read/finalized by a GET here.
    await fixture.db.exam.update({
      where: { id: exam.id },
      data: { entryClosesAt: new Date(Date.now() - 1000) },
    });
    expect(Date.parse(second.deadlineAt)).toBeGreaterThan(Date.now());
    expect(counts(await refreshOverview(page))).toEqual([0, 1]);
    await refreshActions(page);
    await locateActionBucket(page, exam.id);
    await expect(
      card(page, 'exam', exam.id).getByRole('link', { name: '继续答卷', exact: true }),
    ).toHaveAttribute('href', `/exam-attempts/${second.id}`);
    const continuing = await call<ExamAttempt>(student, `/exams/${exam.id}/start`, 'POST', {});
    expect(continuing).toMatchObject({ id: second.id, number: 2, status: 'in_progress' });

    await eligibility(false);
    await eligibility(true);
    await fixture.db.exam.update({
      where: { id: exam.id },
      data: { entryClosesAt: new Date(Date.now() + 3600_000) },
    });
    expect(counts(await refreshOverview(page))).toEqual([0, 0]);
    await call(student, `/exams/${exam.id}/start`, 'POST', {}, 409);
    expect(await fixture.db.examAttempt.count({ where: { examId: exam.id, userId: studentUser.id } })).toBe(
      2,
    );
    await refreshActions(page);
    for (const label of ['今日', '未来7天', '逾期']) {
      await selectBucket(page, label);
      await expect(card(page, 'exam', exam.id)).toHaveCount(0);
    }

    // Restore one owned extra attempt first so cancellation, rather than quota,
    // independently explains the final disappearance from both consumers.
    await call(teacher, `/exams/${exam.id}/extensions`, 'POST', {
      userId: studentUser.id,
      deadlineAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
      extraAttempts: 1,
      reason: '独立验证考试本体取消',
    });
    expect(counts(await refreshOverview(page))).toEqual([0, 1]);
    await call(teacher, `/exams/${exam.id}/cancel`, 'POST', { reason: '考试本体取消必须排除' });
    expect(counts(await refreshOverview(page))).toEqual([0, 0]);
    await refreshActions(page);
    for (const label of ['今日', '未来7天', '逾期']) {
      await selectBucket(page, label);
      await expect(card(page, 'exam', exam.id)).toHaveCount(0);
    }
    await call(student, `/exams/${exam.id}/start`, 'POST', {}, 409);
    expect(fixture.errors).toEqual([]);
  } catch (error) {
    throw fixture.failure(error);
  } finally {
    await fixture.cleanup();
  }
});
