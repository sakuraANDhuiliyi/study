import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import { AcademicsService } from '../apps/api/src/academics/academics.service';

const actor: Actor = {
  id: 'learner',
  name: '学习者',
  organizationId: 'personal-space',
  accountMode: 'PERSONAL',
  role: 'STUDENT',
  permissions: ['learning.use'],
  sessionId: 'session',
};
const sql = {
  values: { query: 'SELECT name, score FROM students ORDER BY score DESC', exercise: 'high-scores' },
};
const budget = async () => [{ inputBytes: 100, resultBytes: 2000 }];

function authentication(resolve: () => Promise<Actor | null>, check = async () => {}) {
  return {
    require: AuthService.prototype.require,
    checkFeature: check,
    resolveSessionId: resolve,
  } as unknown as AuthService;
}

test('SQL工作线程完成后，会话撤销或账号空间改变均不能保存结果', async () => {
  for (const fresh of [null, { ...actor, organizationId: 'institution' }, { ...actor, id: 'another-user' }]) {
    let rechecks = 0;
    const db = {
      $queryRaw: budget,
      $transaction: async () => assert.fail('失效会话不得进入写入事务'),
    } as unknown as PrismaService;
    const service = new AcademicsService(
      db,
      authentication(async () => {
        rechecks++;
        return fresh;
      }),
    );
    await assert.rejects(service.evaluate(actor, 'sql-lab', sql), ForbiddenException);
    assert.equal(rechecks, 1);
  }
});

test('SQL完成后必须重新检查学生身份、学习权限和机构功能开关', async () => {
  for (const fresh of [
    { ...actor, role: 'TEACHER' },
    { ...actor, permissions: [] },
  ]) {
    const db = {
      $queryRaw: budget,
      $transaction: async () => assert.fail('撤销资格不得保存结果'),
    } as unknown as PrismaService;
    const service = new AcademicsService(
      db,
      authentication(async () => fresh),
    );
    await assert.rejects(service.evaluate(actor, 'sql-lab', sql), ForbiddenException);
  }
  let checks = 0;
  const db = {
    $queryRaw: budget,
    $transaction: async () => assert.fail('机构已关闭功能，不得保存结果'),
  } as unknown as PrismaService;
  const service = new AcademicsService(
    db,
    authentication(
      async () => actor,
      async () => {
        if (++checks === 2) throw new ForbiddenException('机构已关闭此功能');
      },
    ),
  );
  await assert.rejects(service.evaluate(actor, 'sql-lab', sql), ForbiddenException);
  assert.equal(checks, 2);
});

test('SQL会话重验后、取得用户行锁前发生的撤销仍由事务阻断', async () => {
  let sessionChecks = 0;
  const current = {
    id: actor.id,
    organizationId: actor.organizationId,
    active: true,
    authVersion: 3,
    passwordHash: 'existing-password-hash',
  };
  const tx = {
    user: { findUnique: async () => current },
    $queryRaw: async (parts: TemplateStringsArray) => {
      assert.match(parts.join(''), /FOR UPDATE/);
      return [current];
    },
    session: {
      findFirst: async () => {
        sessionChecks++;
        return null;
      },
    },
    academicsRecord: { count: async () => assert.fail('事务中失效会话不得继续配额或写入操作') },
  };
  const db = {
    $queryRaw: budget,
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaService;
  const service = new AcademicsService(
    db,
    authentication(async () => actor),
  );
  await assert.rejects(service.evaluate(actor, 'sql-lab', sql), UnauthorizedException);
  assert.equal(sessionChecks, 1);
});

test('个人模式伪造管理员、教师及权限不全的机构管理员无法管理专业目录', async () => {
  const service = new AcademicsService(
    {} as PrismaService,
    authentication(async () => actor),
  );
  const administrators = [
    { ...actor, role: 'ADMIN', permissions: ['org.manage', 'users.manage'] },
    { ...actor, accountMode: 'ORGANIZATION', role: 'TEACHER', permissions: ['org.manage', 'users.manage'] },
    { ...actor, accountMode: 'ORGANIZATION', role: 'ADMIN', permissions: ['org.manage'] },
    { ...actor, accountMode: 'ORGANIZATION', role: 'ADMIN', permissions: ['users.manage'] },
  ];
  for (const administrator of administrators) {
    await assert.rejects(service.createSubject(administrator, { name: '未授权学科' }), ForbiddenException);
    await assert.rejects(service.adminMajors(administrator), ForbiddenException);
  }
});
