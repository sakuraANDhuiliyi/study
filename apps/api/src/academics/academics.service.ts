import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { Prisma, type AcademicsRecord } from '@prisma/client';
import type { Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { lockSecurityUser } from '../auth/security-transaction';
import { PrismaService } from '../common/prisma.service';
import { academicModules, getAcademicModule } from './academics.modules';
import { moduleSummary } from './academics.types';
import { evaluateAcademicModule, publicAcademicModule } from './academics.engine';
import {
  academicPreferencesInput,
  academicEvaluationInput,
  academicRecordQuery,
  academicRecordPatch,
  academicSubjectCreate,
  academicSubjectPatch,
  academicMajorCreate,
  academicMajorPatch,
} from './academics.schemas';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const selectedSubject = {
  id: true,
  organizationId: true,
  name: true,
  description: true,
  active: true,
  revision: true,
} as const;
const selectedMajor = { ...selectedSubject, subjectId: true, moduleIds: true } as const;

@Injectable()
export class AcademicsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  private scope(actor: Actor) {
    return { organizationId: actor.organizationId, userId: actor.id };
  }
  private directoryScope(actor: Actor) {
    return { OR: [{ organizationId: null }, { organizationId: actor.organizationId }] };
  }
  private async access(actor: Actor) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('学习工作台仅供学生使用');
    this.auth.require(actor, 'learning.use');
    await this.auth.checkFeature(actor, '/api/practice');
  }
  private admin(actor: Actor) {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role) || actor.accountMode === 'PERSONAL')
      throw new ForbiddenException('此操作仅供机构管理员使用');
    this.auth.require(actor, 'org.manage');
    this.auth.require(actor, 'users.manage');
  }
  private async current(tx: Tx, actor: Actor) {
    const verified = await tx.user.findUnique({ where: { id: actor.id } });
    if (!verified) throw new UnauthorizedException('登录已失效，请重新登录');
    await lockSecurityUser(tx, actor, verified);
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true } });
    if (!user.roles.some((role) => role.roleId === actor.role))
      throw new UnauthorizedException('账号身份已变化');
    return user;
  }
  private module(id: string) {
    const module = getAcademicModule(id);
    if (!module) throw new NotFoundException('学习模块不存在');
    return module;
  }
  private moduleIds(ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('学习模块不能重复');
    for (const id of ids) this.module(id);
    return ids;
  }
  private async subject(tx: Tx, actor: Actor, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "AcademicsSubject" WHERE "id" = ${id} FOR SHARE`;
    const row = await tx.academicsSubject.findFirst({
      where: { id, active: true, ...this.directoryScope(actor) },
      select: selectedSubject,
    });
    if (!row) throw new BadRequestException('所选学科不可用或不属于当前机构');
    return row;
  }
  private async personalMajor(tx: Tx, actor: Actor, id: string | null) {
    if (!id) return null;
    await tx.$queryRaw`SELECT "id" FROM "AcademicsMajor" WHERE "id" = ${id} FOR SHARE`;
    const row = await tx.academicsMajor.findFirst({
      where: { id, active: true, organizationId: null },
      select: selectedMajor,
    });
    if (!row) throw new BadRequestException('个人账号请选择开放的专业模板');
    await this.subject(tx, actor, row.subjectId);
    return row;
  }
  private recordDto(row: AcademicsRecord) {
    const { id, moduleId, title, values, result, notes, status, revision, createdAt, updatedAt } = row;
    return { id, moduleId, title, values, result, notes, status, revision, createdAt, updatedAt };
  }
  async catalog(actor: Actor) {
    const subjects = await this.db.academicsSubject.findMany({
      where: { ...this.directoryScope(actor), active: true },
      select: selectedSubject,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    const majors = await this.db.academicsMajor.findMany({
      where: { ...this.directoryScope(actor), active: true, subjectId: { in: subjects.map((s) => s.id) } },
      select: selectedMajor,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    return { subjects, majors, modules: academicModules.map(moduleSummary) };
  }
  async me(actor: Actor) {
    await this.access(actor);
    const where = this.scope(actor);
    const [user, preference, records, completed, groups, recentRecords] = await this.db.$transaction([
      this.db.user.findFirstOrThrow({
        where: { id: actor.id, organizationId: actor.organizationId },
        select: { accountMode: true, majorId: true },
      }),
      this.db.academicsPreference.findUnique({ where: { organizationId_userId: where } }),
      this.db.academicsRecord.count({ where }),
      this.db.academicsRecord.count({ where: { ...where, status: 'COMPLETED' } }),
      this.db.academicsRecord.groupBy({ by: ['moduleId'], where, orderBy: { moduleId: 'asc' } }),
      this.db.academicsRecord.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 8 }),
    ]);
    const major = user.majorId
      ? await this.db.academicsMajor.findFirst({
          where: { id: user.majorId, ...this.directoryScope(actor) },
          select: selectedMajor,
        })
      : null;
    const ids = new Set(major?.moduleIds ?? ['study-notebook', 'research-planning']);
    return {
      ...user,
      major,
      selectedModuleIds: preference?.selectedModuleIds ?? [],
      revision: preference?.revision ?? 0,
      stats: { records, completed, modulesPracticed: groups.length },
      recentRecords: recentRecords.map((row) => this.recordDto(row)),
      recommendations: academicModules.filter((module) => ids.has(module.id)).map(moduleSummary),
    };
  }
  async preferences(actor: Actor, body: unknown) {
    await this.access(actor);
    const input = academicPreferencesInput.parse(body);
    this.moduleIds(input.selectedModuleIds);
    return this.db.$transaction(async (tx) => {
      const user = await this.current(tx, actor);
      if (input.majorId !== undefined) {
        if (user.accountMode !== 'PERSONAL') throw new ForbiddenException('机构学生的专业由管理员设置');
        await this.personalMajor(tx, actor, input.majorId);
      }
      const where = this.scope(actor);
      const existing = await tx.academicsPreference.findUnique({ where: { organizationId_userId: where } });
      if ((existing?.revision ?? 0) !== input.revision)
        throw new ConflictException('偏好已在其他页面更新，请刷新后重试');
      const data = { selectedModuleIds: input.selectedModuleIds, revision: input.revision + 1 };
      const preference = existing
        ? await tx.academicsPreference.update({ where: { id: existing.id }, data })
        : await tx.academicsPreference.create({ data: { ...where, ...data } });
      if (input.majorId !== undefined)
        await tx.user.update({
          where: { id: actor.id },
          data: { majorId: input.majorId, personalMajorId: input.majorId },
        });
      return {
        revision: preference.revision,
        selectedModuleIds: preference.selectedModuleIds,
        majorId: input.majorId === undefined ? user.majorId : input.majorId,
      };
    });
  }
  async detail(actor: Actor, id: string) {
    await this.access(actor);
    return publicAcademicModule(this.module(id));
  }
  async evaluate(actor: Actor, id: string, body: unknown) {
    await this.access(actor);
    const input = academicEvaluationInput.parse(body),
      module = this.module(id);
    const result = await evaluateAcademicModule(module, input.values);
    // PostgreSQL expands decimal exponents and adds separators when rendering JSONB.
    // Check the actual stored envelope rather than letting a valid small JSON request hit a CHECK failure.
    const [budget] = await this.db.$queryRaw<{ inputBytes: number; resultBytes: number }[]>`
      SELECT octet_length(${JSON.stringify(input.values)}::jsonb::text) AS "inputBytes",
             octet_length(${JSON.stringify(result)}::jsonb::text) AS "resultBytes"
    `;
    if (budget.inputBytes > 98304 || budget.resultBytes > 262144)
      throw new BadRequestException('输入或计算结果过大，请减少数据数量或使用合适的数值范围');
    const fresh = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (!fresh || fresh.organizationId !== actor.organizationId || fresh.id !== actor.id)
      throw new ForbiddenException('当前学习会话已失效');
    await this.access(fresh);
    const record = await this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const where = this.scope(actor),
        now = Date.now();
      const [all, day, minute] = await Promise.all([
        tx.academicsRecord.count({ where }),
        tx.academicsRecord.count({ where: { ...where, createdAt: { gte: new Date(now - 86400000) } } }),
        tx.academicsRecord.count({ where: { ...where, createdAt: { gte: new Date(now - 60000) } } }),
      ]);
      if (all >= 5000) throw new ConflictException('学习记录已达到上限，请整理旧记录后再练习');
      if (day >= 200 || minute >= 20) throw new HttpException('练习过于频繁，请稍后再试', 429);
      return tx.academicsRecord.create({
        data: {
          ...where,
          moduleId: module.id,
          title: input.title ?? module.title,
          values: json(input.values),
          result: json(result),
        },
      });
    });
    return { record: this.recordDto(record), result };
  }
  async records(actor: Actor, query: unknown) {
    await this.access(actor);
    const input = academicRecordQuery.parse(query);
    if (input.moduleId) this.module(input.moduleId);
    const where = {
      ...this.scope(actor),
      ...(input.moduleId ? { moduleId: input.moduleId } : {}),
      ...(input.status === 'all' ? {} : { status: input.status }),
    };
    const [items, total] = await this.db.$transaction([
      this.db.academicsRecord.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.db.academicsRecord.count({ where }),
    ]);
    return {
      items: items.map((row) => this.recordDto(row)),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
  async record(actor: Actor, id: string) {
    await this.access(actor);
    const row = await this.db.academicsRecord.findFirst({ where: { ...this.scope(actor), id } });
    if (!row) throw new NotFoundException('学习记录不存在');
    return this.recordDto(row);
  }
  async patchRecord(actor: Actor, id: string, body: unknown) {
    await this.access(actor);
    const { revision, ...input } = academicRecordPatch.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const row = await tx.academicsRecord.findFirst({ where: { ...this.scope(actor), id } });
      if (!row) throw new NotFoundException('学习记录不存在');
      const changed = await tx.academicsRecord.updateMany({
        where: { id, ...this.scope(actor), revision },
        data: { ...input, revision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('记录已在其他页面更新，请刷新后重试');
      return this.recordDto(await tx.academicsRecord.findUniqueOrThrow({ where: { id } }));
    });
  }
  async deleteRecord(actor: Actor, id: string) {
    await this.access(actor);
    return this.db.$transaction(async (tx) => {
      await this.current(tx, actor);
      const removed = await tx.academicsRecord.deleteMany({ where: { ...this.scope(actor), id } });
      if (!removed.count) throw new NotFoundException('学习记录不存在');
      return { ok: true };
    });
  }
  async adminSubjects(actor: Actor) {
    this.admin(actor);
    return {
      items: await this.db.academicsSubject.findMany({
        where: this.directoryScope(actor),
        select: selectedSubject,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
    };
  }
  async adminMajors(actor: Actor) {
    this.admin(actor);
    return {
      items: await this.db.academicsMajor.findMany({
        where: this.directoryScope(actor),
        select: selectedMajor,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1000,
      }),
    };
  }
  private async catalogLock(tx: Tx, actor: Actor) {
    await this.current(tx, actor);
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${'academics-catalog:' + actor.organizationId}))`;
  }
  async createSubject(actor: Actor, body: unknown) {
    this.admin(actor);
    const input = academicSubjectCreate.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.catalogLock(tx, actor);
      if ((await tx.academicsSubject.count({ where: { organizationId: actor.organizationId } })) >= 200)
        throw new ConflictException('机构学科数量已达到上限');
      if (
        await tx.academicsSubject.findFirst({
          where: { organizationId: actor.organizationId, name: input.name },
        })
      )
        throw new ConflictException('机构已有同名学科');
      return tx.academicsSubject.create({
        data: { ...input, organizationId: actor.organizationId },
        select: selectedSubject,
      });
    });
  }
  async patchSubject(actor: Actor, id: string, body: unknown) {
    this.admin(actor);
    const { revision, ...input } = academicSubjectPatch.parse(body);
    return this.db.$transaction(async (tx) => {
      await this.catalogLock(tx, actor);
      await tx.$queryRaw`SELECT "id" FROM "AcademicsSubject" WHERE "id" = ${id} FOR UPDATE`;
      const row = await tx.academicsSubject.findFirst({ where: { id, ...this.directoryScope(actor) } });
      if (!row) throw new NotFoundException('学科不存在');
      if (row.organizationId === null) throw new ForbiddenException('公共学科模板只读，请创建机构自己的学科');
      if (
        input.name &&
        (await tx.academicsSubject.findFirst({
          where: { organizationId: actor.organizationId, name: input.name, id: { not: id } },
        }))
      )
        throw new ConflictException('机构已有同名学科');
      if (
        input.active === false &&
        (await tx.academicsMajor.count({ where: { subjectId: id, active: true } }))
      )
        throw new ConflictException('请先停用该学科下的专业');
      const changed = await tx.academicsSubject.updateMany({
        where: { id, organizationId: actor.organizationId, revision },
        data: { ...input, revision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('学科已被更新，请刷新后重试');
      return tx.academicsSubject.findUniqueOrThrow({ where: { id }, select: selectedSubject });
    });
  }
  async createMajor(actor: Actor, body: unknown) {
    this.admin(actor);
    const input = academicMajorCreate.parse(body);
    this.moduleIds(input.moduleIds);
    return this.db.$transaction(async (tx) => {
      await this.catalogLock(tx, actor);
      await this.subject(tx, actor, input.subjectId);
      if ((await tx.academicsMajor.count({ where: { organizationId: actor.organizationId } })) >= 500)
        throw new ConflictException('机构专业数量已达到上限');
      if (
        await tx.academicsMajor.findFirst({
          where: { organizationId: actor.organizationId, name: input.name },
        })
      )
        throw new ConflictException('机构已有同名专业');
      return tx.academicsMajor.create({
        data: { ...input, organizationId: actor.organizationId },
        select: selectedMajor,
      });
    });
  }
  async patchMajor(actor: Actor, id: string, body: unknown) {
    this.admin(actor);
    const { revision, ...input } = academicMajorPatch.parse(body);
    if (input.moduleIds) this.moduleIds(input.moduleIds);
    return this.db.$transaction(async (tx) => {
      await this.catalogLock(tx, actor);
      await tx.$queryRaw`SELECT "id" FROM "AcademicsMajor" WHERE "id" = ${id} FOR UPDATE`;
      const row = await tx.academicsMajor.findFirst({ where: { id, ...this.directoryScope(actor) } });
      if (!row) throw new NotFoundException('专业不存在');
      if (row.organizationId === null) throw new ForbiddenException('公共专业模板只读，请复制为机构专业');
      if (input.subjectId !== undefined || input.active !== false)
        await this.subject(tx, actor, input.subjectId ?? row.subjectId);
      if (
        input.name &&
        (await tx.academicsMajor.findFirst({
          where: { organizationId: actor.organizationId, name: input.name, id: { not: id } },
        }))
      )
        throw new ConflictException('机构已有同名专业');
      const changed = await tx.academicsMajor.updateMany({
        where: { id, organizationId: actor.organizationId, revision },
        data: { ...input, revision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('专业已被更新，请刷新后重试');
      return tx.academicsMajor.findUniqueOrThrow({ where: { id }, select: selectedMajor });
    });
  }
}
