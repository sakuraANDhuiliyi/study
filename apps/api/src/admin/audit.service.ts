import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { lockSecurityUser } from '../auth/security-transaction';
import { PrismaService } from '../common/prisma.service';
import {
  auditExportInput,
  auditFilterSummary,
  parseAuditListQuery,
  type AuditFilters,
} from './audit.schemas';
import {
  AuditExportRenderer,
  auditExportMaxBytes,
  auditExportTooLarge,
  type AuditExportRecord,
} from './audit-export.renderer';

type Tx = Prisma.TransactionClient;
type AuditListRecord = AuditExportRecord & { organizationId: string; details: unknown };
export const auditExportAction = 'admin.audit.export';
const readPermission = 'audit.read';
const exportPermissions = [readPermission, 'data.export'] as const;
const literalContains = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

/** Organization scope is only from Actor; literal historical IDs need not have a current User. */
export function auditWhere(organizationId: string, filters: AuditFilters) {
  const clauses = [Prisma.sql`a."organizationId" = ${organizationId}`];
  if (filters.search) {
    const term = literalContains(filters.search);
    clauses.push(Prisma.sql`(a."action" ILIKE ${term} OR a."resourceType" ILIKE ${term}
      OR a."resourceId" ILIKE ${term} OR a."requestId" ILIKE ${term})`);
  }
  // Preserve Prisma's historical contains/LIKE semantics, including case sensitivity.
  if (filters.action) clauses.push(Prisma.sql`a."action" LIKE ${`%${filters.action}%`}`);
  if (filters.actorId) clauses.push(Prisma.sql`a."userId" = ${filters.actorId}`);
  if (filters.resourceType) clauses.push(Prisma.sql`a."resourceType" = ${filters.resourceType}`);
  if (filters.resourceId) clauses.push(Prisma.sql`a."resourceId" = ${filters.resourceId}`);
  if (filters.requestId) clauses.push(Prisma.sql`a."requestId" = ${filters.requestId}`);
  if (filters.from) clauses.push(Prisma.sql`a."createdAt" >= ${new Date(filters.from)}`);
  if (filters.to) clauses.push(Prisma.sql`a."createdAt" <= ${new Date(filters.to)}`);
  return Prisma.join(clauses, ' AND ');
}

@Injectable()
export class AdminAuditService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  private access(actor: Actor, exporting = false) {
    if (actor.accountMode === 'PERSONAL') throw new ForbiddenException('个人空间没有机构审计权限');
    for (const permission of exporting ? exportPermissions : [readPermission])
      this.auth.require(actor, permission);
  }
  private async fresh(actor: Actor, exporting = false) {
    const current = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.organizationId !== actor.organizationId ||
      current.role !== actor.role ||
      current.csrfToken !== actor.csrfToken
    )
      throw new UnauthorizedException('当前管理会话已变化，请重新登录');
    this.access(current, exporting);
    if (exporting) {
      // This check runs only after the transaction released its User lock/connection.
      // AuthService's effective permissions alone are insufficient if a historical
      // Permission row accidentally marks data.export as non-sensitive.
      const grant = await this.db.sensitiveGrant.findFirst({
        where: {
          organizationId: current.organizationId,
          userId: current.id,
          permissionId: 'data.export',
          expiresAt: { gt: new Date() },
        },
        select: { expiresAt: true },
      });
      if (!grant || grant.expiresAt <= new Date()) throw new ForbiddenException('独立导出授权已失效');
    }
    return current;
  }

  /** Every authorization query under the User lock uses this one transaction connection. */
  private async current(tx: Tx, actor: Actor) {
    if (!actor.sessionId || !actor.csrfToken) throw new UnauthorizedException('当前管理会话已失效');
    const verified = await tx.user.findUnique({ where: { id: actor.id } });
    if (!verified) throw new UnauthorizedException('登录已失效，请重新登录');
    await lockSecurityUser(tx, actor, verified);
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true } });
    if (user.accountMode !== 'ORGANIZATION' || !user.roles.some((role) => role.roleId === actor.role))
      throw new UnauthorizedException('账号身份或学习空间已变化');
    const now = new Date();
    const session =
      actor.sessionId &&
      (await tx.session.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.id,
          role: actor.role,
          authVersion: user.authVersion,
          csrfToken: actor.csrfToken,
          expiresAt: { gt: now },
        },
        select: { id: true },
      }));
    if (!session) throw new UnauthorizedException('当前管理会话已失效');
    const organization = await tx.organization.findUnique({
      where: { id: actor.organizationId },
      select: { active: true, kind: true },
    });
    if (!organization?.active || organization.kind !== 'INSTITUTION')
      throw new ForbiddenException('机构已停用或空间已变化');
    const templates = await tx.rolePermission.findMany({
      where: { roleId: actor.role, permissionId: { in: [...exportPermissions] } },
      include: { permission: true },
    });
    const grants = await tx.sensitiveGrant.findMany({
      where: {
        organizationId: actor.organizationId,
        userId: actor.id,
        permissionId: { in: [...exportPermissions] },
        expiresAt: { gt: new Date() },
      },
      select: { permissionId: true, expiresAt: true },
    });
    for (const id of exportPermissions) {
      const template = templates.find((entry) => entry.permissionId === id);
      if (
        !template ||
        ((id === 'data.export' || template.permission.sensitive) &&
          !grants.some((grant) => grant.permissionId === id && grant.expiresAt > new Date()))
      )
        throw new ForbiddenException('没有执行此操作的权限或独立导出授权已失效');
    }
  }
  async list(actor: Actor, query: unknown) {
    this.access(actor);
    const input = parseAuditListQuery(query);
    const where = auditWhere(actor.organizationId, input.filters);
    const [result] = await this.db.$queryRaw<{ total: bigint; items: AuditListRecord[] }[]>(Prisma.sql`
      WITH selected AS MATERIALIZED (
        SELECT a.*, CASE WHEN a."userId" IS NULL THEN '系统' ELSE COALESCE(u."name", '历史账号') END AS "actorName"
        FROM "AuditLog" a LEFT JOIN "User" u ON u."id" = a."userId" AND u."organizationId" = ${actor.organizationId}
        WHERE ${where} ORDER BY a."createdAt" DESC, a."id" DESC LIMIT ${input.pageSize} OFFSET ${input.skip}
      )
      SELECT (SELECT COUNT(*) FROM "AuditLog" a WHERE ${where})::bigint AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."createdAt" DESC, s."id" DESC) FROM selected s), '[]'::jsonb) AS items
    `);
    await this.fresh(actor);
    return {
      items: result.items.map((item) => ({ ...item, createdAt: new Date(item.createdAt).toISOString() })),
      total: Number(result.total),
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async export(actor: Actor, body: unknown) {
    this.access(actor, true);
    const input = auditExportInput.parse(body);
    const filters = auditFilterSummary(input);
    const where = auditWhere(actor.organizationId, filters);
    const output = await this.db.$transaction(
      async (tx) => {
        await this.current(tx, actor);
        // One READ COMMITTED SELECT supplies count, scalar preflight, identity names and rows
        // from the same statement snapshot. CASE prevents an oversized history entering Node.
        // No details JSON, OFFSET batching or second connection is involved in an export.
        const [snapshot] = await tx.$queryRaw<
          {
            matchedCount: bigint;
            recordCount: number;
            minimumBytes: bigint;
            rows: AuditExportRecord[];
          }[]
        >(Prisma.sql`
        WITH selected AS MATERIALIZED (
          SELECT a."id", a."createdAt", a."userId", a."action", a."resourceType", a."resourceId", a."requestId",
            CASE WHEN a."userId" IS NULL THEN '系统' ELSE COALESCE(u."name", '历史账号') END AS "actorName"
          FROM "AuditLog" a LEFT JOIN "User" u ON u."id" = a."userId" AND u."organizationId" = ${actor.organizationId}
          WHERE ${where} ORDER BY a."createdAt" DESC, a."id" DESC LIMIT ${input.limit}
        ), budget AS (
          SELECT COUNT(*)::integer AS "recordCount", COALESCE(SUM(
            octet_length("id")::bigint + 24 + COALESCE(octet_length("userId"),0) + octet_length("actorName") +
            octet_length("action") + octet_length("resourceType") + octet_length("resourceId") +
            COALESCE(octet_length("requestId"),0)),0)::bigint AS "minimumBytes" FROM selected
        )
        SELECT (SELECT COUNT(*) FROM "AuditLog" a WHERE ${where})::bigint AS "matchedCount",
          b."recordCount", b."minimumBytes",
          CASE WHEN b."minimumBytes" <= ${auditExportMaxBytes} THEN
            COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."createdAt" DESC,s."id" DESC) FROM selected s),'[]'::jsonb)
            ELSE '[]'::jsonb END AS rows FROM budget b
      `);
        if (snapshot.minimumBytes > BigInt(auditExportMaxBytes)) throw auditExportTooLarge();
        const renderer = new AuditExportRenderer();
        for (const row of snapshot.rows) renderer.add(row);
        const rendered = renderer.finish();
        if (rendered.count !== snapshot.recordCount) throw new Error('审计导出快照记录数量不一致');
        // READ COMMITTED rechecks see committed grant/template changes and elapsed expiry.
        await this.current(tx, actor);
        return {
          ...rendered,
          matchedCount: Number(snapshot.matchedCount),
          recordCount: rendered.count,
          truncated: rendered.count < Number(snapshot.matchedCount),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 15_000 },
    );
    await this.fresh(actor, true);
    // Record preparation after the data snapshot; a server cannot claim client delivery.
    // If authorization changes after this event, the last fresh check still denies bytes.
    await this.db.$transaction(
      async (tx) => {
        await this.current(tx, actor);
        const [{ createdAt }] = await tx.$queryRaw<
          { createdAt: Date }[]
        >`SELECT clock_timestamp()::timestamptz(3) AS "createdAt"`;
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.id,
            action: auditExportAction,
            resourceType: 'AuditLog',
            resourceId: 'batch',
            requestId: actor.requestId,
            createdAt,
            details: {
              format: 'csv',
              deliveryState: 'prepared',
              limit: input.limit,
              filters: filters as Prisma.InputJsonObject,
              matchedCount: output.matchedCount,
              count: output.recordCount,
              bytes: output.bytes,
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 15_000 },
    );
    await this.fresh(actor, true);
    return { ...output, filename: 'audit-records.csv', contentType: 'text/csv; charset=utf-8' };
  }
}
