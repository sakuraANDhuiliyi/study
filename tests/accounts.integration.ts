import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { hashPasswordAsync } from '../apps/api/src/auth/password';

const db = new PrismaClient();
const origin = 'http://127.0.0.1:3036';
const password = 'Personal-account_fixture-123!';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Client = { cookie: string; csrf: string; user: any };
async function call(
  client: Client | null,
  path: string,
  method = 'GET',
  body?: unknown,
  expected: number | number[] = method === 'POST' ? 201 : 200,
  csrf = true,
) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      ...(client ? { cookie: client.cookie, ...(csrf ? { 'x-csrf-token': client.csrf } : {}) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${method} ${path}: ${response.status} ${text.slice(0, 1000)}`,
  );
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  };
}
async function login(username: string, secret = password) {
  const response = await call(null, '/auth/login', 'POST', { username, password: secret });
  return { cookie: response.cookie, csrf: response.body.csrfToken, user: response.body.user } as Client;
}

test(
  '个人注册、专业、恢复、组织申请审核及空间切换真实HTTP与PostgreSQL验收',
  { timeout: 90000 },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(new URL(process.env.DATABASE_URL!).pathname.includes('review'), '必须使用隔离review数据库');
    const suffix = randomUUID().slice(0, 8);
    let logs = '';
    const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: {
        ...process.env,
        PORT: '3036',
        BIND_HOST: '127.0.0.1',
        APP_ORIGIN: origin,
        DISABLE_JOBS: 'true',
        COOKIE_SECURE: 'false',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-50000);
      });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (api.exitCode !== null) throw new Error(`测试API启动失败: ${logs}`);
        try {
          if ((await fetch(`${origin}/api/health`)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* starting */
        }
        await wait(100);
      }
      assert.ok(ready, `需要构建API并确保3036端口空闲: ${logs}`);
      const institution = await db.organization.create({ data: { name: `个人账号验收机构-${suffix}` } });
      const foreign = await db.organization.create({ data: { name: `外机构-${suffix}` } });
      const hash = await hashPasswordAsync(password);
      async function fixture(tag: string, roleId: string, organizationId = institution.id) {
        const user = await db.user.create({
          data: {
            username: `accounts_${suffix}_${tag}`,
            name: tag,
            organizationId,
            passwordHash: hash,
            roles: { create: { roleId } },
          },
        });
        return login(user.username);
      }
      const admin = await fixture('admin', 'ADMIN');
      const foreignAdmin = await fixture('foreign', 'ADMIN', foreign.id);
      const teacher = await fixture('teacher', 'TEACHER');
      const institutional = await fixture('student', 'STUDENT');
      const superadmin = await fixture('super', 'SUPER_ADMIN');
      const subject = await db.academicsSubject.create({ data: { name: `验收学科-${suffix}` } });
      const globalMajor = await db.academicsMajor.create({
        data: { subjectId: subject.id, name: `公共专业-${suffix}`, moduleIds: [] },
      });
      const localMajor = await db.academicsMajor.create({
        data: { subjectId: subject.id, organizationId: institution.id, name: '本机构专业' },
      });
      const foreignMajor = await db.academicsMajor.create({
        data: { subjectId: subject.id, organizationId: foreign.id, name: '外机构专业' },
      });
      const inactiveMajor = await db.academicsMajor.create({
        data: { subjectId: subject.id, name: `停用专业-${suffix}`, active: false },
      });
      const inactiveSubject = await db.academicsSubject.create({
        data: { name: `停用父学科-${suffix}`, active: false },
      });
      const unusableMajor = await db.academicsMajor.create({
        data: { subjectId: inactiveSubject.id, name: `父学科失活的专业-${suffix}` },
      });
      const name = `accounts_${suffix}_personal`;
      let personal: Client;
      let other: Client;
      let code: string;
      let applicationId: string;
      let originalSpace: string;
      async function register(username: string, majorId?: string) {
        const result = await call(null, '/auth/register', 'POST', {
          username,
          name: '个人学习者',
          password,
          majorId,
        });
        return { user: result.body.user, csrf: result.body.csrfToken, cookie: result.cookie } as Client;
      }
      await t.test('公开注册严格输入、全局专业、独立学生身份与重复账号回滚', async () => {
        const input = { username: name, name: '个人学习者', password };
        await call(null, '/auth/register', 'POST', { ...input, roles: ['ADMIN'] }, 400);
        await call(null, '/auth/register', 'POST', { ...input, organizationId: institution.id }, 400);
        await call(null, '/auth/register', 'POST', { ...input, majorId: localMajor.id }, 400);
        await call(null, '/auth/register', 'POST', { ...input, majorId: inactiveMajor.id }, 400);
        await call(null, '/auth/register', 'POST', { ...input, majorId: unusableMajor.id }, 400);
        personal = await register(name.toUpperCase(), globalMajor.id);
        other = await register(`accounts_${suffix}_other`);
        originalSpace = personal.user.organizationId;
        assert.equal(personal.user.username, name);
        assert.equal(personal.user.accountMode, 'PERSONAL');
        assert.equal(personal.user.major.id, globalMajor.id);
        assert.deepEqual(personal.user.roles, ['STUDENT']);
        assert.equal(personal.user.canReturnToPersonal, false);
        assert.equal(personal.user.passwordHash, undefined);
        assert.equal(personal.user.personalOrganizationId, undefined);
        const org = await db.organization.findUniqueOrThrow({ where: { id: originalSpace } });
        assert.equal(org.kind, 'PERSONAL');
        assert.equal(org.joinEnabled, false);
        assert.equal(org.inviteCode, null);
        const count = await db.organization.count({ where: { kind: 'PERSONAL' } });
        await call(null, '/auth/register', 'POST', input, 409);
        assert.equal(await db.organization.count({ where: { kind: 'PERSONAL' } }), count);
        await call(personal, '/auth/role', 'POST', { role: 'TEACHER' }, 403);
        await call(personal, '/admin/users', 'GET', undefined, 403);
        await call(personal, '/auth/profile', 'PATCH', { majorId: localMajor.id }, 400);
        await call(personal, '/auth/profile', 'PATCH', { majorId: globalMajor.id, name: '自助修改姓名' });
        await call(personal, '/auth/profile', 'PATCH', { name: '无CSRF' }, 403, false);
      });
      await t.test('资料修改专业推进偏好版本，旧窗口不能覆盖并保留已选模块', async () => {
        const initial = (await call(other, '/academics/me')).body;
        assert.equal(initial.majorId, null);
        assert.equal(initial.revision, 0);
        await call(other, '/auth/profile', 'PATCH', { majorId: globalMajor.id });
        await call(
          other,
          '/academics/preferences',
          'PATCH',
          {
            revision: initial.revision,
            selectedModuleIds: [],
            majorId: initial.majorId,
          },
          409,
        );
        const afterProfile = (await call(other, '/academics/me')).body;
        assert.equal(afterProfile.majorId, globalMajor.id);
        assert.equal(afterProfile.revision, 1);
        assert.deepEqual(afterProfile.selectedModuleIds, []);
        const preference = (
          await call(other, '/academics/preferences', 'PATCH', {
            revision: afterProfile.revision,
            selectedModuleIds: ['study-notebook'],
            majorId: globalMajor.id,
          })
        ).body;
        assert.equal(preference.revision, 2);
        await call(other, '/auth/profile', 'PATCH', { majorId: null });
        await call(
          other,
          '/academics/preferences',
          'PATCH',
          {
            revision: preference.revision,
            selectedModuleIds: [],
            majorId: globalMajor.id,
          },
          409,
        );
        const cleared = (await call(other, '/academics/me')).body;
        assert.equal(cleared.majorId, null);
        assert.equal(cleared.revision, 3);
        assert.deepEqual(cleared.selectedModuleIds, ['study-notebook']);
        await call(other, '/auth/profile', 'PATCH', { majorId: null, name: '只修改姓名' });
        assert.equal((await call(other, '/academics/me')).body.revision, 3);
      });
      await t.test('个人恢复码无需管理员，原子单次使用并撤销全部已有会话', async () => {
        const configured = await call(personal, '/auth/recovery-code', 'POST', { oldPassword: password });
        const recoveryCode = configured.body.code;
        const stored = await db.passwordRecovery.findUniqueOrThrow({ where: { userId: personal.user.id } });
        assert.equal(stored.pendingUntil, null);
        assert.notEqual(stored.codeHash, recoveryCode);
        const secondSession = await login(name);
        await call(
          null,
          '/auth/recover',
          'POST',
          { username: name, code: 'x'.repeat(48), newPassword: password },
          401,
        );
        const recovered = await Promise.all(
          [0, 1].map(() =>
            call(
              null,
              '/auth/recover',
              'POST',
              { username: name, code: recoveryCode, newPassword: password },
              [201, 401],
            ),
          ),
        );
        assert.deepEqual(recovered.map((item) => item.status).sort(), [201, 401]);
        await call(personal, '/auth/me', 'GET', undefined, 401);
        await call(secondSession, '/auth/me', 'GET', undefined, 401);
        await call(
          null,
          '/auth/recover',
          'POST',
          { username: name, code: recoveryCode, newPassword: password },
          401,
        );
        personal = await login(name);
        const orgRecovery = await call(institutional, '/auth/recovery-code', 'POST', {
          oldPassword: password,
        });
        await call(
          null,
          '/auth/recover',
          'POST',
          { username: institutional.user.username, code: orgRecovery.body.code, newPassword: password },
          401,
        );
      });
      await t.test('邀请码轮换与并发申请、取消、拒绝及机构和本人隔离', async () => {
        const initial = await call(admin, '/admin/join-settings');
        assert.deepEqual(initial.body, { joinEnabled: false, inviteCode: null });
        await call(personal, '/account/join-requests', 'POST', { inviteCode: 'x'.repeat(32) }, 400);
        await call(teacher, '/admin/join-settings', 'GET', undefined, 403);
        const enabled = await call(admin, '/admin/join-settings', 'PATCH', { joinEnabled: true });
        code = enabled.body.inviteCode;
        assert.ok(code.length >= 32);
        const rotated = await call(admin, '/admin/join-settings/rotate-code', 'POST', {});
        await call(personal, '/account/join-requests', 'POST', { inviteCode: code }, 400);
        code = rotated.body.inviteCode;
        const applications = await Promise.all(
          [0, 1].map(() =>
            call(
              personal,
              '/account/join-requests',
              'POST',
              { inviteCode: code, majorId: localMajor.id, note: '希望加入本机构学习' },
              [201, 409],
            ),
          ),
        );
        assert.deepEqual(applications.map((item) => item.status).sort(), [201, 409]);
        const id = applications.find((item) => item.status === 201)!.body.id;
        await call(other, `/account/join-requests/${id}/cancel`, 'POST', {}, 404);
        assert.equal((await call(other, '/account/join-requests')).body.items.length, 0);
        assert.equal((await call(foreignAdmin, '/admin/join-requests')).body.items.length, 0);
        await call(foreignAdmin, `/admin/join-requests/${id}`, 'PATCH', { status: 'APPROVED' }, 404);
        await call(personal, `/account/join-requests/${id}/cancel`, 'POST', {});
        await call(admin, `/admin/join-requests/${id}`, 'PATCH', { status: 'APPROVED' }, 409);
        const rejected = await call(personal, '/account/join-requests', 'POST', { inviteCode: code });
        await call(admin, `/admin/join-requests/${rejected.body.id}`, 'PATCH', { status: 'REJECTED' });
        assert.equal((await call(personal, '/auth/me')).body.user.accountMode, 'PERSONAL');
      });
      await t.test('批准申请只切换账号归属，保留个人数据并使旧会话全部失效', async () => {
        await db.algorithmLearningState.create({
          data: {
            organizationId: originalSpace,
            userId: personal.user.id,
            problemId: 'sum-of-two',
            note: '仅个人空间可见',
            revision: 1,
          },
        });
        const result = await call(personal, '/account/join-requests', 'POST', {
          inviteCode: code,
          majorId: localMajor.id,
        });
        applicationId = result.body.id;
        const anotherSession = await login(name);
        await call(
          admin,
          `/admin/join-requests/${applicationId}`,
          'PATCH',
          { status: 'APPROVED', majorId: foreignMajor.id },
          400,
        );
        await call(
          admin,
          `/admin/join-requests/${applicationId}`,
          'PATCH',
          { status: 'APPROVED', roles: ['TEACHER'] },
          400,
        );
        const reviews = await Promise.all(
          [0, 1].map(() =>
            call(
              admin,
              `/admin/join-requests/${applicationId}`,
              'PATCH',
              { status: 'APPROVED', majorId: localMajor.id },
              [200, 409],
            ),
          ),
        );
        assert.deepEqual(reviews.map((item) => item.status).sort(), [200, 409]);
        await call(personal, '/auth/me', 'GET', undefined, 401);
        await call(anotherSession, '/auth/me', 'GET', undefined, 401);
        personal = await login(name);
        assert.equal(personal.user.organizationId, institution.id);
        assert.equal(personal.user.accountMode, 'ORGANIZATION');
        assert.equal(personal.user.majorId, localMajor.id);
        assert.equal(personal.user.canReturnToPersonal, true);
        assert.deepEqual(personal.user.roles, ['STUDENT']);
        assert.equal((await call(personal, '/algorithms/problems/sum-of-two/learning')).body.note, '');
        await call(personal, '/auth/profile', 'PATCH', { majorId: globalMajor.id }, 403);
        assert.equal((await call(admin, `/admin/users?search=${name}`)).body.items[0].majorId, localMajor.id);
        const all = await call(superadmin, '/admin/organizations?pageSize=100');
        assert.ok(all.body.items.every((item: any) => item.kind === 'INSTITUTION'));
        assert.ok(all.body.items.every((item: any) => item.inviteCode === undefined));
        await call(
          superadmin,
          `/admin/organizations/${originalSpace}`,
          'PATCH',
          { active: false, reason: '禁止管理个人空间' },
          404,
        );
        await call(
          superadmin,
          `/admin/organizations/${originalSpace}/admins`,
          'POST',
          { username: `forbidden_${suffix}`, name: '禁止提权', password, reason: '不能在个人空间创建管理员' },
          404,
        );
        const notification = await db.notification.findFirst({
          where: { userId: personal.user.id, eventKey: `join-request:${applicationId}:APPROVED` },
        });
        assert.ok(notification);
      });
      await t.test('退出机构恢复个人专业和原学习记录、注销机构资格且无法被原管理员修改', async () => {
        const course = await db.course.create({
          data: {
            organizationId: institution.id,
            title: '机构课程',
            teacherId: teacher.user.id,
            status: 'PUBLISHED',
          },
        });
        const schoolClass = await db.class.create({
          data: { organizationId: institution.id, name: `班级-${suffix}`, grade: '一年级' },
        });
        const member = await db.classMember.create({
          data: { classId: schoolClass.id, userId: personal.user.id },
        });
        const enrollment = await db.enrollment.create({
          data: { courseId: course.id, userId: personal.user.id },
        });
        await db.algorithmLearningState.create({
          data: {
            organizationId: institution.id,
            userId: personal.user.id,
            problemId: 'sum-of-two',
            note: '仅机构空间可见',
            revision: 1,
          },
        });
        await call(institutional, '/account/leave-organization', 'POST', {}, 403);
        const result = await call(personal, '/account/leave-organization', 'POST', {});
        assert.equal(result.body.loginRequired, true);
        await call(personal, '/auth/me', 'GET', undefined, 401);
        personal = await login(name);
        assert.equal(personal.user.organizationId, originalSpace);
        assert.equal(personal.user.majorId, globalMajor.id);
        assert.equal(personal.user.accountMode, 'PERSONAL');
        assert.equal(
          (await call(personal, '/algorithms/problems/sum-of-two/learning')).body.note,
          '仅个人空间可见',
        );
        assert.equal((await db.classMember.findUniqueOrThrow({ where: { id: member.id } })).active, false);
        assert.equal((await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).active, false);
        await call(admin, `/admin/users/${personal.user.id}`, 'PATCH', { roles: ['TEACHER'] }, 404);
        await call(personal, `/courses/${course.id}`, 'GET', undefined, [403, 404]);
        assert.equal(
          (
            await db.algorithmLearningState.findFirstOrThrow({
              where: { organizationId: institution.id, userId: personal.user.id },
            })
          ).note,
          '仅机构空间可见',
        );
      });
      await t.test('管理员创建、编辑和批量导入专业验证以及账号模式字段保护', async () => {
        const input = {
          username: `accounts_${suffix}_created`,
          name: '机构创建学生',
          password,
          roles: ['STUDENT'],
          majorId: localMajor.id,
        };
        const created = await call(admin, '/admin/users', 'POST', input);
        assert.equal(created.body.accountMode, 'ORGANIZATION');
        assert.equal(created.body.majorId, localMajor.id);
        await call(admin, `/admin/users/${created.body.id}`, 'PATCH', { majorId: foreignMajor.id }, 400);
        await call(admin, `/admin/users/${created.body.id}`, 'PATCH', { majorId: globalMajor.id });
        await call(
          admin,
          '/admin/users',
          'POST',
          { ...input, username: `${input.username}_bad`, majorId: inactiveMajor.id },
          400,
        );
        const rows = [{ ...input, username: `${input.username}_import`, majorId: foreignMajor.id }];
        const invalid = await call(admin, '/admin/users/import', 'POST', { rows, commit: true });
        assert.equal(invalid.body.valid, false);
        assert.equal(invalid.body.committed, false);
        rows[0].majorId = globalMajor.id;
        const imported = await call(admin, '/admin/users/import', 'POST', { rows, commit: true });
        assert.equal(imported.body.committed, true);
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { username: rows[0].username } })).majorId,
          globalMajor.id,
        );
        const managed = await db.user.findUniqueOrThrow({ where: { id: created.body.id } });
        assert.equal(managed.personalOrganizationId, null);
        const listed = await call(admin, `/admin/users?search=${name}`);
        assert.equal(listed.body.items.length, 0);
      });
      await t.test('个人恢复与注册使用数据库限流，跨站注册拒绝，机构恢复仍需许可', async () => {
        const rejected = await fetch(`${origin}/api/auth/register`, {
          method: 'POST',
          headers: { origin: 'https://foreign.invalid', 'content-type': 'application/json' },
          body: JSON.stringify({ username: `cross_${suffix}`, password, name: '跨站注册' }),
        });
        assert.equal(rejected.status, 403);
        const limitedName = `limited_${suffix}`;
        await db.authAttemptWindow.create({
          data: {
            key: `register:account:${createHash('sha256').update(limitedName).digest('hex')}`,
            count: 8,
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        await call(
          null,
          '/auth/register',
          'POST',
          { username: limitedName, password, name: '受限账号' },
          429,
        );
        assert.equal(await db.user.findUnique({ where: { username: limitedName } }), null);
        for (let attempt = 0; attempt < 8; attempt++)
          await call(
            null,
            '/auth/recover',
            'POST',
            { username: other.user.username, code: 'x'.repeat(48), newPassword: password },
            401,
          );
        await call(
          null,
          '/auth/recover',
          'POST',
          { username: other.user.username, code: 'x'.repeat(48), newPassword: password },
          429,
        );
        const recovery = await call(institutional, '/auth/recovery-code', 'POST', { oldPassword: password });
        await call(admin, `/admin/users/${institutional.user.id}/recovery`, 'POST', {});
        await call(null, '/auth/recover', 'POST', {
          username: institutional.user.username,
          code: recovery.body.code,
          newPassword: password,
        });
        await call(institutional, '/auth/me', 'GET', undefined, 401);
        assert.equal((await login(institutional.user.username)).user.accountMode, 'ORGANIZATION');
      });
      assert.ok(!logs.includes(password), '日志不应泄漏密码');
    } finally {
      api.kill('SIGTERM');
      if (api.exitCode === null) await Promise.race([once(api, 'exit'), wait(3000)]);
      if (api.exitCode === null) api.kill('SIGKILL');
      await db.$disconnect();
    }
  },
);
