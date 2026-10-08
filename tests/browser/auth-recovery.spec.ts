import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Locator,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
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
  /review|test|clean/i.test(database.pathname);

test.skip(!isolated, 'Password recovery browser checks require the disposable security-review environment');
// Recovery codes and passwords must never appear in screenshots or retained traces.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

async function fillSecret(locator: Locator, value: string) {
  try {
    await locator.fill(value);
  } catch {
    // A Playwright fill error normally includes its plaintext argument in the call log.
    throw new Error('Unable to fill an account security field');
  }
}

test('本人通过个人中心预留恢复码，管理员批准后在登录页恢复并使用新密码登录', async ({ page }) => {
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const password = `Recovery-${randomBytes(20).toString('base64url')}!`;
  const newPassword = `Recovered-${randomBytes(20).toString('base64url')}!`;
  let organizationId: string | undefined;
  let administrator: APIRequestContext | undefined;
  try {
    const organization = await db.organization.create({ data: { name: `恢复浏览器回归-${suffix}` } });
    organizationId = organization.id;
    const passwordHash = await hashPasswordAsync(password);
    const admin = await db.user.create({
      data: {
        organizationId,
        username: `recovery_browser_admin_${suffix}`,
        name: '恢复测试管理员',
        passwordHash,
        roles: { create: { roleId: 'ADMIN' } },
      },
    });
    const owner = await db.user.create({
      data: {
        organizationId,
        username: `recovery_browser_owner_${suffix}`,
        name: '恢复测试学生',
        passwordHash,
        roles: { create: { roleId: 'STUDENT' } },
      },
    });
    administrator = await playwrightRequest.newContext({ baseURL: api });
    const adminLogin = await administrator.post('/api/auth/login', {
      data: { username: admin.username, password },
    });
    expect(adminLogin.status()).toBe(201);
    const adminSession = await adminLogin.json();

    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill(owner.username);
    await fillSecret(page.getByLabel('密码', { exact: true }), password);
    await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/profile');
    await page.getByRole('tab', { name: '账号安全', exact: true }).click();
    await fillSecret(page.getByLabel('验证当前密码', { exact: true }), password);
    await page.getByRole('button', { name: '生成恢复码', exact: true }).click();
    const codeField = page.getByLabel('一次性账号恢复码', { exact: true });
    await expect(codeField).toBeVisible();
    const code = await codeField.inputValue();
    expect(/^lmsr_[A-Za-z0-9_-]{43}$/.test(code)).toBe(true);
    await expect(page.getByText('已预留恢复码。重新生成会使原码失效。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '我已安全保存', exact: true }).click();
    await expect(codeField).toHaveCount(0);

    const approved = await administrator.post(`/api/admin/users/${owner.id}/recovery`, {
      headers: { 'x-csrf-token': adminSession.csrfToken, Origin: web! },
      data: {},
    });
    expect(approved.status()).toBe(201);
    // Approval revokes existing sessions. Refresh exercises the actual forced logout.
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('button', { name: '使用预留恢复码恢复账号', exact: true }).click();
    await expect(page.getByRole('heading', { name: '恢复你的账号', exact: true })).toBeVisible();
    await page.getByLabel('账号', { exact: true }).fill(owner.username);
    await fillSecret(page.getByLabel('本人预留的恢复码', { exact: true }), code);
    await fillSecret(page.getByLabel('新密码', { exact: true }), newPassword);
    await fillSecret(page.getByLabel('确认新密码', { exact: true }), newPassword);
    await page.getByRole('button', { name: '使用恢复码设置新密码', exact: true }).click();
    await expect(
      page.getByText('密码已恢复，请用新密码登录，并在个人中心重新生成恢复码。', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '登录你的账号', exact: true })).toBeVisible();
    await fillSecret(page.getByLabel('密码', { exact: true }), newPassword);
    await page.getByRole('button', { name: '登录学习平台', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: owner.name, exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '账号安全', exact: true }).click();
    await expect(
      page.getByText('预先生成并离线保存恢复码，以便忘记密码时恢复账号。', { exact: true }),
    ).toBeVisible();
    expect(await db.passwordRecovery.count({ where: { userId: owner.id } })).toBe(0);
  } finally {
    // Playwright can include password input values in its automatic error context.
    // Close this test's page before artifact collection, even when the flow fails.
    await page.close().catch(() => {});
    await administrator?.dispose();
    if (organizationId) {
      const users = await db.user.findMany({ where: { organizationId }, select: { id: true } });
      const ids = users.map((user) => user.id);
      await db.$transaction([
        db.passwordRecovery.deleteMany({ where: { userId: { in: ids } } }),
        db.session.deleteMany({ where: { userId: { in: ids } } }),
        db.sensitiveGrant.deleteMany({ where: { userId: { in: ids } } }),
        db.notification.deleteMany({ where: { organizationId } }),
        db.backgroundJob.deleteMany({ where: { organizationId } }),
        db.auditLog.deleteMany({ where: { organizationId } }),
        db.userRole.deleteMany({ where: { userId: { in: ids } } }),
        db.user.deleteMany({ where: { organizationId } }),
        db.organization.delete({ where: { id: organizationId } }),
      ]);
    }
    await db.$disconnect();
  }
});
