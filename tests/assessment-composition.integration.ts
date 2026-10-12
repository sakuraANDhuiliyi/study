import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Actor } from '../apps/api/src/auth/auth.guard';

// Exercise production decorator metadata: tsx source imports do not emit it.
// The iteration gate builds the API before running *.integration.ts.
const require = createRequire(import.meta.url);
const { assessmentProviders } =
  require('../apps/api/dist/assessment/assessment.providers.js') as typeof import('../apps/api/src/assessment/assessment.providers');
const { AssessmentService } =
  require('../apps/api/dist/assessment/assessment.service.js') as typeof import('../apps/api/src/assessment/assessment.service');
const { ExamDeadlineService } =
  require('../apps/api/dist/assessment/exam-deadline.service.js') as typeof import('../apps/api/src/assessment/exam-deadline.service');
const { PrismaService } =
  require('../apps/api/dist/common/prisma.service.js') as typeof import('../apps/api/src/common/prisma.service');
const { AuthService } =
  require('../apps/api/dist/auth/auth.service.js') as typeof import('../apps/api/src/auth/auth.service');
const { AuditService } =
  require('../apps/api/dist/common/audit.service.js') as typeof import('../apps/api/src/common/audit.service');

type Timer = { callback: () => void; delay: number | undefined; unrefs: number; clears: number };
type Fixture = {
  app: INestApplicationContext;
  service: InstanceType<typeof AssessmentService>;
  worker: InstanceType<typeof ExamDeadlineService>;
  timers: Timer[];
  permissions: string[];
  audits: string[];
  releasedAt: Date;
};

function deferredSweep() {
  let finish!: (value: never[]) => void;
  const pending = new Promise<never[]>((resolve) => {
    finish = resolve;
  });
  return { pending, finish: () => finish([]) };
}

async function withContext(
  disabled: boolean,
  findMany: () => Promise<never[]>,
  check: (fixture: Fixture) => Promise<void>,
) {
  const previousDisabled = process.env.DISABLE_JOBS;
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const timers: Timer[] = [];
  const permissions: string[] = [];
  const audits: string[] = [];
  const releasedAt = new Date('2020-01-01T00:00:00Z');
  const exam = {
    id: 'composition-exam',
    organizationId: 'composition-org',
    courseId: 'composition-course',
    title: 'Composition fixture',
    status: 'published',
    endsAt: new Date('2019-01-01T00:00:00Z'),
    graderIds: [],
    audience: [],
    gradesReleasedAt: releasedAt,
    scoreReleaseAt: releasedAt,
  };
  const db = {
    examAttempt: { findMany },
    exam: {
      async findFirst() {
        return exam;
      },
    },
    async $transaction(callback: (tx: unknown) => Promise<unknown>) {
      return callback({
        async $queryRaw() {
          return [{ locked: 1 }];
        },
        exam: {
          async findUniqueOrThrow() {
            return exam;
          },
        },
      });
    },
  };
  const auth = {
    require(_actor: Actor, permission: string) {
      permissions.push(permission);
    },
    async course() {},
  };
  const audit = {
    async record(_actor: Actor, action: string) {
      audits.push(action);
    },
    async notify() {},
  };
  let app: INestApplicationContext | undefined;
  process.env.DISABLE_JOBS = String(disabled);
  globalThis.setInterval = ((callback: () => void, delay?: number) => {
    const timer = {
      callback,
      delay,
      unrefs: 0,
      clears: 0,
      unref() {
        this.unrefs++;
        return this;
      },
    };
    timers.push(timer);
    return timer;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((timer: Timer) => {
    timer.clears++;
  }) as unknown as typeof clearInterval;
  try {
    class CompositionModule {}
    Module({
      providers: [
        ...assessmentProviders,
        { provide: PrismaService, useValue: db },
        { provide: AuthService, useValue: auth },
        { provide: AuditService, useValue: audit },
      ],
    })(CompositionModule);
    app = await NestFactory.createApplicationContext(CompositionModule, {
      logger: false,
      abortOnError: false,
    });
    for (const provider of assessmentProviders) {
      assert.ok(app.get(provider) instanceof provider, `${provider.name} must resolve through real Nest DI`);
    }
    await check({
      app,
      service: app.get(AssessmentService),
      worker: app.get(ExamDeadlineService),
      timers,
      permissions,
      audits,
      releasedAt,
    });
  } finally {
    try {
      if (app) await app.close();
    } finally {
      globalThis.setInterval = originalInterval;
      globalThis.clearInterval = originalClear;
      if (previousDisabled === undefined) delete process.env.DISABLE_JOBS;
      else process.env.DISABLE_JOBS = previousDisabled;
    }
  }
}

test('评测生产注入图与截止任务生命周期组合', { concurrency: false, timeout: 15_000 }, async (t) => {
  await t.test('启用任务只注册一个十秒 unref 定时器，并立即首轮扫描和随容器关闭销毁', async () => {
    const first = deferredSweep();
    let scans = 0;
    try {
      await withContext(
        false,
        () => {
          scans++;
          return first.pending;
        },
        async ({ app, service, worker, timers }) => {
          assert.equal(scans, 1, 'initial sweep must run without waiting for the first timer tick');
          assert.equal(timers.length, 1);
          assert.equal(timers[0].delay, 10_000);
          assert.equal(timers[0].unrefs, 1);
          assert.deepEqual(service.schedulerSnapshot(), {
            automaticEnabled: true,
            lifecycle: 'scheduled',
            pollIntervalMs: 10_000,
            pollInProgress: true,
          });
          assert.deepEqual(service.schedulerSnapshot(), worker.schedulerSnapshot());
          timers[0].callback();
          await service.sweepDueAttempts();
          assert.equal(scans, 1, 'timer and facade must share the running worker');
          first.finish();
          await nextTurn();
          assert.equal(service.schedulerSnapshot().pollInProgress, false);
          timers[0].callback();
          await nextTurn();
          assert.equal(scans, 2, 'scheduled callback must resume after the pending sweep finishes');
          await app.close();
          assert.equal(timers[0].clears, 1);
          assert.deepEqual(service.schedulerSnapshot(), {
            automaticEnabled: true,
            lifecycle: 'stopped',
            pollIntervalMs: 10_000,
            pollInProgress: false,
          });
        },
      );
    } finally {
      first.finish();
    }
  });

  await t.test('停用自动任务不注册定时器或首轮扫描，手动扫描仍可用', async () => {
    let scans = 0;
    await withContext(
      true,
      async () => {
        scans++;
        return [];
      },
      async ({ app, service, timers }) => {
        assert.equal(timers.length, 0);
        assert.equal(scans, 0);
        assert.deepEqual(service.schedulerSnapshot(), {
          automaticEnabled: false,
          lifecycle: 'disabled',
          pollIntervalMs: 10_000,
          pollInProgress: false,
        });
        await service.sweepDueAttempts();
        assert.equal(scans, 1);
        assert.equal(service.schedulerSnapshot().lifecycle, 'disabled');
        await app.close();
        assert.equal(service.schedulerSnapshot().lifecycle, 'stopped');
        assert.equal(timers.length, 0);
      },
    );
  });

  await t.test('发布成绩与手动扫描复用同一个截止 worker 的并发保护', async () => {
    const blocked = deferredSweep();
    let scans = 0;
    const actor: Actor = {
      id: 'composition-teacher',
      role: 'TEACHER',
      name: 'Composition teacher',
      organizationId: 'composition-org',
      permissions: ['assessment.grade'],
    };
    try {
      await withContext(
        true,
        () => {
          scans++;
          return blocked.pending;
        },
        async ({ service, worker, permissions, audits, releasedAt }) => {
          const manual = service.sweepDueAttempts();
          assert.equal(scans, 1);
          assert.equal(worker.schedulerSnapshot().pollInProgress, true);
          const result = await service.releaseExam(actor, 'composition-exam');
          assert.deepEqual(result, { released: 0, releasedAt, visibleAt: releasedAt });
          await worker.sweepDueAttempts();
          assert.equal(scans, 1, 'grade release and direct worker access must not start overlapping sweeps');
          assert.equal(service.schedulerSnapshot().pollInProgress, true);
          assert.ok(permissions.includes('assessment.grade'));
          assert.deepEqual(audits, ['exam.release']);
          blocked.finish();
          await manual;
          assert.equal(service.schedulerSnapshot().pollInProgress, false);
          await service.releaseExam(actor, 'composition-exam');
          assert.equal(
            scans,
            2,
            'grade release must call the worker again after the original sweep completes',
          );
        },
      );
    } finally {
      blocked.finish();
    }
  });
});
