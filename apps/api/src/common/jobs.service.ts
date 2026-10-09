import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CommunicationService } from '../communication/communication.service';
import { UploadSafetyService } from '../communication/upload-safety.service';
import type { SchedulerLifecycle, SchedulerSnapshot } from './scheduler-status';
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private automaticEnabled = process.env.DISABLE_JOBS !== 'true';
  private lifecycle: SchedulerLifecycle = 'not_initialized';
  private lastUploadCleanup = 0;
  private logger = new Logger('Jobs');
  constructor(
    private db: PrismaService,
    private communication: CommunicationService,
    private uploads: UploadSafetyService,
  ) {}
  onModuleInit() {
    this.automaticEnabled = process.env.DISABLE_JOBS !== 'true';
    if (!this.automaticEnabled) {
      this.lifecycle = 'disabled';
      return;
    }
    this.timer = setInterval(() => void this.run(), 5000);
    this.lifecycle = 'scheduled';
    void this.run();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.lifecycle = 'stopped';
  }
  schedulerSnapshot(): SchedulerSnapshot {
    return {
      automaticEnabled: this.automaticEnabled,
      lifecycle: this.lifecycle,
      pollIntervalMs: 5000,
      pollInProgress: this.busy,
    };
  }
  async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = new Date();
      if (now.getTime() - this.lastUploadCleanup >= 60000) {
        this.lastUploadCleanup = now.getTime();
        try {
          await this.uploads.cleanup();
        } catch {
          this.logger.error('Upload cleanup will retry; other background jobs continue');
        }
      }
      await this.db.backgroundJob.updateMany({
        where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - 60000) } },
        data: { status: 'PENDING', lockedAt: null },
      });
      const jobs = await this.db.backgroundJob.findMany({
        where: { status: 'PENDING', runAt: { lte: now } },
        orderBy: [{ runAt: 'asc' }, { id: 'asc' }],
        take: 50,
      });
      for (const job of jobs) {
        const claim = await this.db.backgroundJob.updateMany({
          where: { id: job.id, status: 'PENDING' },
          data: { status: 'RUNNING', lockedAt: new Date(), attempts: { increment: 1 } },
        });
        if (!claim.count) continue;
        try {
          if (job.kind === 'NOTIFICATION') {
            const p = job.payload as {
              userIds: string[];
              type: string;
              title: string;
              body: string;
              link: string;
              eventKey: string;
            };
            const setting = await this.db.systemSetting.findUnique({
              where: {
                organizationId_key: { organizationId: job.organizationId, key: 'notificationEnabled' },
              },
            });
            if (setting?.value !== false) {
              const users = await this.db.user.findMany({
                where: { id: { in: p.userIds }, organizationId: job.organizationId, active: true },
                select: { id: true },
              });
              await this.db.notification.createMany({
                data: users.map((u) => ({
                  organizationId: job.organizationId,
                  userId: u.id,
                  type: p.type,
                  title: p.title,
                  body: p.body,
                  link: p.link,
                  eventKey: p.eventKey,
                })),
                skipDuplicates: true,
              });
            }
          } else if (job.kind === 'ASSIGNMENT_EXPORT') {
            await this.communication.processAssignmentExport(job);
          } else throw new Error('UNSUPPORTED_JOB');
          await this.db.backgroundJob.update({
            where: { id: job.id },
            data: { status: 'SUCCEEDED', lockedAt: null, lastError: null },
          });
        } catch {
          await this.db.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: job.attempts >= 7 ? 'FAILED' : 'PENDING',
              lockedAt: null,
              lastError: '任务处理失败，已记录重试',
              runAt: new Date(Date.now() + Math.min(3600000, 5000 * 2 ** job.attempts)),
            },
          });
        }
      }
      if (now.getSeconds() < 6) {
        await this.scheduleReminders();
        await this.db.session.deleteMany({ where: { expiresAt: { lt: now } } });
      }
    } catch {
      this.logger.error('Background job pass failed; will retry on next pass');
    } finally {
      this.busy = false;
    }
  }
  private async scheduleReminders() {
    const now = new Date(),
      soon = new Date(Date.now() + 86400000);
    const [assignments, exams] = await Promise.all([
      this.db.assignment.findMany({
        where: { status: 'published', dueAt: { gte: now, lte: soon } },
        include: { audience: true },
      }),
      this.db.exam.findMany({
        where: { status: 'published', startsAt: { gte: now, lte: soon } },
        include: { audience: true },
      }),
    ]);
    for (const task of [
      ...assignments.map((x) => ({ ...x, kind: 'assignment' as const })),
      ...exams.map((x) => ({ ...x, kind: 'exam' as const })),
    ]) {
      const eventKey = `reminder:${task.kind}:${task.id}:${task.kind === 'exam' ? task.startsAt.toISOString() : task.dueAt.toISOString()}`;
      const audience = task.audience.map((x) => x.userId);
      await this.db.backgroundJob.upsert({
        where: { eventKey },
        create: {
          organizationId: task.organizationId,
          kind: 'NOTIFICATION',
          eventKey,
          payload: {
            userIds: audience,
            type: 'REMINDER',
            title: task.kind === 'exam' ? '考试即将开始' : '作业即将截止',
            body: task.title,
            link: `/${task.kind === 'exam' ? 'exams' : 'assignments'}/${task.id}`,
            eventKey,
          },
        },
        update: {},
      });
    }
  }
}
