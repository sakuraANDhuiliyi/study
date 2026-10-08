import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password';

// Explicit, disposable API/database only: this suite never falls back to the demo service.
const base = process.env.TEST_BASE_URL;
if (!base || process.env.NODE_ENV === 'production')
  throw new Error('Auth security tests require TEST_BASE_URL and a non-production isolated database');
const db = new PrismaClient();
after(() => db.$disconnect());
const password = 'Security_fixture_123!';
const suffix = randomUUID().slice(0, 8);
type Client = { cookie: string; csrf: string; id: string; organizationId: string };
async function request(client: Client | null, path: string, method = 'GET', body?: unknown, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(client ? { cookie: client.cookie, 'x-csrf-token': client.csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : null;
}
async function login(username: string): Promise<Client> {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  return {
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
    csrf: body.csrfToken,
    id: body.user.id,
    organizationId: body.user.organizationId,
  };
}
async function fixture(name: string, roles = ['STUDENT'], organizationId?: string) {
  const org =
    organizationId || (await db.organization.create({ data: { name: `安全审查 ${name} ${suffix}` } })).id;
  const user = await db.user.create({
    data: {
      username: `security_${suffix}_${name}`,
      name,
      organizationId: org,
      passwordHash: hashPassword(password),
      roles: { create: roles.map((roleId) => ({ roleId })) },
    },
  });
  return { user, client: await login(user.username) };
}

test('关闭的功能拒绝大小写不同的真实 Express 路由和收藏写入', async () => {
  const { user, client } = await fixture('features');
  await db.systemSetting.create({
    data: {
      organizationId: user.organizationId,
      key: 'features',
      value: { practice: false, communication: false },
    },
  });
  for (const path of [
    '/api/practice',
    '/api/Practice',
    '/API/practice',
    '/api/FAVORITES',
    '/api/Mistakes',
    '/api/communication/posts',
    '/API/Communication/posts',
    '/api/COMMUNICATION/conversations',
  ])
    await request(client, path, 'GET', undefined, 403);
  const denied = await request(client, '/api/questions/unknown/favorite', 'PUT', { favorite: true }, 403);
  assert.match(denied.message, /已关闭此功能/);
  await request(client, '/api/QUESTIONS/unknown/FAVORITE', 'PUT', { favorite: true }, 403);
  await request(client, '/api/auth/me');
});

test('机构隔离、基础角色上限、会话撤销与敏感授权撤销使用当前状态', async () => {
  const { user: administrator, client: admin } = await fixture('admin', ['ADMIN']);
  const { user: student, client } = await fixture('student', ['STUDENT'], administrator.organizationId);
  const { user: outsider } = await fixture('other', ['STUDENT']);
  const { user: superuser, client: superadmin } = await fixture(
    'super',
    ['SUPER_ADMIN'],
    administrator.organizationId,
  );
  const { user: teacher, client: teacherClient } = await fixture(
    'teacher',
    ['TEACHER'],
    administrator.organizationId,
  );
  await request(admin, '/api/admin/users/' + admin.id, 'PATCH', { roles: ['SUPER_ADMIN'] }, 403);
  await request(admin, '/api/admin/users/' + outsider.id, 'PATCH', { active: false }, 404);
  await request(
    admin,
    '/api/admin/users',
    'POST',
    {
      username: `blocked_${suffix}`,
      name: '禁止提权',
      password,
      roles: ['SUPER_ADMIN'],
    },
    403,
  );
  await request(
    admin,
    '/api/admin/roles/STUDENT',
    'PATCH',
    { permissions: ['users.manage'], reason: '拒绝角色越权修改' },
    403,
  );
  await request(
    superadmin,
    '/api/admin/roles/SUPER_ADMIN',
    'PATCH',
    { permissions: [], reason: '拒绝修改本人模板' },
    403,
  );
  await request(
    superadmin,
    '/api/admin/roles/STUDENT',
    'PATCH',
    { permissions: ['users.manage'], reason: '拒绝超越学生上限' },
    403,
  );
  await request(
    superadmin,
    '/api/admin/grants',
    'POST',
    {
      userId: superuser.id,
      permissionId: 'data.export',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      reason: '拒绝独立授权自授',
    },
    403,
  );
  const grant = await request(
    superadmin,
    '/api/admin/grants',
    'POST',
    {
      userId: teacher.id,
      permissionId: 'data.export',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      reason: '验证即时权限撤销',
    },
    201,
  );
  assert((await request(teacherClient, '/api/auth/me')).user.permissions.includes('data.export'));
  await request(superadmin, '/api/admin/grants/' + grant.id, 'DELETE', { reason: '验证独立授权撤销' });
  assert(!(await request(teacherClient, '/api/auth/me')).user.permissions.includes('data.export'));
  await request(admin, '/api/admin/users/' + student.id, 'PATCH', { roles: ['TEACHER'] });
  await request(client, '/api/auth/me', 'GET', undefined, 401);
  await request(client, '/api/auth/role', 'POST', { role: 'STUDENT' }, 401);
});

test('模板非敏感权限可在固定上限内恢复，敏感新增仍要求独立授权', async () => {
  const { client: superadmin, user } = await fixture('template_super', ['SUPER_ADMIN']);
  const { client: teacher } = await fixture('template_teacher', ['TEACHER'], user.organizationId);
  const before = await db.rolePermission.findMany({ where: { roleId: 'TEACHER' } });
  const initial = before.map((p) => p.permissionId);
  assert(
    initial.includes('course.manage') && initial.includes('data.export'),
    'Requires seeded canonical TEACHER template',
  );
  const reason = '验证模板维护授权边界';
  try {
    await request(superadmin, '/api/admin/roles/TEACHER', 'PATCH', {
      permissions: initial.filter((p) => p !== 'course.manage'),
      reason,
    });
    assert(!(await request(teacher, '/api/auth/me')).user.permissions.includes('course.manage'));
    await request(superadmin, '/api/admin/roles/TEACHER', 'PATCH', { permissions: initial, reason });
    assert((await request(teacher, '/api/auth/me')).user.permissions.includes('course.manage'));
    assert(!(await request(teacher, '/api/auth/me')).user.permissions.includes('data.export'));
    await request(superadmin, '/api/admin/roles/TEACHER', 'PATCH', {
      permissions: initial.filter((p) => p !== 'data.export'),
      reason,
    });
    await request(superadmin, '/api/admin/roles/TEACHER', 'PATCH', { permissions: initial, reason }, 403);
    await request(
      superadmin,
      '/api/admin/roles/TEACHER',
      'PATCH',
      {
        permissions: [...initial.filter((p) => p !== 'data.export'), 'users.manage'],
        reason,
      },
      403,
    );
  } finally {
    // Only restore this suite's removed edges. All credentials and templates belong to the disposable database.
    await db.rolePermission.createMany({ data: before, skipDuplicates: true });
  }
});

test('批量导入整批验证且不回传明文密码，成员撤销和跨机构引用即时生效', async () => {
  const { user: adminUser, client: admin } = await fixture('import_admin', ['ADMIN']);
  const { user: teacherUser, client: teacher } = await fixture(
    'course_teacher',
    ['TEACHER'],
    adminUser.organizationId,
  );
  const { user: studentUser, client: student } = await fixture(
    'course_student',
    ['STUDENT'],
    adminUser.organizationId,
  );
  const { user: foreignUser, client: foreignTeacher } = await fixture('foreign_teacher', ['TEACHER']);
  const first = { username: `import_${suffix}`, name: '导入检验', password, roles: ['STUDENT'] };
  const invalid = await request(
    admin,
    '/api/admin/users/import',
    'POST',
    {
      rows: [first, { ...first, username: `import_denied_${suffix}`, roles: ['ADMIN'] }],
      commit: true,
    },
    201,
  );
  assert.equal(invalid.valid, false);
  assert.equal(invalid.committed, false);
  assert(invalid.errors.some((e: { row: number }) => e.row === 3));
  assert.equal(await db.user.count({ where: { username: first.username } }), 0);
  assert(!JSON.stringify(invalid).includes(password));
  const imported = await request(
    admin,
    '/api/admin/users/import',
    'POST',
    { rows: [first], commit: true },
    201,
  );
  assert.equal(imported.committed, true);
  const listed = await request(admin, '/api/admin/users?search=' + first.username);
  assert.equal(listed.total, 1);
  assert(!JSON.stringify(listed).includes('password'));
  const course = await request(teacher, '/api/courses', 'POST', { title: `安全边界课程 ${suffix}` }, 201);
  const chapter = await request(
    teacher,
    `/api/courses/${course.id}/chapters`,
    'POST',
    { title: '授权章节' },
    201,
  );
  await request(
    teacher,
    `/api/chapters/${chapter.id}/lessons`,
    'POST',
    { title: '授权课时', content: '<p>内容</p>' },
    201,
  );
  await request(teacher, `/api/courses/${course.id}`, 'PATCH', { status: 'PUBLISHED' });
  await request(
    teacher,
    `/api/courses/${course.id}/members`,
    'POST',
    { userId: foreignUser.id, kind: 'teacher' },
    403,
  );
  await request(
    admin,
    `/api/courses/${course.id}/members`,
    'POST',
    { userId: foreignUser.id, kind: 'teacher' },
    400,
  );
  await request(foreignTeacher, `/api/courses/${course.id}`, 'GET', undefined, 404);
  await request(teacher, `/api/courses/${course.id}/members`, 'POST', { userId: studentUser.id }, 201);
  await request(student, `/api/courses/${course.id}`);
  await request(student, `/api/courses/${course.id}/members`, 'GET', undefined, 403);
  await request(teacher, `/api/courses/${course.id}/members/${studentUser.id}`, 'DELETE');
  await request(student, `/api/courses/${course.id}`, 'GET', undefined, 403);
  await request(admin, '/api/admin/users/' + teacherUser.id, 'PATCH', { active: false });
  await request(teacher, `/api/courses/${course.id}`, 'GET', undefined, 401);
});
