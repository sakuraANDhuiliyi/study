import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type AcademicGoal } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { lockSecurityUser } from '../auth/security-transaction';
import { PrismaService } from '../common/prisma.service';
import { getAcademicModule } from './academics.modules';
import {
  academicGoalCreate,
  academicGoalDelete,
  academicGoalPatch,
  academicGoalQuery,
} from './goals.schemas';

type Tx = Prisma.TransactionClient;
export function academicGoalToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function academicGoalDto(row: AcademicGoal, progressCount: number, today = academicGoalToday()) {
  const { id, moduleId, title, targetCount, archived, revision, createdAt, updatedAt } = row;
  const dueDate = row.dueDate?.toISOString().slice(0, 10) ?? null;
  const completed = progressCount >= targetCount;
  return {
    id,
    moduleId,
    title,
    targetCount,
    dueDate,
    archived,
    revision,
    createdAt,
    updatedAt,
    progressCount,
    completed,
    unit: moduleId === 'algorithms' ? ('题' as const) : ('次' as const),
    overdue: !!dueDate && dueDate < today && !completed && !archived,
  };
}
type GoalDto = ReturnType<typeof academicGoalDto>;
export function compareAcademicGoals(a: GoalDto, b: GoalDto) {
  return (
    Number(a.completed) - Number(b.completed) ||
    (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

@Injectable()
export class AcademicGoalsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  private scope(actor: Actor) {
    return { organizationId: actor.organizationId, userId: actor.id };
  }
  private async access(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('学习目标仅供学生使用');
    this.auth.require(actor, 'learning.use');
    await this.auth.checkFeature(actor, '/api/practice');
  }
  private async current(tx: Tx, actor: Actor) {
    const verified = await tx.user.findUnique({ where: { id: actor.id } });
    if (!verified) throw new UnauthorizedException('登录已失效，请重新登录');
    await lockSecurityUser(tx, actor, verified);
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true } });
    if (!user.roles.some((role) => role.roleId === 'STUDENT'))
      throw new UnauthorizedException('账号身份已变化，请重新登录');
    const feature = await tx.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: actor.organizationId, key: 'features' } },
    });
    if ((feature?.value as { practice?: boolean } | null)?.practice === false)
      throw new ForbiddenException('机构已关闭此功能');
  }
  private async own(tx: Tx, actor: Actor, id: string) {
    const row = await tx.academicGoal.findFirst({ where: { id, ...this.scope(actor) } });
    if (!row) throw new NotFoundException('学习目标不存在');
    return row;
  }
  private async withProgress(tx: Tx, actor: Actor, rows: AcademicGoal[]) {
    if (!rows.length) return [];
    const counts = await tx.$queryRaw<{ id: string; progressCount: number }[]>(Prisma.sql`
      SELECT g."id", (CASE WHEN g."moduleId" = 'algorithms' THEN (
        SELECT COUNT(DISTINCT s."problemId") FROM "AlgorithmSubmission" s
        WHERE s."organizationId" = g."organizationId" AND s."userId" = g."userId"
          AND s."mode" = 'submit' AND s."status" = 'accepted' AND NOT s."customInput"
          AND s."createdAt" >= g."createdAt"
      ) ELSE (
        SELECT COUNT(*) FROM "AcademicsRecord" r
        WHERE r."organizationId" = g."organizationId" AND r."userId" = g."userId"
          AND r."moduleId" = g."moduleId" AND r."status" = 'COMPLETED'
          AND r."createdAt" >= g."createdAt"
      ) END)::integer AS "progressCount"
      FROM "AcademicGoal" g
      WHERE g."organizationId" = ${actor.organizationId} AND g."userId" = ${actor.id}
        AND g."id" IN (${Prisma.join(rows.map((row) => row.id))})
    `);
    const byId = new Map(counts.map((entry) => [entry.id, entry.progressCount]));
    const today = academicGoalToday();
    return rows.map((row) => academicGoalDto(row, byId.get(row.id) ?? 0, today));
  }
  async list(actor: Actor, query: unknown) {
    await this.access(actor);
    const input = academicGoalQuery.parse(query);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const rows = await tx.academicGoal.findMany({
        where: {
          ...this.scope(actor),
          ...(input.status === 'all' ? {} : { archived: input.status === 'archived' }),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
      return { items: (await this.withProgress(tx, actor, rows)).sort(compareAcademicGoals) };
    });
  }
  async create(actor: Actor, body: unknown) {
    await this.access(actor);
    const input = academicGoalCreate.parse(body);
    if (!getAcademicModule(input.moduleId)) throw new NotFoundException('学习模块不存在');
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      if ((await tx.academicGoal.count({ where: this.scope(actor) })) >= 100)
        throw new ConflictException('学习目标已达到100个，请删除旧目标后再创建');
      // PostgreSQL now() is the transaction start, potentially before a long user-lock wait.
      // Establish the goal after the lock and use the database clock for both record types.
      const [{ createdAt }] = await tx.$queryRaw<{ createdAt: Date }[]>`
        SELECT clock_timestamp()::timestamptz(3) AS "createdAt"
      `;
      const row = await tx.academicGoal.create({
        data: {
          ...this.scope(actor),
          ...input,
          createdAt,
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
        },
      });
      return (await this.withProgress(tx, actor, [row]))[0];
    });
  }
  async patch(actor: Actor, id: string, body: unknown) {
    await this.access(actor);
    const { revision, dueDate, ...input } = academicGoalPatch.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      await this.own(tx, actor, id);
      const changed = await tx.academicGoal.updateMany({
        where: { id, ...this.scope(actor), revision },
        data: {
          ...input,
          ...(dueDate === undefined
            ? {}
            : { dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null }),
          revision: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException('目标已在其他页面更新，请刷新后重试');
      return (await this.withProgress(tx, actor, [await this.own(tx, actor, id)]))[0];
    });
  }
  async delete(actor: Actor, id: string, body: unknown) {
    await this.access(actor);
    const { revision } = academicGoalDelete.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      await this.own(tx, actor, id);
      const changed = await tx.academicGoal.deleteMany({ where: { id, ...this.scope(actor), revision } });
      if (!changed.count) throw new ConflictException('目标已在其他页面更新，请刷新后重试');
      return { ok: true };
    });
  }
}
