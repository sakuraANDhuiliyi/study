import { ConflictException, ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Attachment, type UploadOperation } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { LocalPrivateStorage } from './storage';

type Tx = Prisma.TransactionClient;
const mb = 1024 * 1024;
function setting(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`Invalid ${name} configuration`);
  return value;
}
export function uploadSafetyLimits() {
  return {
    userBytes: setting('MAX_USER_UPLOAD_MB', 1024, 102400) * mb,
    organizationBytes: setting('MAX_ORG_UPLOAD_MB', 10240, 1024000) * mb,
    userFiles: setting('MAX_USER_UPLOAD_FILES', 1000, 100000),
    organizationFiles: setting('MAX_ORG_UPLOAD_FILES', 20000, 1000000),
    userConcurrent: setting('MAX_UPLOADS_PER_USER', 2, 10),
    totalConcurrent: setting('MAX_UPLOADS_TOTAL', 8, 64),
    perMinute: setting('UPLOADS_PER_MINUTE', 20, 120),
    orphanHours: setting('UNUSED_UPLOAD_TTL_HOURS', 24, 720),
  };
}

@Injectable()
export class UploadSafetyService {
  private readonly logger = new Logger(UploadSafetyService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly storage: LocalPrivateStorage,
  ) {}
  private async lock(tx: Tx) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('upload-admission'))`;
  }
  async maximumBytes(actor: Actor) {
    const configured = await this.db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: actor.organizationId, key: 'maxUploadMB' } },
    });
    const env = Number(process.env.MAX_UPLOAD_MB ?? 10);
    const maximum = Math.min(
      50,
      Number.isFinite(env) && env > 0 ? env : 10,
      typeof configured?.value === 'number' && configured.value > 0 ? configured.value : 50,
    );
    return Math.floor(maximum * mb);
  }
  async reserve(actor: Actor, bytes: number, purpose: 'upload' | 'export' = 'upload') {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 530 * mb)
      throw new ConflictException('文件容量预留无效');
    const limits = uploadSafetyLimits();
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const now = new Date();
      // Expired reservations remain charged until their possibly-written file is removed.
      const pending = { status: 'pending' };
      const scope = { organizationId: actor.organizationId, ownerId: actor.id };
      const [
        user,
        organization,
        reservedUser,
        reservedOrg,
        userActive,
        totalActive,
        recent,
        deletingUser,
        deletingOrg,
      ] = await Promise.all([
        tx.attachment.aggregate({ where: scope, _sum: { size: true }, _count: true }),
        tx.attachment.aggregate({
          where: { organizationId: actor.organizationId },
          _sum: { size: true },
          _count: true,
        }),
        tx.uploadOperation.aggregate({
          where: { ...scope, ...pending },
          _sum: { reservedBytes: true },
          _count: true,
        }),
        tx.uploadOperation.aggregate({
          where: { organizationId: actor.organizationId, ...pending },
          _sum: { reservedBytes: true },
          _count: true,
        }),
        tx.uploadOperation.count({ where: { ...scope, ...pending } }),
        tx.uploadOperation.count({ where: pending }),
        tx.uploadOperation.count({
          where: { ...scope, createdAt: { gte: new Date(now.getTime() - 60000) } },
        }),
        tx.pendingFileDeletion.aggregate({ where: scope, _sum: { size: true }, _count: true }),
        tx.pendingFileDeletion.aggregate({
          where: { organizationId: actor.organizationId },
          _sum: { size: true },
          _count: true,
        }),
      ]);
      if (userActive >= limits.userConcurrent || totalActive >= limits.totalConcurrent)
        throw new HttpException('上传请求过多，请等待当前上传完成', 429);
      if (recent >= limits.perMinute) throw new HttpException('上传过于频繁，请稍后再试', 429);
      if (
        (user._sum.size ?? 0) +
          (reservedUser._sum.reservedBytes ?? 0) +
          (deletingUser._sum.size ?? 0) +
          bytes >
          limits.userBytes ||
        user._count + reservedUser._count + deletingUser._count >= limits.userFiles ||
        (organization._sum.size ?? 0) +
          (reservedOrg._sum.reservedBytes ?? 0) +
          (deletingOrg._sum.size ?? 0) +
          bytes >
          limits.organizationBytes ||
        organization._count + reservedOrg._count + deletingOrg._count >= limits.organizationFiles
      )
        throw new HttpException('附件累计容量或数量已达上限，请删除未使用文件或联系管理员', 413);
      return tx.uploadOperation.create({
        data: {
          ...scope,
          purpose,
          reservedBytes: bytes,
          storageKey: randomUUID(),
          expiresAt: new Date(now.getTime() + 10 * 60000),
        },
      });
    });
  }
  async finish(
    actor: Actor,
    lease: UploadOperation,
    data: Prisma.AttachmentUncheckedCreateInput,
    extra?: (tx: Tx, attachment: Attachment) => Promise<void>,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const current = await tx.uploadOperation.findFirst({
        where: {
          id: lease.id,
          organizationId: actor.organizationId,
          ownerId: actor.id,
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
      });
      if (!current || data.size > current.reservedBytes || data.storageKey !== current.storageKey)
        throw new ConflictException('上传请求已过期，请重试');
      const attachment = await tx.attachment.create({ data });
      if (extra) await extra(tx, attachment);
      await tx.uploadOperation.update({ where: { id: lease.id }, data: { status: 'completed' } });
      return attachment;
    });
  }
  async release(id: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const lease = await tx.uploadOperation.findUnique({ where: { id } });
      if (!lease || lease.status === 'completed') return;
      // A commit may succeed even when its acknowledgement is lost. Never remove
      // a durable attachment in error handling, or trust a stale lease object.
      if (await tx.attachment.findUnique({ where: { storageKey: lease.storageKey } })) return;
      // Remove first; failed filesystem cleanup must not release the charged capacity.
      await this.storage.delete(lease.storageKey);
      await tx.uploadOperation.update({
        where: { id },
        data: { status: 'failed', cleanupAttemptedAt: new Date() },
      });
    });
  }
  private async referenced(tx: Tx, id: string) {
    const [row] = await tx.$queryRaw<{ used: boolean }[]>`SELECT (
      EXISTS (SELECT 1 FROM "DiscussionPost" WHERE ${id} = ANY("attachmentIds")) OR
      EXISTS (SELECT 1 FROM "DiscussionReply" WHERE ${id} = ANY("attachmentIds")) OR
      EXISTS (SELECT 1 FROM "Message" WHERE ${id} = ANY("attachmentIds")) OR
      EXISTS (SELECT 1 FROM "Lesson" WHERE "attachmentId" = ${id} OR ${id} = ANY("attachmentIds")) OR
      EXISTS (SELECT 1 FROM "Assignment" WHERE ${id} = ANY("attachmentIds")) OR
      EXISTS (SELECT 1 FROM "AssignmentDraft" WHERE ${id} = ANY("attachmentIds")) OR
      EXISTS (SELECT 1 FROM "AssignmentSubmission" WHERE ${id} = ANY("attachmentIds"))
    ) AS used`;
    return row.used;
  }
  async remove(actor: Actor, id: string) {
    let key = '';
    await this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const [file] = await tx.$queryRaw<
        {
          id: string;
          storageKey: string;
          exportJobId: string | null;
          organizationId: string;
          ownerId: string;
          size: number;
        }[]
      >`
        SELECT id, "storageKey", "exportJobId", "organizationId", "ownerId", size FROM "Attachment"
        WHERE id = ${id} AND "organizationId" = ${actor.organizationId} AND "ownerId" = ${actor.id} FOR UPDATE`;
      if (!file) throw new ForbiddenException('附件不存在或不属于本人');
      if (file.exportJobId || (await this.referenced(tx, file.id)))
        throw new ConflictException('附件已用于业务记录，不能删除');
      await this.queueDeletion(tx, file);
      key = file.storageKey;
    });
    await this.drainDeletions(key);
    return { success: true };
  }
  private async queueDeletion(
    tx: Tx,
    file: { id: string; storageKey: string; organizationId: string; ownerId: string; size: number },
  ) {
    const { storageKey, organizationId, ownerId, size } = file;
    await tx.pendingFileDeletion.create({ data: { storageKey, organizationId, ownerId, size } });
    await tx.attachment.delete({ where: { id: file.id } });
  }
  private async drainDeletions(storageKey?: string) {
    const files = await this.db.pendingFileDeletion.findMany({
      where: storageKey ? { storageKey } : { retryAt: { lte: new Date() } },
      orderBy: { retryAt: 'asc' },
      take: 50,
    });
    for (const file of files) {
      try {
        await this.storage.delete(file.storageKey);
        await this.db.pendingFileDeletion.deleteMany({ where: { storageKey: file.storageKey } });
      } catch {
        await this.db.pendingFileDeletion.updateMany({
          where: { storageKey: file.storageKey },
          data: { retryAt: new Date(Date.now() + 60000) },
        });
        // Keep charging quota, but let subsequent batches progress past failed keys.
        this.logger.warn('Physical file deletion will retry; capacity remains charged');
      }
    }
  }
  async cleanup() {
    const now = new Date();
    const expired = await this.db.uploadOperation.findMany({
      where: { OR: [{ status: 'pending', expiresAt: { lte: now } }, { status: 'failed' }] },
      orderBy: { cleanupAttemptedAt: { sort: 'asc', nulls: 'first' } },
      take: 50,
    });
    for (const lease of expired) {
      try {
        await this.release(lease.id);
        // Re-sweep failed keys for a full day after expiry: a writer that was
        // already running during cancellation can leave a late file after a crash.
        await this.db.uploadOperation.deleteMany({
          where: { id: lease.id, status: 'failed', expiresAt: { lt: new Date(now.getTime() - 86400000) } },
        });
      } catch {
        await this.db.uploadOperation.updateMany({
          where: { id: lease.id },
          data: { cleanupAttemptedAt: now },
        });
        this.logger.warn('Upload file cleanup will retry; capacity remains charged');
      }
    }
    const cutoff = new Date(now.getTime() - uploadSafetyLimits().orphanHours * 3600000);
    // A reference trigger permanently marks used files in the business transaction;
    // old drafts cannot interleave a new reference with deletion of an orphan.
    await this.db.$transaction(async (tx) => {
      const orphans = await tx.$queryRaw<
        { id: string; storageKey: string; organizationId: string; ownerId: string; size: number }[]
      >`
        SELECT id, "storageKey", "organizationId", "ownerId", size FROM "Attachment" WHERE "claimedAt" IS NULL AND "exportJobId" IS NULL
        AND "createdAt" < ${cutoff} ORDER BY "createdAt", id LIMIT 50 FOR UPDATE SKIP LOCKED`;
      for (const file of orphans) {
        if (await this.referenced(tx, file.id)) continue;
        await this.queueDeletion(tx, file);
      }
    });
    await this.drainDeletions();
    await this.db.uploadOperation.deleteMany({
      where: { status: 'completed', createdAt: { lt: new Date(now.getTime() - 86400000) } },
    });
  }
}
