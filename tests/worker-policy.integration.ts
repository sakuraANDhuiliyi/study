import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPasswordAsync } from '../apps/api/src/auth/password';
import { permissionDefinitions, roleDefinitions } from '../apps/api/src/auth/permissions';

// Only the random database created by this suite is migrated, seeded or dropped. The
// explicitly selected local review database supplies CREATEDB access, never fixture data.
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const endpoint = '/admin/jobs';
type Client = { cookie: string; csrf: string; user: any };
async function freePort() {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test(
  'Worker startup policy: isolated production HTTP, responding-instance metadata and local notifications/deadlines',
  { timeout: 180_000 },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, 'production', '集成测试禁止在production模式运行');
    const configured =
      process.env.WORKER_POLICY_TEST_ADMIN_DATABASE_URL ||
      process.env.ACADEMICS_TEST_ADMIN_DATABASE_URL ||
      (process.env.DOTENV_CONFIG_PATH && process.env.DATABASE_URL);
    assert.ok(
      configured,
      '需要显式本机review/test数据库：WORKER_POLICY_TEST_ADMIN_DATABASE_URL、ACADEMICS_TEST_ADMIN_DATABASE_URL或DOTENV_CONFIG_PATH',
    );
    let adminUrl: URL;
    try {
      adminUrl = new URL(configured);
    } catch {
      throw new Error('测试管理员数据库URL格式无效');
    }
    assert.ok(['postgres:', 'postgresql:'].includes(adminUrl.protocol), '只允许PostgreSQL连接');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname), '只连接本机PostgreSQL');
    assert.match(
      adminUrl.pathname,
      /review|test|clean/i,
      '管理员连接也必须显式选择本机review/test/clean数据库',
    );
    const suffix = randomBytes(8).toString('hex');
    const databaseName = `worker_policy_it_${suffix}`;
    assert.match(databaseName, /^worker_policy_it_[a-f0-9]{16}$/);
    const isolatedUrl = new URL(adminUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    const apiUrl = new URL(isolatedUrl);
    apiUrl.searchParams.set('connection_limit', '3');
    const password = `Fixture-${randomBytes(20).toString('hex')}!`;
    const safe = (value: string) =>
      [password, configured, isolatedUrl.href, apiUrl.href, decodeURIComponent(adminUrl.password)]
        .filter(Boolean)
        .reduce((text, secret) => text.split(secret).join('[redacted]'), value)
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
        .replace(/https?:\/\/[^\s/]+:[^\s@]+@[^\s"']+/gi, '[credential URL redacted]')
        .replace(
          /("(?:csrf[-_]?token|session[-_]?token|token|password|authorization|cookie|set-cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
          '$1"[redacted]"',
        )
        .replace(/lms_session=[^;\s"]+/gi, 'lms_session=[redacted]');
    const port = await freePort();
    const directory = mkdtempSync(join(tmpdir(), 'worker-policy-http-'));
    const configPath = join(directory, 'config.yaml');
    const origin = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      DATABASE_URL: apiUrl.href,
      NODE_ENV: 'test',
      PORT: String(port),
      BIND_HOST: '127.0.0.1',
      APP_ORIGIN: origin,
      COOKIE_SECURE: 'false',
      DISABLE_JOBS: 'true',
      AI_CONFIG_PATH: configPath,
      ALGORITHM_JUDGE_ENABLED: 'false',
      ALGORITHM_JUDGE_URL: '',
      ALGORITHM_JUDGE_TOKEN: '',
      PROGRAMMING_PREVIEW_ENABLED: 'false',
      UPLOAD_DIR: join(directory, 'uploads'),
    };
    const owner = new PrismaClient({ datasourceUrl: adminUrl.href });
    let db: PrismaClient | undefined;
    const children: ChildProcess[] = [];
    let migration: ChildProcess | undefined;
    let created = false;
    let logs = '';
    async function call(
      client: Client | null,
      path: string,
      method = 'GET',
      body?: unknown,
      expected: number | number[] = method === 'POST' ? 201 : 200,
      csrf = true,
      requestOrigin = origin,
    ) {
      const response = await fetch(`${requestOrigin}/api${path}`, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: {
          origin: requestOrigin,
          'content-type': 'application/json',
          ...(client ? { cookie: client.cookie, ...(csrf ? { 'x-csrf-token': client.csrf } : {}) } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      assert.ok(
        (Array.isArray(expected) ? expected : [expected]).includes(response.status),
        `${method} ${path}: ${response.status}; ${safe(text).slice(0, 1500)}`,
      );
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
        cookie: response.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; '),
      };
    }
    async function login(username: string, target = origin): Promise<Client> {
      const response = await call(null, '/auth/login', 'POST', { username, password }, 201, true, target);
      return { cookie: response.cookie, csrf: response.body.csrfToken, user: response.body.user };
    }
    async function stop(child: ChildProcess | undefined) {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await Promise.race([exited, wait(3000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await Promise.race([exited, wait(1000)]);
      }
    }
    async function deploy() {
      migration = spawn(
        process.execPath,
        [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma')],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      for (const stream of [migration.stdout, migration.stderr])
        stream?.on('data', (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-20000);
        });
      const timeout = setTimeout(() => migration?.kill('SIGKILL'), 60_000);
      try {
        const [code] = await once(migration, 'exit');
        assert.equal(code, 0, `隔离测试库迁移失败：${safe(output)}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    try {
      writeFileSync(
        configPath,
        'judge0: {enabled: false}\nai: {enabled: false}\nwebSearch: {enabled: false}\n',
        {
          mode: 0o600,
        },
      );
      try {
        await owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
        created = true;
      } catch {
        throw new Error('无法创建随机测试库；请检查本机PostgreSQL及CREATEDB权限。未修改现有数据库。');
      }
      await deploy();
      db = new PrismaClient({ datasourceUrl: isolatedUrl.href });
      await db.permission.createMany({
        data: permissionDefinitions.map(([id, name, sensitive]) => ({ id, name, sensitive })),
        skipDuplicates: true,
      });
      for (const [id, role] of Object.entries(roleDefinitions)) {
        await db.role.create({ data: { id, name: role.name, description: role.description } });
        await db.rolePermission.createMany({
          data: role.permissions.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
      await db.role.create({
        data: {
          id: 'WORKER_PLATFORM',
          name: 'Owned policy platform reader',
          description: 'Owned random DB only',
        },
      });
      await db.rolePermission.createMany({
        data: ['audit.read', 'org.platform'].map((permissionId) => ({
          roleId: 'WORKER_PLATFORM',
          permissionId,
        })),
      });
      const organization = await db.organization.create({ data: { name: '学习概览验收机构甲' } });
      const hash = await hashPasswordAsync(password);
      const makeUser = async (tag: string, roleId = 'STUDENT', organizationId = organization.id) =>
        db!.user.create({
          data: {
            username: `actions_${suffix}_${tag}`,
            name: tag,
            organizationId,
            passwordHash: hash,
            roles: { create: { roleId } },
          },
        });
      const [studentUser, teacherUser, adminUser, platformUser] = await Promise.all([
        makeUser('student'),
        makeUser('teacher', 'TEACHER'),
        makeUser('admin', 'ADMIN'),
        makeUser('platform', 'WORKER_PLATFORM'),
      ]);
      for (const permissionId of ['audit.read', 'org.platform'])
        if ((await db.permission.findUniqueOrThrow({ where: { id: permissionId } })).sensitive) {
          await db.sensitiveGrant.create({
            data: {
              organizationId: organization.id,
              userId: platformUser.id,
              permissionId,
              grantedBy: adminUser.id,
              reason: 'Owned random DB metadata fixture only',
              expiresAt: new Date(Date.now() + 3600_000),
            },
          });
        }
      const eventKey = `worker-policy-${suffix}`;
      const payload = {
        userIds: [studentUser.id],
        type: 'OWNED_POLICY',
        title: 'Owned local policy notification',
        body: 'Owned local data only',
        link: '/dashboard',
        eventKey,
      };
      // Valid local notification exists BEFORE startup, so immediate Common polling
      // is distinguishable without depending on wall-clock minute seconds0..5.
      const notify = await db.backgroundJob.create({
        data: {
          organizationId: organization.id,
          kind: 'NOTIFICATION',
          eventKey,
          payload,
          runAt: new Date(Date.now() - 1000),
        },
      });
      const stale = await db.backgroundJob.create({
        data: {
          organizationId: organization.id,
          kind: 'NOTIFICATION',
          eventKey: `${eventKey}-stale`,
          payload: { ...payload, eventKey: `${eventKey}-stale` },
          status: 'RUNNING',
          lockedAt: new Date(Date.now() - 120_000),
          runAt: new Date(Date.now() + 86400_000),
        },
      });
      let enabledPort = await freePort();
      while (enabledPort === port) enabledPort = await freePort();
      const enabledOrigin = `http://127.0.0.1:${enabledPort}`;
      async function start(target: string, disabled: boolean, uploads: string) {
        const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
          env: {
            ...env,
            PORT: new URL(target).port,
            APP_ORIGIN: target,
            DISABLE_JOBS: String(disabled),
            UPLOAD_DIR: uploads,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.push(child);
        for (const stream of [child.stdout, child.stderr])
          stream?.on('data', (chunk: Buffer) => {
            logs = (logs + chunk.toString()).slice(-80000);
          });
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error(`Owned API startup failed: ${safe(logs)}`);
          try {
            if ((await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) {
              ready = true;
              break;
            }
          } catch {
            /* Only this child is observed. */
          }
          await wait(100);
        }
        assert.ok(ready, 'Build API before running this owned suite');
      }
      await start(origin, true, join(directory, 'disabled-owned-uploads'));
      const [student, teacher, ordinary, platform] = await Promise.all(
        [studentUser, teacherUser, adminUser, platformUser].map((user) => login(user.username)),
      );
      assert.ok(platform.user.permissions.includes('org.platform'));
      const jobs = async (client = platform, target = origin) =>
        (await call(client, endpoint, 'GET', undefined, 200, true, target)).body;
      function policy(body: any, enabled: boolean) {
        const status = body.schedulerStatus;
        assert.equal(status.scope, 'responding_api_instance');
        assert.deepEqual(Object.keys(status).sort(), ['common', 'examDeadline', 'observedAt', 'scope']);
        assert.ok(
          Number.isFinite(Date.parse(status.observedAt)) && Number.isFinite(Date.parse(body.serverTime)),
        );
        for (const [key, interval] of [
          ['common', 5000],
          ['examDeadline', 10000],
        ] as const) {
          assert.deepEqual(Object.keys(status[key]).sort(), [
            'automaticEnabled',
            'lifecycle',
            'pollInProgress',
            'pollIntervalMs',
          ]);
          assert.equal(status[key].automaticEnabled, enabled);
          assert.equal(status[key].lifecycle, enabled ? 'scheduled' : 'disabled');
          assert.equal(status[key].pollIntervalMs, interval);
          assert.equal(typeof status[key].pollInProgress, 'boolean');
        }
        assert.ok(!/hostname|configPath|PRIVATE|processId|pid|databaseUrl/i.test(JSON.stringify(status)));
      }
      const course = await db.course.create({
        data: {
          organizationId: organization.id,
          teacherId: teacherUser.id,
          title: 'Owned worker deadline course',
          status: 'PUBLISHED',
        },
      });
      await db.enrollment.create({ data: { courseId: course.id, userId: studentUser.id } });
      await db.teachingAssignment.create({ data: { courseId: course.id, userId: teacherUser.id } });
      const realAttempt = async (tag: string) => {
        const now = Date.now();
        const question = (
          await call(teacher, '/questions', 'POST', {
            courseId: course.id,
            type: 'single',
            stem: `${tag}-${suffix}`,
            options: [
              { id: 'A', text: 'Correct' },
              { id: 'B', text: 'Wrong' },
            ],
            answer: 'A',
            explanation: 'PRIVATE_CONFIDENTIAL_EXPLANATION',
            scoreCents: 100,
            practiceEnabled: false,
            scope: 'private',
          })
        ).body;
        const exam = (
          await call(teacher, '/exams', 'POST', {
            courseId: course.id,
            title: tag,
            startsAt: new Date(now - 60000).toISOString(),
            endsAt: new Date(now + 4 * 3600_000).toISOString(),
            entryClosesAt: new Date(now + 2 * 3600_000).toISOString(),
            durationMinutes: 60,
            questionVersionIds: [question.versions[0].id],
            audienceIds: [studentUser.id],
            maxAttempts: 1,
            passCents: 60,
          })
        ).body;
        await call(teacher, `/exams/${exam.id}/publish`, 'POST', {});
        assert.ok(await db!.examPaperItem.count({ where: { snapshot: { examId: exam.id } } }));
        const attempt = (await call(student, `/exams/${exam.id}/start`, 'POST', {})).body;
        await db!.examAttempt.update({
          where: { id: attempt.id },
          data: { deadlineAt: new Date(Date.now() - 1000) },
        });
        return attempt;
      };
      const manual = await realAttempt('Owned manual attempt'),
        automatic = await realAttempt('Owned automatic attempt');

      await t.test(
        'Exacttrue production startup registers neither scheduler and leaves owned ready/stale/deadline records unchanged across intervals',
        async () => {
          policy(await jobs(), false);
          assert.equal('schedulerStatus' in (await jobs(ordinary)), false);
          const before = await db!.assessmentJobRun.count();
          await wait(11000); // crosses Common5s and Assessment10s after due fixtures exist
          for (const row of [notify, stale]) {
            const actual = await db!.backgroundJob.findUniqueOrThrow({ where: { id: row.id } });
            assert.equal(actual.status, row.status);
            assert.equal(actual.attempts, row.attempts);
            assert.equal(actual.lockedAt?.toISOString(), row.lockedAt?.toISOString());
          }
          assert.equal(await db!.notification.count({ where: { userId: studentUser.id, eventKey } }), 0);
          for (const attempt of [manual, automatic])
            assert.equal(
              (await db!.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
              'in_progress',
            );
          assert.equal(await db!.assessmentJobRun.count(), before);
          policy(await jobs(), false);
        },
      );

      await t.test(
        'Disabled automatic policy does not block a real student manual deadline read or auth expiry',
        async () => {
          // Only now exercise manual finalization, after disabled automatic evidence.
          assert.equal((await call(student, `/attempts/${manual.id}`)).body.status, 'timed_out');
          assert.equal(
            (await db!.examAttempt.findUniqueOrThrow({ where: { id: automatic.id } })).status,
            'in_progress',
          );
          const expiring = await login(studentUser.username);
          await db!.session.updateMany({
            where: { userId: studentUser.id },
            data: { expiresAt: new Date(Date.now() - 1) },
          });
          await call(expiring, endpoint, 'GET', undefined, 401);
        },
      );

      await t.test(
        'False own instance preserves immediate local delivery, stale recovery and valid automatic exam finalization; disabled responder remains local',
        async () => {
          await start(enabledOrigin, false, join(directory, 'enabled-owned-uploads'));
          let finished = false;
          for (let probe = 0; probe < 150; probe++) {
            const [job, attempt] = await Promise.all([
              db!.backgroundJob.findUniqueOrThrow({ where: { id: notify.id } }),
              db!.examAttempt.findUniqueOrThrow({ where: { id: automatic.id } }),
            ]);
            if (job.status === 'SUCCEEDED' && attempt.status === 'timed_out') {
              finished = true;
              break;
            }
            await wait(100);
          }
          assert.ok(
            finished,
            'Actual Common and Assessment startup must perform their owned work without polling attempt GET',
          );
          const delivered = await db!.notification.findMany({ where: { userId: studentUser.id, eventKey } });
          assert.equal(
            delivered.length,
            1,
            'Exact owned event/user discriminator; real publish may queue additional owned notifications',
          );
          assert.equal((await db!.backgroundJob.findUniqueOrThrow({ where: { id: notify.id } })).attempts, 1);
          assert.equal(
            (await db!.backgroundJob.findUniqueOrThrow({ where: { id: stale.id } })).status,
            'PENDING',
          );
          assert.ok(
            await db!.assessmentJobRun.count({
              where: { type: 'exam_deadline', status: 'completed', processed: { gte: 1 } },
            }),
          );
          policy(await jobs(platform, enabledOrigin), true);
          // Both endpoints see the same now-processed DB rows, but automatic policy is
          // local to the responding API, not a global worker-disable/health claim.
          const disabled = await jobs();
          policy(disabled, false);
          assert.ok(disabled.items.some((item: any) => item.id === notify.id && item.status === 'SUCCEEDED'));
          await db!.backgroundJob.update({
            where: { id: notify.id },
            data: { status: 'PENDING', runAt: new Date(), lockedAt: null },
          });
          let deduped = false;
          for (let probe = 0; probe < 80; probe++) {
            if (
              (await db!.backgroundJob.findUniqueOrThrow({ where: { id: notify.id } })).status === 'SUCCEEDED'
            ) {
              deduped = true;
              break;
            }
            await wait(100);
          }
          assert.ok(deduped);
          assert.equal(await db!.notification.count({ where: { userId: studentUser.id, eventKey } }), 1);
        },
      );

      async function blockedRead(
        expected: number,
        change: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>,
      ) {
        let pending: Promise<{ value?: Awaited<ReturnType<typeof call>>; error?: unknown }> | undefined;
        try {
          await db!.$transaction(
            async (tx) => {
              await tx.$executeRawUnsafe('LOCK TABLE "BackgroundJob" IN ACCESS EXCLUSIVE MODE');
              const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
              pending = call(platform, endpoint, 'GET', undefined, expected).then(
                (value) => ({ value }),
                (error) => ({ error }),
              );
              let observed = false;
              for (let probe = 0; probe < 200; probe++) {
                const [state] = await owner.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity s WHERE s.datname = ${databaseName}
                AND ${pid} = ANY(pg_blocking_pids(s.pid)) AND s.query LIKE '%admin-jobs-list%'
                AND s.query LIKE '%base AS MATERIALIZED%'
            ) AS blocked`;
                if (state.blocked) {
                  observed = true;
                  break;
                }
                await wait(20);
              }
              assert.ok(observed, 'Observe exact randomDB query/blocker PID; no sleep-assumed stage');
              await change(tx);
            },
            { timeout: 12000 },
          );
          assert.ok(pending);
          const result = await pending;
          if (result.error) throw result.error;
          assert.ok(result.value);
          return result.value;
        } finally {
          if (pending) await pending;
        }
      }

      await t.test(
        'Metadata remains under final scope/audit/session fence after actual private SQL waits',
        async () => {
          for (const permissionId of ['org.platform', 'audit.read']) {
            let mutated = false;
            let originalFailure: unknown;
            try {
              const response = await blockedRead(403, async (tx) => {
                await tx.rolePermission.delete({
                  where: { roleId_permissionId: { roleId: 'WORKER_PLATFORM', permissionId } },
                });
                mutated = true;
              });
              for (const field of ['items', 'stateCounts', 'schedulerStatus'])
                assert.equal(field in response.body, false);
            } catch (error) {
              originalFailure = error;
              throw error;
            } finally {
              try {
                if (mutated)
                  await db!.rolePermission.upsert({
                    where: { roleId_permissionId: { roleId: 'WORKER_PLATFORM', permissionId } },
                    create: { roleId: 'WORKER_PLATFORM', permissionId },
                    update: {},
                  });
              } catch (restoreFailure) {
                if (originalFailure)
                  throw new AggregateError(
                    [originalFailure, restoreFailure],
                    'Worker metadata validation and owned fixture restore failed',
                  );
                throw restoreFailure;
              }
            }
          }
          const response = await blockedRead(401, (tx) =>
            tx.session.deleteMany({ where: { userId: platformUser.id } }),
          );
          assert.equal('schedulerStatus' in response.body, false);
        },
      );

      await t.test(
        'Three-connection responding instances handle six concurrent metadata reads without held transaction/nested connection',
        async () => {
          const freshPlatform = await login(platformUser.username);
          const responses = await Promise.all(
            Array.from({ length: 6 }, (_, index) => jobs(freshPlatform, index % 2 ? enabledOrigin : origin)),
          );
          responses.forEach((body, index) => policy(body, !!(index % 2)));
        },
      );
      assert.ok(!logs.includes(password), 'No test credential may be printed by the child');
    } catch (error) {
      throw new Error(safe(error instanceof Error ? error.message : 'Owned worker policy validation failed'));
    } finally {
      let failed = false;
      const stopped = await Promise.allSettled([...children.map((child) => stop(child)), stop(migration)]);
      if (stopped.some((result) => result.status === 'rejected')) failed = true;
      try {
        try {
          await db?.$disconnect();
        } catch {
          failed = true;
        }
        if (created) {
          assert.match(databaseName, /^worker_policy_it_[a-f0-9]{16}$/);
          try {
            await owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
          } catch {
            failed = true;
          }
        }
      } finally {
        try {
          await owner.$disconnect();
        } catch {
          failed = true;
        }
        rmSync(directory, { recursive: true, force: true });
      }
      if (failed)
        throw new Error('Owned worker resources cleanup failed; inspect worker_policy_it_ random DB only');
    }
  },
);
