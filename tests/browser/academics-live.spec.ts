import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { hashPasswordAsync } from '../../apps/api/src/auth/password';

const api = process.env.TEST_BASE_URL;
const web = process.env.WEB_BASE_URL || 'http://localhost:5173';
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/none');
const loopback = (hostname: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
const isolated =
  process.env.NODE_ENV !== 'production' &&
  !!api &&
  loopback(new URL(api).hostname) &&
  loopback(new URL(web).hostname) &&
  loopback(database.hostname) &&
  /review/i.test(database.pathname);

test.skip(!isolated, 'Live academics checks require loopback web/API and a disposable review database');
// Account credentials and organization invitation codes must not enter automatic artifacts.
test.use({ screenshot: 'off', trace: 'off', video: 'off', actionTimeout: 15000 });

async function fillSecret(locator: Locator, value: string) {
  try {
    await locator.fill(value);
  } catch {
    throw new Error('Unable to fill an account security field');
  }
}

async function login(page: Page, username: string, password: string) {
  await page.goto(`${web}/login`);
  await page.getByLabel('账号', { exact: true }).fill(username);
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${web.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/$`));
}

async function chooseOption(page: Page, combobox: Locator, label: string) {
  // Keyboard traversal also reaches options outside Ant Design's virtualized viewport.
  await combobox.press('ArrowDown');
  for (let count = 0; count < 150; count++) {
    const active = page.locator(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-active',
    );
    if ((await active.getAttribute('title')) === label) {
      await combobox.press('Enter');
      return;
    }
    await combobox.press('ArrowDown');
  }
  throw new Error(`Unable to select learning option: ${label}`);
}

async function clearClientStorage(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function safeScreenshot(page: Page, name: string) {
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await mkdir('test-results/academics-live', { recursive: true });
  await page.screenshot({ path: `test-results/academics-live/${name}.png`, fullPage: true });
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
}

test('真实个人注册、专业与实验记录持久化、组织审批及退出后的个人数据恢复', async ({ page, browser }) => {
  test.setTimeout(180000);
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const studentName = '专业学习验收同学';
  const username = `academic_live_student_${suffix}`;
  const adminUsername = `academic_live_admin_${suffix}`;
  const password = `Academic-${randomBytes(24).toString('base64url')}!`;
  const adminPassword = `Academic-admin-${randomBytes(24).toString('base64url')}!`;
  const notebookTitle = `RC学习笔记-${suffix}`;
  const notebookBody = '串联电阻之和是等效电阻；RC在一个时间常数处充至约63.2%。\n下一步用并联电路作对照。';
  const persistedNotes = '已核对R=600Ω、I=0.02A。保留 <vector> 为纯文本，不作为HTML执行。';
  let organizationId: string | undefined;
  let assignedMajorId: string | undefined;
  let adminContext: BrowserContext | undefined;
  let administrator: APIRequestContext | undefined;
  const errors: string[] = [];
  const observe = (target: Page) => {
    target.on('pageerror', (error) => errors.push(error.message));
    target.on('console', (event) => {
      if (
        event.type() === 'error' &&
        /content security policy|violat.*policy|worker.*(?:fail|error)|refused to (?:load|execute|create)/i.test(
          event.text(),
        )
      )
        errors.push(event.text());
    });
  };
  observe(page);
  try {
    const organization = await db.organization.create({ data: { name: `专业学习浏览器验收-${suffix}` } });
    organizationId = organization.id;
    const administratorUser = await db.user.create({
      data: {
        organizationId,
        username: adminUsername,
        name: '专业学习验收管理员',
        passwordHash: await hashPasswordAsync(adminPassword),
        roles: { create: { roleId: 'ADMIN' } },
      },
    });
    const computerMajor = await db.academicsMajor.findUniqueOrThrow({
      where: { id: 'major-computer-science' },
    });
    const assignedMajor = await db.academicsMajor.create({
      data: {
        organizationId,
        subjectId: computerMajor.subjectId,
        name: `浏览器工程专业-${suffix}`,
        description: '仅供独立浏览器验收使用',
        moduleIds: ['circuit-lab', 'sql-lab', 'study-notebook'],
      },
    });
    assignedMajorId = assignedMajor.id;

    administrator = await playwrightRequest.newContext({ baseURL: api });
    const adminLogin = await administrator.post('/api/auth/login', {
      data: { username: administratorUser.username, password: adminPassword },
    });
    expect(adminLogin.status()).toBe(201);
    const adminSession = await adminLogin.json();
    const joinSettings = await administrator.patch('/api/admin/join-settings', {
      headers: { 'x-csrf-token': adminSession.csrfToken, Origin: web },
      data: { joinEnabled: true },
    });
    expect(joinSettings.ok()).toBe(true);
    const { inviteCode } = await joinSettings.json();
    expect(typeof inviteCode).toBe('string');

    await test.step('个人注册与服务器学习设置', async () => {
      await page.goto(`${web}/login`);
      await page.getByText('个人注册', { exact: true }).click();
      await page.getByLabel('姓名或昵称', { exact: true }).fill(studentName);
      await page.getByLabel('账号', { exact: true }).fill(username);
      await fillSecret(page.getByLabel('密码', { exact: true }), password);
      await fillSecret(page.getByLabel('确认密码', { exact: true }), password);
      await page.getByRole('button', { name: '注册并开始学习', exact: true }).click();
      await expect(page.getByRole('heading', { name: '我的学习空间', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: '我的课程', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: '算法练习', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '定制学习模块', exact: true }).click();
      const preferences = page.getByRole('dialog', { name: '定制我的学习空间' });
      await chooseOption(page, preferences.getByRole('combobox', { name: '我的专业' }), computerMajor.name);
      await preferences.getByRole('button', { name: '加入该专业推荐模块', exact: true }).click();
      await preferences.getByRole('checkbox', { name: '电阻网络与RC响应', exact: true }).check();
      await preferences.getByRole('checkbox', { name: 'SQL查询与关系数据库练习', exact: true }).check();
      await preferences.getByRole('checkbox', { name: '自由学习笔记', exact: true }).check();
      await preferences.getByRole('button', { name: '保存学习设置', exact: true }).click();
      await expect(preferences).toBeHidden();
      await clearClientStorage(page);
      await page.getByRole('button', { name: '定制学习模块', exact: true }).click();
      const saved = page.getByRole('dialog', { name: '定制我的学习空间' });
      await expect(saved.locator('.ant-select-selection-item')).toHaveText(computerMajor.name);
      for (const title of ['电阻网络与RC响应', 'SQL查询与关系数据库练习', '自由学习笔记'])
        await expect(saved.getByRole('checkbox', { name: title, exact: true })).toBeChecked();
      await saved.locator('.ant-modal-close').click();
      await safeScreenshot(page, 'personal-center-desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      await assertNoHorizontalOverflow(page);
      await safeScreenshot(page, 'personal-center-mobile');
    });

    await test.step('实际电路与SQL引擎、390像素结果布局', async () => {
      await page.goto(`${web}/academics/modules/circuit-lab`);
      await page.getByLabel('电阻列表（Ω）', { exact: true }).fill('[100,200,300]');
      await page.getByLabel('电源电压（V）', { exact: true }).fill('12');
      await page.getByLabel('本次记录标题（可选）', { exact: true }).fill(`串联电路验收-${suffix}`);
      await page.getByRole('button', { name: '运行并保存结果', exact: true }).click();
      await expect(page.getByRole('tab', { name: '结果与笔记', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const metrics = page.locator('.academic-metrics > div');
      await expect(metrics.filter({ has: page.getByText('等效电阻', { exact: true }) })).toContainText('600');
      await expect(metrics.filter({ has: page.getByText('总电流', { exact: true }) })).toContainText('0.02');
      await expect(metrics.filter({ has: page.getByText('RC时间常数', { exact: true }) })).toContainText(
        '0.06',
      );
      await assertNoHorizontalOverflow(page);
      await safeScreenshot(page, 'circuit-result-mobile');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${web}/academics/modules/sql-lab`);
      await page
        .getByLabel('SQL查询', { exact: true })
        .fill('SELECT name, score FROM students WHERE score >= 80 ORDER BY score DESC, id ASC;');
      await page.getByRole('button', { name: '运行并保存结果', exact: true }).click();
      await expect(
        page
          .locator('.academic-metrics > div')
          .filter({ has: page.getByText('任务是否匹配', { exact: true }) }),
      ).toContainText('是');
      const table = page
        .getByRole('region', { name: '查询结果，可横向滚动', exact: true })
        .getByRole('table');
      await expect(table.getByRole('row')).toHaveCount(5);
      await expect(table.locator('tbody tr')).toHaveText(['Dana95', 'Alice92', 'Chen88', 'Faye81']);
    });

    await test.step('自由笔记与记录笔记清除本机缓存后仍存在', async () => {
      await page.goto(`${web}/academics/modules/study-notebook`);
      await page.getByLabel('笔记主题', { exact: true }).fill(notebookTitle);
      await page.getByLabel('笔记正文', { exact: true }).fill(notebookBody);
      await page.getByLabel('标签', { exact: true }).fill('RC,电路,服务器持久化');
      await page.getByRole('button', { name: '保存学习记录', exact: true }).click();
      await expect(page.getByLabel('记录标题', { exact: true })).toHaveValue(notebookTitle);
      await page.getByLabel('学习记录笔记', { exact: true }).fill(persistedNotes);
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' && /\/api\/academics\/records\//.test(response.url()),
      );
      await page.getByRole('button', { name: '保存记录与笔记', exact: true }).click();
      expect((await saved).ok()).toBe(true);
      await clearClientStorage(page);
      await page.goto(`${web}/notes`);
      const card = page
        .locator('.academic-record-grid .panel')
        .filter({ has: page.getByRole('heading', { name: notebookTitle, exact: true }) });
      await card.getByRole('button', { name: '查看与编辑', exact: true }).click();
      const detail = page.getByRole('dialog', { name: '学习记录详情' });
      await expect(detail.getByLabel('学习记录笔记', { exact: true })).toHaveValue(persistedNotes);
      await expect(detail).toContainText(notebookBody);
      await detail.locator('.ant-modal-close').click();
    });

    await test.step('邀请申请由隔离组织管理员审批并指定专业', async () => {
      await page.goto(`${web}/organization`);
      await fillSecret(page.getByLabel('组织邀请码', { exact: true }), inviteCode);
      await page.getByLabel('申请说明（可选）', { exact: true }).fill('申请学习组织课程并保留个人学习空间。');
      await page.getByRole('button', { name: '提交加入申请', exact: true }).click();
      await expect(page.getByText('等待审核', { exact: true })).toBeVisible();
      adminContext = await browser.newContext({ baseURL: web, viewport: { width: 1440, height: 1000 } });
      const adminPage = await adminContext.newPage();
      observe(adminPage);
      await login(adminPage, adminUsername, adminPassword);
      await adminPage.goto(`${web}/admin/academics`);
      await adminPage.getByRole('tab', { name: '邀请码与加入审批', exact: true }).click();
      await chooseOption(
        adminPage,
        adminPage.getByRole('combobox', { name: `为${studentName}指定专业` }),
        assignedMajor.name,
      );
      await adminPage.getByRole('button', { name: '批准加入', exact: true }).click();
      await adminPage.getByRole('tooltip').getByRole('button', { name: '批准加入', exact: true }).click();
      await expect(adminPage.getByText('已批准加入，申请者需要重新登录', { exact: true })).toBeVisible();
      await adminContext.close();
      adminContext = undefined;
      await page.reload();
      await expect(page).toHaveURL(/\/login$/);
      await login(page, username, password);
      await expect(page.getByRole('link', { name: '我的课程', exact: true })).toBeVisible();
      await page.goto(`${web}/academics`);
      await page.getByRole('button', { name: '定制学习模块', exact: true }).click();
      const preferences = page.getByRole('dialog', { name: '定制我的学习空间' });
      await expect(preferences.getByRole('combobox', { name: '我的专业' })).toBeDisabled();
      await expect(preferences.locator('.ant-select-selection-item')).toHaveText(assignedMajor.name);
      await preferences.locator('.ant-modal-close').click();
      await page.goto(`${web}/academics/records`);
      await expect(page.getByRole('heading', { name: notebookTitle, exact: true })).toHaveCount(0);
    });

    await test.step('退出组织后恢复个人专业、学习设置和原笔记', async () => {
      await page.goto(`${web}/organization`);
      await page.getByRole('button', { name: '返回个人学习空间', exact: true }).click();
      await page.getByRole('tooltip').getByRole('button', { name: '退出组织', exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await login(page, username, password);
      await clearClientStorage(page);
      await expect(page.getByRole('heading', { name: '我的学习空间', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: '我的课程', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '定制学习模块', exact: true }).click();
      const preferences = page.getByRole('dialog', { name: '定制我的学习空间' });
      await expect(preferences.getByRole('combobox', { name: '我的专业' })).toBeEnabled();
      await expect(preferences.locator('.ant-select-selection-item')).toHaveText(computerMajor.name);
      await expect(
        preferences.getByRole('checkbox', { name: '电阻网络与RC响应', exact: true }),
      ).toBeChecked();
      await preferences.locator('.ant-modal-close').click();
      await page.goto(`${web}/notes`);
      const card = page
        .locator('.academic-record-grid .panel')
        .filter({ has: page.getByRole('heading', { name: notebookTitle, exact: true }) });
      await card.getByRole('button', { name: '查看与编辑', exact: true }).click();
      const detail = page.getByRole('dialog', { name: '学习记录详情' });
      await expect(detail.getByLabel('学习记录笔记', { exact: true })).toHaveValue(persistedNotes);
      await expect(detail).toContainText(notebookBody);
      expect(errors).toEqual([]);
    });
  } finally {
    // Close pages before error-context collection can include input values.
    await page.close().catch(() => {});
    await adminContext?.close();
    await administrator?.dispose();
    const users = await db.user.findMany({
      where: { username: { in: [username, adminUsername] } },
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
    await db.$transaction([
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
      db.userRole.deleteMany({ where: { userId: { in: ids } } }),
      db.user.deleteMany({ where: { id: { in: ids } } }),
      db.academicsMajor.deleteMany({ where: { id: { in: assignedMajorId ? [assignedMajorId] : [] } } }),
      db.organization.deleteMany({ where: { id: { in: organizations } } }),
    ]);
    await db.$disconnect();
  }
});
