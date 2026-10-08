import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { Actor } from '../auth/auth.guard';
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly db: PrismaService) {}
  async record(
    actor: Actor,
    action: string,
    resourceType: string,
    resourceId: string,
    details: unknown = {},
  ) {
    // Call sites supply an explicit allowlist of audit details, never request bodies.
    return this.db.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        action,
        resourceType,
        resourceId,
        details: JSON.parse(JSON.stringify(details)),
        requestId: actor.requestId,
      },
    });
  }
  async notify(
    userIds: string[],
    organizationId: string,
    type: string,
    title: string,
    body: string,
    link: string,
    eventKey: string,
  ) {
    try {
      await this.db.backgroundJob.upsert({
        where: { eventKey: 'notify:' + eventKey },
        create: {
          organizationId,
          kind: 'NOTIFICATION',
          eventKey: 'notify:' + eventKey,
          payload: { userIds: [...new Set(userIds)], type, title, body, link, eventKey },
        },
        update: {},
      });
    } catch {
      this.logger.error('Unable to enqueue notification; primary action is retained');
    }
  }
}
