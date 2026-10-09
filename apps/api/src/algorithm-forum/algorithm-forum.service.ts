import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type AlgorithmForumPost, type AlgorithmForumReply } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { lockSecurityUser } from '../auth/security-transaction';
import { PrismaService } from '../common/prisma.service';
import { algorithmProblems, getAlgorithmProblem } from '../algorithms/algorithms.catalog';
import {
  forumLimits,
  type ForumListQuery,
  type ForumPostInput,
  type ForumPostUpdateInput,
  type ForumModerationInput,
  type ForumPageQuery,
} from './algorithm-forum.schemas';
type Tx = Prisma.TransactionClient;
export function forumAuthorLabel(id: string) {
  return `学习者·${createHash('sha256').update(`algorithm-forum:${id}`).digest('hex').slice(0, 8)}`;
}
export function forumCanWrite(actor: Actor) {
  return actor.role === 'STUDENT'
    ? actor.permissions.includes('learning.use')
    : actor.permissions.includes('communication.write');
}
export function forumCanModerate(actor: Actor, organizationId: string) {
  return (
    actor.permissions.includes('communication.moderate') &&
    (actor.organizationId === organizationId ||
      (actor.role === 'SUPER_ADMIN' && actor.permissions.includes('org.platform')))
  );
}
export function forumVisibleWhere(actor: Actor, scope?: string): Prisma.AlgorithmForumPostWhereInput {
  return {
    deletedAt: null,
    ...(scope === 'public'
      ? { scope: 'public' }
      : scope === 'organization'
        ? { scope: 'organization', organizationId: actor.organizationId }
        : { OR: [{ scope: 'public' }, { scope: 'organization', organizationId: actor.organizationId }] }),
  };
}
@Injectable()
export class AlgorithmForumService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  private async access(actor: Actor) {
    await this.auth.checkFeature(actor, '/api/algorithm-forum');
  }
  private own(actor: Actor, row: { authorId: string; organizationId: string }) {
    return actor.id === row.authorId && actor.organizationId === row.organizationId;
  }
  private async current(tx: Tx, actor: Actor) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`algorithm-forum:${actor.id}`}))`;
    const user = await tx.user.findUnique({ where: { id: actor.id } });
    if (!user) throw new UnauthorizedException('登录已失效');
    await lockSecurityUser(tx, actor, user);
    const session =
      actor.sessionId && (await tx.session.findFirst({ where: { id: actor.sessionId, role: actor.role } }));
    if (!session) throw new UnauthorizedException('当前身份已变化，请重新登录');
    const permissions = await tx.$queryRaw<
      { permissionId: string }[]
    >`SELECT p."permissionId" FROM "UserRole" u JOIN "RolePermission" p ON p."roleId" = u."roleId" WHERE u."userId" = ${actor.id} AND u."roleId" = ${actor.role} FOR SHARE OF u,p`;
    const fresh = {
      ...actor,
      accountMode: user.accountMode,
      permissions: permissions.map((p) => p.permissionId),
    };
    const settings = await tx.$queryRaw<
      { value: { practice?: boolean; communication?: boolean } }[]
    >`SELECT value FROM "SystemSetting" WHERE "organizationId" = ${actor.organizationId} AND key = 'features' FOR SHARE`;
    if (settings[0]?.value?.practice === false || settings[0]?.value?.communication === false)
      throw new ForbiddenException('机构已关闭此功能');
    return fresh;
  }
  private async rate(tx: Tx, actor: Actor) {
    const since = new Date(Date.now() - 86400000);
    const [daily, minute] = await Promise.all([
      tx.auditLog.count({
        where: { userId: actor.id, action: { startsWith: 'algorithm-forum.' }, createdAt: { gt: since } },
      }),
      tx.auditLog.count({
        where: {
          userId: actor.id,
          action: { startsWith: 'algorithm-forum.' },
          createdAt: { gt: new Date(Date.now() - 60000) },
        },
      }),
    ]);
    if (daily >= forumLimits.writesPerDay || minute >= forumLimits.writesPerMinute)
      throw new HttpException('发言或修改过于频繁，请稍后再试', 429);
    const muted = await tx.communicationMute.findFirst({
      where: {
        organizationId: actor.organizationId,
        userId: actor.id,
        courseId: null,
        classId: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (muted) throw new ForbiddenException('当前账号被禁言，暂不能发表或修改算法讨论');
  }
  private audit(tx: Tx, actor: Actor, action: string, id: string, details: Prisma.InputJsonValue = {}) {
    return tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        action: `algorithm-forum.${action}`,
        resourceType: 'AlgorithmForum',
        resourceId: id,
        details,
        requestId: actor.requestId,
      },
    });
  }
  private revision(row: { revision: number }, expected: number) {
    if (row.revision !== expected || row.revision >= 2147483647)
      throw new ConflictException('讨论已更新，请刷新后重试；当前输入不会被自动覆盖');
  }
  private async post(db: Tx | PrismaService, actor: Actor, id: string, lock = false) {
    if (lock) await db.$queryRaw`SELECT id FROM "AlgorithmForumPost" WHERE id = ${id} FOR UPDATE`;
    const row = await db.algorithmForumPost.findFirst({ where: { id, ...forumVisibleWhere(actor) } });
    if (!row) throw new NotFoundException('讨论不存在或不可访问');
    return row;
  }
  private postDto(actor: Actor, row: AlgorithmForumPost, replyCount = 0, detail = false) {
    const problem = row.problemId ? getAlgorithmProblem(row.problemId) : undefined;
    const own = this.own(actor, row),
      moderate = forumCanModerate(actor, row.organizationId);
    return {
      id: row.id,
      scope: row.scope,
      kind: row.kind,
      title: row.title,
      ...(detail ? { body: row.body } : { excerpt: row.body.slice(0, 180) }),
      problemId: row.problemId,
      problem: problem ? { id: problem.id, number: problem.number, title: problem.title } : null,
      revision: row.revision,
      pinned: row.pinned,
      closed: row.closed,
      solved: row.solved,
      authorLabel: forumAuthorLabel(row.authorId),
      isOwn: own,
      canEdit: own && forumCanWrite(actor),
      canDelete: (own && forumCanWrite(actor)) || moderate,
      canModerate: moderate,
      canSolve: moderate || (own && forumCanWrite(actor)),
      replyCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  private replyDto(actor: Actor, row: AlgorithmForumReply) {
    return {
      id: row.id,
      body: row.body,
      revision: row.revision,
      authorLabel: forumAuthorLabel(row.authorId),
      isOwn: this.own(actor, row),
      canDelete:
        (this.own(actor, row) && forumCanWrite(actor)) || forumCanModerate(actor, row.organizationId),
      createdAt: row.createdAt,
    };
  }
  async status(actor: Actor) {
    await this.access(actor);
    return {
      canWrite: forumCanWrite(actor),
      canOrganization: actor.accountMode !== 'PERSONAL',
      limits: forumLimits,
      problems: algorithmProblems.map(({ id, number, title }) => ({ id, number, title })),
    };
  }
  async list(actor: Actor, query: ForumListQuery) {
    await this.access(actor);
    if (query.scope === 'organization' && actor.accountMode === 'PERSONAL')
      throw new ForbiddenException('个人空间没有机构讨论区，请查看公共社区');
    if (query.problemId && !getAlgorithmProblem(query.problemId)) throw new NotFoundException('算法题不存在');
    const where: Prisma.AlgorithmForumPostWhereInput = {
      ...forumVisibleWhere(actor, query.scope),
      ...(query.problemId ? { problemId: query.problemId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.solved ? { solved: query.solved === 'true' } : {}),
      ...(query.q
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: query.q, mode: 'insensitive' } },
                  { body: { contains: query.q, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.algorithmForumPost.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
      }),
      this.db.algorithmForumPost.count({ where }),
    ]);
    const counts = await this.db.algorithmForumReply.groupBy({
      by: ['postId'],
      where: { postId: { in: items.map((p) => p.id) }, deletedAt: null },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.postId, c._count._all]));
    return {
      items: items.map((row) => this.postDto(actor, row, byId.get(row.id) || 0)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async detail(actor: Actor, id: string) {
    await this.access(actor);
    const row = await this.post(this.db, actor, id);
    const count = await this.db.algorithmForumReply.count({ where: { postId: id, deletedAt: null } });
    return this.postDto(actor, row, count, true);
  }
  async create(actor: Actor, input: ForumPostInput) {
    await this.access(actor);
    if (input.problemId && !getAlgorithmProblem(input.problemId)) throw new NotFoundException('算法题不存在');
    return this.db.$transaction(async (tx) => {
      const fresh = await this.current(tx, actor);
      if (!forumCanWrite(fresh)) throw new ForbiddenException('当前身份没有算法论坛发言权限');
      if (input.scope === 'organization' && fresh.accountMode === 'PERSONAL')
        throw new ForbiddenException('个人空间只能向公共社区发帖');
      await this.rate(tx, fresh);
      if ((await tx.algorithmForumPost.count({ where: { authorId: actor.id } })) >= forumLimits.maxPosts)
        throw new ConflictException('已达到 100 篇讨论上限，请联系管理员');
      const row = await tx.algorithmForumPost.create({
        data: { ...input, organizationId: actor.organizationId, authorId: actor.id },
      });
      await this.audit(tx, actor, 'post.create', row.id, {
        scope: row.scope,
        kind: row.kind,
        problemId: row.problemId,
      });
      return this.postDto(fresh, row, 0, true);
    });
  }
  async update(actor: Actor, id: string, input: ForumPostUpdateInput) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      const fresh = await this.current(tx, actor),
        row = await this.post(tx, fresh, id, true);
      if (!this.own(fresh, row) || !forumCanWrite(fresh)) throw new ForbiddenException('仅作者可修改内容');
      if (row.closed) throw new ConflictException('讨论已关闭，不能修改内容');
      this.revision(row, input.revision);
      await this.rate(tx, fresh);
      const updated = await tx.algorithmForumPost.update({
        where: { id },
        data: { title: input.title, body: input.body, revision: { increment: 1 } },
      });
      await this.audit(tx, actor, 'post.update', id, { revision: updated.revision });
      const replies = await tx.algorithmForumReply.count({ where: { postId: id, deletedAt: null } });
      return this.postDto(fresh, updated, replies, true);
    });
  }
  async remove(actor: Actor, id: string, revision: number) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      const fresh = await this.current(tx, actor),
        row = await this.post(tx, fresh, id, true);
      if (!(this.own(fresh, row) && forumCanWrite(fresh)) && !forumCanModerate(fresh, row.organizationId))
        throw new ForbiddenException('没有删除此讨论的权限');
      this.revision(row, revision);
      await this.rate(tx, fresh);
      await tx.algorithmForumPost.update({
        where: { id },
        data: { deletedAt: new Date(), revision: { increment: 1 } },
      });
      await this.audit(tx, actor, 'post.delete', id, { scope: row.scope });
      return { ok: true };
    });
  }
  async moderate(actor: Actor, id: string, input: ForumModerationInput) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      const fresh = await this.current(tx, actor),
        row = await this.post(tx, fresh, id, true);
      const moderation = forumCanModerate(fresh, row.organizationId);
      if (
        !moderation &&
        (!this.own(fresh, row) ||
          !forumCanWrite(fresh) ||
          input.pinned !== undefined ||
          input.closed !== undefined ||
          input.solved === undefined)
      )
        throw new ForbiddenException('没有管理此讨论的权限');
      this.revision(row, input.revision);
      await this.rate(tx, fresh);
      const { revision: _revision, ...flags } = input;
      const updated = await tx.algorithmForumPost.update({
        where: { id },
        data: { ...flags, revision: { increment: 1 } },
      });
      await this.audit(tx, actor, 'post.moderate', id, flags);
      const replies = await tx.algorithmForumReply.count({ where: { postId: id, deletedAt: null } });
      return this.postDto(fresh, updated, replies, true);
    });
  }
  async replies(actor: Actor, id: string, query: ForumPageQuery) {
    await this.access(actor);
    await this.post(this.db, actor, id);
    const where = { postId: id, deletedAt: null };
    const [items, total] = await Promise.all([
      this.db.algorithmForumReply.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.algorithmForumReply.count({ where }),
    ]);
    return {
      items: items.map((row) => this.replyDto(actor, row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async reply(actor: Actor, id: string, input: { postRevision: number; body: string }) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      const fresh = await this.current(tx, actor);
      if (!forumCanWrite(fresh)) throw new ForbiddenException('当前身份没有回复权限');
      const post = await this.post(tx, fresh, id, true);
      this.revision(post, input.postRevision);
      if (post.closed) throw new ConflictException('讨论已关闭，不再接受回复');
      await this.rate(tx, fresh);
      if ((await tx.algorithmForumReply.count({ where: { authorId: actor.id } })) >= forumLimits.maxReplies)
        throw new ConflictException('已达到回复数量上限');
      const row = await tx.algorithmForumReply.create({
        data: { postId: id, organizationId: actor.organizationId, authorId: actor.id, body: input.body },
      });
      await this.audit(tx, actor, 'reply.create', row.id, { postId: id });
      return this.replyDto(fresh, row);
    });
  }
  async removeReply(actor: Actor, postId: string, id: string, revision: number) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      const fresh = await this.current(tx, actor);
      await this.post(tx, fresh, postId, true);
      const row = await tx.algorithmForumReply.findFirst({ where: { id, postId, deletedAt: null } });
      if (!row) throw new NotFoundException('回复不存在');
      if (!(this.own(fresh, row) && forumCanWrite(fresh)) && !forumCanModerate(fresh, row.organizationId))
        throw new ForbiddenException('没有删除此回复的权限');
      this.revision(row, revision);
      await this.rate(tx, fresh);
      await tx.algorithmForumReply.update({
        where: { id },
        data: { deletedAt: new Date(), revision: { increment: 1 } },
      });
      await this.audit(tx, actor, 'reply.delete', id, { postId });
      return { ok: true };
    });
  }
}
