import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type LiveClass, type LiveMember } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from '../auth/auth.service';
import type { Actor } from '../auth/auth.guard';
import { LiveMedia } from './live.media';
import { LiveConnections } from './live.connections';
import { readLiveConfiguration } from './live.config';
import { LIVE_PRESENCE_MS, liveChat, liveCreate, liveList, liveModeration } from './live.schemas';

type Tx = Prisma.TransactionClient;
export function liveHost(a: Actor) {
  return (
    a.role !== 'STUDENT' &&
    (a.permissions.includes('course.manage') || a.permissions.includes('course.admin'))
  );
}
export function liveAttendance(
  member: Pick<LiveMember, 'state' | 'heartbeatAt' | 'attendanceSeconds'>,
  now: Date,
) {
  const gap = Math.max(0, now.getTime() - member.heartbeatAt.getTime());
  return (
    member.attendanceSeconds +
    (member.state === 'ACTIVE' && gap <= LIVE_PRESENCE_MS ? Math.floor(gap / 1000) : 0)
  );
}

@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cleaning = false;
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private media: LiveMedia,
    private connections: LiveConnections,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup(), 10_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  status() {
    try {
      readLiveConfiguration();
      return { available: true, reason: '', maxParticipants: 100 };
    } catch {
      return { available: false, reason: '直播尚未配置，请联系管理员启用直播服务', maxParticipants: 100 };
    }
  }
  private audit(tx: Tx, a: Actor, action: string, id: string, details: Prisma.InputJsonObject = {}) {
    return tx.auditLog.create({
      data: {
        organizationId: a.organizationId,
        userId: a.id,
        action: `live.${action}`,
        resourceType: 'LiveClass',
        resourceId: id,
        details,
        requestId: a.requestId,
      },
    });
  }
  private async current(a: Actor, tx: Tx) {
    if (!a.sessionId) throw new UnauthorizedException('登录已失效');
    const actor = await new AuthService(tx as PrismaService).resolveSessionId(a.sessionId);
    if (!actor || actor.id !== a.id || actor.organizationId !== a.organizationId || actor.role !== a.role)
      throw new UnauthorizedException('身份已改变，请重新登录');
    await new AuthService(tx as PrismaService).checkFeature(actor, '/api/live');
    return actor;
  }
  private async access(a: Actor, id: string, tx: Tx = this.db, write = false) {
    const actor = await this.current(a, tx);
    const room = await tx.liveClass.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!room) throw new NotFoundException('直播课堂不存在');
    const auth = new AuthService(tx as PrismaService);
    const course = await auth.course(actor, room.courseId);
    if (write && !liveHost(actor)) throw new ForbiddenException('没有管理此课堂的权限');
    return { actor, room, course };
  }
  private async locked<T>(id: string | string[], fn: (tx: Tx) => Promise<T>) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', '5000', true)`;
        for (const key of Array.isArray(id) ? [...id].sort() : [id])
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`live:${key}`}, 0))`;
        return fn(tx);
      },
      { maxWait: 10000, timeout: 20000 },
    );
  }
  private active(room: LiveClass, courseStatus?: string) {
    if (room.status !== 'LIVE' || !room.startedAt || Date.now() - room.startedAt.getTime() > 8 * 3600_000)
      throw new ConflictException('课堂尚未开始或已经结束');
    if (courseStatus && courseStatus !== 'PUBLISHED') throw new ForbiddenException('课程当前未开放直播');
  }
  async list(a: Actor, input: unknown) {
    const q = liveList.parse(input);
    const ids = await this.auth.courseIds(a);
    const where = {
      organizationId: a.organizationId,
      courseId: q.courseId ? { in: ids.filter((id) => id === q.courseId) } : { in: ids },
    };
    const [items, total] = await Promise.all([
      this.db.liveClass.findMany({
        where,
        orderBy: [{ scheduledAt: 'desc' }, { id: 'asc' }],
        take: q.pageSize,
        skip: (q.page - 1) * q.pageSize,
      }),
      this.db.liveClass.count({ where }),
    ]);
    const courses = await this.db.course.findMany({
      where: { id: { in: items.map((x) => x.courseId) }, organizationId: a.organizationId },
      select: { id: true, title: true },
    });
    return {
      items: items.map(({ roomName: _roomName, ...x }) => ({
        ...x,
        courseTitle: courses.find((c) => c.id === x.courseId)?.title,
        canManage: liveHost(a),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      provider: this.status(),
    };
  }
  async create(a: Actor, input: unknown) {
    const body = liveCreate.parse(input);
    if (Math.abs(new Date(body.scheduledAt).getTime() - Date.now()) > 366 * 86400_000)
      throw new ConflictException('预约时间应在当前日期前后一年内');
    return this.locked(`course:${body.courseId}`, async (tx) => {
      const actor = await this.current(a, tx);
      await new AuthService(tx as PrismaService).course(actor, body.courseId, true);
      if (!liveHost(actor)) throw new ForbiddenException('没有开播权限');
      if ((await tx.liveClass.count({ where: { courseId: body.courseId, status: 'SCHEDULED' } })) >= 20)
        throw new ConflictException('本课程已有20场待开始直播，请先处理已有预约');
      const room = await tx.liveClass.create({
        data: {
          ...body,
          scheduledAt: new Date(body.scheduledAt),
          organizationId: actor.organizationId,
          creatorId: actor.id,
          roomName: `study-${randomUUID()}`,
        },
      });
      await this.audit(tx, actor, 'create', room.id, { courseId: body.courseId });
      return { id: room.id, revision: room.revision };
    });
  }
  async detail(a: Actor, id: string) {
    const { room, actor, course } = await this.access(a, id);
    const host = liveHost(actor);
    let chatAvailable = actor.permissions.includes('communication.read');
    try {
      await this.auth.checkFeature(actor, '/api/communication');
    } catch {
      chatAvailable = false;
    }
    const [members, messages] = await Promise.all([
      this.db.liveMember.findMany({
        where: {
          liveClassId: id,
          ...(host
            ? {
                OR: [
                  { state: 'ACTIVE', heartbeatAt: { gt: new Date(Date.now() - LIVE_PRESENCE_MS) } },
                  { state: 'BLOCKED' },
                ],
              }
            : { state: 'ACTIVE', heartbeatAt: { gt: new Date(Date.now() - LIVE_PRESENCE_MS) } }),
        },
        orderBy: [{ state: 'asc' }, { handRaised: 'desc' }, { joinedAt: 'asc' }],
        take: 150,
      }),
      chatAvailable
        ? this.db.liveMessage.findMany({
            where: { liveClassId: id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 50,
            select: { id: true, name: true, text: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);
    const own = await this.db.liveMember.findUnique({
      where: { liveClassId_userId: { liveClassId: id, userId: actor.id } },
    });
    const memberView = (m: LiveMember) => ({
      id: m.id,
      name: m.name,
      host: m.host,
      state: m.state,
      approved: m.approved,
      handRaised: m.handRaised,
      chatMuted: m.chatMuted,
      revision: m.revision,
      online: m.state === 'ACTIVE' && Date.now() - m.heartbeatAt.getTime() <= LIVE_PRESENCE_MS,
      attendanceSeconds: m.attendanceSeconds,
    });
    const { roomName: _roomName, ...view } = room;
    return {
      ...view,
      courseTitle: course.title,
      canManage: host,
      chatAvailable,
      canChat: chatAvailable && actor.permissions.includes('communication.write'),
      members: members.map(memberView),
      own: own ? memberView(own) : null,
      messages: messages.reverse(),
      provider: this.status(),
    };
  }
  async start(a: Actor, id: string, revision: number) {
    const initial = await this.access(a, id, this.db, true);
    return this.locked([id, `course:${initial.course.id}`], async (tx) => {
      const { actor, room, course } = await this.access(a, id, tx, true);
      if (room.revision !== revision || room.status !== 'SCHEDULED')
        throw new ConflictException('课堂状态已变化，请刷新后重试');
      if (course.status !== 'PUBLISHED') throw new ConflictException('请先发布课程再开始直播');
      if (await tx.liveClass.count({ where: { courseId: room.courseId, status: 'LIVE' } }))
        throw new ConflictException('本课程已有正在进行的直播');
      await this.media.create(room.roomName, room.maxParticipants);
      await tx.liveClass.update({
        where: { id },
        data: { status: 'LIVE', startedAt: new Date(), revision: { increment: 1 } },
      });
      await this.audit(tx, actor, 'start', id);
      return { ok: true };
    });
  }
  async end(a: Actor, id: string, revision: number) {
    const room = await this.locked(id, async (tx) => {
      const { actor, room } = await this.access(a, id, tx, true);
      if (room.revision !== revision) throw new ConflictException('课堂状态已变化，请刷新后重试');
      if (room.status !== 'ENDED') {
        await tx.liveClass.update({
          where: { id },
          data: {
            status: 'ENDED',
            endedAt: new Date(),
            revision: { increment: 1 },
            cleanupPending: room.status === 'LIVE',
          },
        });
        await tx.liveMember.updateMany({
          where: { liveClassId: id, state: 'ACTIVE' },
          data: {
            state: 'LEFT',
            approved: false,
            handRaised: false,
            revision: { increment: 1 },
            leftAt: new Date(),
          },
        });
        await this.audit(tx, actor, 'end', id);
      }
      return room;
    });
    this.connections.closeClass(id);
    if (room.status === 'SCHEDULED' || (room.status === 'ENDED' && !room.cleanupPending)) return { ok: true };
    await this.media.end(room.roomName);
    await this.db.liveClass.update({ where: { id }, data: { cleanupPending: false } });
    return { ok: true };
  }
  async join(a: Actor, id: string) {
    readLiveConfiguration();
    const { room, member } = await this.locked(id, async (tx) => {
      const { actor, room, course } = await this.access(a, id, tx);
      this.active(room, course.status);
      const existing = await tx.liveMember.findUnique({
        where: { liveClassId_userId: { liveClassId: id, userId: actor.id } },
      });
      if (existing?.state === 'BLOCKED') throw new ForbiddenException('你已被移出本场课堂');
      if (
        !existing ||
        existing.state !== 'ACTIVE' ||
        Date.now() - existing.heartbeatAt.getTime() > LIVE_PRESENCE_MS
      ) {
        if (
          (await tx.liveMember.count({
            where: {
              liveClassId: id,
              state: 'ACTIVE',
              heartbeatAt: { gt: new Date(Date.now() - LIVE_PRESENCE_MS) },
            },
          })) >= room.maxParticipants
        )
          throw new ConflictException('课堂人数已满，请稍后重试');
      }
      const host = liveHost(actor);
      const continuing =
        existing?.state === 'ACTIVE' && existing.sessionId === actor.sessionId && existing.host === host;
      const now = new Date();
      const data = {
        sessionId: actor.sessionId!,
        connectionId: randomUUID(),
        name: actor.name,
        host,
        state: 'ACTIVE',
        approved: host || !!(continuing && existing?.approved),
        heartbeatAt: now,
        leftAt: null,
        syncPending: true,
      };
      const member = await tx.liveMember.upsert({
        where: { liveClassId_userId: { liveClassId: id, userId: actor.id } },
        create: { liveClassId: id, userId: actor.id, ...data },
        update: {
          ...data,
          revision: { increment: 1 },
          handRaised: continuing ? existing!.handRaised : false,
          attendanceSeconds: existing ? liveAttendance(existing, now) : 0,
        },
      });
      await this.audit(tx, actor, 'join', id, { memberId: member.id });
      return { room, member };
    });
    // A delayed admission must not disconnect a newer tab that already replaced it.
    await this.locked(id, async (tx) => {
      const latest = await tx.liveMember.findUnique({ where: { id: member.id } });
      if (!latest || latest.connectionId !== member.connectionId || latest.state !== 'ACTIVE')
        throw new ConflictException('另一页面已更新课堂连接，请使用最新进入的页面');
      this.connections.closeMember(member.id);
      await this.media.remove(room.roomName, member.id);
    });
    await this.syncMember(id, member.id);
    return {
      token: await this.media.token(
        room.roomName,
        member.id,
        member.name,
        member.approved,
        member.host,
        member.connectionId,
      ),
      identity: member.id,
      connectionId: member.connectionId,
      path: '/api/live/media',
      approved: member.approved,
      host: member.host,
    };
  }
  private async activeMember(actor: Actor, room: LiveClass, tx: Tx, connectionId: string) {
    const m = await tx.liveMember.findUnique({
      where: { liveClassId_userId: { liveClassId: room.id, userId: actor.id } },
    });
    if (
      !m ||
      m.state !== 'ACTIVE' ||
      m.sessionId !== actor.sessionId ||
      m.connectionId !== connectionId ||
      Date.now() - m.heartbeatAt.getTime() > LIVE_PRESENCE_MS
    )
      throw new ForbiddenException('请先进入直播课堂');
    return m;
  }
  async presence(
    a: Actor,
    id: string,
    action: 'heartbeat' | 'leave' | 'raise',
    connectionId: string,
    raised = false,
  ) {
    const result = await this.locked(id, async (tx) => {
      const { actor, room, course } = await this.access(a, id, tx);
      if (action !== 'leave') this.active(room, course.status);
      const m = await this.activeMember(actor, room, tx, connectionId);
      if (action === 'raise' && m.host) throw new ConflictException('教师无需申请连麦');
      const now = new Date();
      await tx.liveMember.update({
        where: { id: m.id },
        data: {
          heartbeatAt: now,
          attendanceSeconds: liveAttendance(m, now),
          ...(action === 'leave'
            ? { state: 'LEFT', approved: false, handRaised: false, leftAt: now, syncPending: true }
            : {}),
          ...(action === 'raise' ? { handRaised: raised } : {}),
          ...(action !== 'heartbeat' ? { revision: { increment: 1 } } : {}),
        },
      });
      if (action !== 'heartbeat')
        await this.audit(tx, actor, action, id, {
          memberId: m.id,
          ...(action === 'raise' ? { raised } : {}),
        });
      return { member: m, room };
    });
    if (action === 'leave') {
      this.connections.closeMember(result.member.id, connectionId);
      await this.syncMember(id, result.member.id);
    }
    return { ok: true };
  }
  async moderate(a: Actor, id: string, memberId: string, input: unknown) {
    const body = liveModeration.parse(input);
    await this.locked(id, async (tx) => {
      const { actor, room } = await this.access(a, id, tx, true);
      this.active(room);
      const m = await tx.liveMember.findFirst({ where: { id: memberId, liveClassId: id } });
      if (!m) throw new NotFoundException('课堂成员不存在');
      if (m.host) throw new ForbiddenException('不能对授课教师执行此操作');
      if (m.revision !== body.revision) throw new ConflictException('成员状态已变化，请刷新后重试');
      if (body.action !== 'remove' && m.state !== 'ACTIVE') throw new ConflictException('成员当前不在课堂内');
      await tx.liveMember.update({
        where: { id: m.id },
        data: {
          revision: { increment: 1 },
          ...(['approve', 'revoke', 'remove'].includes(body.action) ? { syncPending: true } : {}),
          ...(body.action === 'approve' ? { approved: true, handRaised: false } : {}),
          ...(body.action === 'revoke' ? { approved: false, handRaised: false } : {}),
          ...(body.action === 'remove'
            ? { state: 'BLOCKED', approved: false, handRaised: false, leftAt: new Date() }
            : {}),
          ...(['mute-chat', 'unmute-chat'].includes(body.action)
            ? { chatMuted: body.action === 'mute-chat' }
            : {}),
        },
      });
      await this.audit(tx, actor, body.action, id, { memberId });
    });
    if (body.action === 'remove') this.connections.closeMember(memberId);
    if (['approve', 'revoke', 'remove'].includes(body.action)) await this.syncMember(id, memberId);
    return { ok: true };
  }
  async message(a: Actor, id: string, input: unknown) {
    const body = liveChat.parse(input);
    return this.locked(id, async (tx) => {
      const { actor, room, course } = await this.access(a, id, tx);
      const auth = new AuthService(tx as PrismaService);
      auth.require(actor, 'communication.write');
      await auth.checkFeature(actor, '/api/communication');
      this.active(room, course.status);
      const m = await this.activeMember(actor, room, tx, body.connectionId);
      if (m.chatMuted) throw new ForbiddenException('你已被禁言');
      const key = { liveClassId: id, userId: actor.id, clientId: body.clientId };
      const duplicate = await tx.liveMessage.findUnique({ where: { liveClassId_userId_clientId: key } });
      if (duplicate) return { id: duplicate.id };
      if (
        (await tx.liveMessage.count({
          where: { liveClassId: id, userId: actor.id, createdAt: { gt: new Date(Date.now() - 10_000) } },
        })) >= 5
      )
        throw new ConflictException('发言过于频繁，请稍后再试');
      if ((await tx.liveMessage.count({ where: { liveClassId: id } })) >= 5000)
        throw new ConflictException('本场课堂消息已达上限');
      return tx.liveMessage.create({
        data: { ...key, name: actor.name, text: body.text },
        select: { id: true },
      });
    });
  }
  async revokeAll(a: Actor, id: string) {
    const ids = await this.locked(id, async (tx) => {
      const { actor, room } = await this.access(a, id, tx, true);
      this.active(room);
      const members = await tx.liveMember.findMany({
        where: { liveClassId: id, state: 'ACTIVE', host: false, approved: true },
        select: { id: true },
      });
      await tx.liveMember.updateMany({
        where: { id: { in: members.map((m) => m.id) } },
        data: { approved: false, handRaised: false, syncPending: true, revision: { increment: 1 } },
      });
      await this.audit(tx, actor, 'revoke-all', id, { members: members.length });
      return members.map((m) => m.id);
    });
    // Healthy provider updates preserve viewing. A failed sync closes that member's
    // signaling connection and retains the desired state for retry.
    const results = await Promise.allSettled(ids.map((memberId) => this.syncMember(id, memberId)));
    return { updated: ids.length, cleanupPending: results.some((r) => r.status === 'rejected') };
  }
  async admission(token: string, cookieToken: string, checkPublish = true) {
    if (!token || token.length > 8192) throw new UnauthorizedException();
    let claims;
    try {
      claims = await this.media.verify(token);
    } catch {
      throw new UnauthorizedException();
    }
    const actor = await this.auth.resolveSession(cookieToken);
    if (!actor || !claims.sub) throw new UnauthorizedException();
    const m = await this.db.liveMember.findUnique({ where: { id: claims.sub } });
    if (!m || m.userId !== actor.id || m.sessionId !== actor.sessionId || m.host !== liveHost(actor))
      throw new ForbiddenException();
    const { room, course } = await this.access(actor, m.liveClassId);
    this.active(room, course.status);
    if (m.state !== 'ACTIVE' || m.syncPending || Date.now() - m.heartbeatAt.getTime() > LIVE_PRESENCE_MS)
      throw new ForbiddenException();
    const g = claims.video;
    let metadata;
    try {
      metadata = JSON.parse(claims.metadata || '{}');
    } catch {
      throw new ForbiddenException();
    }
    if (metadata.connectionId !== m.connectionId) throw new ForbiddenException();
    if (
      !g ||
      !g.roomJoin ||
      g.room !== room.roomName ||
      g.roomAdmin ||
      g.roomCreate ||
      g.roomList ||
      g.roomRecord ||
      g.ingressAdmin ||
      claims.sip ||
      claims.inference ||
      claims.observability ||
      g.canSubscribe !== true ||
      g.canPublishData !== false ||
      g.canUpdateOwnMetadata ||
      (checkPublish && !!g.canPublish !== m.approved)
    )
      throw new ForbiddenException();
    // Verify source grants too: LiveKit gives canPublishSources precedence over canPublish.
    const sources = (g.canPublishSources || []) as unknown as string[];
    const allowed = m.host
      ? ['camera', 'microphone', 'screen_share', 'screen_share_audio']
      : ['camera', 'microphone'];
    if (checkPublish && (sources.some((s) => !allowed.includes(s)) || (!m.approved && sources.length)))
      throw new ForbiddenException();
    return { member: m, room };
  }
  async connectionAllowed(memberId: string, cookieToken: string, connectionId: string) {
    const actor = await this.auth.resolveSession(cookieToken);
    if (!actor) throw new UnauthorizedException();
    const m = await this.db.liveMember.findUnique({ where: { id: memberId } });
    if (
      !m ||
      m.state !== 'ACTIVE' ||
      m.syncPending ||
      m.userId !== actor.id ||
      m.sessionId !== actor.sessionId ||
      m.connectionId !== connectionId ||
      m.host !== liveHost(actor) ||
      Date.now() - m.heartbeatAt.getTime() > LIVE_PRESENCE_MS
    )
      throw new ForbiddenException();
    const { room, course } = await this.access(actor, m.liveClassId);
    this.active(room, course.status);
  }
  private async syncMember(id: string, memberId: string) {
    let syncingConnectionId: string | undefined;
    try {
      await this.locked(id, async (tx) => {
        const room = await tx.liveClass.findUnique({ where: { id } });
        const m = await tx.liveMember.findFirst({ where: { id: memberId, liveClassId: id } });
        if (!room || !m) return;
        syncingConnectionId = m.connectionId;
        // Serialize provider calls with state changes, and read the latest desired state.
        // A delayed approval must never overwrite a more recent revoke/remove.
        if (room.status === 'LIVE' && m.state === 'ACTIVE') {
          // Empty LiveKit rooms expire independently of the scheduled class. Recreate
          // the same scoped room before a late arrival/reconnect, never an arbitrary name.
          await this.media.create(room.roomName, room.maxParticipants);
          await this.media.permission(room.roomName, m.id, m.approved, m.host);
        } else await this.media.remove(room.roomName, m.id);
        await tx.liveMember.update({ where: { id: m.id }, data: { syncPending: false } });
      });
    } catch (error) {
      if (syncingConnectionId) this.connections.closeMember(memberId, syncingConnectionId);
      throw error;
    }
  }
  private async cleanup() {
    if (this.cleaning || !this.status().available) return;
    this.cleaning = true;
    try {
      await this.db.liveClass.updateMany({
        where: { status: 'LIVE', startedAt: { lt: new Date(Date.now() - 8 * 3600_000) } },
        data: { status: 'ENDED', endedAt: new Date(), cleanupPending: true, revision: { increment: 1 } },
      });
      for (const r of await this.db.liveClass.findMany({ where: { cleanupPending: true }, take: 20 })) {
        this.connections.closeClass(r.id);
        try {
          await this.media.end(r.roomName);
          await this.db.liveClass.updateMany({
            where: { id: r.id, status: 'ENDED' },
            data: { cleanupPending: false },
          });
        } catch {
          /* Persisted cleanup is retried, never reported as a successful cleanup. */
        }
      }
      for (const m of await this.db.liveMember.findMany({ where: { syncPending: true }, take: 100 })) {
        try {
          await this.syncMember(m.liveClassId, m.id);
        } catch {
          /* Retry persisted desired permissions. */
        }
      }
    } catch {
      /* A database/provider outage must not produce credential-bearing logs. */
    } finally {
      this.cleaning = false;
    }
  }
}
