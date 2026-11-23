import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { emptyFocusQuery, focusId, focusInput, focusQuery, focusSummary } from './focus-data';

type Owner = { organizationId: string; userId: string };
const fields = {
  id: true,
  title: true,
  category: true,
  mode: true,
  plannedMinutes: true,
  actualSeconds: true,
  status: true,
  reflection: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
} as const;

@ApiTags('私人专注空间')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('focus')
export class FocusController {
  constructor(private readonly db: PrismaService) {}

  private audit(tx: Prisma.TransactionClient, actor: Actor, action: string, id: string) {
    return tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        action: 'focus.session.' + action,
        resourceType: 'FocusSession',
        resourceId: id,
        requestId: actor.requestId,
        details: {},
      },
    });
  }

  private async scoped<T>(
    actor: Actor,
    action: string,
    run: (tx: Prisma.TransactionClient, owner: Owner) => Promise<T>,
  ) {
    const result = await this.db.$transaction(async (tx) => {
      // Serialize retries, history/count snapshots and deletion within this private space.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${'focus:' + actor.organizationId + ':' + actor.id}))`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id} FOR SHARE`;
      if (actor.sessionId)
        await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id"=${actor.sessionId} FOR SHARE`;
      const auth = new AuthService(tx as PrismaService);
      const current =
        actor.sessionId &&
        (await (actor.clientType === 'MOBILE'
          ? auth.resolveMobileSessionId(actor.sessionId)
          : auth.resolveSessionId(actor.sessionId)));
      if (
        !current ||
        current.id !== actor.id ||
        current.organizationId !== actor.organizationId ||
        current.role !== actor.role ||
        current.accountMode !== actor.accountMode ||
        current.clientType !== (actor.clientType === 'MOBILE' ? 'MOBILE' : 'WEB') ||
        (actor.clientType !== 'MOBILE' && current.csrfToken !== actor.csrfToken)
      )
        throw new UnauthorizedException('登录身份或学习空间已变化，请刷新');
      if (current.role !== 'STUDENT' || !current.permissions.includes('learning.use')) {
        await this.audit(tx, actor, action + '.denied', 'scope');
        return { denied: true } as const;
      }
      return {
        denied: false,
        value: await run(tx, { organizationId: current.organizationId, userId: current.id }),
      } as const;
    });
    if (result.denied) throw new ForbiddenException('专注空间仅供有学习权限的学生使用');
    return result.value;
  }

  @Get('sessions')
  list(@CurrentActor() actor: Actor, @Query() params: unknown) {
    return this.scoped(actor, 'list', async (tx, owner) => {
      const { category, status, page, pageSize } = focusQuery.parse(params);
      const where = { ...owner, category, status };
      const items = await tx.focusSession.findMany({
        where,
        select: fields,
        orderBy: [{ endedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      const total = await tx.focusSession.count({ where });
      return { items, total, page, pageSize };
    });
  }

  @Get('summary')
  summary(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.scoped(actor, 'summary', async (tx, owner) => {
      emptyFocusQuery.parse(query);
      const now = new Date();
      const rows = await tx.$queryRaw<{ date: string; seconds: number; completedCount: number }[]>`
        SELECT to_char("endedAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date,
               SUM("actualSeconds")::double precision AS seconds, COUNT(*)::double precision AS "completedCount"
        FROM "FocusSession" WHERE "organizationId"=${owner.organizationId} AND "userId"=${owner.userId}
          AND "mode"='FOCUS' AND "status"='COMPLETED'
        GROUP BY 1`;
      return focusSummary(rows, now);
    });
  }

  @Post('sessions')
  create(@CurrentActor() actor: Actor, @Body() input: unknown, @Query() params: unknown) {
    return this.scoped(actor, 'create', async (tx, owner) => {
      emptyFocusQuery.parse(params);
      const data = focusInput.parse(input);
      const stored = await tx.focusSession.findUnique({
        where: { organizationId_userId_startedAt: { ...owner, startedAt: data.startedAt } },
        select: fields,
      });
      if (stored) {
        if (
          stored.title !== data.title ||
          stored.category !== data.category ||
          stored.mode !== data.mode ||
          stored.plannedMinutes !== data.plannedMinutes ||
          stored.actualSeconds !== data.actualSeconds ||
          stored.status !== data.status ||
          stored.reflection !== data.reflection ||
          stored.endedAt.getTime() !== data.endedAt.getTime()
        )
          throw new ConflictException('该次计时已被记录，请刷新历史记录');
        return stored;
      }
      const row = await tx.focusSession.create({ data: { ...owner, ...data }, select: fields });
      await this.audit(tx, actor, 'create', row.id);
      return row;
    });
  }

  @Get('sessions/:id')
  async read(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() params: unknown) {
    const row = await this.scoped(actor, 'read', async (tx, owner) => {
      emptyFocusQuery.parse(params);
      const item = await tx.focusSession.findFirst({
        where: { ...owner, id: focusId.parse(id) },
        select: fields,
      });
      if (!item) await this.audit(tx, actor, 'read.denied', 'unavailable');
      return item;
    });
    if (!row) throw new NotFoundException('专注记录不存在');
    return row;
  }

  @Delete('sessions/:id')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() params: unknown,
    @Body() body: unknown,
  ) {
    const removed = await this.scoped(actor, 'delete', async (tx, owner) => {
      emptyFocusQuery.parse(params);
      emptyFocusQuery.parse(body ?? {});
      const { count } = await tx.focusSession.deleteMany({ where: { ...owner, id: focusId.parse(id) } });
      // Persist denial in the actor's space without recording or looking up another owner's identifier.
      await this.audit(tx, actor, count ? 'delete' : 'delete.denied', count ? id : 'unavailable');
      return count;
    });
    if (!removed) throw new NotFoundException('专注记录不存在');
    return { deleted: true };
  }
}
