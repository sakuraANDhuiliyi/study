import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mobileSchoolDirectoryRouteAllowed,
  schoolDirectoryImport,
  schoolDirectoryRoles,
  schoolDirectoryQuery,
  schoolDirectoryBinding,
} from '../apps/api/src/mobile/mobile-school-directory.policy';
import { parseSchoolImportCsv, schoolDirectoryApi } from '../apps/mobile/src/school-directory-model';
import type { MobileClient } from '../apps/mobile/src/client';
test('school directory routes allow only user import/export, role assignment and class-course binding', () => {
  for (const [p, m] of [
    ['users', 'GET'],
    ['users/template', 'GET'],
    ['users/export', 'GET'],
    ['users/import', 'POST'],
    ['users/u1/roles', 'PATCH'],
    ['classes', 'GET'],
    ['courses', 'GET'],
    ['classes/c1/courses', 'GET'],
    ['classes/c1/courses', 'POST'],
  ])
    assert.equal(mobileSchoolDirectoryRouteAllowed('/api/mobile/school-directory/' + p, m), true, p);
  for (const [p, m] of [
    ['users/u1', 'PATCH'],
    ['users/u1/password', 'POST'],
    ['roles', 'PATCH'],
    ['users/u1/roles', 'POST'],
    ['classes/c1/courses/c2', 'DELETE'],
    ['users/export/foreign', 'GET'],
    ['users/%2e%2e/roles', 'PATCH'],
  ])
    assert.equal(mobileSchoolDirectoryRouteAllowed('/api/mobile/school-directory/' + p, m), false, p);
});
test('native school schemas preserve row diagnostics and reject unknown authority, oversized batches and higher roles', () => {
  assert.equal(
    schoolDirectoryImport.safeParse({ rows: [{ username: 'bad', password: 3 }], commit: false }).success,
    true,
  );
  for (const b of [
    { rows: [{ organizationId: 'foreign' }] },
    { rows: Array.from({ length: 101 }, () => ({})) },
    { rows: [{}], organizationId: 'other' },
    { rows: [{}], commit: 'true' },
  ])
    assert.equal(schoolDirectoryImport.safeParse(b).success, false);
  for (const r of [[], ['SUPER_ADMIN'], ['owner']])
    assert.equal(schoolDirectoryRoles.safeParse({ roles: r }).success, false);
  assert.equal(schoolDirectoryRoles.safeParse({ roles: ['TEACHER', 'STUDENT'] }).success, true);
  for (const q of [{ page: true }, { page: ['1', '2'] }, { pageSize: 21 }, { organizationId: 'foreign' }])
    assert.equal(schoolDirectoryQuery.safeParse(q).success, false);
  assert.equal(schoolDirectoryBinding.safeParse({ courseId: 'c1', userIds: ['other'] }).success, false);
});
test('CSV parser handles BOM, CRLF, escaped quotes and embedded newlines while preserving password bytes', () => {
  const rows = parseSchoolImportCsv(
    '\ufeffusername,name,password,studentNo,roles,majorId\r\nu1,"中文,姓名",  secret bytes  ,01,STUDENT|TEACHER,\r\nu2,"two""quotes\nline",another secret,,,\r\n',
  );
  assert.deepEqual(rows, [
    {
      username: 'u1',
      name: '中文,姓名',
      password: '  secret bytes  ',
      studentNo: '01',
      roles: ['STUDENT', 'TEACHER'],
    },
    { username: 'u2', name: 'two"quotes\nline', password: 'another secret', roles: [''] },
  ]);
});
test('CSV rejects ambiguous headers, malformed quotes, column mismatch, NUL and batches beyond100', () => {
  for (const csv of [
    'username,name,password,roles,organizationId\nu,n,p,STUDENT,other',
    'username,name,password,password\nu,n,p,p',
    'username,name,password,roles\nu,"open,p,STUDENT',
    'username,name,password,roles\nu,"closed"x,p,STUDENT',
    'username,name,password,roles\nu,n,p,STUDENT,extra',
    'username,name,password,roles\nu,n,\0,STUDENT',
  ])
    assert.throws(() => parseSchoolImportCsv(csv));
  const header = 'username,name,password,roles\n',
    row = 'u,n,p,STUDENT\n';
  assert.equal(parseSchoolImportCsv(header + row.repeat(100)).length, 100);
  assert.throws(() => parseSchoolImportCsv(header + row.repeat(101)));
  assert.throws(() => parseSchoolImportCsv('a'.repeat(512 * 1024 + 1)));
});
test('preview cannot accidentally commit and role update removes duplicate roles without injecting account fields', async () => {
  const calls: unknown[][] = [];
  const client = {
    request: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as MobileClient;
  const rows = [{ username: 'native', name: '姓名', password: 'ephemeral-only', roles: ['STUDENT'] }];
  await schoolDirectoryApi.preview(client, rows);
  await schoolDirectoryApi.commit(client, rows);
  await schoolDirectoryApi.roles(client, 'u1', ['TEACHER', 'TEACHER', 'STUDENT']);
  assert.deepEqual(calls, [
    ['/mobile/school-directory/users/import', { rows, commit: false }, 'POST'],
    ['/mobile/school-directory/users/import', { rows, commit: true }, 'POST'],
    ['/mobile/school-directory/users/u1/roles', { roles: ['TEACHER', 'STUDENT'] }, 'PATCH'],
  ]);
});
