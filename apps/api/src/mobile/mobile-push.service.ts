import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type MobilePushDelivery, type MobilePushDevice } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import type { Actor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import {
  MobilePushGateway,
  mobilePushConfig,
  openPushToken,
  pushTokenHash,
  sealPushToken,
} from './mobile-push.gateway';
@Injectable()
export class MobilePushService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private deviceCursor: string | undefined;
  constructor(
    private db: PrismaService,
    private gateway: MobilePushGateway,
  ) {}
  onModuleInit() {
    if (process.env.DISABLE_JOBS === 'true' || !this.gateway.status().available) return;
    this.timer = setInterval(() => void this.run().catch(() => undefined), 5000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async owner(tx: Prisma.TransactionClient, a: Actor, write = false) {
    if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT' || !a.sessionId)
      throw new ForbiddenException('远程学习通知仅供学生手机会话启用');
    if (write) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${a.id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${a.id} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id"=${a.sessionId} FOR SHARE`;
    const auth = new AuthService(tx as PrismaService),
      current = await auth.resolveMobileSessionId(a.sessionId);
    if (
      !current ||
      current.id !== a.id ||
      current.organizationId !== a.organizationId ||
      current.role !== a.role
    )
      throw new UnauthorizedException('手机身份已变化，请重新登录');
    auth.require(current, 'learning.use');
    return current;
  }
  async status(a: Actor) {
    return this.db.$transaction(async (tx) => {
      const current = await this.owner(tx, a);
      const binding = await tx.mobilePushDevice.findFirst({
        where: {
          sessionId: a.sessionId,
          userId: current.id,
          organizationId: current.organizationId,
          active: true,
        },
        select: { id: true },
      });
      return { ...this.gateway.status(), enabled: !!binding, bindingId: binding?.id || null };
    });
  }
  async bind(a: Actor, input: { token: string; projectId: string }) {
    const config = mobilePushConfig();
    if (!config.available || input.projectId !== config.projectId)
      throw new ServiceUnavailableException('远程通知配置尚未完成或项目不匹配');
    const hash = pushTokenHash(input.token);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'mobile-push:' + hash},0))`;
      const current = await this.owner(tx, a, true);
      const existing = await tx.mobilePushDevice.findUnique({ where: { sessionId: a.sessionId! } });
      if (
        existing?.active &&
        existing.tokenHash === hash &&
        existing.userId === current.id &&
        existing.organizationId === current.organizationId &&
        existing.role === current.role &&
        existing.accountMode === current.accountMode
      )
        return { enabled: true, bindingId: existing.id };
      if (
        (await tx.mobilePushDevice.count({
          where: {
            userId: current.id,
            organizationId: current.organizationId,
            active: true,
            sessionId: { not: a.sessionId! },
          },
        })) >= 5
      )
        throw new ForbiddenException('最多启用5个手机会话，请先关闭旧设备通知');
      // Rebinding creates a new opaque namespace. Already queued messages for a previous identity cannot target it.
      await tx.mobilePushDevice.deleteMany({
        where: { OR: [{ tokenHash: hash }, { sessionId: a.sessionId! }] },
      });
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const row = await tx.mobilePushDevice.create({
        data: {
          organizationId: current.organizationId,
          userId: current.id,
          sessionId: a.sessionId!,
          role: current.role,
          accountMode: current.accountMode!,
          tokenHash: hash,
          tokenCiphertext: sealPushToken(input.token, config.key),
          createdAt: clock.now,
        },
        select: { id: true },
      });
      return { enabled: true, bindingId: row.id };
    });
  }
  async remove(a: Actor) {
    return this.db.$transaction(async (tx) => {
      const current = await this.owner(tx, a, true);
      await tx.mobilePushDevice.deleteMany({
        where: { sessionId: a.sessionId, userId: current.id, organizationId: current.organizationId },
      });
      return { enabled: false, bindingId: null };
    });
  }
  private async valid(device: MobilePushDevice) {
    if (!device.active) return false;
    const auth = new AuthService(this.db),
      a = await auth.resolveMobileSessionId(device.sessionId);
    if (
      !a ||
      a.id !== device.userId ||
      a.organizationId !== device.organizationId ||
      a.role !== device.role ||
      a.accountMode !== device.accountMode ||
      !a.permissions.includes('learning.use')
    )
      return false;
    const setting = await this.db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: a.organizationId, key: 'notificationEnabled' } },
    });
    return setting?.value !== false;
  }
  /** Incremental outbox materialization from real inbox events; no provider or content generation. */
  private async enqueue() {
    const devices = await this.db.mobilePushDevice.findMany({
      where: { active: true, ...(this.deviceCursor ? { id: { gt: this.deviceCursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 50,
    });
    this.deviceCursor = devices.length === 50 ? devices.at(-1)!.id : undefined;
    for (const device of devices) {
      if (!(await this.valid(device))) {
        await this.db.mobilePushDevice.updateMany({ where: { id: device.id }, data: { active: false } });
        continue;
      }
      await this.db
        .$executeRaw`INSERT INTO "MobilePushDelivery" ("id","deviceId","notificationId","organizationId","userId","status","updatedAt")
    SELECT 'push_' || md5(${device.id} || ':' || n.id),${device.id},n.id,n."organizationId",n."userId",'PENDING',clock_timestamp()
    FROM "Notification" n WHERE n."organizationId"=${device.organizationId} AND n."userId"=${device.userId} AND n."readAt" IS NULL
    AND n."createdAt">=${device.createdAt} AND n."createdAt">=clock_timestamp()-INTERVAL '7 days'
    AND NOT EXISTS (SELECT 1 FROM "MobilePushDelivery" d WHERE d."deviceId"=${device.id} AND d."notificationId"=n.id)
    ORDER BY n."createdAt",n.id LIMIT 25 ON CONFLICT ("deviceId","notificationId") DO NOTHING`;
    }
  }
  async run() {
    if (this.busy || !this.gateway.status().available) return;
    this.busy = true;
    try {
      const now = new Date();
      // A crashed send could already have reached Expo: never blindly re-send it.
      await this.db.mobilePushDelivery.updateMany({
        where: { status: 'SENDING', leaseExpiresAt: { lt: now } },
        data: { status: 'UNKNOWN', lastErrorCode: 'SEND_LEASE_EXPIRED', claimId: null, leaseExpiresAt: null },
      });
      await this.db.mobilePushDelivery.updateMany({
        where: { status: 'CHECKING', leaseExpiresAt: { lt: now } },
        data: { status: 'TICKET', claimId: null, leaseExpiresAt: null },
      });
      await this.enqueue();
      const rows = await this.db.mobilePushDelivery.findMany({
        where: { status: { in: ['PENDING', 'TICKET'] }, nextAttemptAt: { lte: new Date() } },
        orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
        take: 10,
      });
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(2, rows.length) }, async () => {
          while (index < rows.length) {
            const row = rows[index++];
            await this.process(row);
          }
        }),
      );
    } finally {
      this.busy = false;
    }
  }
  private async process(row: MobilePushDelivery) {
    const receipt = row.status === 'TICKET',
      claimId = randomUUID(),
      maximum = receipt ? 12 : 5;
    if ((receipt ? row.receiptAttempts : row.attempts) >= maximum) {
      await this.db.mobilePushDelivery.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: 'FAILED', lastErrorCode: 'RETRY_EXHAUSTED' },
      });
      return;
    }
    const claimed = await this.db.mobilePushDelivery.updateMany({
      // Include the observed retry generation: a stale worker must not reclaim an ABA status
      // after another worker returns it to PENDING/TICKET with a new backoff or attempt count.
      where: {
        id: row.id,
        status: row.status,
        attempts: row.attempts,
        receiptAttempts: row.receiptAttempts,
        nextAttemptAt: row.nextAttemptAt,
      },
      data: {
        status: receipt ? 'CHECKING' : 'SENDING',
        claimId,
        leaseExpiresAt: new Date(Date.now() + 60000),
        ...(receipt ? { receiptAttempts: { increment: 1 } } : { attempts: { increment: 1 } }),
      },
    });
    if (!claimed.count) return;
    const finish = (data: Prisma.MobilePushDeliveryUpdateManyMutationInput) =>
      this.db.mobilePushDelivery.updateMany({
        where: { id: row.id, claimId },
        data: { ...data, claimId: null, leaseExpiresAt: null },
      });
    try {
      const device = await this.db.mobilePushDevice.findUnique({ where: { id: row.deviceId } }),
        notification = await this.db.notification.findFirst({
          where: { id: row.notificationId, userId: row.userId, organizationId: row.organizationId },
        });
      if (
        !device ||
        device.userId !== row.userId ||
        device.organizationId !== row.organizationId ||
        !notification ||
        notification.readAt ||
        !(await this.valid(device))
      ) {
        await finish({ status: 'SKIPPED', lastErrorCode: 'SCOPE_UNAVAILABLE' });
        return;
      }
      let token = '';
      if (!receipt) {
        try {
          token = openPushToken(device.tokenCiphertext, mobilePushConfig().key);
        } catch {
          await this.db.mobilePushDevice.updateMany({ where: { id: device.id }, data: { active: false } });
          await finish({ status: 'FAILED', lastErrorCode: 'TOKEN_UNAVAILABLE' });
          return;
        }
      }
      const outcome = receipt
        ? await this.gateway.receipt(row.ticketId!)
        : await this.gateway.send(token, device.id);
      if (outcome.kind === 'ticket') {
        await finish({
          status: 'TICKET',
          ticketId: outcome.id,
          lastErrorCode: null,
          nextAttemptAt: new Date(Date.now() + 15000),
        });
        return;
      }
      if (outcome.kind === 'delivered') {
        await finish({ status: 'DELIVERED', lastErrorCode: null });
        return;
      }
      if (outcome.disable)
        await this.db.mobilePushDevice.updateMany({
          where: { id: device.id, tokenHash: device.tokenHash },
          data: { active: false },
        });
      const count = (receipt ? row.receiptAttempts : row.attempts) + 1,
        retry = outcome.kind === 'retry' && count < maximum;
      await finish({
        status: retry ? (receipt ? 'TICKET' : 'PENDING') : outcome.kind === 'unknown' ? 'UNKNOWN' : 'FAILED',
        lastErrorCode: outcome.code,
        nextAttemptAt: new Date(Date.now() + Math.min(3600000, 15000 * 2 ** (count - 1))),
      });
    } catch {
      // Unexpected send completion is also ambiguous. Read-only receipt polling may safely retry.
      await finish({
        status: receipt ? 'TICKET' : 'UNKNOWN',
        lastErrorCode: 'WORKER_UNCERTAIN',
        nextAttemptAt: new Date(Date.now() + 60000),
      });
    }
  }
}
