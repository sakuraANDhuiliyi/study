import { Controller, Get, Query, UseGuards, Res, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from '../auth/auth.service';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuditService } from '../common/audit.service';
import { CoursesController } from '../courses/courses.controller';
import { csvCell } from '../common/utils';
import type { Response } from 'express';
@ApiTags('工作台与学习分析')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller()
export class AnalyticsController {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private audit: AuditService,
  ) {}
  @Get('dashboard') async dashboard(@CurrentActor() a: Actor) {
    const courseIds = await this.auth.courseIds(a);
    const now = new Date();
    const courseController = new CoursesController(this.db, this.auth, this.audit);
    const courses = (await courseController.list(a, { pageSize: '6' })).items;
    const [assignments, exams, progress, unread, announcements, logs] = await Promise.all([
      this.db.assignment.findMany({
        where: {
          courseId: { in: courseIds },
          dueAt: { gt: now },
          ...(a.role === 'STUDENT'
            ? {
                status: 'published',
                opensAt: { lte: now },
                audience: { some: { userId: a.id } },
                exceptions: { none: { userId: a.id, exempt: true } },
              }
            : {}),
        },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: 100,
        include: {
          submissions: {
            where: a.role === 'STUDENT' ? { userId: a.id, status: 'submitted' } : {},
            select: { id: true, userId: true, gradingStatus: true },
          },
        },
      }),
      this.db.exam.findMany({
        where: {
          courseId: { in: courseIds },
          endsAt: { gt: now },
          ...(a.role === 'STUDENT'
            ? { status: 'published', audience: { some: { userId: a.id, eligible: true } } }
            : {}),
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 100,
        include: {
          attempts: {
            where: a.role === 'STUDENT' ? { userId: a.id } : {},
            select: { id: true, userId: true, status: true, gradingStatus: true },
          },
        },
      }),
      this.db.learningProgress.findMany({
        where: { courseId: { in: courseIds }, ...(a.role === 'STUDENT' ? { userId: a.id } : {}) },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      this.db.notification.count({ where: { userId: a.id, readAt: null } }),
      this.db.announcement.findMany({
        where: {
          organizationId: a.organizationId,
          OR: [{ courseId: null }, { courseId: { in: courseIds } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      this.db.auditLog.findMany({
        where: { userId: a.id, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);
    const [completedCount, pendingCount, upcomingCount, gradingCount, examGradingCount] = await Promise.all([
      this.db.learningProgress.count({
        where: {
          userId: a.id,
          completed: true,
          courseId: { in: courseIds },
          lessonId: {
            in: (
              await this.db.lesson.findMany({
                where: { courseId: { in: courseIds }, OR: [{ opensAt: null }, { opensAt: { lte: now } }] },
                select: { id: true },
              })
            ).map((l) => l.id),
          },
        },
      }),
      this.db.assignment.count({
        where: {
          courseId: { in: courseIds },
          status: 'published',
          opensAt: { lte: now },
          dueAt: { gt: now },
          audience: { some: { userId: a.id } },
          exceptions: { none: { userId: a.id, exempt: true } },
          submissions: { none: { userId: a.id, status: 'submitted' } },
        },
      }),
      this.db.exam.count({
        where: {
          courseId: { in: courseIds },
          status: 'published',
          startsAt: { gt: now },
          audience: { some: { userId: a.id, eligible: true } },
        },
      }),
      this.db.assignmentSubmission.count({
        where: { assignment: { courseId: { in: courseIds } }, status: 'submitted', gradingStatus: 'pending' },
      }),
      this.db.examAttempt.count({
        where: {
          exam: { courseId: { in: courseIds } },
          status: { in: ['submitted', 'timed_out'] },
          gradingStatus: 'pending',
        },
      }),
    ]);
    const taskCourses = await this.db.course.findMany({
      where: { id: { in: [...new Set([...assignments, ...exams].map((x) => x.courseId))] } },
      select: { id: true, title: true },
    });
    const courseTitles = new Map(taskCourses.map((c) => [c.id, c.title]));
    const tasks = [
      ...assignments
        .filter((x) => x.dueAt > now && (a.role !== 'STUDENT' || x.submissions.length === 0))
        .map((x) => ({
          id: x.id,
          title: x.title,
          type: 'assignment',
          dueAt: x.dueAt,
          courseTitle: courseTitles.get(x.courseId),
          path: `/assignments/${x.id}`,
        })),
      ...exams
        .filter(
          (x) =>
            x.endsAt > now && (a.role !== 'STUDENT' || !x.attempts.some((t) => t.status !== 'in_progress')),
        )
        .map((x) => ({
          id: x.id,
          title: x.title,
          type: 'exam',
          dueAt: x.startsAt,
          courseTitle: courseTitles.get(x.courseId),
          path: `/exams/${x.id}`,
        })),
    ]
      .sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime())
      .slice(0, 8);
    let metrics = [];
    if (a.role === 'STUDENT')
      metrics = [
        { label: '在学课程', value: courseIds.length, detail: '当前获得授权的课程', path: '/courses' },
        { label: '待完成作业', value: pendingCount, detail: '尚未正式提交', path: '/assignments' },
        { label: '即将开始的考试', value: upcomingCount, detail: '已发布且具有参考资格', path: '/exams' },
        { label: '已完成课时', value: completedCount, detail: '按课时完成标记统计', path: '/analytics' },
      ];
    else if (a.role === 'TEACHER')
      metrics = [
        { label: '授课课程', value: courseIds.length, detail: '当前授课关系', path: '/courses' },
        { label: '待批改作业', value: gradingCount, detail: '包含待人工批阅提交', path: '/assignments' },
        { label: '待阅卷答卷', value: examGradingCount, detail: '正式成绩尚未完成', path: '/exams' },
        { label: '未读通知', value: unread, detail: '教学与交流提醒', path: '/notifications' },
      ];
    else {
      const [users, classes, reports] = await Promise.all([
        this.db.user.count({ where: { organizationId: a.organizationId, active: true } }),
        this.db.class.count({ where: { organizationId: a.organizationId } }),
        this.db.contentReport.count({ where: { organizationId: a.organizationId, status: 'PENDING' } }),
      ]);
      metrics = [
        { label: '启用账号', value: users, detail: '当前机构', path: '/admin/users' },
        { label: '行政班级', value: classes, detail: '组织与教学安排', path: '/admin/classes' },
        { label: '课程总数', value: courseIds.length, detail: '包含草稿与归档', path: '/courses' },
        { label: '待处理举报', value: reports, detail: '内容治理', path: '/admin/reports' },
      ];
    }
    if (a.permissions.includes('org.platform')) {
      const [organizations, accounts, failures, pendingJobs] = await Promise.all([
        this.db.organization.count({ where: { active: true } }),
        this.db.user.count({ where: { active: true } }),
        this.db.backgroundJob.count({ where: { status: 'FAILED' } }),
        this.db.backgroundJob.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
      ]);
      metrics = [
        { label: '启用机构', value: organizations, detail: '平台机构概况', path: '/admin/organizations' },
        { label: '启用账号', value: accounts, detail: '平台总量；详情按机构授权', path: '/admin/users' },
        { label: '失败任务', value: failures, detail: '已达到重试上限', path: '/admin/audit?tab=jobs' },
        { label: '待处理任务', value: pendingJobs, detail: '排队或正在执行', path: '/admin/audit?tab=jobs' },
      ];
    }
    const lessonNames = await this.db.lesson.findMany({
      where: { id: { in: progress.slice(0, 8).map((x) => x.lessonId) } },
      select: { id: true, title: true },
    });
    return {
      metrics,
      courses,
      tasks,
      unread,
      announcements,
      activity: progress.slice(0, 5).map((p) => ({
        id: p.id,
        title: lessonNames.find((l) => l.id === p.lessonId)?.title || '课时学习',
        detail: p.completed ? '已完成课时' : '已保存学习位置',
        createdAt: p.updatedAt,
      })),
      weeklyActivity: Array.from({ length: 7 }, (_, i) => {
        const date = new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en-CA', {
          timeZone: 'Asia/Shanghai',
        });
        return {
          date,
          count:
            logs.filter(
              (l) => l.createdAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) === date,
            ).length +
            progress.filter(
              (p) => p.updatedAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) === date,
            ).length,
        };
      }),
    };
  }
  @Get('analytics') async analytics(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    if (a.role !== 'STUDENT') this.auth.require(a, 'analysis.read');
    let ids = await this.auth.courseIds(a);
    if (q.courseId) {
      await this.auth.course(a, q.courseId);
      ids = ids.filter((id) => id === q.courseId);
    }
    if (q.termId)
      ids = (
        await this.db.course.findMany({ where: { id: { in: ids }, termId: q.termId }, select: { id: true } })
      ).map((c) => c.id);
    if (q.classId) {
      const allowed = await this.db.class.findFirst({
        where: { id: q.classId, organizationId: a.organizationId },
      });
      if (!allowed) throw new ForbiddenException('班级不在授权机构内');
      if (
        a.role === 'STUDENT' &&
        !(await this.db.classMember.findFirst({ where: { classId: q.classId, userId: a.id, active: true } }))
      )
        throw new ForbiddenException('无权查看该班级');
      ids = (
        await this.db.courseClass.findMany({
          where: { courseId: { in: ids }, classId: q.classId },
          select: { courseId: true },
        })
      ).map((c) => c.courseId);
    }
    if (['ADMIN', 'SUPER_ADMIN'].includes(a.role) && !a.permissions.includes('analysis.sensitive')) {
      const [users, courses, assignments, exams, active] = await Promise.all([
        this.db.user.count({ where: { organizationId: a.organizationId } }),
        this.db.course.count({ where: { id: { in: ids } } }),
        this.db.assignment.count({ where: { courseId: { in: ids } } }),
        this.db.exam.count({ where: { courseId: { in: ids } } }),
        this.db.auditLog.findMany({
          where: {
            organizationId: a.organizationId,
            action: 'login.success',
            createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
          },
          distinct: ['userId'],
          select: { userId: true },
        }),
      ]);
      return {
        metrics: [
          { label: '机构账号', value: users, detail: '包含停用账号' },
          { label: '课程', value: courses, detail: '当前筛选范围' },
          { label: '作业 / 考试', value: `${assignments} / ${exams}`, detail: '已创建的教学任务' },
          { label: '近 30 天活跃账号', value: active.length, detail: '至少一次成功登录' },
        ],
        courseProgress: [],
        scoreTrend: [],
        knowledgePoints: [],
        distribution: [],
        students: [],
        rules: ['管理角色默认只显示业务运行数据。教学成绩分析需要 analysis.sensitive 独立限时授权。'],
      };
    }
    if (['ADMIN', 'SUPER_ADMIN'].includes(a.role))
      await this.audit.record(a, 'analysis.sensitive.read', 'Course', 'scope', { courseIds: ids });
    // A course may teach several classes. Filtering only CourseClass would still
    // return every student's grades in that course, including other classes.
    const classUserIds = q.classId
      ? (
          await this.db.classMember.findMany({
            where: { classId: q.classId, active: true },
            select: { userId: true },
          })
        ).map((m) => m.userId)
      : undefined;
    const userWhere =
      a.role === 'STUDENT' ? { userId: a.id } : classUserIds ? { userId: { in: classUserIds } } : {};
    const [courses, lessons, progress, enrollments, attempts, submissions, practice, mistakes] =
      await Promise.all([
        this.db.course.findMany({ where: { id: { in: ids } } }),
        this.db.lesson.findMany({
          where: { courseId: { in: ids }, OR: [{ opensAt: null }, { opensAt: { lte: new Date() } }] },
        }),
        this.db.learningProgress.findMany({ where: { courseId: { in: ids }, ...userWhere } }),
        this.db.enrollment.findMany({ where: { courseId: { in: ids }, active: true, ...userWhere } }),
        this.db.examAttempt.findMany({
          where: {
            ...userWhere,
            exam: {
              courseId: { in: ids },
              status: 'published',
              scoreReleaseAt: { lte: new Date() },
              ...(a.role === 'STUDENT' ? { audience: { some: { userId: a.id, eligible: true } } } : {}),
            },
            status: { in: ['submitted', 'timed_out'] },
            releaseStatus: 'released',
            gradingStatus: 'graded',
          },
          select: {
            examId: true,
            userId: true,
            scoreCents: true,
            submittedAt: true,
            exam: { select: { title: true, totalCents: true, passCents: true } },
          },
          orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        }),
        this.db.assignmentSubmission.findMany({
          where: {
            ...userWhere,
            assignment: {
              courseId: { in: ids },
              status: 'published',
              ...(a.role === 'STUDENT' ? { audience: { some: { userId: a.id } } } : {}),
            },
            status: 'submitted',
            gradingStatus: 'graded',
            releasedAt: { lte: new Date() },
          },
          select: {
            assignmentId: true,
            userId: true,
            scoreCents: true,
            submittedAt: true,
            assignment: { select: { title: true, totalCents: true } },
          },
          orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        }),
        this.db.practiceAnswer.findMany({
          where: { session: { courseId: { in: ids }, ...userWhere } },
          select: { questionVersionId: true, correct: true },
        }),
        this.db.mistakeRecord.findMany({
          where: { courseId: { in: ids }, ...userWhere, mastered: false },
          orderBy: { wrongCount: 'desc' },
          take: 10,
        }),
      ]);
    // Latest valid released attempt/submission per person+task. Pending and absent states never become zero.
    const latest = new Map<
      string,
      { name: string; score: number; date: Date; userId: string; pass: boolean }
    >();
    for (const x of attempts)
      if (x.scoreCents !== null && x.exam.totalCents > 0)
        latest.set(`exam:${x.examId}:${x.userId}`, {
          name: x.exam.title,
          score: (x.scoreCents / x.exam.totalCents) * 100,
          date: x.submittedAt!,
          userId: x.userId,
          pass: x.scoreCents >= x.exam.passCents,
        });
    for (const x of submissions)
      if (x.scoreCents !== null && x.assignment.totalCents > 0)
        latest.set(`assignment:${x.assignmentId}:${x.userId}`, {
          name: x.assignment.title,
          score: (x.scoreCents / x.assignment.totalCents) * 100,
          date: x.submittedAt,
          userId: x.userId,
          pass: x.scoreCents / x.assignment.totalCents >= 0.6,
        });
    const scores = [...latest.values()].sort((x, y) => x.date.getTime() - y.date.getTime());
    const sorted = scores.map((x) => x.score).sort((x, y) => x - y);
    const average = sorted.length
      ? Math.round((sorted.reduce((s, x) => s + x, 0) / sorted.length) * 10) / 10
      : null;
    const median = sorted.length
      ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
      : null;
    const versions = await this.db.questionVersion.findMany({
      where: { id: { in: [...new Set(practice.map((x) => x.questionVersionId))] } },
      select: { id: true, knowledgePoints: true, stem: true },
    });
    const versionsById = new Map(versions.map((v) => [v.id, v]));
    const questionTotals = new Map<string, { total: number; correct: number }>();
    const kp = new Map<string, { correct: number; total: number }>();
    for (const p of practice) {
      if (p.correct === null) continue;
      const totals = questionTotals.get(p.questionVersionId) || { total: 0, correct: 0 };
      totals.total++;
      if (p.correct) totals.correct++;
      questionTotals.set(p.questionVersionId, totals);
      for (const name of versionsById.get(p.questionVersionId)?.knowledgePoints || []) {
        const value = kp.get(name) || { correct: 0, total: 0 };
        value.total++;
        if (p.correct) value.correct++;
        kp.set(name, value);
      }
    }
    const knowledgePoints = [...kp].map(([name, v]) => ({
      name,
      ...v,
      accuracy: Math.round((v.correct / v.total) * 100),
      sufficient: v.total >= 3,
      recommendation:
        v.total < 3
          ? '数据不足，建议完成更多相关练习'
          : v.correct / v.total < 0.7
            ? '建议复习相关课时，并从错题本重新练习'
            : '保持间隔复习',
    }));
    const courseProgress = courses.map((c) => {
      const ls = lessons.filter((l) => l.courseId === c.id);
      const active = enrollments.filter((e) => e.courseId === c.id).map((e) => e.userId);
      const total = ls.length * (a.role === 'STUDENT' ? 1 : active.length);
      const completed = progress.filter(
        (p) =>
          p.courseId === c.id &&
          p.completed &&
          ls.some((l) => l.id === p.lessonId) &&
          (a.role === 'STUDENT' || active.includes(p.userId)),
      ).length;
      return { name: c.title, completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
    });
    const users =
      a.role === 'STUDENT'
        ? []
        : await this.db.user.findMany({
            where: { id: { in: [...new Set(enrollments.map((e) => e.userId))] } },
            select: { id: true, name: true },
          });
    const students = users
      .map((u) => {
        const userCourses = enrollments.filter((e) => e.userId === u.id).map((e) => e.courseId);
        const ls = lessons.filter((l) => userCourses.includes(l.courseId));
        const total = ls.length,
          completed = progress.filter(
            (p) => p.userId === u.id && p.completed && ls.some((l) => l.id === p.lessonId),
          ).length;
        return { ...u, completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
      })
      .sort((x, y) => x.percent - y.percent);
    const tasks = await this.db.assignment.findMany({
      where: { courseId: { in: ids }, status: 'published', opensAt: { lte: new Date() } },
      include: {
        audience: true,
        exceptions: true,
        submissions: {
          orderBy: { version: 'desc' },
          select: { userId: true, status: true, late: true, version: true },
        },
      },
    });
    let expectedSubmissions = 0,
      submitted = 0,
      late = 0;
    const overdue = new Map<string, number>();
    for (const task of tasks) {
      const currentUsers = enrollments.filter((e) => e.courseId === task.courseId).map((e) => e.userId);
      for (const member of task.audience) {
        if (
          !currentUsers.includes(member.userId) ||
          task.exceptions.some((e) => e.userId === member.userId && e.exempt)
        )
          continue;
        expectedSubmissions++;
        const latest = task.submissions.find((s) => s.userId === member.userId);
        if (latest?.status === 'submitted') {
          submitted++;
          if (latest.late) late++;
        } else if (task.dueAt < new Date()) overdue.set(member.userId, (overdue.get(member.userId) || 0) + 1);
      }
    }
    const taskSummary = {
      expectedSubmissions,
      submitted,
      missing: expectedSubmissions - submitted,
      late,
      submissionRate: expectedSubmissions ? Math.round((submitted / expectedSubmissions) * 100) : null,
      lateRate: submitted ? Math.round((late / submitted) * 100) : null,
      rule: '已开放已发布作业，按当前成员和指定对象交集；排除豁免，每人每项取最新提交版本；提交率=有效提交/应提交，迟交率=迟交/有效提交。',
    };
    const questionStats = [...questionTotals].map(([id, { total, correct }]) => {
      return {
        id,
        stem: versionsById.get(id)?.stem || '',
        total,
        correct,
        accuracy: Math.round((correct / total) * 100),
      };
    });
    const classMembers =
      a.role === 'STUDENT'
        ? []
        : await this.db.classMember.findMany({
            where: {
              userId: { in: users.map((u) => u.id) },
              active: true,
              ...(q.classId ? { classId: q.classId } : {}),
            },
          });
    const classes = await this.db.class.findMany({
      where: { id: { in: classMembers.map((c) => c.classId) }, organizationId: a.organizationId },
    });
    const classComparison = classes.map((c) => {
      const members = classMembers.filter((m) => m.classId === c.id).map((m) => m.userId),
        related = students.filter((s) => members.includes(s.id)),
        completed = related.reduce((sum, s) => sum + s.completed, 0),
        total = related.reduce((sum, s) => sum + s.total, 0),
        grades = scores.filter((s) => members.includes(s.userId));
      return {
        id: c.id,
        name: c.name,
        studentCount: related.length,
        completed,
        total,
        percent: total ? Math.round((completed / total) * 100) : 0,
        averageScore: grades.length
          ? Math.round((grades.reduce((sum, g) => sum + g.score, 0) / grades.length) * 10) / 10
          : null,
        scoreCount: grades.length,
      };
    });
    const suggestions = users.flatMap((u) => {
      const count = overdue.get(u.id) || 0,
        grades = scores.filter((s) => s.userId === u.id).slice(-3);
      const reasons = [];
      if (count >= 2) reasons.push(`${count} 项已截止作业尚未有效提交`);
      if (grades.length === 3 && grades[2].score < grades[1].score && grades[1].score < grades[0].score)
        reasons.push('最近 3 项已发布百分制成绩连续下降，请结合任务难度了解原因');
      return reasons.length ? [{ userId: u.id, name: u.name, reason: reasons.join('；') }] : [];
    });
    const eligiblePractice = practice.filter((x) => x.correct !== null);
    return {
      taskSummary,
      questionStats,
      classComparison,
      suggestions,
      metrics: [
        {
          label: '平均成绩',
          value: average ?? '数据不足',
          detail: `百分制；${scores.length} 个已发布有效成绩`,
        },
        { label: '中位数', value: median ?? '数据不足', detail: '排除缺考、待批阅与未发布' },
        {
          label: '及格率',
          value: scores.length
            ? `${Math.round((scores.filter((x) => x.pass).length / scores.length) * 100)}%`
            : '数据不足',
          detail: '考试按设定及格线，作业按 60%',
        },
        {
          label: '练习正确率',
          value: eligiblePractice.length
            ? `${Math.round((eligiblePractice.filter((x) => x.correct).length / eligiblePractice.length) * 100)}%`
            : '数据不足',
          detail: `${eligiblePractice.length} 次客观题作答`,
        },
      ],
      scoreTrend: scores.map((s) => ({ ...s, score: Math.round(s.score * 10) / 10 })),
      knowledgePoints,
      courseProgress,
      students,
      mistakes,
      distribution: [
        { name: '0–59', count: sorted.filter((x) => x < 60).length },
        { name: '60–79', count: sorted.filter((x) => x >= 60 && x < 80).length },
        { name: '80–89', count: sorted.filter((x) => x >= 80 && x < 90).length },
        { name: '90–100', count: sorted.filter((x) => x >= 90).length },
      ],
      rules: [
        '统计时间范围：当前授权课程的全部历史；课程筛选同时应用于图表、明细与导出。',
        '课程完成率 = 已明确标记完成的已开放课时 / 当前有效成员应完成的已开放课时；学习时长不代表掌握度。',
        '成绩使用每人每项任务最近一次已发布且批阅完成的有效成绩，统一折算百分制。待批阅、未发布、缺考和未提交均不作为零分。',
        '知识点正确率 = 完全答对的客观练习次数 / 可自动判分的练习次数；至少 3 个样本才给出复习建议。',
        '课程成员变更后统计按当前授权范围查询；改分后即时读取最新有效成绩。',
      ],
    };
  }
  @Get('analytics/export') async export(
    @CurrentActor() a: Actor,
    @Query() q: Record<string, string>,
    @Res() res: Response,
  ) {
    this.auth.require(a, 'data.export');
    if (['ADMIN', 'SUPER_ADMIN'].includes(a.role) && !a.permissions.includes('analysis.sensitive'))
      throw new ForbiddenException('未获教学统计敏感授权');
    const report = await this.analytics(a, q);
    await this.audit.record(a, 'analytics.export', 'Course', q.courseId || 'all', {
      count: report.scoreTrend.length,
    });
    const rows = [
      ['任务', '百分制成绩', '时间', '学生ID'],
      ...report.scoreTrend.map((s: any) => [s.name, s.score, s.date, s.userId]),
    ];
    res
      .type('text/csv; charset=utf-8')
      .attachment('learning-report.csv')
      .send('\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
  }
}
