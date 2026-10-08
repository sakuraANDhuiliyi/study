import type { PrismaClient } from '@prisma/client';

export async function seedCommunication(
  db: PrismaClient,
  ctx: { organizationId: string; teacherId: string; studentId: string; courseId: string; classId: string },
) {
  const { organizationId, teacherId, studentId, courseId, classId } = ctx;
  const post = await db.discussionPost.upsert({
    where: { id: 'demo-discussion-welcome' },
    create: {
      id: 'demo-discussion-welcome',
      organizationId,
      courseId,
      authorId: teacherId,
      title: '本周答疑：如何安排有效的复习？',
      body: '欢迎在这里分享学习进度和遇到的问题。建议先完成课程课时，再做练习；遇到不理解的知识点可以引用回复继续讨论。',
      pinned: true,
      featured: true,
    },
    update: {},
  });
  await db.discussionReply.upsert({
    where: { id: 'demo-discussion-reply' },
    create: {
      id: 'demo-discussion-reply',
      organizationId,
      postId: post.id,
      authorId: studentId,
      body: '我已经完成第一课，准备根据错题本再复习一次。',
    },
    update: {},
  });
  const classRoom = await db.conversation.upsert({
    where: { classId },
    create: { id: 'demo-class-conversation', organizationId, kind: 'class', title: '示范班交流', classId },
    update: {},
  });
  await db.message.upsert({
    where: {
      conversationId_senderId_clientId: {
        conversationId: classRoom.id,
        senderId: teacherId,
        clientId: 'seed-class-welcome',
      },
    },
    create: {
      organizationId,
      conversationId: classRoom.id,
      senderId: teacherId,
      clientId: 'seed-class-welcome',
      body: '同学们好！本周学习任务已开放，有问题可以在课程讨论区留言。',
    },
    update: {},
  });
  const directKey = `${organizationId}:${[teacherId, studentId].sort().join(':')}`;
  const direct = await db.conversation.upsert({
    where: { directKey },
    create: { id: 'demo-direct-conversation', organizationId, kind: 'direct', title: '师生私信', directKey },
    update: {},
  });
  await db.conversationMember.createMany({
    data: [teacherId, studentId].map((userId) => ({ conversationId: direct.id, userId })),
    skipDuplicates: true,
  });
  await db.message.upsert({
    where: {
      conversationId_senderId_clientId: {
        conversationId: direct.id,
        senderId: teacherId,
        clientId: 'seed-direct-welcome',
      },
    },
    create: {
      organizationId,
      conversationId: direct.id,
      senderId: teacherId,
      clientId: 'seed-direct-welcome',
      body: '欢迎加入课程。你可以在这里向授课教师询问个人学习问题。',
    },
    update: {},
  });
  await db.notification.upsert({
    where: { userId_eventKey: { userId: studentId, eventKey: 'seed:communication-welcome' } },
    create: {
      organizationId,
      userId: studentId,
      eventKey: 'seed:communication-welcome',
      type: 'PRIVATE_MESSAGE',
      title: '教师发送了欢迎消息',
      body: '进入交流中心查看课程讨论与师生私信。',
      link: `/communication?conversation=${direct.id}`,
    },
    update: {},
  });
}
