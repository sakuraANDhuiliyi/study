import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import { AcademicsService } from '../apps/api/src/academics/academics.service';
import { getAcademicModule } from '../apps/api/src/academics/academics.modules';

// Explicit disposable local target only. Every user, organization and retained request below
// belongs to this suite; seeded learners and their request budgets are never reset.
test('PostgreSQL预占：跨服务实例并发、失败计费、IP共享锁和记录位上限', { timeout: 60000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  const configured =
    process.env.ACADEMICS_ADMISSION_TEST_DATABASE_URL ||
    (process.env.DOTENV_CONFIG_PATH && process.env.DATABASE_URL);
  assert.ok(configured, '需要显式隔离测试环境 DOTENV_CONFIG_PATH 或 ACADEMICS_ADMISSION_TEST_DATABASE_URL');
  const url = new URL(configured);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), '仅限本机隔离数据库');
  assert.match(url.pathname, /review|test|clean/i, '只允许名称包含review/test/clean的隔离数据库');
  url.searchParams.set('connection_limit', '4');
  const clients = [
    new PrismaService({ datasourceUrl: url.href }),
    new PrismaService({ datasourceUrl: url.href }),
  ];
  const db = clients[0];
  const services = clients.map((client) => new AcademicsService(client, new AuthService(client)));
  const suffix = randomBytes(8).toString('hex');
  const ownedUsers: string[] = [];
  let organizationId: string | undefined;
  const previousIpLimit = process.env.ACADEMICS_IP_MINUTE_LIMIT;
  const ip = `2001:db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}::1`;
  const bad = { values: { voltage: 'invalid' } };
  const status = (error: unknown, code: number) =>
    error instanceof HttpException && error.getStatus() === code;
  async function learner(name: string): Promise<Actor> {
    const user = await db.user.create({
      data: {
        username: `admission_${suffix}_${name}`,
        name: `预占审核 ${name}`,
        organizationId: organizationId!,
        passwordHash: 'test-fixture-not-a-password-hash',
        roles: { create: { roleId: 'STUDENT' } },
      },
    });
    ownedUsers.push(user.id);
    const session = await db.session.create({
      data: {
        userId: user.id,
        tokenHash: randomBytes(32).toString('hex'),
        csrfToken: randomBytes(16).toString('hex'),
        authVersion: user.authVersion,
        role: 'STUDENT',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const actor = await new AuthService(db).resolveSessionId(session.id);
    assert.ok(actor?.permissions.includes('learning.use'), '隔离测试库需要已初始化学生角色权限');
    return actor;
  }
  try {
    organizationId = (await db.organization.create({ data: { name: `学科预占审核 ${suffix}` } })).id;
    await t.test('两个实例30个同账号并发请求只有20次进入计算，失败记录仍独立计费', async () => {
      const actor = await learner('minute');
      const outcomes = await Promise.allSettled(
        Array.from({ length: 30 }, (_, index) => services[index % 2].evaluate(actor, 'circuit-lab', bad, ip)),
      );
      assert.equal(
        outcomes.filter(
          (outcome) => outcome.status === 'rejected' && outcome.reason instanceof BadRequestException,
        ).length,
        20,
      );
      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'rejected' && status(outcome.reason, 429)).length,
        10,
      );
      assert.equal(await db.academicsEvaluationAttempt.count({ where: { userId: actor.id } }), 20);
      assert.equal(
        await db.academicsEvaluationAttempt.count({
          where: { userId: actor.id, reservedUntil: { not: null } },
        }),
        0,
      );
      assert.equal(await db.academicsRecord.count({ where: { userId: actor.id } }), 0);
      await db.academicsRecord.deleteMany({ where: { userId: actor.id } });
      await assert.rejects(services[1].evaluate(actor, 'circuit-lab', bad, ip), (error: unknown) =>
        status(error, 429),
      );
    });
    await t.test('跨空间200次日预算和请求解析失败仍在计算前拦截', async () => {
      const actor = await learner('day');
      await db.academicsEvaluationAttempt.createMany({
        data: Array.from({ length: 200 }, () => ({
          userId: actor.id,
          organizationId: 'previous-personal-space',
          createdAt: new Date(Date.now() - 120000),
        })),
      });
      await assert.rejects(services[1].evaluate(actor, 'sql-lab', { invalid: true }, ip), (error: unknown) =>
        status(error, 429),
      );
      assert.equal(await db.academicsEvaluationAttempt.count({ where: { userId: actor.id } }), 200);
      assert.equal(await db.academicsRecord.count({ where: { userId: actor.id } }), 0);
    });
    await t.test('4999条记录的8次并发预占仅有一位，释放后成功填满5000并拒绝继续计算', async () => {
      const actor = await learner('slots');
      await db.academicsRecord.createMany({
        data: Array.from({ length: 4999 }, () => ({
          userId: actor.id,
          organizationId: actor.organizationId,
          moduleId: 'circuit-lab',
          title: '历史审核记录',
          values: {},
          result: {},
          createdAt: new Date(Date.now() - 172800000),
        })),
      });
      const outcomes = await Promise.allSettled(
        Array.from(
          { length: 8 },
          (_, index) => (services[index % 2] as any).reserveEvaluation(actor, ip) as Promise<{ id: string }>,
        ),
      );
      const accepted = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      assert.equal(accepted.length, 1);
      assert.equal(
        outcomes.filter(
          (outcome) => outcome.status === 'rejected' && outcome.reason instanceof ConflictException,
        ).length,
        7,
      );
      await assert.rejects(services[0].evaluate(actor, 'circuit-lab', bad, ip), ConflictException);
      await db.academicsEvaluationAttempt.updateMany({
        where: { userId: actor.id },
        data: { reservedUntil: null },
      });
      const saved = await services[1].evaluate(
        actor,
        'circuit-lab',
        { values: getAcademicModule('circuit-lab')!.defaultValues },
        ip,
      );
      assert.ok(saved.record.id);
      assert.equal(await db.academicsRecord.count({ where: { userId: actor.id } }), 5000);
      assert.equal(
        await db.academicsEvaluationAttempt.count({
          where: { userId: actor.id, reservedUntil: { not: null } },
        }),
        0,
      );
      await assert.rejects(services[0].evaluate(actor, 'circuit-lab', bad, ip), ConflictException);
    });
    await t.test('同一IP四个账号跨实例并发共享可配置分钟预算', async () => {
      process.env.ACADEMICS_IP_MINUTE_LIMIT = '20';
      const actors = await Promise.all(Array.from({ length: 4 }, (_, index) => learner(`ip_${index}`)));
      const otherIp = `${ip.slice(0, -1)}2`;
      const outcomes = await Promise.allSettled(
        Array.from({ length: 30 }, (_, index) =>
          services[index % 2].evaluate(actors[index % 4], 'circuit-lab', bad, otherIp),
        ),
      );
      assert.equal(
        outcomes.filter(
          (outcome) => outcome.status === 'rejected' && outcome.reason instanceof BadRequestException,
        ).length,
        20,
      );
      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'rejected' && status(outcome.reason, 429)).length,
        10,
      );
      assert.equal(
        await db.academicsEvaluationAttempt.count({
          where: { userId: { in: actors.map((actor) => actor.id) } },
        }),
        20,
      );
      process.env.ACADEMICS_IP_MINUTE_LIMIT = '120';
    });
    await t.test('过期尝试清理每次最多1000条，故障租约到期不占记录位', async () => {
      const actor = await learner('cleanup');
      await db.academicsEvaluationAttempt.createMany({
        data: Array.from({ length: 1500 }, () => ({
          userId: actor.id,
          organizationId: actor.organizationId,
          createdAt: new Date(Date.now() - 172800000),
          reservedUntil: new Date(Date.now() - 172000000),
        })),
      });
      await assert.rejects(services[0].evaluate(actor, 'circuit-lab', bad, ip), BadRequestException);
      assert.equal(await db.academicsEvaluationAttempt.count({ where: { userId: actor.id } }), 501);
      await assert.rejects(services[1].evaluate(actor, 'circuit-lab', bad, ip), BadRequestException);
      assert.equal(await db.academicsEvaluationAttempt.count({ where: { userId: actor.id } }), 2);
    });
  } finally {
    if (previousIpLimit === undefined) delete process.env.ACADEMICS_IP_MINUTE_LIMIT;
    else process.env.ACADEMICS_IP_MINUTE_LIMIT = previousIpLimit;
    const where = { userId: { in: ownedUsers } };
    await db.academicsEvaluationAttempt.deleteMany({ where });
    await db.academicsRecord.deleteMany({ where });
    await db.session.deleteMany({ where });
    await db.userRole.deleteMany({ where });
    await db.user.deleteMany({ where: { id: { in: ownedUsers } } });
    if (organizationId) await db.organization.delete({ where: { id: organizationId } });
    await Promise.all(clients.map((client) => client.$disconnect()));
  }
});
