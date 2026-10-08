import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { assertRuntimeDatabaseRole } from '../apps/api/src/common/database-security';
import { UploadSafetyService } from '../apps/api/src/communication/upload-safety.service';
import { LocalPrivateStorage } from '../apps/api/src/communication/storage';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import { hashPassword } from '../apps/api/src/auth/password';
import { plainPdf, objectStreamPdf } from './helpers/pdf-fixtures';

test(
  'upload admission, cleanup and restricted runtime role on a disposable PostgreSQL database',
  { timeout: 60000 },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert(['127.0.0.1', 'localhost'].includes(url.hostname) && /review|test|clean/i.test(url.pathname));
    const base = process.env.TEST_BASE_URL!;
    assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
    const db = new PrismaService();
    const second = new PrismaService();
    const storage = new LocalPrivateStorage();
    const safety = new UploadSafetyService(db, storage);
    const other = new UploadSafetyService(second, storage);
    t.after(async () => {
      await second.$disconnect();
      await db.$disconnect();
    });
    const organization = await db.organization.create({ data: { name: `上传安全回归 ${randomUUID()}` } });
    const users = [];
    for (let i = 0; i < 3; i++)
      users.push(
        await db.user.create({
          data: {
            organizationId: organization.id,
            username: `uploadfix_${randomUUID().slice(0, 12)}`,
            name: '上传安全回归',
            passwordHash: hashPassword(process.env.DEV_SEED_PASSWORD!),
            roles: { create: { roleId: 'STUDENT' } },
          },
        }),
      );
    const actor = (index: number): Actor => ({
      id: users[index].id,
      organizationId: organization.id,
      role: 'STUDENT',
      name: '上传安全回归',
      permissions: ['file.upload'],
    });
    const status = (expected: number) => (error: unknown) =>
      error instanceof HttpException && error.getStatus() === expected;
    function configure(subtest: { after: (callback: () => void) => void }, values: Record<string, string>) {
      const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
      Object.assign(process.env, values);
      subtest.after(() => {
        for (const [key, value] of Object.entries(before)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      });
    }
    await t.test(
      'two database clients atomically share cumulative capacity and concurrency',
      async (subtest) => {
        configure(subtest, {
          MAX_USER_UPLOAD_MB: '1',
          MAX_ORG_UPLOAD_MB: '10240',
          MAX_UPLOADS_PER_USER: '2',
        });
        const outcomes = await Promise.allSettled([
          safety.reserve(actor(0), 600 * 1024),
          other.reserve(actor(0), 600 * 1024),
        ]);
        assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
        const denied = outcomes.find((result) => result.status === 'rejected') as PromiseRejectedResult;
        assert(status(413)(denied.reason));
        const granted = outcomes.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<
          Awaited<ReturnType<typeof safety.reserve>>
        >;
        await safety.release(granted.value.id);
        configure(subtest, { MAX_UPLOADS_PER_USER: '1' });
        const one = await safety.reserve(actor(0), 16);
        await assert.rejects(other.reserve(actor(0), 16), status(429));
        await safety.release(one.id);
      },
    );
    await t.test('organization capacity, total slots and rate limits cover all owners', async (subtest) => {
      configure(subtest, { MAX_ORG_UPLOAD_MB: '1', MAX_UPLOADS_TOTAL: '8' });
      const one = await safety.reserve(actor(0), 600 * 1024);
      await assert.rejects(other.reserve(actor(1), 600 * 1024), status(413));
      await safety.release(one.id);
      configure(subtest, { MAX_UPLOADS_TOTAL: '1' });
      const slot = await safety.reserve(actor(0), 16);
      await assert.rejects(other.reserve(actor(1), 16), status(429));
      await safety.release(slot.id);
      configure(subtest, { UPLOADS_PER_MINUTE: '1' });
      const rate = await safety.reserve(actor(2), 16);
      await safety.release(rate.id);
      await assert.rejects(other.reserve(actor(2), 16), status(429));
    });
    await t.test('failed and abandoned writes release capacity only after file removal', async () => {
      const lease = await safety.reserve(actor(1), 64);
      await storage.put(lease.storageKey, Buffer.from('abandoned fixture'));
      await db.uploadOperation.update({
        where: { id: lease.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await safety.cleanup();
      assert.equal(
        (await db.uploadOperation.findUniqueOrThrow({ where: { id: lease.id } })).status,
        'failed',
      );
      assert.equal(existsSync(resolve(process.env.UPLOAD_DIR!, lease.storageKey)), false);
      await assert.rejects(
        safety.finish(actor(1), lease, {
          organizationId: organization.id,
          ownerId: users[1].id,
          storageKey: lease.storageKey,
          originalName: 'fixture.txt',
          mime: 'text/plain',
          size: 1,
          sha256: createHash('sha256').update('x').digest('hex'),
        }),
        status(409),
      );
      // Model a delayed writer that outlives cancellation and crashes before catch.
      await storage.put(lease.storageKey, Buffer.from('late fixture'));
      await safety.cleanup();
      assert.equal(existsSync(resolve(process.env.UPLOAD_DIR!, lease.storageKey)), false);
    });
    await t.test(
      'release preserves a committed attachment when the commit acknowledgement is lost',
      async () => {
        const lease = await safety.reserve(actor(1), 64);
        await storage.put(lease.storageKey, Buffer.from('committed fixture'));
        const file = await safety.finish(actor(1), lease, {
          organizationId: organization.id,
          ownerId: users[1].id,
          storageKey: lease.storageKey,
          originalName: 'committed.txt',
          mime: 'text/plain',
          size: 17,
          sha256: createHash('sha256').update('committed fixture').digest('hex'),
        });
        await safety.release(lease.id);
        assert(existsSync(resolve(process.env.UPLOAD_DIR!, lease.storageKey)));
        assert(await db.attachment.findUnique({ where: { id: file.id } }));
        await safety.remove(actor(1), file.id);
      },
    );
    await t.test(
      'failed physical deletions remain charged and retries do not block later files',
      async (subtest) => {
        const brokenStorage = new LocalPrivateStorage();
        let failingKey = '';
        const physicalDelete = brokenStorage.delete.bind(brokenStorage);
        brokenStorage.delete = async (key) => {
          if (key === failingKey) throw new Error('simulated disk error');
          await physicalDelete(key);
        };
        const failing = new UploadSafetyService(db, brokenStorage);
        const lease = await safety.reserve(actor(0), 700 * 1024);
        failingKey = lease.storageKey;
        await storage.put(lease.storageKey, Buffer.from('deletion fixture'));
        const file = await safety.finish(actor(0), lease, {
          organizationId: organization.id,
          ownerId: users[0].id,
          storageKey: lease.storageKey,
          originalName: 'deletion.txt',
          mime: 'text/plain',
          size: 700 * 1024,
          sha256: createHash('sha256').update('deletion fixture').digest('hex'),
        });
        await failing.remove(actor(0), file.id);
        assert.equal(await db.attachment.findUnique({ where: { id: file.id } }), null);
        assert(await db.pendingFileDeletion.findUnique({ where: { storageKey: lease.storageKey } }));
        configure(subtest, { MAX_USER_UPLOAD_MB: '1' });
        await assert.rejects(safety.reserve(actor(0), 600 * 1024), status(413));
        const bad = await safety.reserve(actor(1), 16);
        const good = await safety.reserve(actor(1), 16);
        await storage.put(bad.storageKey, Buffer.from('pending fixture'));
        await storage.put(good.storageKey, Buffer.from('pending fixture'));
        await db.uploadOperation.updateMany({
          where: { id: { in: [bad.id, good.id] } },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        failingKey = bad.storageKey;
        await failing.cleanup();
        assert.equal(
          (await db.uploadOperation.findUniqueOrThrow({ where: { id: good.id } })).status,
          'failed',
        );
        assert.equal(
          (await db.uploadOperation.findUniqueOrThrow({ where: { id: bad.id } })).status,
          'pending',
        );
        failingKey = '';
        await db.pendingFileDeletion.updateMany({ data: { retryAt: new Date(Date.now() - 1000) } });
        await safety.cleanup();
        assert.equal(
          await db.pendingFileDeletion.findUnique({ where: { storageKey: lease.storageKey } }),
          null,
        );
        assert.equal(existsSync(resolve(process.env.UPLOAD_DIR!, lease.storageKey)), false);
      },
    );

    let cookie = '',
      csrf = '';
    async function call(path: string, method = 'GET', body?: unknown) {
      const form = body instanceof FormData;
      return fetch(base + '/api' + path, {
        method,
        headers: {
          Origin: process.env.APP_ORIGIN!,
          ...(cookie ? { Cookie: cookie, 'x-csrf-token': csrf } : {}),
          ...(!form && body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
      });
    }
    const login = await call('/auth/login', 'POST', {
      username: users[1].username,
      password: process.env.DEV_SEED_PASSWORD,
    });
    assert.equal(login.status, 201, await login.clone().text());
    cookie = login.headers.getSetCookie()[0].split(';')[0];
    csrf = (await login.json()).csrfToken;
    async function upload(name: string, bytes: Buffer) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)]), name);
      return call('/attachments', 'POST', form);
    }
    await t.test('real upload rejects encoded and compressed PDF actions, accepts safe PDF', async () => {
      for (const bytes of [
        plainPdf(['<< /S /Java#53cript /J#53 (void 0;) >>']),
        await objectStreamPdf(true),
      ]) {
        const response = await upload('inert-action.pdf', bytes);
        assert.equal(response.status, 415, await response.text());
      }
      const response = await upload('static.pdf', plainPdf());
      assert.equal(response.status, 201, await response.clone().text());
      const file = await response.json();
      const wrongOwner = await assert.rejects(safety.remove(actor(0), file.id), status(403));
      assert.equal(wrongOwner, undefined);
      assert.equal((await call(`/attachments/${file.id}`, 'DELETE')).status, 200);
    });
    await t.test(
      'reference claims retain active files; unused expiry and owner deletion are safe',
      async () => {
        const response = await upload('fixture.txt', Buffer.from('retained fixture'));
        assert.equal(response.status, 201, await response.clone().text());
        const file = await response.json();
        const conversation = await db.conversation.create({
          data: { organizationId: organization.id, kind: 'DIRECT', title: 'fixture' },
        });
        const message = await db.message.create({
          data: {
            organizationId: organization.id,
            conversationId: conversation.id,
            senderId: users[1].id,
            body: 'fixture',
            attachmentIds: [file.id],
            clientId: randomUUID(),
          },
        });
        await db.attachment.update({
          where: { id: file.id },
          data: { createdAt: new Date(Date.now() - 48 * 3600000) },
        });
        assert((await db.attachment.findUniqueOrThrow({ where: { id: file.id } })).claimedAt);
        await safety.cleanup();
        assert(await db.attachment.findUnique({ where: { id: file.id } }));
        assert.equal((await call(`/attachments/${file.id}`, 'DELETE')).status, 409);
        await db.message.delete({ where: { id: message.id } });
        await db.conversation.delete({ where: { id: conversation.id } });
        assert.equal((await call(`/attachments/${file.id}`, 'DELETE')).status, 200);
        const abandonedResponse = await upload('unused.txt', Buffer.from('unused fixture'));
        assert.equal(abandonedResponse.status, 201, await abandonedResponse.clone().text());
        const abandoned = await abandonedResponse.json();
        await db.attachment.update({
          where: { id: abandoned.id },
          data: { createdAt: new Date(Date.now() - 48 * 3600000) },
        });
        await safety.cleanup();
        assert.equal(await db.attachment.findUnique({ where: { id: abandoned.id } }), null);
      },
    );
    await t.test(
      'cleanup cannot remove a file being claimed by a concurrent business transaction',
      async () => {
        const response = await upload('concurrent.txt', Buffer.from('concurrent fixture'));
        assert.equal(response.status, 201, await response.clone().text());
        const file = await response.json();
        await db.attachment.update({
          where: { id: file.id },
          data: { createdAt: new Date(Date.now() - 48 * 3600000) },
        });
        const conversation = await db.conversation.create({
          data: { organizationId: organization.id, kind: 'DIRECT', title: 'concurrent fixture' },
        });
        let claimed!: () => void;
        let release!: () => void;
        const entered = new Promise<void>((resolve) => {
          claimed = resolve;
        });
        const hold = new Promise<void>((resolve) => {
          release = resolve;
        });
        const transaction = db.$transaction(async (tx) => {
          const message = await tx.message.create({
            data: {
              organizationId: organization.id,
              conversationId: conversation.id,
              senderId: users[1].id,
              body: 'concurrent fixture',
              attachmentIds: [file.id],
              clientId: randomUUID(),
            },
          });
          claimed();
          await hold;
          return message;
        });
        await Promise.race([entered, transaction]);
        try {
          await other.cleanup();
          assert(await second.attachment.findUnique({ where: { id: file.id } }));
        } finally {
          release();
        }
        const message = await transaction;
        assert((await db.attachment.findUniqueOrThrow({ where: { id: file.id } })).claimedAt);
        await db.message.delete({ where: { id: message.id } });
        await db.conversation.delete({ where: { id: conversation.id } });
        assert.equal((await call(`/attachments/${file.id}`, 'DELETE')).status, 200);
      },
    );
    await t.test(
      'runtime account can use business data but cannot inherit administrative or DDL access',
      async () => {
        const { provisionRuntimeRole } = await import('../scripts/provision-runtime-db.mjs');
        const name = `lms_security_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const password = randomBytes(24).toString('base64url');
        await provisionRuntimeRole(db, {
          DATABASE_URL: url.href,
          APP_DATABASE_USER: name,
          APP_DATABASE_PASSWORD: password,
        });
        const runtimeUrl = new URL(url);
        runtimeUrl.username = name;
        runtimeUrl.password = password;
        const runtime = new PrismaService({ datasourceUrl: runtimeUrl.href });
        try {
          await assertRuntimeDatabaseRole(runtime);
          await db.$executeRawUnsafe(`ALTER ROLE "${name}" REPLICATION`);
          await assert.rejects(assertRuntimeDatabaseRole(runtime), /separate runtime database role/);
          await db.$executeRawUnsafe(`ALTER ROLE "${name}" NOREPLICATION`);
          await assert.rejects(assertRuntimeDatabaseRole(db), /separate runtime database role/);
          const notification = await runtime.notification.create({
            data: {
              organizationId: organization.id,
              userId: users[1].id,
              type: 'FIXTURE',
              title: 'fixture',
              body: 'fixture',
              link: '',
              eventKey: randomUUID(),
            },
          });
          await runtime.notification.delete({ where: { id: notification.id } });
          await assert.rejects(
            runtime.$executeRawUnsafe('CREATE TABLE public.security_fixture_forbidden(id integer)'),
          );
          await assert.rejects(runtime.$queryRawUnsafe('SELECT * FROM "_prisma_migrations"'));
        } finally {
          await runtime.$disconnect();
          await db.$executeRawUnsafe(`DROP OWNED BY "${name}"`);
          await db.$executeRawUnsafe(`DROP ROLE "${name}"`);
        }
      },
    );
  },
);
