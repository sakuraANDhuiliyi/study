import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import { AcademicsService, academicIpMinuteLimit } from '../apps/api/src/academics/academics.service';

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
function authentication(resolve: () => Promise<Actor | null>, check = async () => {}) {
  return {
    require: AuthService.prototype.require,
    checkFeature: check,
    resolveSessionId: resolve,
  } as unknown as AuthService;
}
type Attempt = {
  id: string;
  organizationId: string;
  userId: string;
  ipHash: string | null;
  createdAt: Date;
  reservedUntil: Date | null;
};
function database(sessionValid = (_check: number) => true) {
  const attempts: Attempt[] = [];
  let sessionChecks = 0,
    transactions = 0,
    recordCount = 0,
    saves = 0,
    budgetChecks = 0;
  const now = new Date();
  const current = {
    ...actor,
    active: true,
    authVersion: 3,
    passwordHash: 'existing-password-hash',
    roles: [{ roleId: 'STUDENT' }],
  };
  function matches(row: Attempt, where: any) {
    return (
      ['id', 'organizationId', 'userId', 'ipHash'].every(
        (key) => where[key] === undefined || row[key as keyof Attempt] === where[key],
      ) &&
      (!where.createdAt || row.createdAt > where.createdAt.gt) &&
      (!where.reservedUntil || (!!row.reservedUntil && row.reservedUntil > where.reservedUntil.gt))
    );
  }
  const attemptTable = {
    count: async ({ where }: any) => attempts.filter((row) => matches(row, where)).length,
    create: async ({ data }: any) => {
      const row = { id: `attempt-${attempts.length}`, ...data };
      attempts.push(row);
      return { id: row.id };
    },
    updateMany: async ({ where, data }: any) => {
      const rows = attempts.filter((row) => matches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
  };
  const tx = {
    user: { findUnique: async () => current, findUniqueOrThrow: async () => current },
    $queryRaw: async (parts: TemplateStringsArray) => {
      const query = parts.join('');
      if (query.includes('clock_timestamp')) return [{ now }];
      if (query.includes('pg_advisory_xact_lock')) return [];
      assert.match(query, /FOR UPDATE/);
      return [current];
    },
    $executeRaw: async (parts: TemplateStringsArray) => {
      assert.match(parts.join(''), /LIMIT 1000 FOR UPDATE SKIP LOCKED/);
      return 0;
    },
    session: { findFirst: async () => (sessionValid(++sessionChecks) ? { id: actor.sessionId } : null) },
    organization: { findUnique: async () => ({ active: true }) },
    academicsEvaluationAttempt: attemptTable,
    academicsRecord: {
      count: async () => recordCount,
      create: async ({ data }: any) => {
        saves++;
        recordCount++;
        return { id: 'record', ...data };
      },
    },
  };
  const db = {
    $queryRaw: async () => {
      budgetChecks++;
      return [{ inputBytes: 100, resultBytes: 2000 }];
    },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
      transactions++;
      return callback(tx);
    },
    academicsEvaluationAttempt: attemptTable,
  } as unknown as PrismaService;
  return {
    db,
    attempts,
    now,
    setRecords: (count: number) => {
      recordCount = count;
    },
    stats: () => ({ sessionChecks, transactions, saves, budgetChecks }),
  };
}

test('SQL工作线程完成后，会话撤销或账号空间改变均不能保存结果，已预占的失败请求仍计费', async () => {
  for (const fresh of [null, { ...actor, organizationId: 'institution' }, { ...actor, id: 'another-user' }]) {
    const fixture = database();
    let rechecks = 0;
    const service = new AcademicsService(
      fixture.db,
      authentication(async () => {
        rechecks++;
        return fresh;
      }),
    );
    await assert.rejects(service.evaluate(actor, 'sql-lab', sql), ForbiddenException);
    assert.equal(rechecks, 1);
    assert.equal(fixture.stats().transactions, 1);
    assert.equal(fixture.stats().saves, 0);
    assert.equal(fixture.attempts.length, 1);
    assert.equal(fixture.attempts[0].reservedUntil, null);
  }
});

test('SQL完成后必须重新检查学生身份、学习权限和机构功能开关', async () => {
  for (const fresh of [
    { ...actor, role: 'TEACHER' },
    { ...actor, permissions: [] },
  ]) {
    const fixture = database();
    const service = new AcademicsService(
      fixture.db,
      authentication(async () => fresh),
    );
    await assert.rejects(service.evaluate(actor, 'sql-lab', sql), ForbiddenException);
    assert.equal(fixture.stats().saves, 0);
  }
  let checks = 0;
  const fixture = database();
  const service = new AcademicsService(
    fixture.db,
    authentication(
      async () => actor,
      async () => {
        if (++checks === 2) throw new ForbiddenException('机构已关闭此功能');
      },
    ),
  );
  await assert.rejects(service.evaluate(actor, 'sql-lab', sql), ForbiddenException);
  assert.equal(checks, 2);
  assert.equal(fixture.stats().saves, 0);
});

test('会话在预占前或SQL完成后的User锁内失效时均阻断计算/保存', async () => {
  for (const revokedAt of [1, 2]) {
    const fixture = database((check) => check < revokedAt);
    const service = new AcademicsService(
      fixture.db,
      authentication(async () => actor),
    );
    await assert.rejects(service.evaluate(actor, 'sql-lab', sql), UnauthorizedException);
    assert.equal(fixture.stats().sessionChecks, revokedAt);
    assert.equal(fixture.stats().saves, 0);
    assert.equal(fixture.attempts.length, revokedAt - 1);
    assert.equal(fixture.stats().budgetChecks, revokedAt - 1);
  }
});

test('20次失败计算消耗分钟预算，第21次在计算前返回429；删除记录不恢复预算', async () => {
  const fixture = database();
  const service = new AcademicsService(
    fixture.db,
    authentication(async () => actor),
  );
  for (let i = 0; i < 20; i++)
    await assert.rejects(
      service.evaluate(actor, 'circuit-lab', { values: { voltage: 'invalid' } }),
      BadRequestException,
    );
  fixture.setRecords(0);
  await assert.rejects(
    service.evaluate(actor, 'sql-lab', sql),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  );
  assert.equal(fixture.attempts.length, 20);
  assert.ok(fixture.attempts.every((row) => row.reservedUntil === null));
  assert.equal(fixture.stats().budgetChecks, 0, '拒绝请求不应产生计算结果或检查结果体积');
});

test('200次滚动日预算跨账号空间累计，并在请求体解析与计算前拒绝', async () => {
  const fixture = database();
  for (let i = 0; i < 200; i++)
    fixture.attempts.push({
      id: `past-${i}`,
      userId: actor.id,
      organizationId: 'previous-space',
      ipHash: null,
      createdAt: new Date(fixture.now.getTime() - 120000),
      reservedUntil: null,
    });
  const service = new AcademicsService(
    fixture.db,
    authentication(async () => actor),
  );
  await assert.rejects(
    service.evaluate(actor, 'sql-lab', { invalid: true }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  );
  assert.equal(fixture.attempts.length, 200);
  assert.equal(fixture.stats().budgetChecks, 0);
});

test('5000条记录总量在计算前检查，尚未完成的计算也占记录位', async () => {
  for (const pending of [false, true]) {
    const fixture = database();
    fixture.setRecords(pending ? 4999 : 5000);
    if (pending)
      fixture.attempts.push({
        id: 'pending',
        userId: actor.id,
        organizationId: actor.organizationId,
        ipHash: null,
        createdAt: fixture.now,
        reservedUntil: new Date(fixture.now.getTime() + 60000),
      });
    const service = new AcademicsService(
      fixture.db,
      authentication(async () => actor),
    );
    await assert.rejects(service.evaluate(actor, 'sql-lab', sql), ConflictException);
    assert.equal(fixture.stats().budgetChecks, 0);
    assert.equal(fixture.attempts.length, pending ? 1 : 0);
  }
});

test('IP预算可配置并对IPv4映射地址使用同一键，成功保存释放预留但保留请求预算', async () => {
  const old = process.env.ACADEMICS_IP_MINUTE_LIMIT;
  try {
    for (const value of ['', '0', '-1', 'NaN', '100001', '20.5']) {
      process.env.ACADEMICS_IP_MINUTE_LIMIT = value;
      assert.equal(academicIpMinuteLimit(), 120);
    }
    process.env.ACADEMICS_IP_MINUTE_LIMIT = '20';
    assert.equal(academicIpMinuteLimit(), 20);
    const fixture = database();
    const service = new AcademicsService(
      fixture.db,
      authentication(async () => actor),
    );
    await service.evaluate(actor, 'sql-lab', sql, '::ffff:203.0.113.1');
    await service.evaluate(actor, 'sql-lab', sql, '203.0.113.1');
    assert.equal(fixture.attempts[0].ipHash, fixture.attempts[1].ipHash);
    assert.match(fixture.attempts[0].ipHash!, /^[a-f0-9]{64}$/);
    assert.ok(fixture.attempts.every((row) => row.reservedUntil === null));
    assert.equal(fixture.stats().saves, 2);
    const ipHash = fixture.attempts[0].ipHash;
    for (let i = 0; i < 18; i++)
      fixture.attempts.push({
        id: `other-${i}`,
        userId: `other-user-${i}`,
        organizationId: actor.organizationId,
        ipHash,
        createdAt: fixture.now,
        reservedUntil: null,
      });
    await assert.rejects(
      service.evaluate(actor, 'sql-lab', sql, '203.0.113.1'),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
    );
    assert.equal(fixture.stats().saves, 2);
  } finally {
    if (old === undefined) delete process.env.ACADEMICS_IP_MINUTE_LIMIT;
    else process.env.ACADEMICS_IP_MINUTE_LIMIT = old;
  }
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
