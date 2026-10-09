import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AlgorithmTrainingPlan, Prisma } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { lockSecurityUser } from '../auth/security-transaction';
import { PrismaService } from '../common/prisma.service';
import { algorithmProblems, type AlgorithmProblem } from './algorithms.catalog';
import {
  trainingPlanCreate,
  trainingPlanDelete,
  trainingPlanLimits,
  trainingPlanPatch,
} from './training-plan.schemas';

type Tx = Prisma.TransactionClient;
type Status = 'todo' | 'attempted' | 'solved';
export function trainingPlanProblemSummary(problem: AlgorithmProblem) {
  return {
    id: problem.id,
    number: problem.number,
    title: problem.title,
    difficulty: problem.difficulty,
    tags: problem.tags,
  };
}
const catalog = algorithmProblems.map(trainingPlanProblemSummary);
const byId = new Map(catalog.map((problem) => [problem.id, problem]));

/** A private projection: code, judge cases and ownership fields never enter a plan response. */
export function trainingPlanDto(row: AlgorithmTrainingPlan, statuses: Map<string, Status>) {
  const problems = row.problemIds.flatMap((id) => {
    const problem = byId.get(id);
    return problem ? [{ ...problem, status: statuses.get(id) ?? 'todo' }] : [];
  });
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    problemIds: row.problemIds,
    archived: row.archived,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    problems,
    total: problems.length,
    solved: problems.filter((problem) => problem.status === 'solved').length,
    nextProblemId: problems.find((problem) => problem.status !== 'solved')?.id ?? null,
  };
}

@Injectable()
export class AlgorithmTrainingPlansService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  private scope(actor: Actor) {
    return { organizationId: actor.organizationId, userId: actor.id };
  }
  private async access(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('算法训练计划仅供学生使用');
    this.auth.require(actor, 'learning.use');
    await this.auth.checkFeature(actor, '/api/algorithms');
  }
  private async current(tx: Tx, actor: Actor) {
    const verified = await tx.user.findUnique({ where: { id: actor.id } });
    if (!verified) throw new UnauthorizedException('登录已失效，请重新登录');
    // Sharing the User lock with account changes makes quotas and space changes atomic.
    await lockSecurityUser(tx, actor, verified);
    if (actor.role !== 'STUDENT') throw new ForbiddenException('算法训练计划仅供学生使用');
    const permissions = await tx.$queryRaw<{ permissionId: string }[]>`
      SELECT p."permissionId" FROM "UserRole" u
      JOIN "RolePermission" p ON p."roleId" = u."roleId"
      WHERE u."userId" = ${actor.id} AND u."roleId" = 'STUDENT' AND p."permissionId" = 'learning.use'
      FOR SHARE OF u, p
    `;
    if (!permissions.length) throw new ForbiddenException('当前学习权限已被撤销');
    const session =
      actor.sessionId &&
      (await tx.session.findFirst({
        where: { id: actor.sessionId, userId: actor.id, role: 'STUDENT' },
        select: { id: true },
      }));
    if (!session) throw new UnauthorizedException('当前身份已变化，请重新登录');
    const organizations = await tx.$queryRaw<{ active: boolean }[]>`
      SELECT active FROM "Organization" WHERE id = ${actor.organizationId} FOR SHARE
    `;
    if (!organizations[0]?.active) throw new ForbiddenException('机构已停用');
    const settings = await tx.$queryRaw<{ value: { practice?: boolean } }[]>`
      SELECT value FROM "SystemSetting" WHERE "organizationId" = ${actor.organizationId} AND key = 'features' FOR SHARE
    `;
    if (settings[0]?.value?.practice === false) throw new ForbiddenException('机构已关闭此功能');
  }
  private async own(tx: Tx, actor: Actor, id: string) {
    const row = await tx.algorithmTrainingPlan.findFirst({ where: { id, ...this.scope(actor) } });
    if (!row) throw new NotFoundException('训练计划不存在');
    return row;
  }
  private async progress(tx: Tx, actor: Actor, rows: AlgorithmTrainingPlan[]) {
    if (!rows.length) return [];
    const ids = [...new Set(rows.flatMap((row) => row.problemIds))];
    const submitted = await tx.algorithmSubmission.groupBy({
      where: {
        ...this.scope(actor),
        problemId: { in: ids },
        mode: 'submit',
        customInput: false,
      },
      by: ['problemId', 'status'],
    });
    const states = new Map<string, Status>();
    for (const submission of submitted) {
      if (submission.status === 'accepted') states.set(submission.problemId, 'solved');
      else if (!states.has(submission.problemId)) states.set(submission.problemId, 'attempted');
    }
    return rows.map((row) => trainingPlanDto(row, states));
  }
  async list(actor: Actor) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const rows = await tx.algorithmTrainingPlan.findMany({
        where: this.scope(actor),
        orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: trainingPlanLimits.maxPlans,
      });
      return { items: await this.progress(tx, actor, rows), catalog, limits: trainingPlanLimits };
    });
  }
  async create(actor: Actor, body: unknown) {
    await this.access(actor);
    const input = trainingPlanCreate.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      if ((await tx.algorithmTrainingPlan.count({ where: this.scope(actor) })) >= trainingPlanLimits.maxPlans)
        throw new ConflictException('训练计划已达到20份，请删除旧计划后再创建');
      const row = await tx.algorithmTrainingPlan.create({ data: { ...this.scope(actor), ...input } });
      return (await this.progress(tx, actor, [row]))[0];
    });
  }
  async patch(actor: Actor, id: string, body: unknown) {
    await this.access(actor);
    const { revision, ...input } = trainingPlanPatch.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      await this.own(tx, actor, id);
      const changed = await tx.algorithmTrainingPlan.updateMany({
        where: { id, ...this.scope(actor), revision },
        data: { ...input, revision: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('训练计划已在其他页面更新，请刷新后重试');
      return (await this.progress(tx, actor, [await this.own(tx, actor, id)]))[0];
    });
  }
  async delete(actor: Actor, id: string, body: unknown) {
    await this.access(actor);
    const { revision } = trainingPlanDelete.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      await this.own(tx, actor, id);
      const changed = await tx.algorithmTrainingPlan.deleteMany({
        where: { id, ...this.scope(actor), revision },
      });
      if (changed.count !== 1) throw new ConflictException('训练计划已在其他页面更新，请刷新后重试');
      return { ok: true };
    });
  }
}
