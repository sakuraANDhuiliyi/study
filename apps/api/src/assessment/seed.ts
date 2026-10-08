import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { QuestionData } from './scoring';

type SeedContext = {
  organizationId: string;
  teacherId: string;
  studentId: string;
  courseId: string;
  otherStudentId: string;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function seedAssessments(db: PrismaClient, context: SeedContext) {
  const { organizationId, teacherId, studentId, courseId } = context;
  const now = Date.now();
  const audienceIds = [...new Set([studentId, context.otherStudentId])];
  const definitions = [
    {
      id: 'demo-practice-single',
      type: 'single',
      stem: '在关系型数据库中，哪一种约束用于唯一标识表中的每一行？',
      options: [
        { id: 'A', text: '主键约束' },
        { id: 'B', text: '默认值约束' },
        { id: 'C', text: '非空约束' },
        { id: 'D', text: '检查约束' },
      ],
      answer: 'A',
      explanation: '主键（PRIMARY KEY）要求值唯一且非空，能唯一标识一行。',
      scoreCents: 2000,
      practice: true,
      knowledgePoints: ['关系模型', '主键'],
    },
    {
      id: 'demo-practice-short',
      type: 'short',
      stem: '请结合一个选课场景，说明事务的原子性和一致性。',
      options: [],
      answer:
        '选课需要同步写入选课记录并扣减剩余名额。两个步骤必须一同成功或一同回滚（原子性），名额不得为负且不得重复选课（一致性）。',
      explanation: '可从业务不变量出发，解释事务边界和失败回滚。',
      scoreCents: 3000,
      practice: true,
      knowledgePoints: ['事务', 'ACID'],
    },
    {
      id: 'demo-practice-multiple',
      type: 'multiple',
      stem: '以下哪些属于事务的 ACID 特性？',
      options: [
        { id: 'A', text: '原子性' },
        { id: 'B', text: '一致性' },
        { id: 'C', text: '隔离性' },
        { id: 'D', text: '界面友好性' },
      ],
      answer: ['A', 'B', 'C'],
      explanation: 'ACID 包括原子性、一致性、隔离性、持久性。漏选按正确选项比例给分，错选不得分。',
      scoreCents: 1500,
      practice: true,
      knowledgePoints: ['事务', 'ACID'],
    },
    {
      id: 'demo-practice-boolean',
      type: 'boolean',
      stem: '外键约束可以帮助维护表与表之间的引用完整性。',
      options: [],
      answer: true,
      explanation: '外键阻止引用不存在的关联记录，删除策略还可保护历史数据。',
      scoreCents: 1000,
      practice: true,
      knowledgePoints: ['引用完整性'],
    },
    {
      id: 'demo-practice-blank',
      type: 'blank',
      stem: '用于查询数据的 SQL 关键字是 ____；对查询结果进行排序的子句是 ____。',
      options: [],
      answer: [['SELECT'], ['ORDER BY']],
      explanation: 'SELECT 查询数据，ORDER BY 指定排序。匹配会忽略大小写、多余空格和全角差异。',
      scoreCents: 1000,
      practice: true,
      knowledgePoints: ['SQL 查询'],
    },
    {
      id: 'demo-exam-single',
      type: 'single',
      stem: '当两名用户同时修改同一条记录时，使用版本号检测冲突属于哪种控制方式？',
      options: [
        { id: 'A', text: '乐观并发控制' },
        { id: 'B', text: '禁用所有事务' },
        { id: 'C', text: '无条件覆盖' },
        { id: 'D', text: '只依赖客户端时间' },
      ],
      answer: 'A',
      explanation: '版本号配合条件更新可以检测陈旧写入，防止静默覆盖。',
      scoreCents: 4000,
      practice: false,
      knowledgePoints: ['并发控制'],
    },
    {
      id: 'demo-exam-short',
      type: 'short',
      stem: '设计一个防止重复选课的数据库方案，说明唯一约束和事务各自承担的职责。',
      options: [],
      answer:
        '在 student_id 与 course_id 上建立组合唯一约束；在事务中检查名额并写入选课，同时原子更新名额。唯一约束抵御并发重复，事务保证多步骤一致。',
      explanation: '评分参考：组合唯一约束 20 分，事务边界 20 分，并发名额控制 20 分。',
      scoreCents: 6000,
      practice: false,
      knowledgePoints: ['唯一约束', '事务'],
    },
    {
      id: 'demo-history-single',
      type: 'single',
      stem: '数据库索引主要用于改进哪一类操作的效率？',
      options: [
        { id: 'A', text: '数据查询与定位' },
        { id: 'B', text: '屏幕亮度调整' },
        { id: 'C', text: '网络物理连接' },
      ],
      answer: 'A',
      explanation: '索引建立辅助结构用于高效查找，但维护索引也会产生写入开销。',
      scoreCents: 10000,
      practice: false,
      knowledgePoints: ['索引'],
    },
  ];
  const versions: Record<string, QuestionData> = {};
  for (const definition of definitions) {
    const { id, practice, ...fields } = definition;
    await db.question.upsert({
      where: { id },
      create: {
        id,
        organizationId,
        courseId,
        creatorId: teacherId,
        scope: 'shared',
        practiceEnabled: practice,
        everPracticeEnabled: practice,
      },
      update: {},
    });
    const version = await db.questionVersion.upsert({
      where: { questionId_version: { questionId: id, version: 1 } },
      create: {
        id: `${id}-v1`,
        questionId: id,
        version: 1,
        ...fields,
        options: json(fields.options),
        answer: json(fields.answer),
        rules: { partialCredit: true, caseSensitive: false, trim: true, collapseWhitespace: true },
        difficulty: 2,
        tags: ['演示数据'],
        children: [],
      },
      update: {},
    });
    versions[id] = version as unknown as QuestionData;
  }
  const assignmentQuestions = ['demo-practice-single', 'demo-practice-short'];
  await db.assignment.upsert({
    where: { id: 'demo-assignment' },
    create: {
      id: 'demo-assignment',
      organizationId,
      courseId,
      creatorId: teacherId,
      title: '第 3 周 · 关系模型与事务实践',
      description: '先完成基础选择题，再用自己的语言解释事务如何保障选课流程。支持草稿保存与两次正式提交。',
      status: 'published',
      opensAt: new Date(now - 86400000),
      dueAt: new Date(now + 7 * 86400000),
      maxAttempts: 2,
      totalCents: 5000,
      attachmentIds: [],
      audience: { create: audienceIds.map((userId) => ({ userId })) },
      items: {
        create: assignmentQuestions.map((id, position) => ({
          questionVersionId: versions[id]!.id,
          position,
        })),
      },
    },
    update: {},
  });
  const pendingUser = context.otherStudentId || studentId;
  await db.assignmentSubmission.upsert({
    where: {
      assignmentId_userId_version: { assignmentId: 'demo-assignment', userId: pendingUser, version: 1 },
    },
    create: {
      id: 'demo-submission',
      assignmentId: 'demo-assignment',
      userId: pendingUser,
      version: 1,
      idempotencyKey: 'demo-submission-key',
      answers: [
        { questionVersionId: versions['demo-practice-single']!.id, value: 'A' },
        {
          questionVersionId: versions['demo-practice-short']!.id,
          value: '事务让选课记录和名额更新一起提交，失败时一起撤销，避免只扣名额没有选课记录。',
        },
      ],
      attachmentIds: [],
      late: false,
    },
    update: {},
  });
  const examQuestions = ['demo-exam-single', 'demo-exam-short'];
  await db.exam.upsert({
    where: { id: 'demo-exam' },
    create: {
      id: 'demo-exam',
      organizationId,
      courseId,
      creatorId: teacherId,
      title: '数据库基础 · 阶段测验',
      description:
        '考试时长 45 分钟。自动保存以服务器确认结果为准。含一道客观题与一道主观题，主观题完成阅卷后统一发布成绩。',
      status: 'published',
      startsAt: new Date(now - 3600000),
      endsAt: new Date(now + 4 * 3600000),
      entryClosesAt: new Date(now + 3 * 3600000),
      durationMinutes: 45,
      maxAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      passCents: 6000,
      totalCents: 10000,
      graderIds: [teacherId],
      appealDeadline: new Date(now + 14 * 86400000),
      audience: { create: audienceIds.map((userId) => ({ userId })) },
      snapshot: {
        create: {
          items: {
            create: examQuestions.map((id, position) => ({
              questionId: id,
              questionVersionId: versions[id]!.id,
              position,
              content: json(versions[id]),
            })),
          },
        },
      },
    },
    update: {},
  });
  await db.exam.upsert({
    where: { id: 'demo-history-exam' },
    create: {
      id: 'demo-history-exam',
      organizationId,
      courseId,
      creatorId: teacherId,
      title: '第 2 周 · SQL 基础测验',
      description: '已结束的测验，用于查看成绩和提交复核。',
      status: 'published',
      startsAt: new Date(now - 8 * 86400000),
      endsAt: new Date(now - 7 * 86400000),
      entryClosesAt: new Date(now - 7 * 86400000 - 3600000),
      durationMinutes: 30,
      passCents: 6000,
      totalCents: 10000,
      graderIds: [teacherId],
      scoreReleaseAt: new Date(now - 6 * 86400000),
      answerReleaseAt: new Date(now - 6 * 86400000),
      explanationReleaseAt: new Date(now - 6 * 86400000),
      commentReleaseAt: new Date(now - 6 * 86400000),
      gradesReleasedAt: new Date(now - 6 * 86400000),
      appealDeadline: new Date(now + 7 * 86400000),
      audience: { create: audienceIds.map((userId) => ({ userId })) },
      snapshot: {
        create: {
          items: {
            create: [
              {
                questionId: 'demo-history-single',
                questionVersionId: versions['demo-history-single']!.id,
                position: 0,
                content: json(versions['demo-history-single']),
              },
            ],
          },
        },
      },
    },
    update: {},
  });
  await db.examAttempt.upsert({
    where: { examId_userId_number: { examId: 'demo-history-exam', userId: studentId, number: 1 } },
    create: {
      id: 'demo-history-attempt',
      examId: 'demo-history-exam',
      userId: studentId,
      number: 1,
      status: 'submitted',
      gradingStatus: 'graded',
      releaseStatus: 'released',
      startedAt: new Date(now - 8 * 86400000 + 60000),
      deadlineAt: new Date(now - 8 * 86400000 + 31 * 60000),
      submittedAt: new Date(now - 8 * 86400000 + 20 * 60000),
      scoreCents: 10000,
      submissionKey: 'demo-history-submit',
      questionOrder: [versions['demo-history-single']!.id],
      optionOrder: { [versions['demo-history-single']!.id]: ['A', 'B', 'C'] },
      flags: [],
      answers: {
        create: [
          {
            questionVersionId: versions['demo-history-single']!.id,
            value: 'A',
            scoreCents: 10000,
            graded: true,
            comment: '基础知识掌握准确。',
          },
        ],
      },
    },
    update: {},
  });
  await db.practiceSession.upsert({
    where: { id: 'demo-practice-history' },
    create: {
      id: 'demo-practice-history',
      organizationId,
      courseId,
      userId: studentId,
      snapshot: json([versions['demo-practice-single'], versions['demo-practice-boolean']]),
      status: 'completed',
      completedAt: new Date(now - 86400000),
      answers: {
        create: [
          {
            questionVersionId: versions['demo-practice-single']!.id,
            questionId: 'demo-practice-single',
            value: 'B',
            scoreCents: 0,
            correct: false,
          },
          {
            questionVersionId: versions['demo-practice-boolean']!.id,
            questionId: 'demo-practice-boolean',
            value: true,
            scoreCents: 1000,
            correct: true,
          },
        ],
      },
    },
    update: {},
  });
  await db.mistakeRecord.upsert({
    where: { userId_questionId: { userId: studentId, questionId: 'demo-practice-single' } },
    create: { userId: studentId, courseId, questionId: 'demo-practice-single', wrongCount: 1 },
    update: {},
  });
  await db.questionFavorite.upsert({
    where: { userId_questionId: { userId: studentId, questionId: 'demo-practice-multiple' } },
    create: { userId: studentId, courseId, questionId: 'demo-practice-multiple' },
    update: {},
  });
  return { assignmentId: 'demo-assignment', examId: 'demo-exam', historyExamId: 'demo-history-exam' };
}
