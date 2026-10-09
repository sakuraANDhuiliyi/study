import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashPasswordAsync } from '../../apps/api/src/auth/password';

const api = process.env.TEST_BASE_URL;
const web = process.env.WEB_BASE_URL || 'http://localhost:5173';
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/none');
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
test.skip(
  process.env.NODE_ENV === 'production' ||
    !api ||
    !loopback(new URL(api).hostname) ||
    !loopback(new URL(web).hostname) ||
    !loopback(database.hostname) ||
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !/review/i.test(database.pathname),
  'Live learning actions require loopback web/API and a review PostgreSQL database',
);
// Random fixture credentials are never typed into the page or recorded in artifacts.
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  actionTimeout: 15000,
  timezoneId: 'America/Los_Angeles',
  viewport: { width: 390, height: 844 },
});

type Client = {
  api: APIRequestContext;
  csrf: string;
  user: { id: string; organizationId: string; accountMode: string; role: string };
};
type Task = { id: string; title: string; dueAt: string; revision: number; completedAt: string | null };
type Summary = {
  id: string;
  type: string;
  dueAt: string;
  originalDueAt?: string;
  action: string;
  actionLabel: string;
  path: string;
  revision?: number;
};
type Actions = {
  items: Summary[];
  counts: { today: number; upcoming: number; overdue: number };
  total: number;
  serverTime: string;
  range: { todayStart: string; tomorrowStart: string; upcomingEnd: string };
};

async function authenticate(
  context: APIRequestContext,
  username: string,
  password: string,
  register = false,
): Promise<Client> {
  let response;
  try {
    response = await context.post(`${web}/api/auth/${register ? 'register' : 'login'}`, {
      headers: { Origin: web },
      data: { username, password, ...(register ? { name: '行动清单验收同学' } : {}) },
    });
  } catch {
    throw new Error('Independent fixture authentication request failed');
  }
  expect(response.status(), 'Independent fixture authentication must succeed').toBe(201);
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
  return response.json();
}
const actions = (client: Client, bucket = 'today') =>
  call<Actions>(client, `/planner/actions?bucket=${bucket}&page=1&pageSize=10`);
const board = (page: Page) => page.getByRole('region', { name: '我的学习行动清单', exact: true });
const card = (page: Page, type: string, id: string) => page.getByTestId(`learning-action-${type}-${id}`);
const patchResponse = (page: Page, id: string) =>
  page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/planner/tasks/${id}` &&
      response.request().method() === 'PATCH',
  );
async function show(page: Page) {
  await page.goto(`${web}/`);
  await expect(board(page)).toBeVisible();
  await expect(board(page).getByRole('status', { name: '行动匹配数量', exact: true })).toBeVisible();
  await expect(board(page).getByRole('tab', { name: /^今日(?:\s|$)/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}
async function bucket(page: Page, label: string) {
  const tab = board(page).getByRole('tab', { name: new RegExp(`^${label}(?:\\s|$)`) });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(board(page).getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
}
async function refresh(page: Page) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/planner/actions' && response.request().method() === 'GET',
  );
  const button = board(page).getByRole('button', { name: '刷新学习行动清单', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(board(page).getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
  return response.json() as Promise<Actions>;
}
async function layout(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    '390px learning action home must remain usable without horizontal overflow',
  ).toBe(true);
}
async function holdActionReads(page: Page) {
  let frozen = true;
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  // Hold actual GET requests after the initial read. Never fabricate a body or
  // status. This prevents focus polling from silently replacing a stale CAS row.
  await page.route(/\/api\/planner\/actions(?:\?|$)/, async (route) => {
    if (frozen && route.request().method() === 'GET') await gate;
    await route.continue().catch(() => {});
  });
  return () => {
    frozen = false;
    release();
  };
}
async function verifyReviewIdentity(db: PrismaClient, client: Client) {
  const row = await db.user.findFirst({
    where: { id: client.user.id, organizationId: client.user.organizationId },
    select: { id: true },
  });
  expect(row, 'The browser proxy must use this disposable review database').not.toBeNull();
}
async function cleanup(
  db: PrismaClient,
  usernames: string[],
  extraOrganizations: string[] = [],
  courseIds: string[] = [],
) {
  // Only the random fixture usernames and organizations collected by this test can be deleted.
  const users = await db.user.findMany({
    where: { username: { in: usernames } },
    select: { id: true, personalOrganizationId: true },
  });
  const ids = users.map((user) => user.id);
  const organizations = [
    ...new Set([
      ...extraOrganizations,
      ...users.flatMap((user) => (user.personalOrganizationId ? [user.personalOrganizationId] : [])),
    ]),
  ];
  const assignments = await db.assignment.findMany({
    where: { organizationId: { in: organizations }, courseId: { in: courseIds } },
    select: { id: true },
  });
  const assignmentIds = assignments.map((item) => item.id);
  const questions = await db.question.findMany({
    where: { organizationId: { in: organizations }, courseId: { in: courseIds } },
    select: { id: true },
  });
  await db.$transaction([
    db.assignmentException.deleteMany({ where: { assignmentId: { in: assignmentIds } } }),
    db.assignmentDraft.deleteMany({ where: { assignmentId: { in: assignmentIds } } }),
    db.assignmentAudience.deleteMany({ where: { assignmentId: { in: assignmentIds } } }),
    db.assignmentItem.deleteMany({ where: { assignmentId: { in: assignmentIds } } }),
    db.assignment.deleteMany({ where: { id: { in: assignmentIds } } }),
    db.questionVersion.deleteMany({ where: { questionId: { in: questions.map((item) => item.id) } } }),
    db.question.deleteMany({ where: { id: { in: questions.map((item) => item.id) } } }),
    db.enrollment.deleteMany({ where: { courseId: { in: courseIds }, userId: { in: ids } } }),
    db.teachingAssignment.deleteMany({ where: { courseId: { in: courseIds }, userId: { in: ids } } }),
    db.learningProgress.deleteMany({ where: { courseId: { in: courseIds }, userId: { in: ids } } }),
    db.lesson.deleteMany({ where: { courseId: { in: courseIds } } }),
    db.chapter.deleteMany({ where: { courseId: { in: courseIds } } }),
    db.course.deleteMany({ where: { id: { in: courseIds }, organizationId: { in: organizations } } }),
    db.personalTask.deleteMany({ where: { userId: { in: ids }, organizationId: { in: organizations } } }),
    db.academicGoal.deleteMany({ where: { userId: { in: ids } } }),
    db.academicsPreference.deleteMany({ where: { userId: { in: ids } } }),
    db.passwordRecovery.deleteMany({ where: { userId: { in: ids } } }),
    db.session.deleteMany({ where: { userId: { in: ids } } }),
    db.sensitiveGrant.deleteMany({ where: { userId: { in: ids } } }),
    db.notification.deleteMany({ where: { organizationId: { in: organizations } } }),
    db.backgroundJob.deleteMany({ where: { organizationId: { in: organizations } } }),
    db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } }),
    db.systemSetting.deleteMany({ where: { organizationId: { in: organizations } } }),
    db.userRole.deleteMany({ where: { userId: { in: ids } } }),
    db.user.deleteMany({ where: { id: { in: ids } } }),
    db.organization.deleteMany({ where: { id: { in: organizations } } }),
  ]);
}

test('真实个人首页跨时间桶读取私人行动，双页面CAS冲突不误完成且完成结果持久化', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const usernames = [`actions_live_${suffix}`, `actions_peer_${suffix}`];
  const password = `Actions-${randomBytes(24).toString('base64url')}!`;
  let peerContext: BrowserContext | undefined;
  let secondPage: Page | undefined;
  const extraOrganizations: string[] = [];
  const heldReads: (() => void)[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const personal = await authenticate(page.request, usernames[0], password, true);
    expect(personal.user.accountMode).toBe('PERSONAL');
    await verifyReviewIdentity(db, personal);
    peerContext = await browser.newContext({
      baseURL: web,
      viewport: { width: 390, height: 844 },
      timezoneId: 'America/Los_Angeles',
    });
    const peer = await authenticate(peerContext.request, usernames[1], password, true);
    await verifyReviewIdentity(db, peer);
    const initial = await actions(personal);
    const due = new Date(Date.parse(initial.range.tomorrowStart) - 1000).toISOString();
    const titles = {
      today: `今日笔记-${suffix}`,
      upcoming: `下周练习-${suffix}`,
      overdue: `逾期复习-${suffix}`,
    };
    const today = await call<Task>(personal, '/planner/tasks', 'POST', { title: titles.today, dueAt: due });
    const future = await call<Task>(personal, '/planner/tasks', 'POST', {
      title: titles.upcoming,
      dueAt: new Date(Date.parse(initial.range.tomorrowStart) + 12 * 3600000).toISOString(),
    });
    const old = await call<Task>(personal, '/planner/tasks', 'POST', {
      title: titles.overdue,
      dueAt: new Date(Date.parse(initial.serverTime) - 3600000).toISOString(),
    });
    const peerTask = await call<Task>(peer, '/planner/tasks', 'POST', {
      title: `别人的待办-${suffix}`,
      dueAt: due,
    });
    const foreign = await db.organization.create({ data: { name: `行动历史空间-${suffix}` } });
    extraOrganizations.push(foreign.id);
    const foreignTask = await db.personalTask.create({
      data: {
        organizationId: foreign.id,
        userId: personal.user.id,
        title: `本人其他空间待办-${suffix}`,
        dueAt: new Date(due),
      },
    });
    expect((await actions(personal)).counts).toEqual({ today: 1, upcoming: 1, overdue: 1 });
    await call(personal, `/planner/tasks/${peerTask.id}`, 'GET', undefined, 404);
    await call(peer, `/planner/tasks/${today.id}`, 'GET', undefined, 404);
    await call(personal, `/planner/tasks/${foreignTask.id}`, 'GET', undefined, 404);

    await test.step('真实接口和移动首页按上海日期读取同一私人任务，不包含他人或其他空间', async () => {
      await show(page);
      await expect(card(page, 'personal', today.id)).toContainText(titles.today);
      await expect(card(page, 'personal', today.id).locator('time')).toHaveAttribute('datetime', today.dueAt);
      await expect(board(page).getByRole('link', { name: '安排个人待办' })).toHaveAttribute(
        'href',
        '/planner',
      );
      await bucket(page, '未来7天');
      await expect(card(page, 'personal', future.id)).toContainText(titles.upcoming);
      await expect(board(page)).toContainText('不包含今天');
      await bucket(page, '逾期');
      await expect(card(page, 'personal', old.id)).toContainText(titles.overdue);
      await expect(card(page, 'personal', old.id)).toContainText('已逾期');
      for (const label of ['今日', '未来7天', '逾期']) {
        await bucket(page, label);
        await expect(card(page, 'personal', peerTask.id)).toHaveCount(0);
        await expect(card(page, 'personal', foreignTask.id)).toHaveCount(0);
      }
      const peerPage = await peerContext!.newPage();
      await show(peerPage);
      await expect(card(peerPage, 'personal', peerTask.id)).toBeVisible();
      await expect(card(peerPage, 'personal', today.id)).toHaveCount(0);
      await expect(card(peerPage, 'personal', foreignTask.id)).toHaveCount(0);
      await layout(page);
      await layout(peerPage);
    });

    await test.step('两个真实页面保留旧revision，409刷新同一时间桶，随后仅成功CAS完成', async () => {
      await bucket(page, '今日');
      secondPage = await context.newPage();
      secondPage.on('pageerror', (error) => errors.push(error.message));
      await show(secondPage);
      await expect(card(secondPage, 'personal', today.id)).toContainText(titles.today);
      const releaseFirst = await holdActionReads(page);
      const releaseSecond = await holdActionReads(secondPage);
      heldReads.push(releaseFirst, releaseSecond);
      const changedTitle = `${titles.today}（另一页面更新）`;
      const changed = await call<Task>(personal, `/planner/tasks/${today.id}`, 'PATCH', {
        revision: 0,
        title: changedTitle,
      });
      expect(changed.revision).toBe(1);
      const conflicted = patchResponse(page, today.id);
      await card(page, 'personal', today.id)
        .getByRole('button', { name: `标为完成 ${titles.today}`, exact: true })
        .click();
      const conflict = await conflicted;
      expect(conflict.status()).toBe(409);
      expect(conflict.request().postDataJSON().revision).toBe(0);
      releaseFirst();
      await expect(board(page)).toContainText('待办已在其他页面修改，已刷新清单。请核对当前内容后再次完成。');
      await expect(card(page, 'personal', today.id)).toContainText(changedTitle);
      expect((await db.personalTask.findUniqueOrThrow({ where: { id: today.id } })).completedAt).toBeNull();
      await expect(board(page).getByRole('tab', { name: /^今日(?:\s|$)/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const completed = patchResponse(page, today.id);
      await card(page, 'personal', today.id)
        .getByRole('button', { name: `标为完成 ${changedTitle}`, exact: true })
        .click();
      const completion = await completed;
      expect(completion.status()).toBe(200);
      expect(completion.request().postDataJSON()).toEqual({ revision: 1, completed: true });
      await expect(card(page, 'personal', today.id)).toHaveCount(0);
      const persisted = await db.personalTask.findFirstOrThrow({
        where: { id: today.id, userId: personal.user.id, organizationId: personal.user.organizationId },
      });
      expect(persisted.revision).toBe(2);
      expect(persisted.completedAt).not.toBeNull();
      // The other real page retains revision 0; its stale completion must not mutate revision 2.
      const stale = patchResponse(secondPage, today.id);
      await card(secondPage, 'personal', today.id)
        .getByRole('button', { name: `标为完成 ${titles.today}`, exact: true })
        .click();
      expect((await stale).status()).toBe(409);
      releaseSecond();
      await expect(card(secondPage, 'personal', today.id)).toHaveCount(0);
      await expect(board(secondPage).getByRole('tab', { name: /^今日(?:\s|$)/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect((await db.personalTask.findUniqueOrThrow({ where: { id: today.id } })).revision).toBe(2);
      await page.reload();
      await expect(board(page)).toBeVisible();
      await expect(card(page, 'personal', today.id)).toHaveCount(0);
      expect((await actions(personal)).counts).toEqual({ today: 0, upcoming: 1, overdue: 1 });
      await layout(page);
      expect(errors).toEqual([]);
    });
  } finally {
    heldReads.forEach((release) => release());
    await secondPage?.close().catch(() => {});
    await peerContext?.close().catch(() => {});
    await page.close().catch(() => {});
    try {
      await cleanup(db, usernames, extraOrganizations);
    } finally {
      await db.$disconnect();
    }
  }
});

test('真实机构首页显示本人补交安排，撤销课程资格后仍能独立使用个人待办', async ({ page, browser }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const usernames = [`actions_org_${suffix}`, `actions_org_peer_${suffix}`, `actions_teacher_${suffix}`];
  const password = `Actions-org-${randomBytes(24).toString('base64url')}!`;
  const organizations: string[] = [];
  const courseIds: string[] = [];
  let peerContext: BrowserContext | undefined;
  let coursePermissionRemoved = false;
  try {
    const organization = await db.organization.create({ data: { name: `行动课程验收组织-${suffix}` } });
    organizations.push(organization.id);
    const hash = await hashPasswordAsync(password);
    const fixtures = await Promise.all(
      usernames.map((username, index) =>
        db.user.create({
          data: {
            username,
            organizationId: organization.id,
            name: `行动验收${index}`,
            passwordHash: hash,
            roles: { create: { roleId: index === 2 ? 'TEACHER' : 'STUDENT' } },
          },
        }),
      ),
    );
    const student = await authenticate(page.request, usernames[0], password);
    expect(student.user.accountMode).toBe('ORGANIZATION');
    await verifyReviewIdentity(db, student);
    peerContext = await browser.newContext({
      baseURL: web,
      viewport: { width: 390, height: 844 },
      timezoneId: 'America/Los_Angeles',
    });
    const peer = await authenticate(peerContext.request, usernames[1], password);
    const initial = await actions(student);
    const currentDue = new Date(Date.parse(initial.range.tomorrowStart) - 1000);
    const originalDue = new Date(Date.parse(initial.serverTime) - 86400000);
    const course = await db.course.create({
      data: {
        organizationId: organization.id,
        teacherId: fixtures[2].id,
        title: `本人延期课程-${suffix}`,
        status: 'PUBLISHED',
      },
    });
    courseIds.push(course.id);
    const chapter = await db.chapter.create({
      data: { courseId: course.id, title: '学习行动导读', sortOrder: 0 },
    });
    await db.lesson.create({
      data: {
        courseId: course.id,
        chapterId: chapter.id,
        title: '如何理解本人补交安排',
        type: 'TEXT',
        content: '截止安排以本人获得的延期为准。',
      },
    });
    await db.enrollment.createMany({
      data: fixtures.slice(0, 2).map((user) => ({ courseId: course.id, userId: user.id })),
    });
    await db.teachingAssignment.create({ data: { courseId: course.id, userId: fixtures[2].id } });
    const question = await db.question.create({
      data: {
        organizationId: organization.id,
        courseId: course.id,
        creatorId: fixtures[2].id,
        versions: {
          create: {
            version: 1,
            type: 'single',
            stem: '选择合理的复习方式。',
            options: [
              { id: 'A', text: '分阶段复习' },
              { id: 'B', text: '完全不复习' },
            ],
            answer: 'A',
            explanation: '练习用例',
            rules: {},
            scoreCents: 100,
            knowledgePoints: [],
            tags: [],
            children: [],
          },
        },
      },
      include: { versions: true },
    });
    const assignment = await db.assignment.create({
      data: {
        organizationId: organization.id,
        courseId: course.id,
        creatorId: fixtures[2].id,
        title: `允许个人补交-${suffix}`,
        status: 'published',
        opensAt: new Date(originalDue.getTime() - 86400000),
        dueAt: originalDue,
        totalCents: 100,
        attachmentIds: [],
        audience: { create: { userId: student.user.id } },
        items: { create: { questionVersionId: question.versions[0].id, position: 0 } },
        exceptions: {
          create: {
            userId: student.user.id,
            approvedBy: fixtures[2].id,
            reason: '学习行动真实补交验收',
            allowUntil: currentDue,
          },
        },
      },
    });
    const listed = await actions(student);
    expect(listed.total).toBe(1);
    expect(listed.items[0]).toMatchObject({
      id: assignment.id,
      type: 'assignment',
      action: 'submit',
      dueAt: currentDue.toISOString(),
      originalDueAt: originalDue.toISOString(),
      path: `/assignments/${assignment.id}`,
    });
    const detail = await call(student, `/assignments/${assignment.id}`);
    expect(detail.exception.allowUntil).toBe(currentDue.toISOString());
    expect((await actions(peer)).counts).toEqual({ today: 0, upcoming: 0, overdue: 0 });
    await call(peer, `/assignments/${assignment.id}`, 'GET', undefined, 403);
    await show(page);
    const row = card(page, 'assignment', assignment.id);
    await expect(row).toContainText(assignment.title);
    await expect(row).toContainText('已采用你的个人延期安排');
    await expect(row.locator('time')).toHaveAttribute('datetime', currentDue.toISOString());
    await expect(row.getByRole('link', { name: '提交作业' })).toHaveAttribute(
      'href',
      `/assignments/${assignment.id}`,
    );
    const peerPage = await peerContext.newPage();
    await show(peerPage);
    await expect(card(peerPage, 'assignment', assignment.id)).toHaveCount(0);
    await layout(page);
    await db.enrollment.update({
      where: { courseId_userId: { courseId: course.id, userId: student.user.id } },
      data: { active: false },
    });
    const refreshed = await refresh(page);
    expect(refreshed.counts).toEqual({ today: 0, upcoming: 0, overdue: 0 });
    await expect(row).toHaveCount(0);
    expect((await actions(student)).total).toBe(0);
    // The legacy organization dashboard requires course.read. The private action
    // panel must still work when that course permission is unavailable.
    const personal = await call<Task>(student, '/planner/tasks', 'POST', {
      title: `机构个人复习安排-${suffix}`,
      dueAt: currentDue.toISOString(),
    });
    const permission = await db.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'course.read' } },
    });
    expect(permission).not.toBeNull();
    const removed = await db.rolePermission.deleteMany({
      where: { roleId: 'STUDENT', permissionId: 'course.read' },
    });
    coursePermissionRemoved = removed.count === 1;
    expect(coursePermissionRemoved).toBe(true);
    const dashboardRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/dashboard') dashboardRequests.push(request.url());
    });
    await page.reload();
    await expect(board(page)).toBeVisible();
    await expect(card(page, 'personal', personal.id)).toContainText(personal.title);
    await expect(card(page, 'assignment', assignment.id)).toHaveCount(0);
    expect((await actions(student)).counts).toEqual({ today: 1, upcoming: 0, overdue: 0 });
    expect(dashboardRequests).toEqual([]);
    await layout(page);
  } finally {
    await peerContext?.close().catch(() => {});
    await page.close().catch(() => {});
    try {
      if (coursePermissionRemoved)
        await db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'course.read' } },
          create: { roleId: 'STUDENT', permissionId: 'course.read' },
          update: {},
        });
      await cleanup(db, usernames, organizations, courseIds);
    } finally {
      await db.$disconnect();
    }
  }
});
