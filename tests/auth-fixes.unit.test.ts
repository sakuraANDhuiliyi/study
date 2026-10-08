import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { lockSecurityUser } from '../apps/api/src/auth/security-transaction';
import {
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  verifyPasswordAsync,
} from '../apps/api/src/auth/password';

test('异步密码哈希兼容已有 salted scrypt 格式，并拒绝损坏的哈希', async () => {
  const legacy = hashPassword('A-secure-password-123!');
  assert(await verifyPasswordAsync('A-secure-password-123!', legacy));
  assert.equal(await verifyPasswordAsync('incorrect', legacy), false);
  const generated = await hashPasswordAsync('A-secure-password-123!');
  assert(verifyPassword('A-secure-password-123!', generated));
  assert.notEqual(generated, legacy);
  for (const bad of ['invalid', 'scrypt$salt$00', legacy + '$extra'])
    assert.equal(await verifyPasswordAsync('A-secure-password-123!', bad), false);
});

test('密码验证队列有界，60个同时验证仍允许事件循环处理定时器', async () => {
  const stored = hashPassword('A-secure-password-123!');
  let completed = 0;
  const timer = new Promise<number>((resolve) => setTimeout(() => resolve(completed), 10));
  const work = Array.from({ length: 60 }, () =>
    verifyPasswordAsync('A-secure-password-123!', stored).then((value) => {
      completed++;
      return value;
    }),
  );
  // Attach rejection handlers before waiting for the timer.
  const resultsPromise = Promise.allSettled(work);
  const completedAtTimer = await timer;
  const results = await resultsPromise;
  const succeeded = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(succeeded.length, 34); // Two active workers and 32 waiting jobs.
  assert.equal(rejected.length, 26);
  assert(completedAtTimer < succeeded.length, '定时器应在验证队列完成前运行');
  for (const result of rejected)
    if (result.status === 'rejected') assert(result.reason instanceof ServiceUnavailableException);
  assert(await verifyPasswordAsync('A-secure-password-123!', stored), '队列溢出后仍可继续处理');
});

test('敏感自助操作在User锁内拒绝已撤销、旧版本、过期和他人会话', async () => {
  const actor = {
    id: 'owner',
    organizationId: 'org',
    sessionId: 'session',
    name: '本人',
    role: 'TEACHER',
    permissions: [],
  };
  // This is the user state read after administrator recovery has already incremented the version.
  const current = {
    id: actor.id,
    organizationId: actor.organizationId,
    active: true,
    authVersion: 1,
    passwordHash: 'verified-hash',
  };
  const sessions = [
    null,
    { id: 'session', userId: 'owner', authVersion: 0, expiresAt: new Date(Date.now() + 60000) },
    { id: 'session', userId: 'owner', authVersion: 1, expiresAt: new Date(Date.now() - 60000) },
    { id: 'session', userId: 'someone-else', authVersion: 1, expiresAt: new Date(Date.now() + 60000) },
  ];
  for (const session of sessions) {
    let locked = false;
    const tx = {
      $queryRaw: async () => {
        locked = true;
        return [current];
      },
      session: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; userId: string; authVersion: number; expiresAt: { gt: Date } };
        }) => {
          assert(locked, '必须先锁User，防止恢复/停用事务穿过检查');
          return session &&
            session.id === where.id &&
            session.userId === where.userId &&
            session.authVersion === where.authVersion &&
            session.expiresAt > where.expiresAt.gt
            ? session
            : null;
        },
      },
    } as unknown as Prisma.TransactionClient;
    await assert.rejects(
      lockSecurityUser(tx, actor, current),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 401,
    );
  }
});

test('有效当前会话允许自助变更，停用机构和验证后变更的密码拒绝', async () => {
  const actor = {
    id: 'owner',
    organizationId: 'org',
    sessionId: 'session',
    name: '本人',
    role: 'TEACHER',
    permissions: [],
  };
  const current = {
    id: actor.id,
    organizationId: actor.organizationId,
    active: true,
    authVersion: 1,
    passwordHash: 'verified-hash',
  };
  let organizationActive = true;
  const tx = {
    $queryRaw: async () => [current],
    session: { findFirst: async () => ({ id: 'session' }) },
    organization: { findUnique: async () => ({ active: organizationActive }) },
  } as unknown as Prisma.TransactionClient;
  assert.equal((await lockSecurityUser(tx, actor, current)).id, actor.id);
  organizationActive = false;
  const denied = (error: unknown) => error instanceof HttpException && error.getStatus() === 403;
  await assert.rejects(lockSecurityUser(tx, actor, current), denied);
  organizationActive = true;
  await assert.rejects(lockSecurityUser(tx, actor, { ...current, authVersion: 0 }), denied);
  await assert.rejects(lockSecurityUser(tx, actor, { ...current, passwordHash: 'old-hash' }), denied);
});
