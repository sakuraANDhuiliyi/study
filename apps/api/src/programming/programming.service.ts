import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Prisma,
  type ProgrammingProject,
  type ProgrammingVersion,
  type ProgrammingAiDraft,
} from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { lockSecurityUser } from '../auth/security-transaction';
import { PrismaService } from '../common/prisma.service';
import { AiGateway } from '../ai-study/ai.gateway';
import { ProgrammingGateway } from './programming.gateway';
import { ProgrammingPreviewService } from './programming-preview.service';
import {
  programmingFilesSchema,
  programmingLimits as limits,
  type ProgrammingFile,
} from './programming.schemas';
import { programmingTemplates, getProgrammingTemplate } from './programming.templates';
import { programmingZip } from './programming.archive';
import { createHash } from 'node:crypto';
import { creativeItems, type CreativeItem } from './creative.catalog';
import type { CreativeListQuery } from './creative.schemas';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const EXPIRED = '上次 AI 编程请求已超时，请重新生成。';
const safeErrors: Record<string, string> = {
  PROVIDER_FAILED: 'AI 暂时未能完成编程，请稍后重试。',
  PROVIDER_QUOTA: 'AI 服务额度不足或请求过多，请稍后重试或联系管理员。',
  PROVIDER_TIMEOUT: 'AI 编程请求超时，请减少材料后重试。',
  PROVIDER_CONFIGURATION: 'AI 服务认证或模型配置不可用，请联系管理员。',
  PROVIDER_RESPONSE: 'AI 未返回有效项目文件，请调整要求后重新生成。',
  PROVIDER_INPUT: '本次项目内容或要求无法处理，请减少文件或调整要求。',
  ACCESS_CHANGED: '当前学习权限或会话已变化，本次生成已停止。',
  LEASE_EXPIRED: EXPIRED,
};

@Injectable()
export class ProgrammingService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly gateway: ProgrammingGateway,
    private readonly ai: AiGateway,
    private readonly previews: ProgrammingPreviewService,
  ) {}
  private scope(actor: Actor) {
    return { organizationId: actor.organizationId, userId: actor.id };
  }
  private async access(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('编程工作室仅供当前学生身份使用');
    this.auth.require(actor, 'learning.use');
    await this.auth.checkFeature(actor, '/api/programming');
  }
  private async freshActor(actor: Actor) {
    const fresh = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (!fresh || fresh.id !== actor.id || fresh.organizationId !== actor.organizationId)
      throw new ForbiddenException('当前学习会话已失效');
    await this.access(fresh);
    return { ...fresh, requestId: actor.requestId };
  }
  private async lock(tx: Tx, actor: Actor) {
    // Match the lock used by student analysis, teacher authoring and web searches.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`ai-study:${actor.organizationId}:${actor.id}`}))`;
  }
  private async current(tx: Tx, actor: Actor) {
    await this.lock(tx, actor);
    const verified = await tx.user.findUnique({ where: { id: actor.id } });
    if (!verified) throw new UnauthorizedException('登录已失效，请重新登录');
    await lockSecurityUser(tx, actor, verified);
    if (actor.role !== 'STUDENT') throw new ForbiddenException('编程工作室仅供当前学生身份使用');
    const roles = await tx.$queryRaw<{ permissionId: string }[]>`
      SELECT p."permissionId" FROM "UserRole" u JOIN "RolePermission" p ON p."roleId" = u."roleId"
      WHERE u."userId" = ${actor.id} AND u."roleId" = 'STUDENT' AND p."permissionId" = 'learning.use'
      FOR SHARE OF u, p
    `;
    if (!roles.length) throw new ForbiddenException('当前学习权限已被撤销');
    const session =
      actor.sessionId && (await tx.session.findFirst({ where: { id: actor.sessionId, role: 'STUDENT' } }));
    if (!session) throw new UnauthorizedException('当前身份已变化，请重新登录');
    const settings = await tx.$queryRaw<{ value: { practice?: boolean } }[]>`
      SELECT value FROM "SystemSetting" WHERE "organizationId" = ${actor.organizationId} AND key = 'features' FOR SHARE
    `;
    if (settings[0]?.value?.practice === false) throw new ForbiddenException('机构已关闭此功能');
  }
  private async own(db: Tx | PrismaService, actor: Actor, id: string) {
    const project = await db.programmingProject.findFirst({ where: { ...this.scope(actor), id } });
    if (!project) throw new NotFoundException('编程项目不存在');
    return project;
  }
  private projectDto(project: ProgrammingProject) {
    return {
      id: project.id,
      title: project.title,
      templateId: project.templateId,
      revision: project.revision,
      files: programmingFilesSchema.parse(project.files),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }
  private versionDto(version: ProgrammingVersion, files = false) {
    return {
      id: version.id,
      number: version.number,
      note: version.note,
      createdAt: version.createdAt,
      ...(files ? { title: version.title, files: programmingFilesSchema.parse(version.files) } : {}),
    };
  }
  private draftDto(draft: ProgrammingAiDraft) {
    return {
      id: draft.id,
      projectId: draft.projectId,
      baseRevision: draft.baseRevision,
      status: draft.status,
      prompt: draft.prompt,
      summary: draft.summary,
      plan: draft.plan,
      teaching: draft.teaching,
      files: draft.files,
      model: draft.model,
      error: draft.error,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      appliedVersionId: draft.appliedVersionId,
    };
  }
  private async audit(
    tx: Tx,
    actor: Actor,
    action: string,
    projectId: string,
    details: Prisma.InputJsonValue = {},
  ) {
    await tx.auditLog.create({
      data: {
        ...this.scope(actor),
        action,
        resourceType: 'ProgrammingProject',
        resourceId: projectId,
        details,
        requestId: actor.requestId,
      },
    });
  }
  private revision(project: ProgrammingProject, revision: number) {
    if (project.revision !== revision) throw new ConflictException('项目已在其他页面更新，请刷新后重试');
    if (project.revision >= 2147483647) throw new ConflictException('项目版本号已达到上限');
  }
  private async nextVersion(tx: Tx, actor: Actor, project: ProgrammingProject, note: string) {
    const last = await tx.programmingVersion.findFirst({
      where: { ...this.scope(actor), projectId: project.id },
      orderBy: { number: 'desc' },
    });
    if ((last?.number ?? 0) >= limits.maxVersions)
      throw new ConflictException(`此项目已保存 ${limits.maxVersions} 个版本，请下载源码并创建新项目继续`);
    return tx.programmingVersion.create({
      data: {
        ...this.scope(actor),
        projectId: project.id,
        number: (last?.number ?? 0) + 1,
        title: project.title,
        note,
        files: json(programmingFilesSchema.parse(project.files)),
      },
    });
  }
  private async preserveCurrent(tx: Tx, actor: Actor, project: ProgrammingProject, note: string) {
    const last = await tx.programmingVersion.findFirst({
      where: { ...this.scope(actor), projectId: project.id },
      orderBy: { number: 'desc' },
    });
    // Preserve all saved draft edits before replacing them. Reuse a matching latest
    // snapshot so an unchanged draft does not consume two history slots.
    if (last?.title === project.title && JSON.stringify(last.files) === JSON.stringify(project.files)) return;
    await this.nextVersion(tx, actor, project, note);
  }
  async status(actor: Actor) {
    await this.access(actor);
    const status = this.ai.getStatus();
    return {
      ai: { ...status.analysis, model: status.model },
      preview: this.previews.status(),
      limits: { ...limits, dailyRequests: status.limits.dailyRequests },
      deployment: { available: false, reason: '本轮提供本地工作区与隔离预览，尚未配置公开域名或部署服务。' },
    };
  }
  async templates(actor: Actor) {
    await this.access(actor);
    return { items: programmingTemplates };
  }
  private creative(id: string) {
    const item = creativeItems.find((entry) => entry.id === id);
    if (!item) throw new NotFoundException('创意作品不存在');
    return item;
  }
  private creativeRevision(item: CreativeItem) {
    return createHash('sha256')
      .update(JSON.stringify({ source: item.source, files: item.files }))
      .digest('hex');
  }
  private creativeSummary(item: CreativeItem, saved: boolean) {
    return {
      id: item.id,
      edition: item.edition || 1,
      title: item.title,
      category: item.category,
      tags: item.tags,
      description: item.description,
      learningGoals: item.learningGoals,
      coverUrl: `/creative/${item.id}.png`,
      saved,
      source: {
        repository: item.source.repository,
        commit: item.source.commit,
        license: item.source.license,
        videos: item.source.videos,
      },
      revision: this.creativeRevision(item),
    };
  }
  async creativeList(actor: Actor, query: CreativeListQuery) {
    await this.access(actor);
    const bookmarks = await this.db.programmingCreativeFavorite.findMany({
      where: this.scope(actor),
      select: { creativeId: true },
    });
    const saved = new Set(bookmarks.map((entry) => entry.creativeId));
    const q = query.q.toLocaleLowerCase();
    const matched = creativeItems.filter(
      (item) =>
        (!query.category || item.category === query.category) &&
        (query.edition === 'all' || (item.edition === 2 ? 'new' : 'foundation') === query.edition) &&
        (query.collection !== 'saved' || saved.has(item.id)) &&
        (!q ||
          [
            item.title,
            item.description,
            item.category,
            ...item.tags,
            item.source.repository,
            ...item.source.videos.flatMap((video) => [video.platform, video.title, video.repository || '']),
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(q)),
    );
    return {
      items: matched
        .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
        .map((item) => this.creativeSummary(item, saved.has(item.id))),
      total: matched.length,
      totalCatalog: creativeItems.length,
      newCount: creativeItems.filter((item) => item.edition === 2).length,
      savedCount: creativeItems.filter((item) => saved.has(item.id)).length,
      categories: [...new Set(creativeItems.map((item) => item.category))].map((name) => ({
        name,
        count: creativeItems.filter((item) => item.category === name).length,
      })),
      repositoryCount: new Set(creativeItems.map((item) => item.source.repository)).size,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async creativeDetail(actor: Actor, id: string) {
    await this.access(actor);
    const item = this.creative(id);
    const saved = !!(await this.db.programmingCreativeFavorite.findUnique({
      where: { organizationId_userId_creativeId: { ...this.scope(actor), creativeId: id } },
    }));
    return {
      ...this.creativeSummary(item, saved),
      source: item.source,
      files: programmingFilesSchema.parse(item.files),
    };
  }
  async creativeFavorite(actor: Actor, id: string, input: { saved: boolean }) {
    await this.access(actor);
    this.creative(id);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const scope = { ...this.scope(actor), creativeId: id };
      if (input.saved)
        await tx.programmingCreativeFavorite.upsert({
          where: { organizationId_userId_creativeId: scope },
          create: scope,
          update: {},
        });
      else await tx.programmingCreativeFavorite.deleteMany({ where: scope });
      return { id, saved: input.saved };
    });
  }
  private checkedCreative(id: string, revision: string) {
    const item = this.creative(id);
    if (this.creativeRevision(item) !== revision)
      throw new ConflictException('创意源码已更新，请重新载入并审阅后操作');
    return item;
  }
  async creativePreview(actor: Actor, id: string, input: { revision: string }) {
    await this.access(actor);
    const item = this.checkedCreative(id, input.revision);
    return this.previews.issueCreative(actor, item.id, programmingFilesSchema.parse(item.files));
  }
  async creativeProject(actor: Actor, id: string, input: { title: string; revision: string }) {
    await this.access(actor);
    const item = this.checkedCreative(id, input.revision);
    const files = programmingFilesSchema.parse(item.files);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      if ((await tx.programmingProject.count({ where: this.scope(actor) })) >= limits.maxProjects)
        throw new ConflictException(`最多保存 ${limits.maxProjects} 个项目，请先下载并删除旧项目`);
      const project = await tx.programmingProject.create({
        data: { ...this.scope(actor), title: input.title, templateId: `creative:${id}`, files: json(files) },
      });
      await this.nextVersion(tx, actor, project, `从创意广场创建：${item.title}`.slice(0, 200));
      await this.audit(tx, actor, 'programming.creative.create', project.id, {
        creativeId: id,
        recipeRevision: input.revision,
        sourceRepository: item.source.repository,
        sourceCommit: item.source.commit,
      });
      return this.projectDto(project);
    });
  }
  async creativeExport(actor: Actor, id: string) {
    await this.access(actor);
    return {
      filename: `creative-${this.creative(id).id}.zip`,
      buffer: programmingZip(programmingFilesSchema.parse(this.creative(id).files)),
    };
  }
  async list(actor: Actor, query: { page: number; pageSize: number }) {
    await this.access(actor);
    const [items, total] = await this.db.$transaction(
      [
        this.db.programmingProject.findMany({
          where: this.scope(actor),
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: query.pageSize,
          skip: (query.page - 1) * query.pageSize,
        }),
        this.db.programmingProject.count({ where: this.scope(actor) }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: items.map(({ files, ...row }) => ({
        id: row.id,
        title: row.title,
        templateId: row.templateId,
        revision: row.revision,
        fileCount: Array.isArray(files) ? files.length : 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      total,
      ...query,
    };
  }
  async create(actor: Actor, input: { title: string; templateId: string }) {
    await this.access(actor);
    const template = getProgrammingTemplate(input.templateId);
    if (!template) throw new BadRequestException('请选择有效的项目模板');
    const files = programmingFilesSchema.parse(template.files);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      if ((await tx.programmingProject.count({ where: this.scope(actor) })) >= limits.maxProjects)
        throw new ConflictException(`最多保存 ${limits.maxProjects} 个项目，请先下载并删除旧项目`);
      const project = await tx.programmingProject.create({
        data: {
          ...this.scope(actor),
          title: input.title,
          templateId: input.templateId,
          files: json(files),
        },
      });
      await this.nextVersion(tx, actor, project, '创建项目');
      await this.audit(tx, actor, 'programming.create', project.id, { templateId: input.templateId });
      return this.projectDto(project);
    });
  }
  async detail(actor: Actor, id: string) {
    await this.access(actor);
    return this.projectDto(await this.own(this.db, actor, id));
  }
  async update(
    actor: Actor,
    id: string,
    input: { revision: number; title: string; files: ProgrammingFile[] },
  ) {
    await this.access(actor);
    const files = programmingFilesSchema.parse(input.files);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const project = await this.own(tx, actor, id);
      this.revision(project, input.revision);
      this.checkCreativeAttribution(project, files);
      const updated = await tx.programmingProject.update({
        where: { id },
        data: {
          title: input.title,
          files: json(files),
          revision: { increment: 1 },
        },
      });
      await this.audit(tx, actor, 'programming.update', id, {
        revision: updated.revision,
        fileCount: files.length,
      });
      return this.projectDto(updated);
    });
  }
  private async recover(tx: Tx, actor: Actor) {
    const now = new Date();
    const expired = await tx.aiStudyOperation.findMany({
      where: {
        ...this.scope(actor),
        status: 'pending',
        leaseExpiresAt: { lte: now },
      },
    });
    for (const operation of expired) {
      await tx.aiStudyOperation.update({
        where: { id: operation.id },
        data: {
          status: 'failed',
          errorCode: 'LEASE_EXPIRED',
          completedAt: now,
        },
      });
      if (operation.reportId && operation.kind === 'analysis')
        await tx.aiStudyReport.updateMany({
          where: { id: operation.reportId, status: 'pending' },
          data: { status: 'failed', error: EXPIRED },
        });
      if (operation.reportId && operation.kind === 'search')
        await tx.aiStudyReport.updateMany({
          where: { id: operation.reportId },
          data: { searchError: EXPIRED },
        });
    }
    await tx.$executeRaw`UPDATE "ProgrammingAiDraft" d SET status = 'failed', error = ${EXPIRED}, "updatedAt" = ${now}
      WHERE d."organizationId" = ${actor.organizationId} AND d."userId" = ${actor.id} AND d.status = 'pending'
      AND EXISTS (SELECT 1 FROM "AiStudyOperation" o WHERE o.id = d."operationId" AND o.status = 'failed')`;
    // Keep the existing entry point consistent if it was recovered here.
    await tx.$executeRaw`UPDATE "AiAuthoringDraft" d SET status = 'failed', error = ${EXPIRED}, revision = revision + 1, "updatedAt" = ${now}
      WHERE d."organizationId" = ${actor.organizationId} AND d."userId" = ${actor.id} AND d.status = 'pending'
      AND EXISTS (SELECT 1 FROM "AiStudyOperation" o WHERE o.id = d."operationId" AND o.status = 'failed')`;
  }
  private checkCreativeAttribution(project: ProgrammingProject, files: ProgrammingFile[]) {
    if (!project.templateId.startsWith('creative:')) return;
    const notice = programmingFilesSchema.parse(project.files).find((file) => file.path === 'NOTICE.txt');
    if (!notice || !files.some((file) => file.path === notice.path && file.content === notice.content))
      throw new BadRequestException('请完整保留 NOTICE.txt 中的来源归属与许可，其他界面源码可以继续修改');
  }
  async remove(actor: Actor, id: string) {
    await this.access(actor);
    await this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      await this.recover(tx, actor);
      await this.own(tx, actor, id);
      if (
        await tx.programmingAiDraft.count({
          where: { ...this.scope(actor), projectId: id, status: 'pending' },
        })
      )
        throw new ConflictException('项目的 AI 请求仍在处理，请等待完成后删除');
      // Delete referencing drafts first. The operation ledger intentionally survives deletion.
      await tx.programmingAiDraft.deleteMany({ where: { ...this.scope(actor), projectId: id } });
      await tx.programmingVersion.deleteMany({ where: { ...this.scope(actor), projectId: id } });
      await tx.programmingProject.delete({ where: { id } });
      await this.audit(tx, actor, 'programming.delete', id);
    });
    this.previews.revokeProject(id);
    return { ok: true };
  }
  async versions(actor: Actor, id: string) {
    await this.access(actor);
    await this.own(this.db, actor, id);
    const rows = await this.db.programmingVersion.findMany({
      where: { ...this.scope(actor), projectId: id },
      orderBy: { number: 'desc' },
      take: limits.maxVersions,
    });
    return { items: rows.map((row) => this.versionDto(row)) };
  }
  private async ownVersion(db: Tx | PrismaService, actor: Actor, projectId: string, id: string) {
    const row = await db.programmingVersion.findFirst({ where: { id, projectId, ...this.scope(actor) } });
    if (!row) throw new NotFoundException('项目版本不存在');
    return row;
  }
  async version(actor: Actor, id: string, versionId: string) {
    await this.access(actor);
    await this.own(this.db, actor, id);
    return this.versionDto(await this.ownVersion(this.db, actor, id, versionId), true);
  }
  async saveVersion(actor: Actor, id: string, input: { revision: number; note: string }) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const project = await this.own(tx, actor, id);
      this.revision(project, input.revision);
      const version = await this.nextVersion(tx, actor, project, input.note);
      const updated = await tx.programmingProject.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      await this.audit(tx, actor, 'programming.version', id, {
        versionId: version.id,
        number: version.number,
      });
      return { project: this.projectDto(updated), version: this.versionDto(version) };
    });
  }
  async restore(actor: Actor, id: string, input: { revision: number; versionId: string }) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const project = await this.own(tx, actor, id);
      this.revision(project, input.revision);
      const version = await this.ownVersion(tx, actor, id, input.versionId);
      await this.preserveCurrent(tx, actor, project, `恢复版本 ${version.number} 前的草稿`);
      const updated = await tx.programmingProject.update({
        where: { id },
        data: {
          title: version.title,
          files: json(programmingFilesSchema.parse(version.files)),
          revision: { increment: 1 },
        },
      });
      await this.nextVersion(tx, actor, updated, `恢复版本 ${version.number}`);
      await this.audit(tx, actor, 'programming.restore', id, { versionId: version.id });
      return this.projectDto(updated);
    });
  }
  async export(actor: Actor, id: string) {
    await this.access(actor);
    const project = await this.own(this.db, actor, id);
    return {
      filename: `programming-${project.id}.zip`,
      buffer: programmingZip(programmingFilesSchema.parse(project.files)),
    };
  }
  async preview(actor: Actor, id: string, input: { revision: number; files: ProgrammingFile[] }) {
    await this.access(actor);
    const project = await this.own(this.db, actor, id);
    this.revision(project, input.revision);
    return this.previews.issue(actor, project, programmingFilesSchema.parse(input.files));
  }
  private async reserve(actor: Actor, projectId: string, input: { revision: number; prompt: string }) {
    const settings = this.ai.getLimits();
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      await this.recover(tx, actor);
      const project = await this.own(tx, actor, projectId);
      this.revision(project, input.revision);
      if (
        (await tx.programmingAiDraft.count({ where: { ...this.scope(actor), projectId } })) >=
        limits.maxAiDrafts
      )
        throw new ConflictException(
          `此项目已有 ${limits.maxAiDrafts} 个 AI 草稿，请下载源码并创建新项目继续`,
        );
      if (await tx.aiStudyOperation.count({ where: { ...this.scope(actor), status: 'pending' } }))
        throw new ConflictException('已有 AI 请求正在处理，请等待完成');
      const now = new Date(),
        shifted = new Date(now.getTime() + 8 * 3600000);
      const day = new Date(
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600000,
      );
      if (
        (await tx.aiStudyOperation.count({
          where: { ...this.scope(actor), createdAt: { gte: day, lt: new Date(day.getTime() + 86400000) } },
        })) >= settings.dailyRequests
      )
        throw new HttpException('今日 AI、联网搜索和资料下载额度已用完，请明天再试', 429);
      const operation = await tx.aiStudyOperation.create({
        data: {
          ...this.scope(actor),
          kind: 'programming',
          leaseExpiresAt: new Date(now.getTime() + settings.timeoutMs + 30000),
        },
      });
      const draft = await tx.programmingAiDraft.create({
        data: {
          ...this.scope(actor),
          projectId,
          operationId: operation.id,
          baseRevision: project.revision,
          prompt: input.prompt,
          model: this.ai.getStatus().model,
        },
      });
      await this.audit(tx, actor, 'programming.ai.generate', projectId, {
        draftId: draft.id,
        baseRevision: project.revision,
      });
      return { draft, project };
    });
  }
  private errorCode(error: unknown) {
    if (!(error instanceof HttpException)) return 'PROVIDER_FAILED';
    return (
      (
        {
          400: 'PROVIDER_INPUT',
          401: 'ACCESS_CHANGED',
          403: 'ACCESS_CHANGED',
          404: 'ACCESS_CHANGED',
          409: 'LEASE_EXPIRED',
          429: 'PROVIDER_QUOTA',
          502: 'PROVIDER_RESPONSE',
          503: 'PROVIDER_CONFIGURATION',
          504: 'PROVIDER_TIMEOUT',
        } as Record<number, string>
      )[error.getStatus()] ?? 'PROVIDER_FAILED'
    );
  }
  private async fail(actor: Actor, draft: ProgrammingAiDraft, code: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const changed = await tx.aiStudyOperation.updateMany({
        where: { id: draft.operationId, status: 'pending' },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorCode: code,
        },
      });
      if (changed.count)
        await tx.programmingAiDraft.updateMany({
          where: { id: draft.id, status: 'pending' },
          data: {
            status: 'failed',
            error: safeErrors[code] ?? safeErrors.PROVIDER_FAILED,
          },
        });
      await this.recover(tx, actor);
    });
  }
  async generate(actor: Actor, id: string, input: { revision: number; prompt: string }) {
    await this.access(actor);
    await this.own(this.db, actor, id);
    const status = this.ai.getStatus();
    if (!status.analysis.available) throw new ServiceUnavailableException(status.analysis.reason);
    const { draft, project } = await this.reserve(actor, id, input);
    try {
      const result = await this.gateway.generate({
        title: project.title,
        prompt: input.prompt,
        files: programmingFilesSchema.parse(project.files),
      });
      const fresh = await this.freshActor(actor);
      await this.db.$transaction(async (tx) => {
        await this.current(tx, fresh);
        await this.own(tx, fresh, id);
        const operation = await tx.aiStudyOperation.findUniqueOrThrow({ where: { id: draft.operationId } });
        if (operation.status !== 'pending' || operation.leaseExpiresAt <= new Date())
          throw new ConflictException('AI 编程请求已过期，请重新发起');
        await tx.aiStudyOperation.update({
          where: { id: operation.id },
          data: { status: 'completed', completedAt: new Date() },
        });
        await tx.programmingAiDraft.update({
          where: { id: draft.id },
          data: {
            status: 'ready',
            summary: result.summary,
            plan: json(result.plan),
            teaching: json(result.teaching),
            files: json(programmingFilesSchema.parse(result.files)),
          },
        });
        await this.audit(tx, fresh, 'programming.ai.generated', id, {
          draftId: draft.id,
          fileCount: result.files.length,
        });
      });
      return this.draft(fresh, id, draft.id);
    } catch (error) {
      await this.fail(actor, draft, this.errorCode(error));
      if (error instanceof HttpException && [401, 403, 404, 409].includes(error.getStatus())) throw error;
      return this.draft(await this.freshActor(actor), id, draft.id);
    }
  }
  private async recoverPending(actor: Actor) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, actor);
      await this.recover(tx, actor);
    });
  }
  async drafts(actor: Actor, id: string) {
    await this.access(actor);
    await this.own(this.db, actor, id);
    await this.recoverPending(actor);
    const rows = await this.db.programmingAiDraft.findMany({
      where: { ...this.scope(actor), projectId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limits.maxAiDrafts,
    });
    return { items: rows.map((row) => this.draftDto(row)) };
  }
  private async ownDraft(db: Tx | PrismaService, actor: Actor, projectId: string, id: string) {
    const draft = await db.programmingAiDraft.findFirst({ where: { ...this.scope(actor), projectId, id } });
    if (!draft) throw new NotFoundException('AI 编程草稿不存在');
    return draft;
  }
  async draft(actor: Actor, id: string, draftId: string) {
    await this.access(actor);
    await this.own(this.db, actor, id);
    await this.recoverPending(actor);
    return this.draftDto(await this.ownDraft(this.db, actor, id, draftId));
  }
  async apply(actor: Actor, id: string, draftId: string, input: { revision: number }) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      await this.recover(tx, actor);
      const project = await this.own(tx, actor, id),
        draft = await this.ownDraft(tx, actor, id, draftId);
      if (draft.status === 'applied')
        return { project: draft.appliedProjectSnapshot, draft: this.draftDto(draft) };
      if (draft.status !== 'ready') throw new ConflictException('仅生成完成的 AI 草稿可以应用');
      this.revision(project, input.revision);
      if (project.revision !== draft.baseRevision)
        throw new ConflictException('项目已在 AI 生成后编辑，请查看差异并重新生成');
      this.checkCreativeAttribution(project, programmingFilesSchema.parse(draft.files));
      await this.preserveCurrent(tx, actor, project, '应用 AI 编程草稿前的草稿');
      const updated = await tx.programmingProject.update({
        where: { id },
        data: {
          files: json(programmingFilesSchema.parse(draft.files)),
          revision: { increment: 1 },
        },
      });
      const version = await this.nextVersion(tx, actor, updated, '应用 AI 编程草稿');
      const saved = await tx.programmingAiDraft.update({
        where: { id: draftId },
        data: {
          status: 'applied',
          appliedVersionId: version.id,
          appliedProjectSnapshot: json(this.projectDto(updated)),
        },
      });
      await this.audit(tx, actor, 'programming.ai.apply', id, {
        draftId,
        versionId: version.id,
        revision: updated.revision,
      });
      return { project: this.projectDto(updated), draft: this.draftDto(saved) };
    });
  }
}
