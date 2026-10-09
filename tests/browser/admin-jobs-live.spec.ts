import {
  test,
  expect,
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
test.skip(!permittedReview(), 'Live jobs require loopback web/API and a review PostgreSQL database');
test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 15_000,
  timezoneId: 'America/Los_Angeles',
  viewport: { width: 1440, height: 1000 },
});
type Client = {
  api: APIRequestContext;
  csrf: string;
  user: { id: string; organizationId: string; role: string; permissions: string[] };
};
type StateCounts = {
  all: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  other: number;
};
type Jobs = {
  items: { id: string; organizationId: string; organizationName: string; kind: string; status: string }[];
  total: number;
  page: number;
  pageSize: number;
  stateCounts: StateCounts;
  scope: string;
  serverTime: string;
  examDeadlineRuns: unknown[];
};
const panel = (page: Page) => page.getByRole('region', { name: '后台任务记录', exact: true });
const row = (page: Page, id: string) => panel(page).getByTestId(`jobs-row-${id}`);
const listResponse = (page: Page, predicate: (url: URL) => boolean = () => true) =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/jobs' && response.request().method() === 'GET' && predicate(url);
  });
async function login(context: APIRequestContext, username: string, password: string): Promise<Client> {
  let response;
  try {
    response = await context.post(`${web}/api/auth/login`, {
      headers: { Origin: web },
      data: { username, password },
    });
  } catch {
    throw new Error('Owned jobs fixture authentication failed');
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
const getJobs = (client: Client, action: string, status = 'ALL', page = 1) =>
  call<Jobs>(
    client,
    `/admin/jobs?${new URLSearchParams({ action, status, page: String(page), pageSize: '20' })}`,
  );
async function show(page: Page) {
  await page.goto(`${web}/admin/audit?tab=jobs`);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('status', { name: '任务匹配数量', exact: true })).toBeVisible();
}
async function apply(page: Page, action: string, status = 'ALL') {
  await panel(page).getByRole('textbox', { name: '任务类型关键词', exact: true }).fill(action);
  await panel(page).getByRole('combobox', { name: '任务状态', exact: true }).selectOption(status);
  const pending = listResponse(
    page,
    (url) =>
      url.searchParams.get('action') === action &&
      url.searchParams.get('status') === status &&
      url.searchParams.get('page') === '1',
  );
  await panel(page).getByRole('button', { name: '应用任务筛选', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as Jobs;
  await expect(panel(page).getByRole('status', { name: '任务匹配数量', exact: true })).toContainText(
    `当前列表共 ${body.total} 项后台任务；第 1 页`,
  );
  return body;
}
async function facets(page: Page, counts: StateCounts) {
  for (const [key, value] of Object.entries(counts))
    await expect(panel(page).getByTestId(`jobs-count-${key}`)).toHaveText(String(value));
}
class OwnedJobs {
  readonly db = new PrismaClient();
  readonly suffix = randomBytes(8).toString('hex');
  readonly prefix = `jobs.live.${this.suffix}`;
  readonly password = `Jobs-${randomBytes(24).toString('base64url')}!`;
  readonly organizations: string[] = [];
  readonly users: string[] = [];
  readonly jobs: string[] = [];
  readonly contexts: BrowserContext[] = [];
  readonly releases: (() => void)[] = [];
  readonly errors: string[] = [];
  private hash = '';
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
  failure(error: unknown) {
    const message = error instanceof Error ? error.message : 'Owned jobs live validation failed';
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
  async organization(name: string, kind = 'INSTITUTION', active = true) {
    const row = await this.db.organization.create({ data: { name: `${name}-${this.suffix}`, kind, active } });
    this.organizations.push(row.id);
    return row;
  }
  async user(organizationId: string, roleIds: string[]) {
    if (!this.hash) this.hash = await hashPasswordAsync(this.password);
    const row = await this.db.user.create({
      data: {
        organizationId,
        name: `后台任务验收-${this.users.length}`,
        username: `jobs_live_${this.suffix}_${this.users.length}`,
        passwordHash: this.hash,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
    this.users.push(row.id);
    return row;
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
  async platform(client: Client) {
    if (client.user.role !== 'SUPER_ADMIN') {
      const body = await call<{ csrfToken: string; user: Client['user'] }>(client, '/auth/role', 'POST', {
        role: 'SUPER_ADMIN',
      });
      client.csrf = body.csrfToken;
      client.user = body.user;
    }
    expect(client.user.permissions).toContain('org.platform');
  }
  async verify(client: Client) {
    expect(
      await this.db.user.findFirst({
        where: { id: client.user.id, organizationId: client.user.organizationId },
        select: { id: true },
      }),
      'Browser proxy must use the same configured review database',
    ).not.toBeNull();
  }
  async job(organizationId: string, status: string, kind: string, position: number) {
    // Common JobsService ignores DISABLE_JOBS. Future runAt prevents claiming,
    // and a future RUNNING lockedAt prevents actual stale-lock recovery.
    const future = new Date(Date.now() + 30 * 86400_000);
    const row = await this.db.backgroundJob.create({
      data: {
        organizationId,
        kind,
        status,
        eventKey: `${this.prefix}.event.${this.jobs.length}`,
        payload: { marker: `PRIVATE_PAYLOAD_${this.suffix}` },
        runAt: future,
        lockedAt: status === 'RUNNING' ? future : null,
        attempts: status === 'PENDING' ? 0 : 2,
        lastError: status === 'FAILED' ? '自有夹具最近错误' : null,
        createdAt: new Date(Date.now() - 86400_000 + position),
      },
    });
    this.jobs.push(row.id);
    return row;
  }
  async cleanup() {
    this.releases.forEach((release) => release());
    const failures: string[] = [];
    const resources = await Promise.allSettled([...this.contexts.map((context) => context.close())]);
    if (resources.some((result) => result.status === 'rejected'))
      failures.push('Owned jobs browser/API resource cleanup failed');
    try {
      await this.db.$transaction(
        async (tx) => {
          await tx.backgroundJob.deleteMany({
            where: { id: { in: this.jobs }, organizationId: { in: this.organizations } },
          });
          await tx.session.deleteMany({ where: { userId: { in: this.users } } });
          await tx.sensitiveGrant.deleteMany({ where: { userId: { in: this.users } } });
          await tx.auditLog.deleteMany({ where: { organizationId: { in: this.organizations } } });
          await tx.notification.deleteMany({ where: { organizationId: { in: this.organizations } } });
          await tx.systemSetting.deleteMany({ where: { organizationId: { in: this.organizations } } });
          await tx.userRole.deleteMany({ where: { userId: { in: this.users } } });
          await tx.user.deleteMany({ where: { id: { in: this.users } } });
          await tx.organization.deleteMany({ where: { id: { in: this.organizations } } });
        },
        { timeout: 20_000 },
      );
    } catch {
      failures.push('Owned jobs database fixture cleanup failed');
    } finally {
      try {
        await this.db.$disconnect();
      } catch {
        failures.push('Jobs fixture database disconnect failed');
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  }
}

test('真实后台任务按类型状态筛选、跨页全量概览与机构归属，停用机构保留且个人空间排除', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const fixture = new OwnedJobs();
  fixture.observe(page);
  try {
    const a = await fixture.organization('任务甲机构'),
      b = await fixture.organization('任务停用乙机构', 'INSTITUTION', false),
      personal = await fixture.organization('任务个人空间', 'PERSONAL');
    const platformUser = await fixture.user(a.id, ['SUPER_ADMIN']),
      adminUser = await fixture.user(a.id, ['ADMIN']);
    const platform = await login(page.request, platformUser.username, fixture.password);
    await fixture.platform(platform);
    await fixture.verify(platform);
    const ordinary = await fixture.browserClient(browser, adminUser.username);
    for (let index = 0; index < 22; index++)
      await fixture.job(a.id, 'PENDING', `${fixture.prefix}.queue`, index);
    const running = await fixture.job(a.id, 'RUNNING', `${fixture.prefix}.running`, 22);
    await fixture.job(a.id, 'SUCCEEDED', `${fixture.prefix}.completed`, 23);
    await fixture.job(a.id, 'FAILED', `${fixture.prefix}.failed`, 24);
    await fixture.job(a.id, 'LEGACY_STATE', `${fixture.prefix}.legacy`, 25);
    const literal = await fixture.job(a.id, 'FAILED', `${fixture.prefix}%_\\literal`, 26);
    await fixture.job(a.id, 'SUCCEEDED', `${fixture.prefix}XYZliteral`, 27);
    await fixture.job(b.id, 'PENDING', `${fixture.prefix}.foreign.queue`, 28);
    const foreignSucceeded = await fixture.job(b.id, 'SUCCEEDED', `${fixture.prefix}.foreign.completed`, 29);
    const personalJob = await fixture.job(personal.id, 'PENDING', `${fixture.prefix}.personal`, 30);
    const expected = { all: 30, pending: 23, running: 1, succeeded: 3, failed: 2, other: 1 };
    const expectedOrdinary = { all: 28, pending: 22, running: 1, succeeded: 2, failed: 2, other: 1 };
    const platformFirst = await getJobs(platform, fixture.prefix);
    expect(platformFirst).toMatchObject({
      total: 30,
      page: 1,
      pageSize: 20,
      stateCounts: expected,
      scope: 'platform_institutions',
    });
    expect(JSON.stringify(platformFirst)).not.toContain(`PRIVATE_PAYLOAD_${fixture.suffix}`);
    for (const item of platformFirst.items) {
      expect(item).not.toHaveProperty('payload');
      expect(item).not.toHaveProperty('eventKey');
    }
    const platformSecond = await getJobs(platform, fixture.prefix, 'ALL', 2);
    const platformIds = [...platformFirst.items, ...platformSecond.items].map((item) => item.id);
    expect(new Set(platformIds).size).toBe(30);
    expect(platformIds).not.toContain(personalJob.id);
    expect(platformIds).toContain(foreignSucceeded.id);

    await show(page);
    expect((await apply(page, fixture.prefix.toUpperCase())).total).toBe(30);
    await facets(page, expected);
    await expect(panel(page).getByRole('status', { name: '任务查询范围' })).toContainText('包含停用机构');
    const second = listResponse(page, (url) => url.searchParams.get('page') === '2');
    await panel(page).locator('.ant-pagination-item-2').click();
    expect((await second).status()).toBe(200);
    await facets(page, expected);
    const selected = await apply(page, fixture.prefix, 'SUCCEEDED');
    expect(selected.total).toBe(3);
    await facets(page, expected);
    await expect(row(page, foreignSucceeded.id)).toContainText(b.name);
    await expect(row(page, foreignSucceeded.id)).toContainText(b.id);
    expect((await apply(page, `${fixture.prefix}%_\\`, 'ALL')).items.map((item) => item.id)).toEqual([
      literal.id,
    ]);
    await facets(page, { all: 1, pending: 0, running: 0, succeeded: 0, failed: 1, other: 0 });
    expect((await apply(page, `${fixture.prefix}.no-match`)).total).toBe(0);
    await expect(panel(page)).toContainText('没有符合筛选的后台任务');
    await facets(page, { all: 0, pending: 0, running: 0, succeeded: 0, failed: 0, other: 0 });
    await apply(page, fixture.prefix);
    await fixture.db.backgroundJob.update({
      where: { id: running.id },
      data: { status: 'SUCCEEDED', lockedAt: null },
    });
    const refreshed = listResponse(page);
    await panel(page).getByRole('button', { name: '刷新后台任务', exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    await facets(page, { ...expected, running: 0, succeeded: 4 });
    const reset = listResponse(
      page,
      (url) => !url.searchParams.has('action') && url.searchParams.get('status') === 'ALL',
    );
    await panel(page).getByRole('button', { name: '重置任务筛选', exact: true }).click();
    expect((await reset).status()).toBe(200);
    await expect(panel(page).getByRole('textbox', { name: '任务类型关键词' })).toHaveValue('');

    await show(ordinary.page);
    const own = await apply(ordinary.page, fixture.prefix);
    expect(own).toMatchObject({ total: 28, scope: 'current_organization', examDeadlineRuns: [] });
    await facets(ordinary.page, { ...expectedOrdinary, running: 0, succeeded: 3 });
    await expect(panel(ordinary.page).getByRole('status', { name: '任务查询范围' })).toContainText(
      '仅查看当前机构',
    );
    for (const item of own.items) expect(item.organizationId).toBe(a.id);
    await expect(row(ordinary.page, foreignSucceeded.id)).toHaveCount(0);
    expect(await ordinary.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    expect(fixture.errors).toEqual([]);
  } catch (error) {
    throw fixture.failure(error);
  } finally {
    await fixture.cleanup();
  }
});

test('真实角色切换后已到达的旧平台任务响应不得覆盖当前机构，撤销本人会话刷新退出', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = new OwnedJobs();
  fixture.observe(page);
  try {
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      (window as any).__jobsArrivals = [];
      (window as any).__jobsExpiry = 0;
      window.addEventListener('auth-expired', () => {
        (window as any).__jobsExpiry++;
      });
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const target = url.includes('/api/admin/jobs');
        const response = await nativeFetch(input, target ? { ...init, signal: undefined } : init);
        if (target) {
          const body = await response.clone().text();
          (window as any).__jobsArrivals.push({ status: response.status, body });
        }
        return response;
      };
    });
    const a = await fixture.organization('当前甲机构'),
      b = await fixture.organization('旧平台乙机构');
    const user = await fixture.user(a.id, ['SUPER_ADMIN', 'ADMIN']);
    const client = await login(page.request, user.username, fixture.password);
    await fixture.platform(client);
    await fixture.verify(client);
    const own = await fixture.job(a.id, 'SUCCEEDED', `${fixture.prefix}.own`, 1);
    const foreign = await fixture.job(b.id, 'FAILED', `${fixture.prefix}.foreign`, 2);
    await show(page);
    await apply(page, fixture.prefix);
    await expect(row(page, own.id)).toBeVisible();
    await expect(row(page, foreign.id)).toBeVisible();
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
    await page.route(/\/api\/admin\/jobs(?:\?|$)/, async (route) => {
      if (!armed || new URL(route.request().url()).searchParams.get('action') !== fixture.prefix) {
        await route.continue().catch(() => {});
        return;
      }
      armed = false;
      // Capture real authorized server data, then deliver it after a real role
      // switch. No body, status or current authorization is invented by the route.
      try {
        const actual = await route.fetch();
        expect(actual.status()).toBe(200);
        const data = (await actual.json()) as Jobs;
        expect(data.scope).toBe('platform_institutions');
        expect(data.items.some((item) => item.id === foreign.id)).toBe(true);
        seen();
        await gate;
        await route.fulfill({ response: actual }).catch(() => {});
      } catch (error) {
        routeError = fixture.failure(error);
        seen();
        await route.abort().catch(() => {});
      }
    });
    await panel(page).getByRole('button', { name: '刷新后台任务', exact: true }).click();
    await started;
    if (routeError) throw routeError;
    const arrivalIndex = await page.evaluate(() => (window as any).__jobsArrivals.length);
    const switched = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/role' && response.request().method() === 'POST',
    );
    const roleControl = page.getByRole('combobox', { name: '切换角色', exact: true });
    await roleControl.focus();
    await roleControl.press('Enter');
    await expect(roleControl).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.ant-select-item-option-content').getByText('机构管理员', { exact: true }).click();
    expect((await switched).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp('/$'));
    // SPA navigation retains the deliberately delayed fetch and its old guard.
    await page.getByRole('link', { name: '审计日志', exact: true }).click();
    await page.getByRole('tab', { name: '后台任务', exact: true }).click();
    await expect(panel(page)).toBeVisible();
    const current = await apply(page, fixture.prefix);
    expect(current).toMatchObject({ scope: 'current_organization', total: 1, examDeadlineRuns: [] });
    const expiry = await page.evaluate(() => (window as any).__jobsExpiry);
    release();
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, from }) =>
            (window as any).__jobsArrivals
              .slice(from)
              .some(
                (entry: any) =>
                  entry.status === 200 &&
                  entry.body.includes(id) &&
                  entry.body.includes('platform_institutions'),
              ),
          { id: foreign.id, from: arrivalIndex },
        ),
      )
      .toBe(true);
    await expect(row(page, own.id)).toBeVisible();
    await expect(row(page, foreign.id)).toHaveCount(0);
    await expect(panel(page)).not.toContainText(b.name);
    await facets(page, { all: 1, pending: 0, running: 0, succeeded: 1, failed: 0, other: 0 });
    expect(await page.evaluate(() => (window as any).__jobsExpiry)).toBe(expiry);
    // Assert actual selected role independently of the late transport response.
    const identity = await call<{ user: Client['user'] }>(client, '/auth/me');
    expect(identity.user.role).toBe('ADMIN');
    expect(identity.user.permissions).not.toContain('org.platform');
    await fixture.db.session.deleteMany({ where: { userId: user.id } });
    const denied = listResponse(page);
    await panel(page).getByRole('button', { name: '刷新后台任务', exact: true }).click();
    expect((await denied).status()).toBe(401);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(panel(page)).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  } catch (error) {
    throw fixture.failure(error);
  } finally {
    await fixture.cleanup();
  }
});
