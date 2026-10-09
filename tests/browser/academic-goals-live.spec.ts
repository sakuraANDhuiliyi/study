import {
  test,
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashPasswordAsync } from '../../apps/api/src/auth/password';

const api = process.env.TEST_BASE_URL;
const web = process.env.WEB_BASE_URL || 'http://localhost:5173';
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/none');
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
const review =
  process.env.NODE_ENV !== 'production' &&
  !!api &&
  loopback(new URL(api).hostname) &&
  loopback(new URL(web).hostname) &&
  loopback(database.hostname) &&
  /review/i.test(database.pathname);
test.skip(!review, 'Live goals require loopback web/API and a review database');
// Registration passwords and invitation codes must never enter traces or failure screenshots.
test.use({ screenshot: 'off', trace: 'off', video: 'off', actionTimeout: 15000 });
type Client = { api: APIRequestContext; csrf: string; user: any };

async function secret(field: Locator, value: string) {
  try {
    await field.fill(value);
  } catch {
    throw new Error('Unable to fill an account security field');
  }
}
async function call(
  client: Client,
  path: string,
  method = 'GET',
  data?: unknown,
  expected = method === 'POST' ? 201 : 200,
) {
  const response = await client.api.fetch(`${web}/api${path}`, {
    method,
    headers: { Origin: web, 'x-csrf-token': client.csrf },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), `${method} ${path} must return ${expected}`).toBe(expected);
  return response.json();
}
async function authenticate(
  context: APIRequestContext,
  username: string,
  password: string,
  registration = false,
): Promise<Client> {
  const response = await context.post(`${web}/api/auth/${registration ? 'register' : 'login'}`, {
    headers: { Origin: web },
    data: { username, password, ...(registration ? { name: '另一位目标验收同学' } : {}) },
  });
  expect(response.status(), 'Fixture account authentication must succeed').toBe(201);
  const body = await response.json();
  return { api: context, csrf: body.csrfToken, user: body.user };
}
async function loginBrowser(page: Page, username: string, password: string): Promise<Client> {
  await page.goto(`${web}/login`);
  await page.getByLabel('账号', { exact: true }).fill(username);
  await secret(page.getByLabel('密码', { exact: true }), password);
  const pending = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expect(page).toHaveURL(/\/$/);
  return { api: page.request, csrf: body.csrfToken, user: body.user };
}
async function choose(page: Page, field: Locator, label: string) {
  await field.press('ArrowDown');
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle(label, { exact: true })
    .click();
}
async function layout(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    '390px view must not overflow horizontally',
  ).toBe(true);
}

test('真实学习目标随完成记录增减、并发编辑保留输入，归档与账号空间隔离', async ({ page, browser }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const username = `goal_live_${suffix}`;
  const otherUsername = `goal_other_${suffix}`;
  const adminUsername = `goal_admin_${suffix}`;
  const password = `Goal-${randomBytes(24).toString('base64url')}!`;
  let personal: Client;
  let second: APIRequestContext | undefined;
  let otherApi: APIRequestContext | undefined;
  let adminApi: APIRequestContext | undefined;
  let otherContext: BrowserContext | undefined;
  let organizationId: string | undefined;
  let goal: any;
  const title = `电路参数对照-${suffix}`;
  const recordTitle = `电路第一轮-${suffix}`;
  const editedTitle = `${title}：保留这份输入`;
  const errors: string[] = [];
  const observe = (target: Page) => {
    target.on('pageerror', (error) => errors.push(error.message));
    target.on('console', (event) => {
      if (
        event.type() === 'error' &&
        /content security policy|violat.*policy|refused to (?:load|execute|create)/i.test(event.text())
      )
        errors.push(event.text());
    });
  };
  observe(page);
  const board = page.getByRole('region', { name: '我的学习目标', exact: true });
  const card = () => page.getByTestId(`academic-goal-${goal.id}`);
  const goals = (client = personal) => call(client, '/academics/goals?status=all');
  const currentGoal = async (client = personal) =>
    (await goals(client)).items.find((item: any) => item.id === goal.id);
  async function showGoals() {
    await page.goto(`${web}/academics`);
    await expect(board).toBeVisible();
  }
  async function evaluateCircuit(label: string) {
    await page.goto(`${web}/academics/modules/circuit-lab`);
    await page.getByLabel('电阻列表（Ω）', { exact: true }).fill('[100,200,300]');
    await page.getByLabel('电源电压（V）', { exact: true }).fill('12');
    await page.getByLabel('本次记录标题（可选）', { exact: true }).fill(label);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/academics/modules/circuit-lab/evaluate') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '运行并保存结果', exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const saved = await response.json();
    expect(saved.record.status).toBe('COMPLETED');
    await expect(page.getByRole('tab', { name: '结果与笔记', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await layout(page);
    return saved.record;
  }
  async function recordStatus(label: string) {
    await page.goto(`${web}/notes`);
    const record = page
      .locator('.academic-record-grid .panel')
      .filter({ has: page.getByRole('heading', { name: recordTitle, exact: true }) });
    await record.getByRole('button', { name: '查看与编辑', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '学习记录详情' });
    await choose(page, dialog.getByRole('combobox', { name: '学习记录状态' }), label);
    const pending = page.waitForResponse(
      (response) =>
        /\/api\/academics\/records\//.test(response.url()) && response.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
    expect((await pending).status()).toBe(200);
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await dialog.locator('.ant-modal-close').click();
  }
  try {
    await test.step('随机个人注册并通过真实界面创建目标', async () => {
      await page.goto(`${web}/login`);
      await page.getByText('个人注册', { exact: true }).click();
      await page.getByLabel('姓名或昵称', { exact: true }).fill('学习目标验收同学');
      await page.getByLabel('账号', { exact: true }).fill(username);
      await secret(page.getByLabel('密码', { exact: true }), password);
      await secret(page.getByLabel('确认密码', { exact: true }), password);
      const registered = page.waitForResponse(
        (response) => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '注册并开始学习', exact: true }).click();
      const response = await registered;
      expect(response.status()).toBe(201);
      const body = await response.json();
      personal = { api: page.request, csrf: body.csrfToken, user: body.user };
      await showGoals();
      await board.getByRole('button', { name: '创建学习目标', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '创建学习目标', exact: true });
      await dialog.getByRole('combobox', { name: '学习模块' }).fill('电阻');
      await page.getByTitle('电阻网络与RC响应', { exact: true }).click();
      await dialog.getByLabel('目标标题', { exact: true }).fill(title);
      await dialog.getByLabel('目标数量', { exact: true }).fill('2');
      await dialog.getByLabel('截止日期（北京时间，可选）', { exact: true }).fill('2000-01-01');
      const created = page.waitForResponse(
        (item) => item.url().endsWith('/api/academics/goals') && item.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: '创建目标', exact: true }).click();
      const saved = await created;
      expect(saved.status()).toBe(201);
      goal = await saved.json();
      expect(goal).toMatchObject({
        moduleId: 'circuit-lab',
        title,
        targetCount: 2,
        progressCount: 0,
        completed: false,
        overdue: true,
        archived: false,
        revision: 0,
        unit: '次',
      });
      await expect(dialog).toBeHidden();
      await expect(card()).toContainText('0 / 2 次');
      await expect(card().getByText('已过期', { exact: true })).toBeVisible();
      expect((await db.academicGoal.findUniqueOrThrow({ where: { id: goal.id } })).userId).toBe(
        personal.user.id,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await layout(page);
    });

    await test.step('真实电路完成记录推动进度，笔记改回继续研究后进度回落', async () => {
      const first = await evaluateCircuit(recordTitle);
      expect(first.moduleId).toBe('circuit-lab');
      await showGoals();
      await expect(card()).toContainText('1 / 2 次');
      expect((await currentGoal()).progressCount).toBe(1);
      await recordStatus('继续研究');
      await showGoals();
      await expect(card()).toContainText('0 / 2 次');
      expect((await currentGoal()).progressCount).toBe(0);
      await recordStatus('已完成');
      await evaluateCircuit(`电路第二轮-${suffix}`);
      await showGoals();
      await expect(card()).toContainText('2 / 2 次');
      await expect(card().getByText('已完成', { exact: true })).toBeVisible();
      await expect(card().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
      expect(await currentGoal()).toMatchObject({ progressCount: 2, completed: true, overdue: false });
      await layout(page);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(card()).toContainText('2 / 2 次');
    });

    await test.step('第二个真实会话造成CAS409，保留输入并核对最新版本后才覆盖', async () => {
      second = await request.newContext();
      const concurrent = await authenticate(second, username, password);
      await card()
        .getByRole('button', { name: `编辑目标 ${title}`, exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: '编辑学习目标', exact: true });
      await expect(dialog.getByRole('combobox', { name: '学习模块' })).toBeDisabled();
      await dialog.getByLabel('目标标题', { exact: true }).fill(editedTitle);
      await dialog.getByLabel('目标数量', { exact: true }).fill('3');
      await dialog.getByLabel('截止日期（北京时间，可选）', { exact: true }).fill('');
      const before = await currentGoal(concurrent);
      await call(concurrent, `/academics/goals/${goal.id}`, 'PATCH', {
        revision: before.revision,
        title: '另一窗口更新的服务器内容',
        targetCount: 4,
      });
      const conflict = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/academics/goals/${goal.id}`) &&
          response.request().method() === 'PATCH',
      );
      await dialog.getByRole('button', { name: '保存目标', exact: true }).click();
      expect((await conflict).status()).toBe(409);
      await expect(dialog.getByLabel('目标标题', { exact: true })).toHaveValue(editedTitle);
      await expect(dialog.getByLabel('目标数量', { exact: true })).toHaveValue('3');
      await dialog.getByRole('button', { name: '保留输入并刷新版本', exact: true }).click();
      await expect(dialog.getByText('另一窗口更新的服务器内容', { exact: true })).toBeVisible();
      await expect(dialog.getByLabel('目标标题', { exact: true })).toHaveValue(editedTitle);
      expect((await currentGoal()).title).toBe('另一窗口更新的服务器内容');
      await layout(page);
      await dialog.getByRole('button', { name: '按最新版本保存我的输入', exact: true }).click();
      await page.getByRole('tooltip').getByRole('button', { name: '确认保存', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(card()).toContainText(editedTitle);
      expect(await currentGoal()).toMatchObject({
        title: editedTitle,
        targetCount: 3,
        dueDate: null,
        progressCount: 2,
        completed: false,
      });
    });

    await test.step('归档与恢复仅改变目标可见性，不伪造进度或删除原记录', async () => {
      await card()
        .getByRole('button', { name: `归档目标 ${editedTitle}`, exact: true })
        .click();
      await expect(card()).toHaveCount(0);
      await choose(page, board.getByRole('combobox', { name: '学习目标状态' }), '已归档');
      await expect(card()).toContainText('2 / 3 次');
      expect(await currentGoal()).toMatchObject({ archived: true, progressCount: 2, overdue: false });
      await card()
        .getByRole('button', { name: `恢复目标 ${editedTitle}`, exact: true })
        .click();
      await expect(card()).toHaveCount(0);
      await choose(page, board.getByRole('combobox', { name: '学习目标状态' }), '当前目标');
      await expect(card()).toContainText('2 / 3 次');
      await layout(page);
    });

    await test.step('另一个个人账号既看不到目标，也不能修改或删除目标', async () => {
      otherApi = await request.newContext();
      const other = await authenticate(otherApi, otherUsername, password, true);
      expect((await goals(other)).items).toEqual([]);
      await call(
        other,
        `/academics/goals/${goal.id}`,
        'PATCH',
        { revision: (await currentGoal()).revision, title: '跨账号写入' },
        404,
      );
      await call(
        other,
        `/academics/goals/${goal.id}`,
        'DELETE',
        { revision: (await currentGoal()).revision },
        404,
      );
      otherContext = await browser.newContext({
        baseURL: web,
        storageState: await otherApi.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const otherPage = await otherContext.newPage();
      observe(otherPage);
      await otherPage.goto(`${web}/academics`);
      await expect(otherPage.getByRole('region', { name: '我的学习目标' })).toContainText('还没有学习目标');
      await expect(otherPage.getByText(editedTitle, { exact: true })).toHaveCount(0);
      await layout(otherPage);
      await otherContext.close();
      otherContext = undefined;
    });

    await test.step('加入机构后个人目标隔离，退出恢复目标及真实进度', async () => {
      const organization = await db.organization.create({ data: { name: `目标验收组织-${suffix}` } });
      organizationId = organization.id;
      await db.user.create({
        data: {
          username: adminUsername,
          name: '目标验收管理员',
          organizationId,
          passwordHash: await hashPasswordAsync(password),
          roles: { create: { roleId: 'ADMIN' } },
        },
      });
      adminApi = await request.newContext();
      const admin = await authenticate(adminApi, adminUsername, password);
      const settings = await call(admin, '/admin/join-settings', 'PATCH', { joinEnabled: true });
      const application = await call(personal, '/account/join-requests', 'POST', {
        inviteCode: settings.inviteCode,
        majorId: 'major-computer-science',
        note: '仅当前测试账号的空间切换验收',
      });
      await call(admin, `/admin/join-requests/${application.id}`, 'PATCH', {
        status: 'APPROVED',
        majorId: 'major-computer-science',
      });
      await call(personal, '/academics/goals', 'GET', undefined, 401);
      personal = await loginBrowser(page, username, password);
      expect(personal.user.accountMode).toBe('ORGANIZATION');
      expect((await goals()).items).toEqual([]);
      await call(
        personal,
        `/academics/goals/${goal.id}`,
        'PATCH',
        { revision: 4, title: '不能跨空间更新' },
        404,
      );
      await showGoals();
      await expect(card()).toHaveCount(0);
      const institutionGoal = await call(personal, '/academics/goals', 'POST', {
        moduleId: 'circuit-lab',
        title: '机构内的新目标',
        targetCount: 1,
      });
      const module = await call(personal, '/academics/modules/circuit-lab');
      await call(personal, '/academics/modules/circuit-lab/evaluate', 'POST', {
        values: module.defaultValues,
      });
      expect((await goals()).items.find((item: any) => item.id === institutionGoal.id)).toMatchObject({
        progressCount: 1,
        completed: true,
      });
      expect((await call(personal, '/account/leave-organization', 'POST', {})).loginRequired).toBe(true);
      personal = await loginBrowser(page, username, password);
      expect(personal.user.accountMode).toBe('PERSONAL');
      await showGoals();
      await expect(card()).toContainText('2 / 3 次');
      expect(await currentGoal()).toMatchObject({ title: editedTitle, progressCount: 2 });
      expect((await goals()).items.some((item: any) => item.id === institutionGoal.id)).toBe(false);
      await call(
        personal,
        `/academics/goals/${institutionGoal.id}`,
        'DELETE',
        { revision: institutionGoal.revision },
        404,
      );
      expect(await db.academicGoal.findUnique({ where: { id: institutionGoal.id } })).not.toBeNull();
    });

    await test.step('删除目标保留已有学习记录', async () => {
      const before = await db.academicsRecord.count({ where: { userId: personal.user.id } });
      await card()
        .getByRole('button', { name: `删除目标 ${editedTitle}`, exact: true })
        .click();
      await page.getByRole('tooltip').getByRole('button', { name: '删除目标', exact: true }).click();
      await expect(card()).toHaveCount(0);
      expect(await db.academicGoal.findUnique({ where: { id: goal.id } })).toBeNull();
      expect(await db.academicsRecord.count({ where: { userId: personal.user.id } })).toBe(before);
      expect(errors).toEqual([]);
    });
  } finally {
    // Close pages before Playwright can collect an input-containing error context.
    await page.close().catch(() => {});
    await otherContext?.close();
    await second?.dispose();
    await otherApi?.dispose();
    await adminApi?.dispose();
    const users = await db.user.findMany({
      where: { username: { in: [username, otherUsername, adminUsername] } },
      select: { id: true, personalOrganizationId: true },
    });
    const ids = users.map((user) => user.id);
    const organizations = [
      ...new Set(
        [organizationId, ...users.map((user) => user.personalOrganizationId)].filter(
          (id): id is string => !!id,
        ),
      ),
    ];
    try {
      await db.$transaction([
        db.academicGoal.deleteMany({ where: { userId: { in: ids } } }),
        db.academicsEvaluationAttempt.deleteMany({ where: { userId: { in: ids } } }),
        db.academicsRecord.deleteMany({ where: { userId: { in: ids } } }),
        db.academicsPreference.deleteMany({ where: { userId: { in: ids } } }),
        db.organizationJoinRequest.deleteMany({
          where: { OR: [{ userId: { in: ids } }, { organizationId: { in: organizations } }] },
        }),
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
    } finally {
      await db.$disconnect();
    }
  }
});
