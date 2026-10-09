import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JobsService } from '../apps/api/src/common/jobs.service';
import { AssessmentService } from '../apps/api/src/assessment/assessment.service';
import { AdminJobsService } from '../apps/api/src/admin/jobs.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';

type Timer = { callback: () => void; interval: number; active: boolean; unrefs: number; unref(): void };
function fakeTimers() {
  const set = globalThis.setInterval,
    clear = globalThis.clearInterval;
  const timers: Timer[] = [];
  globalThis.setInterval = ((callback: () => void, interval: number) => {
    const timer = {
      callback,
      interval,
      active: true,
      unrefs: 0,
      unref() {
        this.unrefs++;
      },
    };
    timers.push(timer);
    return timer;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((timer: Timer) => {
    timer.active = false;
  }) as unknown as typeof clearInterval;
  return {
    timers,
    tick() {
      timers.filter((timer) => timer.active).forEach((timer) => timer.callback());
    },
    restore() {
      globalThis.setInterval = set;
      globalThis.clearInterval = clear;
    },
  };
}
function flag(value: string | undefined) {
  const original = process.env.DISABLE_JOBS;
  if (value === undefined) delete process.env.DISABLE_JOBS;
  else process.env.DISABLE_JOBS = value;
  return () => {
    if (original === undefined) delete process.env.DISABLE_JOBS;
    else process.env.DISABLE_JOBS = original;
  };
}
const flush = () => new Promise<void>((done) => setImmediate(done));
function clock(stamp: string) {
  const NativeDate = Date,
    time = NativeDate.parse(stamp);
  globalThis.Date = class extends NativeDate {
    constructor(value?: string | number | Date) {
      super(value === undefined ? time : value);
    }
    static now() {
      return time;
    }
  } as DateConstructor;
  return () => {
    globalThis.Date = NativeDate;
  };
}
function common(db: unknown, uploads: unknown = { cleanup: async () => {} }) {
  return new JobsService(db as never, {} as never, uploads as never);
}
function assessment(db: unknown) {
  return new AssessmentService(db as never, {} as never, {} as never);
}

for (const value of ['true', undefined, 'false', 'True', '1']) {
  test(`Actual lifecycle preserves exact startup flag ${value ?? '(genuinely unset)'}, first pass and timer cadence`, async () => {
    const restore = flag(value),
      timers = fakeTimers();
    const c = common({}),
      a = assessment({});
    let commonPass = 0,
      examPass = 0;
    Reflect.set(c, 'run', async () => {
      commonPass++;
    });
    Reflect.set(a, 'sweepDueAttempts', async () => {
      examPass++;
    });
    try {
      assert.equal(c.schedulerSnapshot().lifecycle, 'not_initialized');
      assert.equal(a.schedulerSnapshot().lifecycle, 'not_initialized');
      c.onModuleInit();
      a.onModuleInit();
      const enabled = value !== 'true';
      assert.deepEqual(c.schedulerSnapshot(), {
        automaticEnabled: enabled,
        lifecycle: enabled ? 'scheduled' : 'disabled',
        pollIntervalMs: 5000,
        pollInProgress: false,
      });
      assert.deepEqual(a.schedulerSnapshot(), {
        automaticEnabled: enabled,
        lifecycle: enabled ? 'scheduled' : 'disabled',
        pollIntervalMs: 10000,
        pollInProgress: false,
      });
      assert.equal(commonPass, Number(enabled));
      assert.equal(examPass, Number(enabled));
      assert.deepEqual(
        timers.timers.map((timer) => [timer.interval, timer.unrefs]),
        enabled
          ? [
              [5000, 0],
              [10000, 1],
            ]
          : [],
      );
      process.env.DISABLE_JOBS = enabled ? 'true' : 'false';
      assert.equal(
        c.schedulerSnapshot().automaticEnabled,
        enabled,
        'metadata is startup policy, no env hot switch',
      );
      assert.equal(a.schedulerSnapshot().automaticEnabled, enabled);
      timers.tick();
      assert.equal(commonPass, enabled ? 2 : 0);
      assert.equal(examPass, enabled ? 2 : 0);
      c.onModuleDestroy();
      a.onModuleDestroy();
      assert.equal(Reflect.get(c, 'timer'), undefined);
      assert.equal(Reflect.get(a, 'timer'), undefined);
      assert.equal(c.schedulerSnapshot().lifecycle, 'stopped');
      assert.equal(a.schedulerSnapshot().lifecycle, 'stopped');
      timers.tick();
      assert.equal(commonPass, enabled ? 2 : 0);
      assert.equal(examPass, enabled ? 2 : 0);
    } finally {
      c.onModuleDestroy();
      a.onModuleDestroy();
      timers.restore();
      restore();
    }
    await flush();
  });
}

test('Disabled lifecycle touches no fake persistence/upload and registers no actual timer', async () => {
  const restore = flag('true'),
    timers = fakeTimers();
  const trap = new Proxy(
    {},
    {
      get() {
        throw new Error('disabled startup must not borrow persistence/upload');
      },
    },
  );
  const c = common(trap, trap),
    a = assessment(trap);
  try {
    c.onModuleInit();
    a.onModuleInit();
    await flush();
    assert.equal(timers.timers.length, 0);
  } finally {
    c.onModuleDestroy();
    a.onModuleDestroy();
    timers.restore();
    restore();
  }
});

test('Common actual fake-persistence pass prevents overlap; destroy stops scheduling while in-flight finally remains truthful', async () => {
  const restore = flag('false'),
    timers = fakeTimers();
  let release!: () => void,
    cleanup = 0,
    scans = 0;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const c = common(
    {
      backgroundJob: {
        updateMany: async () => ({ count: 0 }),
        findMany: async ({ take }: { take: number }) => {
          assert.equal(take, 50);
          scans++;
          return [];
        },
      },
      assignment: { findMany: async () => [] },
      exam: { findMany: async () => [] },
      session: { deleteMany: async () => ({ count: 0 }) },
    },
    {
      cleanup: async () => {
        cleanup++;
        await held;
      },
    },
  );
  try {
    c.onModuleInit();
    assert.equal(c.schedulerSnapshot().pollInProgress, true);
    timers.tick();
    timers.tick();
    assert.equal(cleanup, 1);
    assert.equal(scans, 0);
    c.onModuleDestroy();
    assert.equal(c.schedulerSnapshot().lifecycle, 'stopped');
    assert.equal(c.schedulerSnapshot().pollInProgress, true);
    release();
    await flush();
    assert.equal(scans, 1);
    assert.equal(c.schedulerSnapshot().pollInProgress, false);
    timers.tick();
    await flush();
    assert.equal(scans, 1);
  } finally {
    release();
    await flush();
    c.onModuleDestroy();
    timers.restore();
    restore();
  }
});

test('Assessment actual fake-persistence sweep keeps overlap guard and stopped/in-flight states without new drain behavior', async () => {
  const restore = flag('false'),
    timers = fakeTimers();
  let release!: () => void,
    scans = 0;
  const held = new Promise<[]>((done) => {
    release = () => done([]);
  });
  const a = assessment({
    examAttempt: {
      findMany: async ({ take }: { take: number }) => {
        assert.equal(take, 100);
        scans++;
        return held;
      },
    },
  });
  try {
    a.onModuleInit();
    assert.equal(a.schedulerSnapshot().pollInProgress, true);
    timers.tick();
    assert.equal(scans, 1);
    a.onModuleDestroy();
    assert.equal(a.schedulerSnapshot().lifecycle, 'stopped');
    assert.equal(a.schedulerSnapshot().pollInProgress, true);
    release();
    await flush();
    assert.equal(a.schedulerSnapshot().pollInProgress, false);
    timers.tick();
    assert.equal(scans, 1);
  } finally {
    release();
    await flush();
    a.onModuleDestroy();
    timers.restore();
    restore();
  }
});

test('Common existing stale-lock60s, CAS claim, pre-claim attempts/backoff and batch50 remain unchanged', async () => {
  const restore = clock('2028-01-01T12:00:15Z');
  const writes: any[] = [],
    claims: any[] = [];
  const c = common({
    backgroundJob: {
      updateMany: async (args: any) => {
        claims.push(args);
        return { count: 1 };
      },
      findMany: async (args: any) => {
        assert.equal(args.take, 50);
        return [0, 7].map((attempts) => ({ id: `job${attempts}`, kind: 'UNKNOWN_OWN_FAKE', attempts }));
      },
      update: async (args: any) => {
        writes.push(args);
      },
    },
  });
  try {
    await c.run();
    assert.equal(claims[0].where.lockedAt.lt.toISOString(), '2028-01-01T11:59:15.000Z');
    for (const claim of claims.slice(1)) assert.deepEqual(claim.data.attempts, { increment: 1 });
    assert.deepEqual(
      writes.map((write) => [write.data.status, write.data.runAt.toISOString()]),
      [
        ['PENDING', '2028-01-01T12:00:20.000Z'],
        ['FAILED', '2028-01-01T12:10:55.000Z'],
      ],
    );
    assert.equal(c.schedulerSnapshot().pollInProgress, false);
  } finally {
    restore();
  }
});

for (const second of [2, 6])
  test(`Common actual minute housekeeping branch at second${second} uses original <6 rule`, async () => {
    const restore = clock(`2028-01-01T12:00:0${second}Z`);
    let reminderReads = 0,
      sessionDeletes = 0;
    const c = common({
      backgroundJob: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
      assignment: {
        findMany: async () => {
          reminderReads++;
          return [];
        },
      },
      exam: {
        findMany: async () => {
          reminderReads++;
          return [];
        },
      },
      session: {
        deleteMany: async () => {
          sessionDeletes++;
          return { count: 0 };
        },
      },
    });
    try {
      await c.run();
      assert.equal(reminderReads, second < 6 ? 2 : 0);
      assert.equal(sessionDeletes, second < 6 ? 1 : 0);
    } finally {
      restore();
    }
  });

const actor: Actor = {
  id: 'owned-manager',
  name: '平台审计员',
  organizationId: 'owned-org',
  accountMode: 'ORGANIZATION',
  role: 'ADMIN',
  sessionId: 'owned-session',
  csrfToken: 'owned-csrf',
  permissions: ['audit.read', 'org.platform'],
};
function jobsContext(current: Actor | null = actor, captured = actor) {
  const operations: string[] = [];
  const snapshot = {
    automaticEnabled: false,
    lifecycle: 'disabled',
    pollIntervalMs: 5000,
    pollInProgress: false,
    pid: 42,
    host: 'PRIVATE_HOST',
    env: 'PRIVATE_CONFIG',
  };
  const result = {
    items: [],
    total: 0,
    stateCounts: { pending: 0, running: 0, succeeded: 0, failed: 0, other: 0, all: 0 },
    examDeadlineRuns: [],
    serverTime: new Date('2028-01-01T12:00:00Z'),
  };
  const db = {
    $queryRaw: async () => {
      operations.push('query');
      return [result];
    },
  };
  const auth = {
    require: (candidate: Actor, permission: string) => {
      if (!candidate.permissions.includes(permission)) throw new ForbiddenException();
    },
    resolveSessionId: async () => {
      operations.push('fresh');
      return current;
    },
  };
  const commonStatus = {
    schedulerSnapshot() {
      operations.push('common');
      return snapshot;
    },
  };
  const examStatus = {
    schedulerSnapshot() {
      operations.push('exam');
      return { ...snapshot, pollIntervalMs: 10000 };
    },
  };
  const service = new AdminJobsService(
    db as never,
    auth as never,
    commonStatus as never,
    examStatus as never,
  );
  return { service, operations, captured };
}

test('Platform metadata is observed after SQL and before last fresh guard, exposes only safe responding-instance fields', async () => {
  const context = jobsContext();
  const response = await context.service.list(actor, {});
  assert.deepEqual(context.operations, ['query', 'common', 'exam', 'fresh']);
  assert.equal(response.schedulerStatus?.scope, 'responding_api_instance');
  assert.ok(Number.isFinite(Date.parse(response.schedulerStatus!.observedAt)));
  assert.deepEqual(Object.keys(response.schedulerStatus!.common).sort(), [
    'automaticEnabled',
    'lifecycle',
    'pollInProgress',
    'pollIntervalMs',
  ]);
  assert.ok(!/PRIVATE|pid|host|env/.test(JSON.stringify(response)));
});

test('Ordinary scope neither reads nor includes global scheduler metadata', async () => {
  const ordinary = { ...actor, permissions: ['audit.read'] },
    context = jobsContext(ordinary, ordinary);
  const response = await context.service.list(ordinary, {});
  assert.deepEqual(context.operations, ['query', 'fresh']);
  assert.equal('schedulerStatus' in response, false);
});

test('Withdrawn platform/audit and changed final identity or CSRF cannot publish captured metadata', async () => {
  for (const current of [
    null,
    { ...actor, organizationId: 'other' },
    { ...actor, csrfToken: 'other' },
    { ...actor, accountMode: 'PERSONAL' },
    { ...actor, permissions: ['audit.read'] },
    { ...actor, permissions: ['org.platform'] },
  ]) {
    const context = jobsContext(current);
    await assert.rejects(
      context.service.list(actor, {}),
      (error) => error instanceof ForbiddenException || error instanceof UnauthorizedException,
    );
    assert.deepEqual(context.operations, ['query', 'common', 'exam', 'fresh']);
  }
});
