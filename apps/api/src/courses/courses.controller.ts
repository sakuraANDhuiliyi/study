import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from '../auth/auth.service';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuditService } from '../common/audit.service';
import { clean, cleanRichText, dateString, paging } from '../common/utils';
export const courseInput = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(10000).default(''),
  category: z.string().max(60).default('通识课程'),
  cover: z
    .string()
    .url()
    .refine((v) => /^https:\/\//i.test(v))
    .nullable()
    .optional(),
  teacherId: z.string().optional(),
  termId: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']).optional(),
});
export const lessonInput = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().max(100000).default(''),
  type: z.enum(['TEXT', 'VIDEO', 'PDF', 'DOCUMENT', 'LINK']).default('TEXT'),
  resourceUrl: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v))
    .nullable()
    .optional(),
  attachmentId: z.string().nullable().optional(),
  opensAt: dateString.nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  relatedTasks: z
    .array(z.object({ type: z.enum(['practice', 'assignment', 'exam']), id: z.string().min(1) }))
    .max(20)
    .default([]),
});
@ApiTags('课程与学习')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller()
export class CoursesController {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private audit: AuditService,
  ) {}
  @Get('courses') async list(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    const ids = await this.auth.courseIds(a);
    const p = paging(q);
    const where = {
      id: { in: ids },
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' as const } } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [courses, total] = await Promise.all([
      this.db.course.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.pageSize,
      }),
      this.db.course.count({ where }),
    ]);
    const courseIds = courses.map((c) => c.id);
    const [lessons, progress, teachers, enrollments] = await Promise.all([
      this.db.lesson.findMany({
        where: {
          courseId: { in: courseIds },
          ...(a.role === 'STUDENT' ? { OR: [{ opensAt: null }, { opensAt: { lte: new Date() } }] } : {}),
        },
        select: { courseId: true, id: true },
      }),
      this.db.learningProgress.findMany({
        where: { userId: a.id, courseId: { in: courseIds }, completed: true },
        select: { courseId: true, lessonId: true },
      }),
      this.db.user.findMany({
        where: { id: { in: courses.map((c) => c.teacherId) } },
        select: { id: true, name: true },
      }),
      this.db.enrollment.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds }, active: true },
        _count: true,
      }),
    ]);
    return {
      items: courses.map((c) => {
        const totalLessons = lessons.filter((l) => l.courseId === c.id).length;
        const completedLessons = progress.filter(
          (l) => l.courseId === c.id && lessons.some((x) => x.id === l.lessonId),
        ).length;
        return {
          ...c,
          totalLessons,
          completedLessons,
          progressPercent: totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0,
          teacherName: teachers.find((t) => t.id === c.teacherId)?.name,
          studentCount: enrollments.find((e) => e.courseId === c.id)?._count || 0,
        };
      }),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  private async teacher(a: Actor, id: string) {
    const u = await this.db.user.findFirst({
      where: { id, organizationId: a.organizationId, active: true, roles: { some: { roleId: 'TEACHER' } } },
    });
    if (!u) throw new BadRequestException('负责教师必须是本机构的启用教师');
  }
  @Post('courses') async create(@CurrentActor() a: Actor, @Body() body: unknown) {
    this.auth.require(a, a.role === 'TEACHER' ? 'course.manage' : 'course.admin');
    const d = courseInput.parse(body);
    const teacherId = a.role === 'TEACHER' ? a.id : d.teacherId;
    if (!teacherId) throw new BadRequestException('请选择负责教师');
    await this.teacher(a, teacherId);
    await this.term(a, d.termId);
    const c = await this.db.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          organizationId: a.organizationId,
          title: d.title,
          description: clean(d.description),
          category: d.category,
          cover: d.cover,
          teacherId,
          termId: d.termId,
          status: 'DRAFT',
        },
      });
      await tx.teachingAssignment.create({ data: { courseId: course.id, userId: teacherId } });
      return course;
    });
    await this.audit.record(a, 'course.create', 'Course', c.id);
    return c;
  }
  private async term(a: Actor, id?: string | null) {
    if (id && !(await this.db.academicTerm.findFirst({ where: { id, organizationId: a.organizationId } })))
      throw new BadRequestException('学期无效');
  }
  @Get('courses/:id') async detail(@CurrentActor() a: Actor, @Param('id') id: string) {
    const course = await this.auth.course(a, id);
    const now = new Date();
    const [chapters, lessons, progress, teachers] = await Promise.all([
      this.db.chapter.findMany({ where: { courseId: id }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.db.lesson.findMany({
        where: {
          courseId: id,
          ...(a.role === 'STUDENT' ? { OR: [{ opensAt: null }, { opensAt: { lte: now } }] } : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.db.learningProgress.findMany({ where: { userId: a.id, courseId: id } }),
      this.db.teachingAssignment.findMany({ where: { courseId: id, active: true } }),
    ]);
    const memberPage =
      a.role === 'STUDENT' ? { items: [], total: 0 } : await this.members(a, id, { pageSize: '100' });
    const members = memberPage.items;
    const teacherNames = await this.db.user.findMany({
      where: { id: { in: teachers.map((t) => t.userId) } },
      select: { id: true, name: true },
    });
    const completed = progress.filter((p) => p.completed && lessons.some((l) => l.id === p.lessonId)).length;
    const taskRefs = lessons.flatMap((l) => l.relatedTasks as { type: string; id: string }[]);
    const [assignments, exams] =
      a.role === 'STUDENT'
        ? await Promise.all([
            this.db.assignment.findMany({
              where: {
                id: { in: taskRefs.filter((t) => t.type === 'assignment').map((t) => t.id) },
                courseId: id,
                status: 'published',
                opensAt: { lte: now },
                audience: { some: { userId: a.id } },
              },
              select: { id: true },
            }),
            this.db.exam.findMany({
              where: {
                id: { in: taskRefs.filter((t) => t.type === 'exam').map((t) => t.id) },
                courseId: id,
                status: 'published',
                audience: { some: { userId: a.id, eligible: true } },
              },
              select: { id: true },
            }),
          ])
        : [[], []];
    return {
      ...course,
      teacherName: teacherNames.map((t) => t.name).join('、'),
      chapters: chapters.map((ch) => ({
        ...ch,
        lessons: lessons
          .filter((l) => l.chapterId === ch.id)
          .map((l) => ({
            ...l,
            relatedTasks: (l.relatedTasks as { type: string; id: string }[]).filter(
              (t) =>
                a.role !== 'STUDENT' ||
                t.type === 'practice' ||
                (t.type === 'assignment' ? assignments : exams).some((x) => x.id === t.id),
            ),
            progress: progress.find((p) => p.lessonId === l.id) || null,
          })),
      })),
      progress: {
        completed,
        total: lessons.length,
        percent: lessons.length ? Math.round((completed / lessons.length) * 100) : 0,
      },
      members,
      memberCount: memberPage.total,
    };
  }
  @Patch('courses/:id') async update(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const before = await this.auth.course(a, id, true);
    const d = courseInput.partial().parse(body);
    await this.term(a, d.termId);
    if (d.teacherId && d.teacherId !== before.teacherId) {
      this.auth.require(a, 'course.admin');
      await this.teacher(a, d.teacherId);
    }
    if (d.status === 'PUBLISHED' && !(await this.db.lesson.count({ where: { courseId: id } })))
      throw new BadRequestException('请先添加至少一个课时');
    const c = await this.db.$transaction(async (tx) => {
      if (d.teacherId && d.teacherId !== before.teacherId) {
        await tx.teachingAssignment.updateMany({
          where: { courseId: id, userId: before.teacherId },
          data: { active: false },
        });
        await tx.teachingAssignment.upsert({
          where: { courseId_userId: { courseId: id, userId: d.teacherId } },
          create: { courseId: id, userId: d.teacherId },
          update: { active: true },
        });
      }
      return tx.course.update({
        where: { id },
        data: { ...d, ...(d.description !== undefined ? { description: clean(d.description) } : {}) },
      });
    });
    await this.audit.record(a, 'course.update', 'Course', id, {
      before: { title: before.title, status: before.status, teacherId: before.teacherId },
      after: { title: c.title, status: c.status, teacherId: c.teacherId },
    });
    if (d.teacherId && d.teacherId !== before.teacherId)
      await this.audit.notify(
        [before.teacherId, d.teacherId],
        a.organizationId,
        'MEMBERSHIP',
        '负责课程交接',
        `课程“${c.title}”的负责教师已更新，访问范围按当前授课关系生效。`,
        '/courses',
        `handoff:${id}:${c.updatedAt.getTime()}`,
      );
    return c;
  }
  @Post('courses/:id/chapters') async chapter(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.auth.course(a, id, true);
    const d = z
      .object({ title: z.string().min(1).max(160), sortOrder: z.number().int().min(0).default(0) })
      .parse(body);
    return this.db.chapter.create({ data: { ...d, courseId: id } });
  }
  @Patch('chapters/:id') async chapterEdit(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const ch = await this.db.chapter.findUnique({ where: { id } });
    if (!ch) throw new NotFoundException();
    await this.auth.course(a, ch.courseId, true);
    const d = z
      .object({ title: z.string().min(1).max(160).optional(), sortOrder: z.number().int().min(0).optional() })
      .parse(body);
    return this.db.chapter.update({ where: { id }, data: d });
  }
  private async checkAttachment(a: Actor, courseId: string, attachmentId?: string | null) {
    if (!attachmentId) return;
    const file = await this.db.attachment.findFirst({
      where: { id: attachmentId, organizationId: a.organizationId, courseId, exportJobId: null },
    });
    if (!file) throw new BadRequestException('附件不属于本课程');
    if (
      file.ownerId !== a.id &&
      !(await this.db.lesson.findFirst({
        where: { courseId, OR: [{ attachmentId }, { attachmentIds: { has: attachmentId } }] },
      }))
    )
      throw new ForbiddenException('只能引用本人上传或已用于本课程课时的资源');
  }
  private async lessonContent(a: Actor, courseId: string, content: string) {
    const safe = cleanRichText(content, true);
    const attachmentIds = [
      ...new Set([...safe.matchAll(/src="\/api\/attachments\/([a-zA-Z0-9_-]+)\/preview"/g)].map((m) => m[1])),
    ];
    if (attachmentIds.length > 30) throw new BadRequestException('单课时最多引用 30 张图片');
    for (const id of attachmentIds) {
      await this.checkAttachment(a, courseId, id);
      const image = await this.db.attachment.findUniqueOrThrow({ where: { id } });
      if (!['image/png', 'image/jpeg'].includes(image.mime))
        throw new BadRequestException('内联资源必须是 PNG 或 JPEG 图片');
    }
    return { content: safe, attachmentIds };
  }
  private async lessonTasks(courseId: string, tasks: { type: string; id: string }[]) {
    for (const task of tasks) {
      const found =
        task.type === 'practice'
          ? await this.db.chapter.findFirst({ where: { id: task.id, courseId } })
          : task.type === 'assignment'
            ? await this.db.assignment.findFirst({ where: { id: task.id, courseId } })
            : await this.db.exam.findFirst({ where: { id: task.id, courseId } });
      if (!found) throw new BadRequestException('关联任务必须属于当前课程');
    }
  }
  @Post('chapters/:id/lessons') async lesson(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const ch = await this.db.chapter.findUnique({ where: { id } });
    if (!ch) throw new NotFoundException();
    await this.auth.course(a, ch.courseId, true);
    const d = lessonInput.parse(body);
    await this.checkAttachment(a, ch.courseId, d.attachmentId);
    await this.lessonTasks(ch.courseId, d.relatedTasks);
    return this.db.lesson.create({
      data: {
        ...d,
        ...(await this.lessonContent(a, ch.courseId, d.content)),
        chapterId: id,
        courseId: ch.courseId,
      },
    });
  }
  @Patch('lessons/:id') async lessonEdit(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const l = await this.db.lesson.findUnique({ where: { id } });
    if (!l) throw new NotFoundException();
    await this.auth.course(a, l.courseId, true);
    const d = lessonInput.partial().parse(body);
    await this.checkAttachment(a, l.courseId, d.attachmentId);
    if (d.relatedTasks) await this.lessonTasks(l.courseId, d.relatedTasks);
    return this.db.lesson.update({
      where: { id },
      data: { ...d, ...(d.content !== undefined ? await this.lessonContent(a, l.courseId, d.content) : {}) },
    });
  }
  @Put('lessons/:id/progress') async progress(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.require(a, 'learning.use');
    const l = await this.db.lesson.findUnique({ where: { id } });
    if (!l) throw new NotFoundException();
    await this.auth.course(a, l.courseId);
    if (l.opensAt && l.opensAt > new Date()) throw new ForbiddenException('课时尚未开放');
    const d = z
      .object({ completed: z.boolean(), positionSeconds: z.number().int().min(0).max(86400).default(0) })
      .parse(body);
    return this.db.learningProgress.upsert({
      where: { userId_lessonId: { userId: a.id, lessonId: id } },
      create: { userId: a.id, lessonId: id, courseId: l.courseId, ...d },
      update: d,
    });
  }
  @Get('courses/:id/members') async members(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: Record<string, string> = {},
  ) {
    await this.auth.course(a, id);
    if (a.role === 'STUDENT') throw new ForbiddenException('学生不能查看完整课程名单');
    const p = paging(q);
    const [enrolled, teaching] = await Promise.all([
      q.kind === 'teacher'
        ? []
        : this.db.enrollment.findMany({
            where: { courseId: id, active: true },
            select: { id: true, userId: true },
          }),
      q.kind === 'student'
        ? []
        : this.db.teachingAssignment.findMany({
            where: { courseId: id, active: true },
            select: { id: true, userId: true },
          }),
    ]);
    const all = [
      ...enrolled.map((x) => ({ ...x, kind: 'student' })),
      ...teaching.map((x) => ({ ...x, kind: 'teacher' })),
    ];
    const where = {
      id: { in: all.map((x) => x.userId) },
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search } },
              { username: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: { id: true, name: true, username: true, studentNo: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.pageSize,
      }),
      this.db.user.count({ where }),
    ]);
    return {
      items: users.map((user) => ({
        ...user,
        userId: user.id,
        kind: teaching.some((x) => x.userId === user.id) ? 'teacher' : 'student',
        membershipId: all.find((x) => x.userId === user.id)?.id,
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  @Post('courses/:id/members') async addMember(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.auth.course(a, id, true);
    const d = z
      .object({ userId: z.string(), kind: z.enum(['teacher', 'student']).default('student') })
      .parse(body);
    if (d.kind === 'teacher') this.auth.require(a, 'course.admin');
    const u = await this.db.user.findFirst({
      where: {
        id: d.userId,
        organizationId: a.organizationId,
        active: true,
        roles: { some: { roleId: d.kind === 'teacher' ? 'TEACHER' : 'STUDENT' } },
      },
    });
    if (!u) throw new BadRequestException('成员不属于本机构或角色不匹配');
    const key = { courseId_userId: { courseId: id, userId: u.id } };
    const result =
      d.kind === 'student'
        ? await this.db.enrollment.upsert({
            where: key,
            create: { courseId: id, userId: u.id },
            update: { active: true },
          })
        : await this.db.teachingAssignment.upsert({
            where: key,
            create: { courseId: id, userId: u.id },
            update: { active: true },
          });
    await this.audit.record(a, 'membership.add', 'Course', id, { userId: u.id, kind: d.kind });
    await this.audit.notify(
      [u.id],
      a.organizationId,
      'MEMBERSHIP',
      '课程成员资格更新',
      '你已加入课程',
      `/courses/${id}`,
      `member:${result.id}:${Date.now()}`,
    );
    return result;
  }
  @Delete('courses/:id/members/:userId') async removeMember(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Query('kind') kind = 'student',
  ) {
    await this.auth.course(a, id, true);
    if (kind === 'teacher') this.auth.require(a, 'course.admin');
    const course = await this.db.course.findUniqueOrThrow({ where: { id } });
    if (kind === 'teacher' && userId === course.teacherId) throw new BadRequestException('请先交接负责教师');
    if (kind === 'teacher')
      await this.db.teachingAssignment.updateMany({
        where: { courseId: id, userId },
        data: { active: false },
      });
    else await this.db.enrollment.updateMany({ where: { courseId: id, userId }, data: { active: false } });
    await this.audit.record(a, 'membership.remove', 'Course', id, { userId, kind });
    await this.audit.notify(
      [userId],
      a.organizationId,
      'MEMBERSHIP',
      '课程成员资格已移除',
      '历史记录仍保留，后续访问按当前授权关系生效。',
      '/courses',
      `member-remove:${id}:${userId}:${Date.now()}`,
    );
    return { ok: true };
  }
  @Get('announcements') async announcements(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    const ids = await this.auth.courseIds(a);
    const p = paging(q);
    if (q.courseId) await this.auth.course(a, q.courseId);
    const where = {
      organizationId: a.organizationId,
      ...(q.courseId ? { courseId: q.courseId } : { OR: [{ courseId: null }, { courseId: { in: ids } }] }),
    };
    const [items, total] = await Promise.all([
      this.db.announcement.findMany({
        where,
        skip: p.skip,
        take: p.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.announcement.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  @Post('announcements') async announcement(@CurrentActor() a: Actor, @Body() body: unknown) {
    const d = z
      .object({
        courseId: z.string().optional(),
        title: z.string().min(1).max(160),
        content: z.string().min(1).max(20000),
      })
      .parse(body);
    if (d.courseId) await this.auth.course(a, d.courseId, true);
    else this.auth.require(a, 'org.manage');
    const n = await this.db.announcement.create({
      data: { ...d, content: clean(d.content), organizationId: a.organizationId, authorId: a.id },
    });
    const users = d.courseId
      ? (await this.db.enrollment.findMany({ where: { courseId: d.courseId, active: true } })).map(
          (x) => x.userId,
        )
      : (
          await this.db.user.findMany({
            where: { organizationId: a.organizationId, active: true },
            select: { id: true },
          })
        ).map((x) => x.id);
    await this.audit.notify(
      users,
      a.organizationId,
      'ANNOUNCEMENT',
      d.title,
      '收到新的教学公告',
      d.courseId ? `/courses/${d.courseId}` : '/notifications',
      `announcement:${n.id}`,
    );
    return n;
  }
}
