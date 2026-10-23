import {
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { cleanText } from '../communication/security';

import {
  discussionId as id,
  discussionPaging as paging,
  discussionListQuery as listQuery,
  mobilePostSchema,
  mobileReplySchema,
} from './mobile-discussions.schemas';
const plain = (s: string, max = 15000) =>
  sanitizeHtml(s, { allowedTags: [], allowedAttributes: {} }).slice(0, max);
const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const postFields = {
  id: true,
  title: true,
  courseId: true,
  authorId: true,
  pinned: true,
  featured: true,
  closed: true,
  solved: true,
  createdAt: true,
} as const;

@Controller('mobile/discussions')
@UseGuards(AuthGuard)
export class MobileDiscussionsController {
  constructor(private db: PrismaService) {}
  private async current(tx: Prisma.TransactionClient, a: Actor) {
    const auth = new AuthService(tx as PrismaService);
    const actor = a.sessionId ? await auth.resolveMobileSessionId(a.sessionId) : null;
    if (!actor || actor.id !== a.id || actor.organizationId !== a.organizationId || actor.role !== a.role)
      throw new UnauthorizedException('会话或身份已变化，请重新登录');
    auth.require(actor, 'learning.use');
    auth.require(actor, 'communication.read');
    await auth.checkFeature(actor, '/api/discussions');
    return actor;
  }
  private scope<T>(
    a: Actor,
    run: (tx: Prisma.TransactionClient, auth: AuthService, current: Actor) => Promise<T>,
    postId?: string,
  ) {
    if (a.role !== 'STUDENT' || a.clientType !== 'MOBILE') throw new ForbiddenException('请使用学生手机会话');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'mobile-discussions:' + a.id}))`;
      if (postId) await tx.$queryRaw`SELECT "id" FROM "DiscussionPost" WHERE "id"=${postId} FOR UPDATE`;
      const auth = new AuthService(tx as PrismaService);
      const current = await this.current(tx, a);
      return run(tx, auth, current);
    });
  }
  @Get('receipts') receipt(@CurrentActor() a: Actor, @Query() input: unknown) {
    const q = z
      .object({ kind: z.enum(['post', 'reply']), key: id.min(8) })
      .strict()
      .parse(input);
    return this.scope(a, async (tx, auth, current) => {
      const where = { authorId_mobileCreateKey: { authorId: current.id, mobileCreateKey: q.key } };
      const row =
        q.kind === 'post'
          ? await tx.discussionPost.findUnique({ where })
          : await tx.discussionReply.findUnique({ where });
      if (!row) return { found: false as const };
      if (row.hidden || row.organizationId !== current.organizationId)
        throw new NotFoundException('已发布内容不可访问');
      const postId = 'postId' in row ? row.postId : row.id;
      const post = await tx.discussionPost.findFirst({
        where: { id: postId, organizationId: current.organizationId, hidden: false },
      });
      if (!post) throw new NotFoundException('讨论不存在或已隐藏');
      await auth.course(current, post.courseId);
      return { found: true as const, id: row.id, postId, createdAt: row.createdAt };
    });
  }
  private async writable(tx: Prisma.TransactionClient, auth: AuthService, a: Actor, courseId: string) {
    auth.require(a, 'communication.write');
    const course = await auth.course(a, courseId);
    if (course.status === 'ARCHIVED') throw new ForbiddenException('归档课程讨论区仅允许阅读');
    const muted = await tx.communicationMute.findFirst({
      where: {
        organizationId: a.organizationId,
        userId: a.id,
        expiresAt: { gt: new Date() },
        OR: [
          { courseId: null, classId: null },
          { courseId, classId: null },
        ],
      },
    });
    if (muted) throw new ForbiddenException('当前已被禁言，不能发布或回复');
  }
  private async post(tx: Prisma.TransactionClient, auth: AuthService, a: Actor, value: string) {
    // scope holds the website moderation/reply row lock before refreshing identity.
    const row = await tx.discussionPost.findFirst({
      where: { id: value, organizationId: a.organizationId, hidden: false },
    });
    if (!row) throw new NotFoundException('讨论不存在或已隐藏');
    const course = await auth.course(a, row.courseId);
    return { row, course };
  }
  @Get() list(@CurrentActor() a: Actor, @Query() input: unknown) {
    const q = listQuery.parse(input);
    return this.scope(a, async (tx, auth, current) => {
      const ids = q.courseId ? [(await auth.course(current, q.courseId)).id] : await auth.courseIds(current);
      const where: Prisma.DiscussionPostWhereInput = {
        organizationId: current.organizationId,
        courseId: { in: ids },
        hidden: false,
        ...(q.featured ? { featured: q.featured === 'true' } : {}),
        ...(q.search
          ? { title: { contains: q.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } }
          : {}),
      };
      const rows = await tx.discussionPost.findMany({
        where,
        select: postFields,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      });
      const courses = await tx.course.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true },
      });
      const names = await tx.user.findMany({
        where: { id: { in: rows.map((r) => r.authorId) }, organizationId: current.organizationId },
        select: { id: true, name: true },
      });
      const counts = await tx.discussionReply.groupBy({
        by: ['postId'],
        where: {
          postId: { in: rows.map((r) => r.id) },
          hidden: false,
          organizationId: current.organizationId,
        },
        _count: { _all: true },
      });
      return {
        items: rows.map(({ authorId, ...r }) => ({
          ...r,
          authorName: names.find((n) => n.id === authorId)?.name || '用户',
          courseTitle: courses.find((c) => c.id === r.courseId)?.title || '',
          replyCount: counts.find((c) => c.postId === r.id)?._count._all || 0,
        })),
        total: await tx.discussionPost.count({ where }),
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }
  @Get(':id') detail(@CurrentActor() a: Actor, @Param('id') value: string, @Query() input: unknown) {
    const key = id.parse(value),
      q = paging.strict().parse(input);
    return this.scope(
      a,
      async (tx, auth, current) => {
        const { row, course } = await this.post(tx, auth, current, key);
        const where = { postId: key, hidden: false, organizationId: current.organizationId };
        const replies = await tx.discussionReply.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        });
        const quotes = await tx.discussionReply.findMany({
          where: { ...where, id: { in: replies.flatMap((r) => (r.quoteReplyId ? [r.quoteReplyId] : [])) } },
        });
        const users = await tx.user.findMany({
          where: {
            id: { in: [row.authorId, ...replies.map((r) => r.authorId), ...quotes.map((r) => r.authorId)] },
            organizationId: current.organizationId,
          },
          select: { id: true, name: true },
        });
        const name = (id: string) => users.find((u) => u.id === id)?.name || '用户';
        let canWrite = true;
        try {
          await this.writable(tx, auth, current, row.courseId);
        } catch (e) {
          if (e instanceof ForbiddenException) canWrite = false;
          else throw e;
        }
        return {
          id: row.id,
          title: row.title,
          body: plain(row.body),
          courseId: row.courseId,
          courseTitle: course.title,
          authorName: name(row.authorId),
          createdAt: row.createdAt,
          pinned: row.pinned,
          featured: row.featured,
          solved: row.solved,
          closed: row.closed,
          canReply: canWrite && !row.closed,
          attachmentCount: row.attachmentIds.length,
          replies: replies.map((r) => {
            const quote = quotes.find((v) => v.id === r.quoteReplyId);
            return {
              id: r.id,
              body: plain(r.body),
              authorName: name(r.authorId),
              own: r.authorId === current.id,
              attachmentCount: r.attachmentIds.length,
              createdAt: r.createdAt,
              quote: quote
                ? { id: quote.id, authorName: name(quote.authorId), body: plain(quote.body, 300) }
                : null,
            };
          }),
          replyPage: { page: q.page, pageSize: q.pageSize, total: await tx.discussionReply.count({ where }) },
        };
      },
      key,
    );
  }
  @Post() create(@CurrentActor() a: Actor, @Body() input: unknown) {
    const q = mobilePostSchema.parse(input),
      digest = hash([q.courseId, q.title, q.body]);
    return this.scope(a, async (tx, auth, current) => {
      await auth.course(current, q.courseId);
      const existing = await tx.discussionPost.findUnique({
        where: { authorId_mobileCreateKey: { authorId: current.id, mobileCreateKey: q.key } },
      });
      if (existing) {
        if (existing.mobileCreateHash !== digest) throw new ConflictException('此发布标识已用于另一份内容');
        if (existing.hidden || existing.organizationId !== current.organizationId)
          throw new NotFoundException('已发布讨论不可访问');
        return { id: existing.id, postId: existing.id, createdAt: existing.createdAt, replayed: true };
      }
      await this.writable(tx, auth, current, q.courseId);
      const row = await tx.discussionPost.create({
        data: {
          organizationId: current.organizationId,
          courseId: q.courseId,
          authorId: current.id,
          title: cleanText(q.title, 160),
          body: cleanText(q.body),
          mobileCreateKey: q.key,
          mobileCreateHash: digest,
        },
      });
      return { id: row.id, postId: row.id, createdAt: row.createdAt, replayed: false };
    });
  }
  @Post(':id/replies') reply(@CurrentActor() a: Actor, @Param('id') value: string, @Body() input: unknown) {
    const key = id.parse(value),
      q = mobileReplySchema.parse(input),
      digest = hash([key, q.body, q.quoteReplyId || null]);
    return this.scope(
      a,
      async (tx, auth, current) => {
        const { row } = await this.post(tx, auth, current, key);
        // A lost response can recover its receipt after closure/muting, without another write.
        const existing = await tx.discussionReply.findUnique({
          where: { authorId_mobileCreateKey: { authorId: current.id, mobileCreateKey: q.key } },
        });
        if (existing) {
          if (existing.mobileCreateHash !== digest) throw new ConflictException('此回复标识已用于另一份内容');
          if (existing.hidden || existing.organizationId !== current.organizationId)
            throw new NotFoundException('已发布回复不可访问');
          return { id: existing.id, postId: key, createdAt: existing.createdAt, replayed: true };
        }
        if (q.quoteReplyId) {
          await tx.$queryRaw`SELECT "id" FROM "DiscussionReply" WHERE "id"=${q.quoteReplyId} FOR SHARE`;
          if (
            !(await tx.discussionReply.findFirst({
              where: {
                id: q.quoteReplyId,
                postId: key,
                organizationId: current.organizationId,
                hidden: false,
              },
            }))
          )
            throw new NotFoundException('引用回复不存在或已隐藏');
        }
        const fresh = await this.current(tx, current);
        await this.writable(tx, auth, fresh, row.courseId);
        if (row.closed) throw new ConflictException('讨论已关闭，不能继续回复');
        const reply = await tx.discussionReply.create({
          data: {
            postId: key,
            organizationId: current.organizationId,
            authorId: current.id,
            body: cleanText(q.body),
            quoteReplyId: q.quoteReplyId,
            mobileCreateKey: q.key,
            mobileCreateHash: digest,
          },
        });
        if (row.authorId !== current.id) {
          const eventKey = 'reply:' + reply.id;
          await tx.backgroundJob.upsert({
            where: { eventKey: 'notify:' + eventKey },
            update: {},
            create: {
              organizationId: current.organizationId,
              kind: 'NOTIFICATION',
              eventKey: 'notify:' + eventKey,
              payload: {
                userIds: [row.authorId],
                type: 'DISCUSSION_REPLY',
                title: '讨论收到新回复',
                body: `${current.name} 回复了「${row.title}」`,
                link: '/communication?post=' + key,
                eventKey,
              },
            },
          });
        }
        return { id: reply.id, postId: key, createdAt: reply.createdAt, replayed: false };
      },
      key,
    );
  }
}
