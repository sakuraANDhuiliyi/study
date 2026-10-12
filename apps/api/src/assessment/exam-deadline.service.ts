import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { SchedulerLifecycle, SchedulerSnapshot } from '../common/scheduler-status';
import { AssessmentContext } from './assessment-context';
import { ExamAttemptsService } from './exam-attempts.service';

@Injectable()
export class ExamDeadlineService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private automaticEnabled = process.env.DISABLE_JOBS !== 'true';
  private lifecycle: SchedulerLifecycle = 'not_initialized';
  private readonly deadlineRetries = new Map<string, number>();
  private readonly logger = new Logger('AssessmentService');
  constructor(
    private readonly context: AssessmentContext,
    private readonly attempts: ExamAttemptsService,
  ) {}

  onModuleInit() {
    this.automaticEnabled = process.env.DISABLE_JOBS !== 'true';
    if (this.automaticEnabled) {
      this.timer = setInterval(() => void this.sweepDueAttempts(), 10000);
      this.timer.unref();
      this.lifecycle = 'scheduled';
      void this.sweepDueAttempts();
    } else this.lifecycle = 'disabled';
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
      pollIntervalMs: 10000,
      pollInProgress: this.running,
    };
  }

  async sweepDueAttempts() {
    if (this.running) return;
    this.running = true;
    let runId: string | undefined;
    try {
      const now = Date.now();
      for (const [id, retryAt] of this.deadlineRetries) if (retryAt <= now) this.deadlineRetries.delete(id);
      const due = await this.context.db.examAttempt.findMany({
        where: {
          status: 'in_progress',
          deadlineAt: { lte: new Date() },
          id: { notIn: [...this.deadlineRetries.keys()] },
        },
        select: { id: true },
        orderBy: [{ deadlineAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
      if (!due.length) return;
      const run = await this.context.db.assessmentJobRun.create({
        data: { type: 'exam_deadline', status: 'running' },
      });
      runId = run.id;
      let processed = 0;
      const failed: string[] = [];
      for (const attempt of due) {
        try {
          await this.attempts.finalizeAttempt(attempt.id, 'deadline');
          processed++;
          this.deadlineRetries.delete(attempt.id);
        } catch {
          failed.push(attempt.id);
          this.deadlineRetries.set(attempt.id, Date.now() + 60000);
          this.logger.error(`答卷到期交卷失败，已隔离并将在一分钟后重试: ${attempt.id}`);
        }
      }
      await this.context.db.assessmentJobRun.update({
        where: { id: run.id },
        data: {
          status: failed.length ? 'failed' : 'completed',
          processed,
          error: failed.length ? JSON.stringify({ failedAttemptIds: failed, retryAfterMs: 60000 }) : null,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error('到期交卷任务失败，将在下轮从未完成答卷恢复');
      if (runId)
        await this.context.db.assessmentJobRun
          .update({
            where: { id: runId },
            data: {
              status: 'failed',
              error: error instanceof Error ? error.name : 'UnknownError',
              completedAt: new Date(),
            },
          })
          .catch(() => undefined);
    } finally {
      this.running = false;
    }
  }
}
