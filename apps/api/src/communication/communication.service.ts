import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type BackgroundJob,
  type Conversation,
  type DiscussionPost,
  type Message,
  type UploadOperation,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import { type Actor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { CommunicationGateway } from './communication.gateway';
import { LocalPrivateStorage } from './storage';
import { UploadSafetyService } from './upload-safety.service';
import { assertSafePdf } from '../common/pdf-security';
import { assertPrivateParticipant, canRetract, cleanText, inspectUpload, safeFilename } from './security';
import { compressedArchive, type ArchiveEntry } from './archive';
import type {
  AttachmentInput,
  MessageInput,
  MessageQuery,
  MuteInput,
  PostInput,
  PostQuery,
  PostUpdate,
  ReplyInput,
  ReportInput,
} from './communication.schemas';

const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class CommunicationService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly gateway: CommunicationGateway,
    private readonly storage: LocalPrivateStorage,
    private readonly uploadSafety: UploadSafetyService,
  ) {}

  private async users(ids: string[]) {
    const users = await this.db.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
  private async assertNotMuted(actor: Actor, courseId?: string, classId?: string) {
    const mute = await this.db.communicationMute.findFirst({
      where: {
        organizationId: actor.organizationId,
        userId: actor.id,
        expiresAt: { gt: new Date() },
        OR: [
          { courseId: null, classId: null },
          ...(courseId ? [{ courseId, classId: null }] : []),
          ...(classId ? [{ classId, courseId: null }] : []),
        ],
      },
    });
    if (mute) throw new ForbiddenException(`当前禁言至 ${mute.expiresAt.toISOString()}：${mute.reason}`);
  }
  private async readCourse(actor: Actor, id: string, write = false) {
    this.auth.require(actor, write ? 'communication.write' : 'communication.read');
    const course = await this.auth.course(actor, id);
    if (write && course.status === 'ARCHIVED') throw new ForbiddenException('归档课程讨论区仅允许阅读');
    if (write) await this.assertNotMuted(actor, id);
    return course;
  }
  private async attachmentsFor(
    actor: Actor,
    ids: string[],
    scope: { courseId?: string; conversationId?: string },
  ) {
    if (!ids.length) return;
    if (new Set(ids).size !== ids.length) throw new BadRequestException('附件不能重复');
    const attachments = await this.db.attachment.findMany({
      where: {
        id: { in: ids },
        organizationId: actor.organizationId,
        ownerId: actor.id,
        assignmentId: null,
        courseId: scope.courseId || null,
        conversationId: scope.conversationId || null,
      },
    });
    if (attachments.length !== ids.length) throw new ForbiddenException('附件不属于当前用户或业务范围');
  }
  private async attachmentMetadata(ids: string[]) {
    if (!ids.length) return [];
    const attachments = await this.db.attachment.findMany({
      where: { id: { in: ids } },
      select: { id: true, originalName: true, mime: true, size: true },
    });
    return attachments.map((file) => ({
      id: file.id,
      name: file.originalName,
      mime: file.mime,
      size: file.size,
    }));
  }
  private async post(actor: Actor, id: string): Promise<DiscussionPost> {
    const post = await this.db.discussionPost.findFirst({
      where: { id, organizationId: actor.organizationId, hidden: false },
    });
    if (!post) throw new NotFoundException('讨论不存在或已隐藏');
    await this.readCourse(actor, post.courseId);
    return post;
  }

  async listPosts(actor: Actor, query: PostQuery) {
    this.auth.require(actor, 'communication.read');
    const allowed = query.courseId
      ? [(await this.readCourse(actor, query.courseId)).id]
      : await this.auth.courseIds(actor);
    const where: Prisma.DiscussionPostWhereInput = {
      organizationId: actor.organizationId,
      courseId: { in: allowed },
      hidden: false,
      ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(query.featured ? { featured: query.featured === 'true' } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { body: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.discussionPost.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.discussionPost.count({ where }),
    ]);
    const [names, counts] = await Promise.all([
      this.users(items.map((post) => post.authorId)),
      this.db.discussionReply.groupBy({
        by: ['postId'],
        where: { postId: { in: items.map((post) => post.id) }, hidden: false },
        _count: { _all: true },
      }),
    ]);
    const countMap = new Map(counts.map((item) => [item.postId, item._count._all]));
    return {
      items: items.map((post) => ({
        ...post,
        authorName: names.get(post.authorId) || '用户',
        replyCount: countMap.get(post.id) || 0,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createPost(actor: Actor, input: PostInput) {
    await this.readCourse(actor, input.courseId, true);
    await this.attachmentsFor(actor, input.attachmentIds, { courseId: input.courseId });
    if (input.linkId && input.linkType) {
      const target =
        input.linkType === 'chapter'
          ? await this.db.chapter.findFirst({ where: { id: input.linkId, courseId: input.courseId } })
          : input.linkType === 'assignment'
            ? await this.db.assignment.findFirst({
                where: {
                  id: input.linkId,
                  courseId: input.courseId,
                  ...(actor.role === 'STUDENT'
                    ? { status: 'published', audience: { some: { userId: actor.id } } }
                    : {}),
                },
              })
            : await this.db.question.findFirst({
                where: {
                  id: input.linkId,
                  courseId: input.courseId,
                  active: true,
                  ...(actor.role === 'STUDENT' ? { practiceEnabled: true } : {}),
                },
              });
      if (!target) throw new BadRequestException('关联资源不在当前可访问的课程范围');
    }
    const post = await this.db.discussionPost.create({
      data: {
        ...input,
        title: cleanText(input.title, 160),
        body: cleanText(input.body),
        organizationId: actor.organizationId,
        authorId: actor.id,
      },
    });
    return { ...post, authorName: actor.name, replyCount: 0 };
  }

  async getPost(actor: Actor, id: string, page = 1, pageSize = 30) {
    const post = await this.post(actor, id);
    const where = { postId: id, hidden: false };
    const [replies, total] = await Promise.all([
      this.db.discussionReply.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.discussionReply.count({ where }),
    ]);
    const quotedIds = replies
      .map((reply) => reply.quoteReplyId)
      .filter((value): value is string => Boolean(value));
    const quoted = await this.db.discussionReply.findMany({
      where: { id: { in: quotedIds }, postId: id, hidden: false },
      select: { id: true, authorId: true, body: true },
    });
    const names = await this.users([
      post.authorId,
      ...replies.map((reply) => reply.authorId),
      ...quoted.map((reply) => reply.authorId),
    ]);
    const files = await this.attachmentMetadata([
      ...post.attachmentIds,
      ...replies.flatMap((reply) => reply.attachmentIds),
    ]);
    const fileMap = new Map(files.map((file) => [file.id, file]));
    return {
      ...post,
      authorName: names.get(post.authorId),
      attachments: post.attachmentIds.map((file) => fileMap.get(file)).filter(Boolean),
      replies: replies.map((reply) => ({
        ...reply,
        authorName: names.get(reply.authorId),
        attachments: reply.attachmentIds.map((file) => fileMap.get(file)).filter(Boolean),
        quote:
          quoted
            .filter((item) => item.id === reply.quoteReplyId)
            .map((item) => ({
              id: item.id,
              authorName: names.get(item.authorId),
              body: item.body.slice(0, 300),
            }))[0] || null,
      })),
      replyPage: { total, page, pageSize },
    };
  }

  async reply(actor: Actor, id: string, input: ReplyInput) {
    const post = await this.post(actor, id);
    await this.readCourse(actor, post.courseId, true);
    if (post.closed) throw new ConflictException('讨论已关闭，不能继续回复');
    if (
      input.quoteReplyId &&
      !(await this.db.discussionReply.findFirst({
        where: { id: input.quoteReplyId, postId: id, hidden: false },
      }))
    )
      throw new BadRequestException('引用回复不属于当前讨论');
    await this.attachmentsFor(actor, input.attachmentIds, { courseId: post.courseId });
    // Lock the post so closing a thread cannot race a reply insertion.
    const reply = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DiscussionPost" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.discussionPost.findUnique({ where: { id } });
      if (!current || current.closed || current.hidden) throw new ConflictException('讨论已关闭或隐藏');
      return tx.discussionReply.create({
        data: {
          ...input,
          body: cleanText(input.body),
          postId: id,
          authorId: actor.id,
          organizationId: actor.organizationId,
        },
      });
    });
    if (post.authorId !== actor.id)
      await this.audit.notify(
        [post.authorId],
        actor.organizationId,
        'DISCUSSION_REPLY',
        '讨论收到新回复',
        `${actor.name} 回复了「${post.title}」`,
        `/communication?post=${id}`,
        `reply:${reply.id}`,
      );
    await this.gateway.invalidate([post.authorId]).catch(() => undefined);
    return { ...reply, authorName: actor.name };
  }

  async updatePost(actor: Actor, id: string, patch: PostUpdate) {
    const post = await this.post(actor, id);
    if (['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) this.auth.require(actor, 'communication.moderate');
    else await this.readCourse(actor, post.courseId, true);
    const onlySolved = Object.keys(patch).every((key) => key === 'solved');
    if (!(onlySolved && post.authorId === actor.id)) await this.moderateCourse(actor, post.courseId);
    return this.db.$transaction(async (tx) => {
      const result = await tx.discussionPost.update({ where: { id }, data: patch });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'communication.update',
          resourceType: 'DiscussionPost',
          resourceId: id,
          requestId: actor.requestId,
          details: {
            before: {
              pinned: post.pinned,
              featured: post.featured,
              closed: post.closed,
              solved: post.solved,
            },
            after: patch,
          },
        },
      });
      return result;
    });
  }

  private async moderateCourse(actor: Actor, courseId: string) {
    if (actor.role === 'TEACHER') {
      this.auth.require(actor, 'communication.write');
      await this.auth.course(actor, courseId, true);
    } else {
      this.auth.require(actor, 'communication.moderate');
      await this.auth.course(actor, courseId);
    }
  }

  /** Contacts are computed from current teaching/enrollment and role records on every request. */
  private async directPeers(actor: Actor, peerId?: string) {
    this.auth.require(actor, 'communication.read');
    if (!['STUDENT', 'TEACHER'].includes(actor.role))
      return new Map<string, { id: string; name: string; role: string; courseNames: string[] }>();
    const courseIds = await this.auth.courseIds(actor);
    const courses = await this.db.course.findMany({
      where: { id: { in: courseIds }, organizationId: actor.organizationId, status: 'PUBLISHED' },
      select: { id: true, title: true },
    });
    const counterpartRole = actor.role === 'STUDENT' ? 'TEACHER' : 'STUDENT';
    const memberships =
      actor.role === 'STUDENT'
        ? await this.db.teachingAssignment.findMany({
            where: {
              courseId: { in: courses.map((course) => course.id) },
              active: true,
              ...(peerId ? { userId: peerId } : {}),
            },
            select: { userId: true, courseId: true },
          })
        : await this.db.enrollment.findMany({
            where: {
              courseId: { in: courses.map((course) => course.id) },
              active: true,
              ...(peerId ? { userId: peerId } : {}),
            },
            select: { userId: true, courseId: true },
          });
    const peers = await this.db.user.findMany({
      where: {
        id: { in: memberships.map((member) => member.userId), not: actor.id },
        organizationId: actor.organizationId,
        active: true,
        roles: { some: { roleId: counterpartRole } },
      },
      select: { id: true, name: true },
    });
    const courseNames = new Map(courses.map((course) => [course.id, course.title]));
    const namesByUser = new Map<string, Set<string>>();
    for (const membership of memberships) {
      const names = namesByUser.get(membership.userId) || new Set<string>();
      const name = courseNames.get(membership.courseId);
      if (name) names.add(name);
      namesByUser.set(membership.userId, names);
    }
    return new Map(
      peers.map((peer) => [
        peer.id,
        { ...peer, role: counterpartRole, courseNames: [...(namesByUser.get(peer.id) || [])] },
      ]),
    );
  }

  async contacts(actor: Actor, page = 1, pageSize = 50, q = '') {
    const items = [...(await this.directPeers(actor)).values()]
      .filter((peer) => !q || peer.name.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id));
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
    };
  }

  private async allowedClassIds(actor: Actor) {
    if (actor.role === 'STUDENT') {
      const records = await this.db.classMember.findMany({
        where: { userId: actor.id, active: true },
        select: { classId: true },
      });
      return records.map((record) => record.classId);
    }
    if (actor.role === 'TEACHER') {
      const courseIds = await this.auth.courseIds(actor);
      return (
        await this.db.courseClass.findMany({
          where: { courseId: { in: courseIds } },
          select: { classId: true },
        })
      ).map((record) => record.classId);
    }
    this.auth.require(actor, 'communication.moderate');
    return (
      await this.db.class.findMany({ where: { organizationId: actor.organizationId }, select: { id: true } })
    ).map((record) => record.id);
  }

  async classes(actor: Actor) {
    this.auth.require(actor, 'communication.read');
    const ids = await this.allowedClassIds(actor);
    return {
      items: await this.db.class.findMany({
        where: { id: { in: ids }, organizationId: actor.organizationId },
        select: { id: true, name: true, grade: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    };
  }

  private async classScope(actor: Actor, classId: string) {
    const classroom = await this.db.class.findFirst({
      where: { id: classId, organizationId: actor.organizationId },
    });
    if (!classroom) throw new NotFoundException('班级不存在');
    if (!(await this.allowedClassIds(actor)).includes(classId))
      throw new ForbiddenException('已失去班级交流资格');
    return classroom;
  }

  async directConversation(actor: Actor, userId: string) {
    this.auth.require(actor, 'communication.write');
    const peer = (await this.directPeers(actor, userId)).get(userId);
    if (!peer) throw new ForbiddenException('只能与当前同课程的师生建立私人会话');
    await this.assertNotBlocked(actor, userId);
    const directKey = `${actor.organizationId}:${[actor.id, userId].sort().join(':')}`;
    return this.db.$transaction(async (tx) => {
      const conversation = await tx.conversation.upsert({
        where: { directKey },
        create: { organizationId: actor.organizationId, kind: 'direct', title: '师生私信', directKey },
        update: {},
      });
      await tx.conversationMember.createMany({
        data: [actor.id, userId].map((id) => ({ conversationId: conversation.id, userId: id })),
        skipDuplicates: true,
      });
      return { ...conversation, title: peer.name };
    });
  }

  async classConversation(actor: Actor, classId: string) {
    this.auth.require(actor, 'communication.read');
    const classroom = await this.classScope(actor, classId);
    return this.db.conversation.upsert({
      where: { classId },
      create: {
        organizationId: actor.organizationId,
        kind: 'class',
        classId,
        title: `${classroom.name}交流`,
      },
      update: {},
    });
  }

  private async conversation(actor: Actor, id: string): Promise<Conversation> {
    await this.auth.checkFeature(actor, '/api/communication');
    this.auth.require(actor, 'communication.read');
    const conversation = await this.db.conversation.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    if (conversation.kind === 'class' && conversation.classId)
      await this.classScope(actor, conversation.classId);
    else {
      const members = await this.db.conversationMember.findMany({
        where: { conversationId: id },
        select: { userId: true },
      });
      assertPrivateParticipant(
        members.map((member) => member.userId),
        actor.id,
      );
      const other = members.find((member) => member.userId !== actor.id)!;
      if (!(await this.directPeers(actor, other.userId)).has(other.userId))
        throw new ForbiddenException('已失去课程师生关系，不能访问私人会话');
    }
    return conversation;
  }

  private async assertNotBlocked(actor: Actor, userId: string) {
    const block = await this.db.communicationBlock.findFirst({
      where: {
        organizationId: actor.organizationId,
        OR: [
          { userId: actor.id, blockedUserId: userId },
          { userId, blockedUserId: actor.id },
        ],
      },
    });
    if (block) throw new ForbiddenException('当前双方已屏蔽，不能发送私信');
  }

  private async conversationRecipients(conversation: Conversation) {
    if (conversation.kind === 'direct')
      return (
        await this.db.conversationMember.findMany({
          where: { conversationId: conversation.id },
          select: { userId: true },
        })
      ).map((member) => member.userId);
    const [members, classes] = await Promise.all([
      this.db.classMember.findMany({
        where: { classId: conversation.classId!, active: true },
        select: { userId: true },
      }),
      this.db.courseClass.findMany({ where: { classId: conversation.classId! }, select: { courseId: true } }),
    ]);
    const teachers = await this.db.teachingAssignment.findMany({
      where: { courseId: { in: classes.map((item) => item.courseId) }, active: true },
      select: { userId: true },
    });
    return [...new Set([...members, ...teachers].map((member) => member.userId))];
  }

  async conversations(actor: Actor, page = 1, pageSize = 30) {
    this.auth.require(actor, 'communication.read');
    const peers = await this.directPeers(actor);
    const memberships = await this.db.conversationMember.findMany({
      where: { userId: actor.id },
      select: { conversationId: true },
    });
    const counterpart = await this.db.conversationMember.findMany({
      where: {
        conversationId: { in: memberships.map((member) => member.conversationId) },
        userId: { in: [...peers.keys()] },
      },
      select: { conversationId: true, userId: true },
    });
    const classIds = await this.allowedClassIds(actor);
    const where: Prisma.ConversationWhereInput = {
      organizationId: actor.organizationId,
      OR: [
        { kind: 'direct', id: { in: counterpart.map((member) => member.conversationId) } },
        { kind: 'class', classId: { in: classIds } },
      ],
    };
    const [items, total] = await Promise.all([
      this.db.conversation.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.conversation.count({ where }),
    ]);
    if (!items.length) return { items: [], total, page, pageSize };
    const ids = items.map((item) => item.id);
    const [latest, cursors] = await Promise.all([
      this.db.$queryRaw<Message[]>(
        Prisma.sql`SELECT DISTINCT ON ("conversationId") * FROM "Message" WHERE "conversationId" IN (${Prisma.join(ids)}) ORDER BY "conversationId", "createdAt" DESC, "id" DESC`,
      ),
      this.db.messageReadCursor.findMany({ where: { userId: actor.id, conversationId: { in: ids } } }),
    ]);
    const unreadFilters: Prisma.MessageWhereInput[] = ids.map((id) => {
      const cursor = cursors.find((item) => item.conversationId === id);
      return {
        conversationId: id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.messageCreatedAt } },
                { createdAt: cursor.messageCreatedAt, id: { gt: cursor.messageId } },
              ],
            }
          : {}),
      };
    });
    const unread = await this.db.message.groupBy({
      by: ['conversationId'],
      where: { senderId: { not: actor.id }, hidden: false, retractedAt: null, OR: unreadFilters },
      _count: { _all: true },
    });
    return {
      items: items.map((conversation) => {
        const message = latest.find((message) => message.conversationId === conversation.id);
        const peer = counterpart.find((member) => member.conversationId === conversation.id);
        return {
          ...conversation,
          title: peer ? peers.get(peer.userId)?.name || conversation.title : conversation.title,
          peerId: peer?.userId,
          lastMessage: message
            ? {
                id: message.id,
                body: message.hidden ? '[内容已隐藏]' : message.retractedAt ? '[消息已撤回]' : message.body,
                createdAt: message.createdAt,
              }
            : null,
          unreadCount: unread.find((item) => item.conversationId === conversation.id)?._count._all || 0,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async messages(actor: Actor, id: string, query: MessageQuery) {
    await this.conversation(actor, id);
    let cursor: Message | null = null;
    if (query.afterId) {
      cursor = await this.db.message.findFirst({ where: { id: query.afterId, conversationId: id } });
      if (!cursor) throw new BadRequestException('补取游标不属于当前会话');
    }
    const where: Prisma.MessageWhereInput = {
      conversationId: id,
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    };
    const [raw, total] = await Promise.all([
      this.db.message.findMany({
        where,
        orderBy: [{ createdAt: cursor ? 'asc' : 'desc' }, { id: cursor ? 'asc' : 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.message.count({ where }),
    ]);
    const items = cursor ? raw : raw.reverse();
    const names = await this.users(items.map((message) => message.senderId));
    const files = await this.attachmentMetadata(
      items.filter((item) => !item.hidden && !item.retractedAt).flatMap((item) => item.attachmentIds),
    );
    return {
      items: items.map((message) => ({
        id: message.id,
        conversationId: id,
        senderId: message.senderId,
        senderName: names.get(message.senderId),
        body: message.hidden ? '[内容已隐藏]' : message.retractedAt ? '[消息已撤回]' : message.body,
        attachmentIds: message.hidden || message.retractedAt ? [] : message.attachmentIds,
        attachments:
          message.hidden || message.retractedAt
            ? []
            : files.filter((file) => message.attachmentIds.includes(file.id)),
        createdAt: message.createdAt,
        retractedAt: message.retractedAt,
        clientId: message.clientId,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: query.page * query.pageSize < total,
    };
  }

  async sendMessage(actor: Actor, id: string, input: MessageInput) {
    this.auth.require(actor, 'communication.write');
    const conversation = await this.conversation(actor, id);
    await this.assertNotMuted(actor, undefined, conversation.classId || undefined);
    const recipients = await this.conversationRecipients(conversation);
    if (conversation.kind === 'direct')
      await this.assertNotBlocked(
        actor,
        recipients.find((userId) => userId !== actor.id)!,
      );
    await this.attachmentsFor(actor, input.attachmentIds, { conversationId: id });
    const body = input.body.trim() ? cleanText(input.body) : '';
    const key = { conversationId: id, senderId: actor.id, clientId: input.clientId };
    const existing = await this.db.message.findUnique({ where: { conversationId_senderId_clientId: key } });
    if (existing) {
      if (existing.retractedAt) return { ...existing, senderName: actor.name };
      if (existing.body !== body || !sameList(existing.attachmentIds, input.attachmentIds))
        throw new ConflictException('同一消息编号不能对应不同内容');
      return { ...existing, senderName: actor.name };
    }
    let message: Message;
    try {
      message = await this.db.$transaction(async (tx) => {
        const item = await tx.message.create({
          data: { ...key, body, attachmentIds: input.attachmentIds, organizationId: actor.organizationId },
        });
        await tx.conversation.update({ where: { id }, data: { updatedAt: item.createdAt } });
        return item;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.db.message.findUnique({
          where: { conversationId_senderId_clientId: key },
        });
        if (duplicate && duplicate.body === body && sameList(duplicate.attachmentIds, input.attachmentIds))
          return { ...duplicate, senderName: actor.name };
        throw new ConflictException('重复消息编号冲突，请更换编号重试');
      }
      throw error;
    }
    const others = recipients.filter((userId) => userId !== actor.id);
    await this.audit.notify(
      others,
      actor.organizationId,
      conversation.kind === 'class' ? 'CLASS_MESSAGE' : 'PRIVATE_MESSAGE',
      conversation.kind === 'class' ? '班级收到新消息' : '收到师生私信',
      `${actor.name} 发送了一条消息`,
      `/communication?conversation=${id}`,
      `message:${message.id}`,
    );
    await this.gateway.invalidate(recipients).catch(() => undefined);
    return { ...message, senderName: actor.name };
  }

  async markConversationRead(actor: Actor, id: string, messageId: string) {
    await this.conversation(actor, id);
    const message = await this.db.message.findFirst({ where: { id: messageId, conversationId: id } });
    if (!message) throw new BadRequestException('已读位置不属于当前会话');
    const where = { conversationId: id, userId: actor.id };
    await this.db.$transaction(async (tx) => {
      await tx.messageReadCursor.upsert({
        where: { conversationId_userId: where },
        create: { ...where, messageId, messageCreatedAt: message.createdAt },
        update: {},
      });
      await tx.messageReadCursor.updateMany({
        where: {
          ...where,
          OR: [
            { messageCreatedAt: { lt: message.createdAt } },
            { messageCreatedAt: message.createdAt, messageId: { lt: message.id } },
          ],
        },
        data: { messageId, messageCreatedAt: message.createdAt },
      });
    });
    return { success: true };
  }

  async retract(actor: Actor, id: string) {
    this.auth.require(actor, 'communication.write');
    const message = await this.db.message.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!message) throw new NotFoundException('消息不存在');
    const conversation = await this.conversation(actor, message.conversationId);
    if (message.senderId !== actor.id) throw new ForbiddenException('只能撤回自己的消息');
    if (message.retractedAt) return { success: true };
    if (!canRetract(message.senderId, actor.id, message.createdAt))
      throw new ForbiddenException('消息仅可在发送后两分钟内撤回');
    await this.db.$transaction(async (tx) => {
      const changed = await tx.message.updateMany({
        where: {
          id,
          senderId: actor.id,
          retractedAt: null,
          createdAt: { gt: new Date(Date.now() - 120000) },
        },
        data: { retractedAt: new Date(), body: '', attachmentIds: [] },
      });
      if (changed.count === 0) throw new ConflictException('消息撤回时间已过');
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'communication.retract',
          resourceType: 'Message',
          resourceId: id,
          requestId: actor.requestId,
          details: { conversationId: conversation.id },
        },
      });
    });
    await this.gateway.invalidate(await this.conversationRecipients(conversation)).catch(() => undefined);
    return { success: true };
  }

  async report(actor: Actor, input: ReportInput) {
    this.auth.require(actor, 'communication.read');
    let courseId: string | undefined,
      classId: string | undefined,
      isPrivate = false;
    if (input.targetType === 'post') courseId = (await this.post(actor, input.targetId)).courseId;
    else if (input.targetType === 'reply') {
      const reply = await this.db.discussionReply.findFirst({
        where: { id: input.targetId, organizationId: actor.organizationId, hidden: false },
      });
      if (!reply) throw new NotFoundException('回复不存在');
      courseId = (await this.post(actor, reply.postId)).courseId;
    } else {
      const message = await this.db.message.findFirst({
        where: { id: input.targetId, organizationId: actor.organizationId },
      });
      if (!message) throw new NotFoundException('消息不存在');
      const conversation = await this.conversation(actor, message.conversationId);
      classId = conversation.classId || undefined;
      isPrivate = conversation.kind === 'direct';
    }
    return this.db.$transaction(async (tx) => {
      const report = await tx.contentReport.create({
        data: {
          ...input,
          reason: cleanText(input.reason, 1000),
          organizationId: actor.organizationId,
          reporterId: actor.id,
          courseId,
          classId,
          isPrivate,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'communication.report',
          resourceType: 'ContentReport',
          resourceId: report.id,
          requestId: actor.requestId,
          details: { targetType: input.targetType, targetId: input.targetId },
        },
      });
      return report;
    });
  }

  private async reportScope(actor: Actor): Promise<Prisma.ContentReportWhereInput> {
    if (actor.role === 'TEACHER') {
      this.auth.require(actor, 'communication.write');
      return {
        organizationId: actor.organizationId,
        isPrivate: false,
        OR: [
          { courseId: { in: await this.auth.courseIds(actor) } },
          { classId: { in: await this.allowedClassIds(actor) } },
        ],
      };
    }
    this.auth.require(actor, 'communication.moderate');
    return { organizationId: actor.organizationId };
  }

  async reports(actor: Actor, page = 1, pageSize = 20, status = 'PENDING') {
    const where: Prisma.ContentReportWhereInput = {
      ...(await this.reportScope(actor)),
      ...(status === 'ALL' ? {} : { status }),
    };
    const [items, total] = await Promise.all([
      this.db.contentReport.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.contentReport.count({ where }),
    ]);
    const publicItems = items.filter((item) => !item.isPrivate);
    const [posts, replies, messages] = await Promise.all([
      this.db.discussionPost.findMany({
        where: {
          id: { in: publicItems.filter((item) => item.targetType === 'post').map((item) => item.targetId) },
          organizationId: actor.organizationId,
        },
        select: { id: true, title: true, body: true, authorId: true, hidden: true },
      }),
      this.db.discussionReply.findMany({
        where: {
          id: { in: publicItems.filter((item) => item.targetType === 'reply').map((item) => item.targetId) },
          organizationId: actor.organizationId,
        },
        select: { id: true, body: true, authorId: true, hidden: true },
      }),
      this.db.message.findMany({
        where: {
          id: {
            in: publicItems.filter((item) => item.targetType === 'message').map((item) => item.targetId),
          },
          organizationId: actor.organizationId,
        },
        select: { id: true, body: true, senderId: true, hidden: true, retractedAt: true },
      }),
    ]);
    const targets = [...posts, ...replies, ...messages.map((item) => ({ ...item, authorId: item.senderId }))];
    const names = await this.users([
      ...items.map((item) => item.reporterId),
      ...targets.map((item) => item.authorId),
    ]);
    // A report is not a grant to browse a private conversation. Only reporter-supplied reason is shown.
    return {
      items: items.map((item) => {
        const target = item.isPrivate ? null : targets.find((target) => target.id === item.targetId);
        return {
          ...item,
          reporterName: names.get(item.reporterId),
          privateContentRestricted: item.isPrivate,
          target: target ? { ...target, authorName: names.get(target.authorId) } : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async resolveReport(actor: Actor, id: string, action: 'hide' | 'dismiss', reason: string) {
    const report = await this.db.contentReport.findFirst({
      where: { id, ...(await this.reportScope(actor)) },
    });
    if (!report) throw new NotFoundException('举报不存在或无权处理');
    if (report.status !== 'PENDING') throw new ConflictException('举报已处理');
    if (report.isPrivate && action === 'hide')
      throw new ForbiddenException('内容治理权限不包含查看或修改私人会话；可记录处理结论或按举报原因禁言');
    if (report.courseId) await this.moderateCourse(actor, report.courseId);
    if (report.classId) await this.classScope(actor, report.classId);
    const resolution = cleanText(reason, 1000);
    const result = await this.db.$transaction(async (tx) => {
      const changed = await tx.contentReport.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: action === 'hide' ? 'RESOLVED' : 'DISMISSED',
          resolution,
          resolvedBy: actor.id,
          resolvedAt: new Date(),
        },
      });
      if (!changed.count) throw new ConflictException('举报已由其他管理员处理');
      if (action === 'hide') {
        if (report.targetType === 'post')
          await tx.discussionPost.update({ where: { id: report.targetId }, data: { hidden: true } });
        else if (report.targetType === 'reply')
          await tx.discussionReply.update({ where: { id: report.targetId }, data: { hidden: true } });
        else await tx.message.update({ where: { id: report.targetId }, data: { hidden: true } });
      }
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'communication.moderate',
          resourceType: 'ContentReport',
          resourceId: id,
          details: { action, reason: resolution, targetType: report.targetType, targetId: report.targetId },
          requestId: actor.requestId,
        },
      });
      return tx.contentReport.findUnique({ where: { id } });
    });
    await this.audit.notify(
      [report.reporterId],
      actor.organizationId,
      'REPORT_RESOLVED',
      '您的举报已处理',
      resolution,
      '/communication',
      `report:${id}:resolved`,
    );
    return result;
  }

  async setBlock(actor: Actor, userId: string, blocked: boolean) {
    this.auth.require(actor, 'communication.write');
    if (userId === actor.id) throw new BadRequestException('不能屏蔽自己');
    const target = await this.db.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId, active: true },
    });
    if (!target) throw new NotFoundException('用户不存在');
    if (blocked)
      await this.db.communicationBlock.upsert({
        where: { userId_blockedUserId: { userId: actor.id, blockedUserId: userId } },
        create: { organizationId: actor.organizationId, userId: actor.id, blockedUserId: userId },
        update: {},
      });
    else await this.db.communicationBlock.deleteMany({ where: { userId: actor.id, blockedUserId: userId } });
    return { success: true, blocked };
  }

  async blocks(actor: Actor) {
    this.auth.require(actor, 'communication.read');
    const items = await this.db.communicationBlock.findMany({
      where: { userId: actor.id, organizationId: actor.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.users(items.map((item) => item.blockedUserId));
    return {
      items: items.map((item) => ({
        userId: item.blockedUserId,
        name: names.get(item.blockedUserId),
        createdAt: item.createdAt,
      })),
    };
  }

  private async muteScope(actor: Actor, courseId?: string | null, classId?: string | null) {
    if (actor.role === 'TEACHER') {
      this.auth.require(actor, 'communication.write');
      if (courseId) await this.auth.course(actor, courseId, true);
      else if (classId) await this.classScope(actor, classId);
      else throw new ForbiddenException('教师只能在被授权课程或班级中禁言');
    } else {
      this.auth.require(actor, 'communication.moderate');
      if (courseId) await this.auth.course(actor, courseId);
      if (classId) await this.classScope(actor, classId);
    }
  }

  async mute(actor: Actor, input: MuteInput) {
    await this.muteScope(actor, input.courseId, input.classId);
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 30 * 86400000)
      throw new BadRequestException('禁言结束时间须在未来三十天内');
    if (input.userId === actor.id) throw new BadRequestException('不能禁言自己');
    const target = await this.db.user.findFirst({
      where: { id: input.userId, organizationId: actor.organizationId, active: true },
    });
    if (!target) throw new NotFoundException('用户不存在');
    if (actor.role === 'TEACHER') {
      const student = await this.db.userRole.findUnique({
        where: { userId_roleId: { userId: input.userId, roleId: 'STUDENT' } },
      });
      if (!student) throw new ForbiddenException('教师只可禁言教学范围内的学生');
      const member = input.courseId
        ? await this.db.enrollment.findFirst({
            where: { userId: input.userId, courseId: input.courseId, active: true },
          })
        : await this.db.classMember.findFirst({
            where: { userId: input.userId, classId: input.classId, active: true },
          });
      if (!member) throw new ForbiddenException('用户不在授权教学范围内');
    }
    return this.db.$transaction(async (tx) => {
      const mute = await tx.communicationMute.create({
        data: {
          ...input,
          reason: cleanText(input.reason, 1000),
          expiresAt,
          organizationId: actor.organizationId,
          createdBy: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'communication.mute',
          resourceType: 'CommunicationMute',
          resourceId: mute.id,
          requestId: actor.requestId,
          details: {
            userId: input.userId,
            courseId: input.courseId,
            classId: input.classId,
            reason: mute.reason,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return mute;
    });
  }

  async mutes(actor: Actor, page = 1, pageSize = 20) {
    const filter: Prisma.CommunicationMuteWhereInput = {
      organizationId: actor.organizationId,
      expiresAt: { gt: new Date() },
    };
    if (actor.role === 'TEACHER') {
      this.auth.require(actor, 'communication.write');
      filter.OR = [
        { courseId: { in: await this.auth.courseIds(actor) } },
        { classId: { in: await this.allowedClassIds(actor) } },
      ];
    } else this.auth.require(actor, 'communication.moderate');
    const [items, total] = await Promise.all([
      this.db.communicationMute.findMany({
        where: filter,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.communicationMute.count({ where: filter }),
    ]);
    const names = await this.users(items.map((item) => item.userId));
    return {
      items: items.map((item) => ({ ...item, userName: names.get(item.userId) })),
      total,
      page,
      pageSize,
    };
  }

  async unmute(actor: Actor, id: string) {
    const mute = await this.db.communicationMute.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!mute) throw new NotFoundException('禁言记录不存在');
    await this.muteScope(actor, mute.courseId, mute.classId);
    await this.db.$transaction(async (tx) => {
      await tx.communicationMute.update({ where: { id }, data: { expiresAt: new Date() } });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'communication.unmute',
          resourceType: 'CommunicationMute',
          resourceId: id,
          requestId: actor.requestId,
          details: { userId: mute.userId },
        },
      });
    });
    return { success: true };
  }

  async notifications(
    actor: Actor,
    query: { page: number; pageSize: number; type?: string; unread?: string },
  ) {
    const where: Prisma.NotificationWhereInput = {
      userId: actor.id,
      organizationId: actor.organizationId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.unread === 'true' ? { readAt: null } : {}),
    };
    const [items, total, unreadCount] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.notification.count({ where }),
      this.db.notification.count({
        where: { userId: actor.id, organizationId: actor.organizationId, readAt: null },
      }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize, unreadCount };
  }

  async readNotification(actor: Actor, id?: string) {
    const where = { userId: actor.id, organizationId: actor.organizationId, ...(id ? { id } : {}) };
    if (id && !(await this.db.notification.findFirst({ where }))) throw new NotFoundException('通知不存在');
    await this.db.notification.updateMany({
      where: { ...where, readAt: null, createdAt: { lte: new Date() } },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  private async assignmentAttachmentScope(
    actor: Actor,
    assignmentId: string,
    ownerId: string,
    uploading: boolean,
  ) {
    const assignment = await this.db.assignment.findFirst({
      where: { id: assignmentId, organizationId: actor.organizationId },
    });
    if (!assignment) throw new NotFoundException('作业不存在');
    await this.auth.course(actor, assignment.courseId);
    if (actor.id === ownerId) {
      if (actor.role === 'STUDENT') {
        if (
          assignment.status !== 'published' ||
          assignment.opensAt > new Date() ||
          !(await this.db.assignmentAudience.findFirst({ where: { assignmentId, userId: actor.id } }))
        )
          throw new ForbiddenException('无权访问此作业附件');
        if (uploading && assignment.dueAt < new Date() && !assignment.allowLate) {
          const exception = await this.db.assignmentException.findFirst({
            where: { assignmentId, userId: actor.id },
          });
          if (!exception?.allowUntil || exception.allowUntil < new Date())
            throw new ForbiddenException('作业已截止，尚未获准补交');
        }
      }
    } else {
      this.auth.require(actor, 'assessment.grade');
      await this.auth.course(actor, assignment.courseId);
    }
    return assignment;
  }

  async upload(
    actor: Actor,
    file: Express.Multer.File | undefined,
    input: AttachmentInput,
    lease: UploadOperation,
  ) {
    this.auth.require(actor, 'file.upload');
    if (!file) throw new BadRequestException('请选择文件');
    if (input.courseId) await this.auth.course(actor, input.courseId);
    if (input.conversationId) await this.conversation(actor, input.conversationId);
    if (input.assignmentId) await this.assignmentAttachmentScope(actor, input.assignmentId, actor.id, true);
    const settings = await this.db.systemSetting.findMany({
      where: { organizationId: actor.organizationId, key: { in: ['maxUploadMB', 'allowedFileTypes'] } },
    });
    const sizeSetting = settings.find((item) => item.key === 'maxUploadMB')?.value;
    const envMax = Number(process.env.MAX_UPLOAD_MB || '10');
    const maxMB = Math.min(
      50,
      Number.isFinite(envMax) && envMax > 0 ? envMax : 10,
      typeof sizeSetting === 'number' && sizeSetting > 0 ? sizeSetting : 50,
    );
    const inspected = inspectUpload(file.originalname, file.buffer, maxMB * 1024 * 1024);
    if (inspected.mime === 'application/pdf') await assertSafePdf(file.buffer);
    const allowed = settings.find((item) => item.key === 'allowedFileTypes')?.value;
    const extension = inspected.name.split('.').pop()?.toLowerCase() || '';
    if (
      Array.isArray(allowed) &&
      !allowed.some(
        (value) =>
          typeof value === 'string' &&
          [extension, `.${extension}`, inspected.mime].includes(value.toLowerCase()),
      )
    )
      throw new ForbiddenException('机构配置不允许上传此文件类型');
    const current = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.organizationId !== actor.organizationId ||
      current.role !== actor.role
    )
      throw new ForbiddenException('上传期间会话或身份发生变化，请重试');
    this.auth.require(current, 'file.upload');
    if (input.courseId) await this.auth.course(current, input.courseId);
    if (input.conversationId) await this.conversation(current, input.conversationId);
    if (input.assignmentId)
      await this.assignmentAttachmentScope(current, input.assignmentId, current.id, true);
    if (!lease || lease.ownerId !== actor.id || lease.organizationId !== actor.organizationId)
      throw new ForbiddenException('上传缺少有效容量预留');
    const storageKey = lease.storageKey;
    await this.storage.put(storageKey, file.buffer);
    try {
      const attachment = await this.uploadSafety.finish(actor, lease, {
        organizationId: actor.organizationId,
        ownerId: actor.id,
        ...input,
        originalName: inspected.name,
        mime: inspected.mime,
        size: file.buffer.length,
        storageKey,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      });
      return {
        id: attachment.id,
        name: attachment.originalName,
        mime: attachment.mime,
        size: attachment.size,
      };
    } catch (error) {
      await this.uploadSafety.release(lease.id);
      throw error;
    }
  }

  async removeAttachment(actor: Actor, id: string) {
    const result = await this.uploadSafety.remove(actor, id);
    await this.audit.record(actor, 'attachment.delete', 'Attachment', id);
    return result;
  }

  private async publishedCourseAttachment(actor: Actor, id: string, courseId: string) {
    const now = new Date();
    const managesCourse =
      actor.permissions.includes('course.manage') || actor.permissions.includes('course.admin');
    const managesAssignments =
      actor.permissions.includes('assessment.manage') || actor.permissions.includes('assessment.grade');
    const moderatesDiscussion =
      actor.permissions.includes('communication.moderate') ||
      (actor.role === 'TEACHER' && managesCourse && actor.permissions.includes('communication.write'));
    const [post, lesson, assignment, replies] = await Promise.all([
      this.db.discussionPost.findFirst({
        where: { courseId, attachmentIds: { has: id }, ...(moderatesDiscussion ? {} : { hidden: false }) },
        select: { id: true },
      }),
      this.db.lesson.findFirst({
        where: {
          courseId,
          AND: [
            { OR: [{ attachmentId: id }, { attachmentIds: { has: id } }] },
            ...(managesCourse ? [] : [{ OR: [{ opensAt: null }, { opensAt: { lte: now } }] }]),
          ],
        },
        select: { id: true },
      }),
      actor.role === 'STUDENT' || managesAssignments
        ? this.db.assignment.findFirst({
            where: {
              courseId,
              attachmentIds: { has: id },
              ...(managesAssignments
                ? {}
                : { status: 'published', opensAt: { lte: now }, audience: { some: { userId: actor.id } } }),
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.db.$queryRaw<Array<{ found: boolean }>>`SELECT EXISTS (
        SELECT 1 FROM "DiscussionReply" r JOIN "DiscussionPost" p ON p."id" = r."postId"
        WHERE r."organizationId" = ${actor.organizationId} AND p."courseId" = ${courseId}
          AND ${id} = ANY(r."attachmentIds") AND (${moderatesDiscussion} OR (NOT r."hidden" AND NOT p."hidden"))
      ) AS found`,
    ]);
    const replyPost = replies[0]?.found;
    if (!post && !lesson && !assignment && !replyPost)
      throw new ForbiddenException('文件尚未开放或所属内容已被隐藏');
    if (!lesson && !assignment) {
      this.auth.require(actor, 'communication.read');
      await this.auth.checkFeature(actor, '/api/communication');
    }
  }

  async download(actor: Actor, id: string) {
    const attachment = await this.db.attachment.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!attachment) throw new NotFoundException('文件不存在');
    if (attachment.exportJobId) {
      if (attachment.ownerId !== actor.id || !attachment.assignmentId)
        throw new ForbiddenException('导出文件仅限申请人下载');
      await this.exportAccess(actor, attachment.assignmentId);
      await this.audit.record(actor, 'data.export.download', 'Attachment', id, {
        assignmentId: attachment.assignmentId,
        jobId: attachment.exportJobId,
      });
    } else if (attachment.courseId) {
      await this.auth.course(actor, attachment.courseId);
      if (attachment.ownerId !== actor.id)
        await this.publishedCourseAttachment(actor, id, attachment.courseId);
    } else if (attachment.conversationId) {
      await this.conversation(actor, attachment.conversationId);
      if (
        attachment.ownerId !== actor.id &&
        !(await this.db.message.findFirst({
          where: {
            conversationId: attachment.conversationId,
            attachmentIds: { has: id },
            retractedAt: null,
            hidden: false,
          },
        }))
      )
        throw new ForbiddenException('文件尚未发送或消息已撤回');
    } else if (attachment.assignmentId) {
      if (
        attachment.ownerId !== actor.id &&
        !(await this.db.assignmentSubmission.findFirst({
          where: {
            assignmentId: attachment.assignmentId,
            userId: attachment.ownerId,
            attachmentIds: { has: id },
          },
          select: { id: true },
        }))
      )
        throw new ForbiddenException('未正式提交的作业附件仅限本人访问');
      await this.assignmentAttachmentScope(actor, attachment.assignmentId, attachment.ownerId, false);
    } else if (attachment.ownerId !== actor.id) {
      const courseIds = await this.auth.courseIds(actor);
      const instructions = await this.db.assignment.findFirst({
        where: {
          organizationId: actor.organizationId,
          courseId: { in: courseIds },
          attachmentIds: { has: id },
          status: 'published',
          ...(actor.role === 'STUDENT'
            ? { opensAt: { lte: new Date() }, audience: { some: { userId: actor.id } } }
            : {}),
        },
        select: { id: true },
      });
      // Private draft uploads remain private until a formal assignment submission references them.
      if (!instructions) {
        this.auth.require(actor, 'assessment.grade');
        const submission = await this.db.assignmentSubmission.findFirst({
          where: {
            userId: attachment.ownerId,
            attachmentIds: { has: id },
            assignment: { organizationId: actor.organizationId, courseId: { in: courseIds } },
          },
          select: { assignmentId: true },
        });
        if (!submission) throw new ForbiddenException('无权下载私人文件');
        await this.assignmentAttachmentScope(actor, submission.assignmentId, attachment.ownerId, false);
      }
    }
    return {
      stream: this.storage.get(attachment.storageKey),
      name: attachment.originalName,
      mime: attachment.mime,
      size: attachment.size,
    };
  }

  private async exportAccess(actor: Actor, assignmentId: string) {
    this.auth.require(actor, 'assessment.grade');
    this.auth.require(actor, 'data.export');
    const assignment = await this.db.assignment.findFirst({
      where: { id: assignmentId, organizationId: actor.organizationId },
    });
    if (!assignment) throw new NotFoundException('作业不存在');
    await this.auth.course(actor, assignment.courseId);
    return assignment;
  }

  private async exportPlan(actor: Actor, assignmentId: string) {
    const assignment = await this.exportAccess(actor, assignmentId);
    const rows = await this.db.assignmentSubmission.findMany({
      where: { assignmentId },
      select: { id: true, userId: true, version: true, attachmentIds: true },
      orderBy: [{ userId: 'asc' }, { version: 'asc' }, { id: 'asc' }],
      take: 501,
    });
    if (rows.length > 500)
      throw new BadRequestException(
        '本次导出超过 500 个提交版本，请按班级拆分作业后重试；系统不会截断导出内容',
      );
    const [answerBytes, gradingBytes] = await Promise.all([
      this.db.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT COALESCE(SUM(pg_column_size("answers") + octet_length("feedback")), 0)::bigint AS bytes FROM "AssignmentSubmission" WHERE "assignmentId" = ${assignmentId}`,
      this.db.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT COALESCE(SUM(pg_column_size(f."items") + octet_length(f."comment")), 0)::bigint AS bytes FROM "AssignmentFeedback" f JOIN "AssignmentSubmission" s ON s."id" = f."submissionId" WHERE s."assignmentId" = ${assignmentId}`,
    ]);
    if (Number(answerBytes[0]?.bytes || 0) + Number(gradingBytes[0]?.bytes || 0) > 20 * 1024 * 1024)
      throw new BadRequestException('在线答案和批注超过 20 MB 导出上限，需缩小范围；未生成部分文件');
    const attachmentIds = [...new Set(rows.flatMap((row) => row.attachmentIds))];
    const files = await this.db.attachment.findMany({
      where: { id: { in: attachmentIds }, organizationId: actor.organizationId, exportJobId: null },
    });
    if (files.length !== attachmentIds.length)
      throw new ConflictException('部分原始附件缺失，导出已停止以免产生不完整资料');
    const fileMap = new Map(files.map((file) => [file.id, file]));
    let bytes = 0;
    for (const row of rows)
      for (const fileId of row.attachmentIds) {
        const file = fileMap.get(fileId)!;
        if (
          file.ownerId !== row.userId ||
          file.courseId ||
          file.conversationId ||
          (file.assignmentId && file.assignmentId !== assignmentId)
        )
          throw new ForbiddenException('提交附件的业务归属不匹配');
        bytes += file.size;
      }
    const configured = Number(process.env.MAX_ASSIGNMENT_EXPORT_MB || 100);
    const maxMB = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 500) : 100;
    if (bytes > maxMB * 1024 * 1024)
      throw new BadRequestException(`导出附件超过 ${maxMB} MB 上限，请缩小范围；未生成部分文件`);
    return { assignment, rows, files };
  }

  async requestAssignmentExport(actor: Actor, assignmentId: string, clientId: string) {
    await this.exportPlan(actor, assignmentId);
    if (!actor.sessionId) throw new ForbiddenException('导出需要有效会话');
    const eventKey = `assignment-export:${actor.id}:${assignmentId}:${clientId}`;
    const job = await this.db.backgroundJob.upsert({
      where: { eventKey },
      create: {
        organizationId: actor.organizationId,
        kind: 'ASSIGNMENT_EXPORT',
        eventKey,
        payload: { userId: actor.id, sessionId: actor.sessionId, assignmentId },
      },
      update: {},
    });
    await this.audit.record(actor, 'data.export.request', 'BackgroundJob', job.id, { assignmentId });
    return { jobId: job.id, status: job.status };
  }

  async assignmentExportStatus(actor: Actor, id: string) {
    const job = await this.db.backgroundJob.findFirst({
      where: { id, organizationId: actor.organizationId, kind: 'ASSIGNMENT_EXPORT' },
    });
    if (!job) throw new NotFoundException('导出任务不存在');
    const payload = job.payload as {
      userId: string;
      assignmentId: string;
      attachmentId?: string;
      error?: string;
    };
    if (payload.userId !== actor.id) throw new ForbiddenException('导出任务仅限申请人查看');
    await this.exportAccess(actor, payload.assignmentId);
    return {
      jobId: id,
      status: job.status,
      attempts: job.attempts,
      attachmentId: job.status === 'SUCCEEDED' ? payload.attachmentId : undefined,
      error: payload.error || job.lastError,
      createdAt: job.createdAt,
    };
  }

  async processAssignmentExport(job: BackgroundJob) {
    const payload = job.payload as {
      userId: string;
      sessionId: string;
      assignmentId: string;
      attachmentId?: string;
      error?: string;
    };
    const actor = await this.auth.resolveSessionId(payload.sessionId);
    if (!actor || actor.id !== payload.userId || actor.organizationId !== job.organizationId)
      throw new ForbiddenException('导出申请人的会话已失效');
    await this.exportAccess(actor, payload.assignmentId);
    const existing = await this.db.attachment.findUnique({ where: { exportJobId: job.id } });
    if (existing) {
      await this.db.backgroundJob.update({
        where: { id: job.id },
        data: { payload: { ...payload, attachmentId: existing.id, error: '' } },
      });
      return;
    }
    const configuredMaximum = Number(process.env.MAX_ASSIGNMENT_EXPORT_MB || 100);
    const exportMaximum =
      Number.isFinite(configuredMaximum) && configuredMaximum > 0 ? Math.min(configuredMaximum, 500) : 100;
    const uploadLease = await this.uploadSafety.reserve(
      actor,
      Math.ceil((exportMaximum + 30) * 1024 * 1024),
      'export',
    );
    const storageKey = uploadLease.storageKey;
    const lease = setInterval(() => {
      void this.db.backgroundJob
        .updateMany({ where: { id: job.id, status: 'RUNNING' }, data: { lockedAt: new Date() } })
        .catch(() => undefined);
    }, 20000);
    lease.unref();
    try {
      const plan = await this.exportPlan(actor, payload.assignmentId);
      const rows = await this.db.$transaction(
        (tx) =>
          tx.assignmentSubmission.findMany({
            where: { id: { in: plan.rows.map((row) => row.id) } },
            include: { grading: { orderBy: { revision: 'asc' } } },
            orderBy: [{ userId: 'asc' }, { version: 'asc' }, { id: 'asc' }],
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      const names = await this.users(rows.map((row) => row.userId));
      const fileMap = new Map(plan.files.map((file) => [file.id, file]));
      const exportedAt = new Date();
      const entries: Array<{ path: string; fileId: string }> = [];
      const manifest = {
        schemaVersion: 1,
        exportedAt: exportedAt.toISOString(),
        assignment: {
          id: plan.assignment.id,
          title: plan.assignment.title,
          courseId: plan.assignment.courseId,
          totalCents: plan.assignment.totalCents,
        },
        rules:
          '每次正式提交和对应批注保留独立版本；scoreCents除以100为显示分数；null表示尚无正式分数。附件路径由服务端生成，原始文件名保留在清单中。',
        submissions: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          userName: names.get(row.userId),
          version: row.version,
          status: row.status,
          submittedAt: row.submittedAt,
          late: row.late,
          gradingStatus: row.gradingStatus,
          scoreCents: row.scoreCents,
          releasedAt: row.releasedAt,
          answers: row.answers,
          feedback: row.feedback,
          gradingHistory: row.grading,
          files: row.attachmentIds.map((fileId, index) => {
            const file = fileMap.get(fileId)!;
            const extension = file.originalName.split('.').pop()?.toLowerCase();
            const suffix = extension && /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin';
            const path = `submissions/${createHash('sha256').update(row.userId).digest('hex').slice(0, 12)}/v${row.version}/${index + 1}-${fileId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}.${suffix}`;
            entries.push({ path, fileId });
            return {
              id: file.id,
              path,
              name: file.originalName,
              mime: file.mime,
              size: file.size,
              sha256: file.sha256,
            };
          }),
        })),
      };
      const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
      if (manifestBytes.length > 30 * 1024 * 1024)
        throw new BadRequestException('导出清单超过 30 MB 上限，未生成部分文件');
      const storage = this.storage;
      async function* archiveEntries(): AsyncGenerator<ArchiveEntry> {
        yield { name: 'manifest.json', size: manifestBytes.length, source: manifestBytes };
        for (const entry of entries) {
          const file = fileMap.get(entry.fileId)!;
          yield { name: entry.path, size: file.size, source: storage.get(file.storageKey) };
        }
      }
      const archive = compressedArchive(archiveEntries(), exportedAt);
      await this.storage.putStream(storageKey, archive.stream);
      const current = await this.auth.resolveSessionId(payload.sessionId);
      if (!current || current.id !== actor.id || current.organizationId !== actor.organizationId)
        throw new ForbiddenException('导出过程中会话失效');
      await this.exportAccess(current, payload.assignmentId);
      const size = archive.size(),
        sha256 = archive.digest();
      try {
        await this.uploadSafety.finish(
          actor,
          uploadLease,
          {
            organizationId: actor.organizationId,
            ownerId: actor.id,
            assignmentId: payload.assignmentId,
            exportJobId: job.id,
            originalName: `${safeFilename(plan.assignment.title).slice(0, 80)}-提交版本-${exportedAt.toISOString().slice(0, 10)}.tar.gz`,
            storageKey,
            mime: 'application/gzip',
            size,
            sha256,
            claimedAt: new Date(),
          },
          async (tx, attachment) => {
            await tx.backgroundJob.update({
              where: { id: job.id },
              data: { payload: { ...payload, attachmentId: attachment.id, error: '' } },
            });
            await tx.auditLog.create({
              data: {
                organizationId: actor.organizationId,
                userId: actor.id,
                action: 'data.export',
                resourceType: 'Assignment',
                resourceId: payload.assignmentId,
                details: {
                  jobId: job.id,
                  submissionCount: rows.length,
                  fileCount: entries.length,
                  bytes: size,
                },
              },
            });
          },
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const winner = await this.db.attachment.findUnique({ where: { exportJobId: job.id } });
          if (winner) {
            await this.uploadSafety.release(uploadLease.id);
            await this.db.backgroundJob.update({
              where: { id: job.id },
              data: { payload: { ...payload, attachmentId: winner.id, error: '' } },
            });
            return;
          }
        }
        throw error;
      }
    } catch (error) {
      await this.uploadSafety.release(uploadLease.id);
      const message =
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
          ? error.message
          : '导出文件处理失败，后台将重试；请检查运行记录';
      await this.db.backgroundJob.update({
        where: { id: job.id },
        data: { payload: { ...payload, error: message } },
      });
      throw error;
    } finally {
      clearInterval(lease);
    }
  }
}
