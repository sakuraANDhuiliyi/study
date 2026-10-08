import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  registrationSchema,
  profileSchema,
  joinRequestSchema,
  joinReviewSchema,
  joinListSchema,
} from '../apps/api/src/accounts/accounts.schemas';
import { canUsePersonalRecovery, validateAccountMajor } from '../apps/api/src/accounts/accounts.service';

test('个人注册与机构申请严格拒绝身份、空间、审核人注入', () => {
  const input = { username: 'new_student', password: 'personal_password_123', name: '学习者' };
  assert.equal(registrationSchema.parse(input).username, input.username);
  for (const extra of [
    { roles: ['ADMIN'] },
    { organizationId: 'foreign' },
    { accountMode: 'ORGANIZATION' },
    { active: true },
  ])
    assert.equal(registrationSchema.safeParse({ ...input, ...extra }).success, false);
  assert.equal(registrationSchema.safeParse({ ...input, password: 'short' }).success, false);
  assert.equal(
    joinRequestSchema.safeParse({ inviteCode: 'a'.repeat(32), status: 'APPROVED' }).success,
    false,
  );
  assert.equal(
    joinRequestSchema.safeParse({ inviteCode: 'a'.repeat(32), note: '中'.repeat(501) }).success,
    false,
  );
  assert.equal(joinReviewSchema.safeParse({ status: 'APPROVED', roles: ['TEACHER'] }).success, false);
  assert.equal(profileSchema.safeParse({}).success, false);
  assert.equal(profileSchema.safeParse({ accountMode: 'PERSONAL' }).success, false);
  assert.equal(joinListSchema.safeParse({ pageSize: '101' }).success, false);
});

test('仅真实个人空间允许恢复码自助恢复，机构学生仍需要管理员许可', () => {
  const user = { accountMode: 'PERSONAL', organizationId: 'space', personalOrganizationId: 'space' };
  assert.equal(canUsePersonalRecovery(user, { kind: 'PERSONAL' }), true);
  for (const candidate of [
    { ...user, accountMode: 'ORGANIZATION' },
    { ...user, personalOrganizationId: null },
    { ...user, organizationId: 'institution' },
  ])
    assert.equal(canUsePersonalRecovery(candidate, { kind: 'PERSONAL' }), false);
  assert.equal(canUsePersonalRecovery(user, { kind: 'INSTITUTION' }), false);
});

test('专业选择始终限制为启用的全局专业或当前机构专业', async () => {
  const queries: any[] = [];
  let found = true,
    subjectActive = true;
  const locks: string[] = [];
  const db = {
    $queryRaw: async (parts: TemplateStringsArray) => {
      locks.push(parts.join(''));
      return [];
    },
    academicsMajor: {
      findFirst: async (query: unknown) => {
        queries.push(query);
        return found ? { id: 'major', organizationId: null, subjectId: 'subject' } : null;
      },
    },
    academicsSubject: {
      findFirst: async (query: any) => {
        assert.deepEqual(query.where.OR, [{ organizationId: null }]);
        return subjectActive ? { id: 'subject' } : null;
      },
    },
  } as unknown as Prisma.TransactionClient;
  await validateAccountMajor(db, 'major', null);
  assert.deepEqual(queries[0].where, { id: 'major', active: true, OR: [{ organizationId: null }] });
  await validateAccountMajor(db, 'major', 'own-org');
  assert.deepEqual(queries[1].where.OR, [{ organizationId: null }, { organizationId: 'own-org' }]);
  assert.equal(await validateAccountMajor(db, null, 'own-org'), null);
  assert.ok(locks.every((query) => query.includes('FOR SHARE')));
  subjectActive = false;
  await assert.rejects(validateAccountMajor(db, 'major', 'own-org'), BadRequestException);
  found = false;
  await assert.rejects(validateAccountMajor(db, 'foreign-major', 'own-org'), BadRequestException);
});
