import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password';
import { permissionDefinitions, roleDefinitions } from './permissions';
import { seedAssessments } from '../apps/api/src/assessment/seed';
import { seedCommunication } from '../apps/api/src/communication/seed';
const db = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Development seed is prohibited in production. Use scripts/bootstrap.ts.');
  const password = process.env.DEV_SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set DEV_SEED_PASSWORD (12+ characters) in .env.');
  const organizationId = 'org-demo';
  await db.organization.upsert({
    where: { id: organizationId },
    create: { id: organizationId, name: '知学示范学院' },
    update: {},
  });
  await db.organization.upsert({
    where: { id: 'org-other' },
    create: { id: 'org-other', name: '边界测试机构' },
    update: {},
  });
  for (const [id, name, sensitive] of permissionDefinitions)
    await db.permission.upsert({
      where: { id },
      create: { id, name, sensitive },
      update: { name, sensitive },
    });
  for (const [id, r] of Object.entries(roleDefinitions)) {
    const existingRole = await db.role.findUnique({ where: { id } });
    await db.role.upsert({
      where: { id },
      create: { id, name: r.name, description: r.description },
      update: {},
    });
    for (const permissionId of existingRole ? [] : r.permissions)
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: id, permissionId } },
        create: { roleId: id, permissionId },
        update: {},
      });
  }
  const users = [
    ['u-student', 'student', '林同学', 'STUDENT'],
    ['u-student2', 'student2', '陈同学', 'STUDENT'],
    ['u-teacher', 'teacher', '周老师', 'TEACHER'],
    ['u-teacher2', 'teacher2', '李老师', 'TEACHER'],
    ['u-admin', 'admin', '教务管理员', 'ADMIN'],
    ['u-super', 'superadmin', '平台管理员', 'SUPER_ADMIN'],
    ['u-outside', 'outsider', '其他机构学生', 'STUDENT'],
  ];
  for (const [id, username, name, roleId] of users) {
    const existingUser = await db.user.findUnique({ where: { id } });
    const user = await db.user.upsert({
      where: { id },
      create: {
        id,
        organizationId: id === 'u-outside' ? 'org-other' : organizationId,
        username,
        name,
        passwordHash: hashPassword(password),
        studentNo: roleId === 'STUDENT' ? username : null,
      },
      update: {},
    });
    if (!existingUser)
      await db.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        create: { userId: user.id, roleId },
        update: {},
      });
  }
  await db.academicTerm.upsert({
    where: { id: 'term-2026' },
    create: {
      id: 'term-2026',
      organizationId,
      name: '2026–2027 学年 · 秋季学期',
      startsAt: new Date('2026-09-01T00:00:00+08:00'),
      endsAt: new Date('2027-01-31T23:59:59+08:00'),
    },
    update: {},
  });
  await db.class.upsert({
    where: { id: 'class-1' },
    create: {
      id: 'class-1',
      organizationId,
      name: '计算机 2026 级 1 班',
      grade: '2026 级',
      termId: 'term-2026',
    },
    update: {},
  });
  for (const userId of ['u-student', 'u-student2'])
    await db.classMember.upsert({
      where: { classId_userId: { classId: 'class-1', userId } },
      create: { classId: 'class-1', userId },
      update: {},
    });
  const catalog = [
    {
      id: 'course-math',
      title: '高等数学 · 从理解到应用',
      category: '数学与逻辑',
      description: '通过函数、极限与微积分建立数学思维，在练习中理解概念，在应用中连接知识。',
      chapters: [
        { title: '函数与极限', lessons: ['函数的概念与性质', '数列极限与收敛', '函数极限的计算'] },
        { title: '导数与微分', lessons: ['导数的定义', '求导法则', '微分的应用'] },
      ],
    },
    {
      id: 'course-python',
      title: 'Python 程序设计基础',
      category: '编程与技术',
      description: '从第一个程序开始，学习变量、控制流与函数，把问题拆解为清晰可执行的步骤。',
      chapters: [
        { title: '开始编程', lessons: ['变量与基本数据类型', '条件与循环', '函数与模块'] },
        { title: '数据处理', lessons: ['列表与字典', '文件读写', '实践：数据统计'] },
      ],
    },
    {
      id: 'course-english',
      title: '大学英语 · 学术阅读',
      category: '语言与表达',
      description: '培养学术文章阅读、词汇分析与清晰表达的能力，逐步形成自主学习习惯。',
      chapters: [
        { title: '阅读策略', lessons: ['识别文章结构', '寻找核心论点', '理解上下文词义'] },
        { title: '表达与写作', lessons: ['段落的逻辑', '学术词汇', '摘要写作'] },
      ],
    },
    {
      id: 'course-private',
      title: '教师授权边界验证课程',
      category: '测试课程',
      description: '用于验证未授权教师和学生不能访问课程。',
      chapters: [{ title: '私有教学内容', lessons: ['权限边界'] }],
    },
  ];
  for (const [ci, c] of catalog.entries()) {
    const teacherId = c.id === 'course-private' ? 'u-teacher2' : 'u-teacher';
    await db.course.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        organizationId,
        title: c.title,
        category: c.category,
        description: c.description,
        teacherId,
        termId: 'term-2026',
        status: 'PUBLISHED',
      },
      update: {},
    });
    await db.teachingAssignment.upsert({
      where: { courseId_userId: { courseId: c.id, userId: teacherId } },
      create: { courseId: c.id, userId: teacherId },
      update: {},
    });
    if (c.id !== 'course-private') {
      for (const userId of ['u-student', 'u-student2'])
        await db.enrollment.upsert({
          where: { courseId_userId: { courseId: c.id, userId } },
          create: { courseId: c.id, userId },
          update: {},
        });
      await db.courseClass.upsert({
        where: { courseId_classId: { courseId: c.id, classId: 'class-1' } },
        create: { courseId: c.id, classId: 'class-1', name: '计算机 1 班 · ' + c.title },
        update: {},
      });
    }
    for (const [i, ch] of c.chapters.entries()) {
      const chapterId = `${c.id}-chapter-${i}`;
      await db.chapter.upsert({
        where: { id: chapterId },
        create: { id: chapterId, courseId: c.id, title: ch.title, sortOrder: i },
        update: {},
      });
      for (const [j, title] of ch.lessons.entries()) {
        const id = `${chapterId}-lesson-${j}`;
        await db.lesson.upsert({
          where: { id },
          create: {
            id,
            chapterId,
            courseId: c.id,
            title,
            sortOrder: j,
            type: 'TEXT',
            content: `<h2>${title}</h2><p>本课时的学习目标：理解核心概念，能用自己的语言说明其意义，并独立完成相关练习。</p><h3>学习方法</h3><p>请先阅读课程讲解，整理关键定义，尝试举出一个具体例子。遇到问题时，可以在课程讨论区发起提问。</p><blockquote>完成阅读后，请进行相关练习；课时完成标记只表示已完成本项学习任务，并不直接代表知识掌握程度。</blockquote><h3>课后任务</h3><ol><li>写下本课时的三个关键概念。</li><li>完成练习中心中的关联题目。</li><li>在课程讨论区分享一个仍有疑问的问题。</li></ol>`,
          },
          update: {},
        });
        if (c.id !== 'course-private' && i === 0 && j < 3 - ci)
          await db.learningProgress.upsert({
            where: { userId_lessonId: { userId: 'u-student', lessonId: id } },
            create: {
              userId: 'u-student',
              lessonId: id,
              courseId: c.id,
              completed: true,
              positionSeconds: 0,
              updatedAt: new Date(Date.now() - (j + ci) * 86400000),
            },
            update: {},
          });
      }
    }
  }
  await db.announcement.upsert({
    where: { id: 'announcement-welcome' },
    create: {
      id: 'announcement-welcome',
      organizationId,
      title: '秋季学期学习安排',
      content: '本周请完成函数与极限章节学习，按时提交课后作业。学习中遇到的问题，可在课程讨论区与老师交流。',
      authorId: 'u-teacher',
    },
    update: {},
  });
  for (const [key, value] of Object.entries({
    platformName: '知学',
    notificationEnabled: true,
    maxUploadMB: 10,
    features: { practice: true, communication: true },
    loginPolicy: { sessionHours: 12 },
  }))
    await db.systemSetting.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, key, value },
      update: {},
    });
  const context = {
    organizationId,
    teacherId: 'u-teacher',
    studentId: 'u-student',
    otherStudentId: 'u-student2',
    courseId: 'course-math',
    classId: 'class-1',
  };
  await seedAssessments(db, context);
  await seedCommunication(db, context);
  await db.auditLog.upsert({
    where: { id: 'audit-dev-seed' },
    create: {
      id: 'audit-dev-seed',
      organizationId,
      userId: 'u-super',
      action: 'development.seed',
      resourceType: 'Organization',
      resourceId: organizationId,
      details: { developmentOnly: true },
    },
    update: {},
  });
  console.log(
    'Development seed complete. Accounts: student, student2, teacher, teacher2, admin, superadmin, outsider. Password: configured DEV_SEED_PASSWORD (not printed).',
  );
}
main()
  .finally(() => db.$disconnect())
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
