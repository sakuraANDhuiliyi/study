import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { lockSecurityUser } from '../auth/security-transaction';
import { PrismaService } from '../common/prisma.service';
import { getAcademicModule } from './academics.modules';
import { academicRecordExportInput } from './records-export.schemas';
import {
  AcademicExportRenderer,
  academicExportMaxBytes,
  academicExportTooLarge,
  type CsvExportRecord,
  type MarkdownExportRecord,
} from './records-export.renderer';

type Tx = Prisma.TransactionClient;
export const academicExportAuditAction = 'academics.records.export';

@Injectable()
export class AcademicRecordExportService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  private async access(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('仅学生可导出本人学习记录');
    this.auth.require(actor, 'learning.use');
    await this.auth.checkFeature(actor, '/api/practice');
  }
  private async fresh(actor: Actor) {
    const fresh = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (!fresh || fresh.id !== actor.id || fresh.organizationId !== actor.organizationId)
      throw new UnauthorizedException('当前学习会话已失效，请重新登录');
    await this.access(fresh);
    return fresh;
  }
  private async current(tx: Tx, actor: Actor) {
    const verified = await tx.user.findUnique({ where: { id: actor.id } });
    if (!verified) throw new UnauthorizedException('登录已失效，请重新登录');
    await lockSecurityUser(tx, actor, verified);
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true } });
    if (actor.role !== 'STUDENT' || !user.roles.some((role) => role.roleId === 'STUDENT'))
      throw new UnauthorizedException('账号身份已变化');
    const session = await tx.session.findFirst({
      where: {
        id: actor.sessionId,
        userId: actor.id,
        role: 'STUDENT',
        authVersion: user.authVersion,
        expiresAt: { gt: new Date() },
      },
    });
    if (!session) throw new UnauthorizedException('当前学习身份已失效');
    const organization = await tx.organization.findUnique({
      where: { id: actor.organizationId },
      select: { id: true, active: true, kind: true },
    });
    if (!organization?.active) throw new ForbiddenException('机构已停用');
    if (
      (user.accountMode === 'PERSONAL' &&
        (organization.kind !== 'PERSONAL' || user.personalOrganizationId !== organization.id)) ||
      (user.accountMode === 'ORGANIZATION' && organization.kind !== 'INSTITUTION')
    )
      throw new UnauthorizedException('当前学习空间已变化，请重新登录');
    const permission = await tx.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
      include: { permission: true },
    });
    if (
      !permission ||
      (permission.permission.sensitive &&
        !(await tx.sensitiveGrant.findFirst({
          where: {
            userId: actor.id,
            organizationId: actor.organizationId,
            permissionId: 'learning.use',
            expiresAt: { gt: new Date() },
          },
        })))
    )
      throw new ForbiddenException('没有执行此操作的权限');
    const feature = await tx.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: actor.organizationId, key: 'features' } },
    });
    if ((feature?.value as { practice?: boolean } | null)?.practice === false)
      throw new ForbiddenException('机构已关闭此功能');
  }
  async export(actor: Actor, body: unknown) {
    await this.access(actor);
    const input = academicRecordExportInput.parse(body);
    if (input.moduleId && !getAcademicModule(input.moduleId)) throw new NotFoundException('学习模块不存在');
    const limit = input.limit ?? (input.format === 'csv' ? 5000 : 20);
    const output = await this.db.$transaction(
      async (tx) => {
        // All checks while holding the user lock must use this transaction's connection.
        // Calling AuthService here would borrow another connection and deadlock a small pool.
        await this.current(tx, actor);
        const [{ recent }] = await tx.$queryRaw<{ recent: number }[]>`
        SELECT COUNT(*)::integer AS recent FROM "AuditLog"
        WHERE "organizationId" = ${actor.organizationId} AND "userId" = ${actor.id}
          AND "action" = ${academicExportAuditAction}
          AND "createdAt" > clock_timestamp() - INTERVAL '1 minute'
      `;
        if (recent >= 5) throw new HttpException('每分钟最多成功导出5次，请稍后再试', 429);
        const where = Prisma.sql`r."organizationId" = ${actor.organizationId} AND r."userId" = ${actor.id}
        ${input.moduleId ? Prisma.sql`AND r."moduleId" = ${input.moduleId}` : Prisma.empty}
        ${input.status !== 'all' ? Prisma.sql`AND r."status" = ${input.status}` : Prisma.empty}`;
        const summary = Prisma.sql`CASE WHEN jsonb_typeof(r."result"->'summary') = 'string' THEN r."result"->>'summary' ELSE '' END`;
        const payloadBytes =
          input.format === 'csv'
            ? Prisma.sql`octet_length(${summary})`
            : Prisma.sql`octet_length(r."values"::text) + octet_length(r."result"::text) + octet_length(r."notes")`;
        // Read only byte counts first, never fetch a potential multi-gigabyte JSON history.
        const [budget] = await tx.$queryRaw<
          { matchedCount: number; recordCount: number; minimumBytes: bigint; generatedAt: Date }[]
        >(Prisma.sql`
        WITH selected AS (
          SELECT octet_length(r."title") + octet_length(r."moduleId") + ${payloadBytes} AS bytes
          FROM "AcademicsRecord" r WHERE ${where}
          ORDER BY r."createdAt" DESC, r."id" DESC LIMIT ${limit}
        )
        SELECT (SELECT COUNT(*)::integer FROM "AcademicsRecord" r WHERE ${where}) AS "matchedCount",
          COUNT(*)::integer AS "recordCount", COALESCE(SUM(bytes), 0)::bigint AS "minimumBytes",
          clock_timestamp() AS "generatedAt" FROM selected
      `);
        if (budget.minimumBytes > BigInt(academicExportMaxBytes)) throw academicExportTooLarge();
        const renderer = new AcademicExportRenderer({ ...budget, format: input.format });
        const batchSize = input.format === 'csv' ? 20 : 5;
        for (let offset = 0; offset < budget.recordCount; offset += batchSize) {
          const common = Prisma.sql`r."id", r."moduleId", r."title", r."status", r."revision", r."createdAt", r."updatedAt"`;
          const columns =
            input.format === 'csv'
              ? Prisma.sql`${common}, ${summary} AS summary, (length(r."notes") > 0) AS "hasNotes"`
              : Prisma.sql`${common}, r."values"::text AS "valuesJson", r."result"::text AS "resultJson", r."notes"`;
          const rows = await tx.$queryRaw<(CsvExportRecord & MarkdownExportRecord)[]>(Prisma.sql`
          SELECT ${columns} FROM "AcademicsRecord" r WHERE ${where}
          ORDER BY r."createdAt" DESC, r."id" DESC LIMIT ${Math.min(batchSize, budget.recordCount - offset)} OFFSET ${offset}
        `);
          for (const row of rows) {
            if (input.format === 'csv') renderer.addCsv(row);
            else renderer.addMarkdown(row);
          }
        }
        const rendered = renderer.finish();
        await this.current(tx, actor);
        const [{ createdAt }] = await tx.$queryRaw<
          { createdAt: Date }[]
        >`SELECT clock_timestamp()::timestamptz(3) AS "createdAt"`;
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.id,
            action: academicExportAuditAction,
            resourceType: 'AcademicsRecord',
            resourceId: 'batch',
            requestId: actor.requestId,
            createdAt,
            details: {
              format: input.format,
              moduleId: input.moduleId ?? null,
              status: input.status,
              limit,
              matchedCount: budget.matchedCount,
              count: rendered.count,
              bytes: rendered.bytes,
            },
          },
        });
        return {
          ...rendered,
          matchedCount: budget.matchedCount,
          recordCount: rendered.count,
          truncated: rendered.count < budget.matchedCount,
        };
      },
      { maxWait: 5000, timeout: 15000 },
    );
    await this.fresh(actor);
    return {
      ...output,
      filename: `academic-records.${input.format}`,
      contentType: input.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
    };
  }
}
