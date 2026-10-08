import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { plannerRange, taskDelete, taskInput, taskPatch } from './planner.schemas';

type Event = {
  id: string;
  type: 'personal' | 'assignment' | 'exam';
  title: string;
  startAt: Date;
  endAt?: Date;
  originalDueAt?: Date;
  entryClosesAt?: Date;
  courseId?: string;
  courseTitle?: string;
  path?: string;
  status: string;
  description?: string;
  revision?: number;
  completedAt?: Date | null;
};
const LIMIT = 500;
@ApiTags('学习日历与个人计划')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('planner')
export class PlannerController {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
  ) {}
  @Get()
  @ApiOperation({ summary: '按当前课程权限聚合作业、考试与本人待办；最多查询93天' })
  async calendar(@CurrentActor() a: Actor, @Query() query: unknown) {
    const q = plannerRange.parse(query);
    const start = new Date(q.start),
      end = new Date(q.end);
    const items: Event[] = [];
    let truncated = false;
    if (q.type === 'all' || q.type === 'personal') {
      const tasks = await this.db.personalTask.findMany({
        where: { userId: a.id, organizationId: a.organizationId, dueAt: { gte: start, lt: end } },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: LIMIT + 1,
      });
      truncated ||= tasks.length > LIMIT;
      items.push(
        ...tasks.slice(0, LIMIT).map((t) => ({
          id: t.id,
          type: 'personal' as const,
          title: t.title,
          description: t.description,
          startAt: t.dueAt,
          status: t.completedAt ? 'completed' : 'pending',
          completedAt: t.completedAt,
          revision: t.revision,
        })),
      );
    }
    const student = a.role === 'STUDENT';
    const canAssess = a.permissions.includes(student ? 'learning.use' : 'assessment.manage');
    if (canAssess && q.type !== 'personal') {
      const ids = await this.auth.courseIds(a);
      const courses = await this.db.course.findMany({
        where: { id: { in: ids }, organizationId: a.organizationId },
        select: { id: true, title: true },
      });
      const titles = new Map(courses.map((c) => [c.id, c.title]));
      if (q.type === 'all' || q.type === 'assignment') {
        // A personal extension replaces the calendar deadline; the original due date still determines lateness.
        const range: Prisma.AssignmentWhereInput = student
          ? {
              OR: [
                {
                  dueAt: { gte: start, lt: end },
                  exceptions: { none: { userId: a.id, allowUntil: { gte: end } } },
                },
                {
                  dueAt: { lt: end },
                  exceptions: { some: { userId: a.id, allowUntil: { gte: start, lt: end } } },
                },
              ],
            }
          : { dueAt: { gte: start, lt: end } };
        const assignments = await this.db.assignment.findMany({
          where: {
            organizationId: a.organizationId,
            courseId: { in: ids },
            status: 'published',
            ...range,
            ...(student ? { audience: { some: { userId: a.id } } } : {}),
          },
          select: {
            id: true,
            title: true,
            courseId: true,
            dueAt: true,
            opensAt: true,
            exceptions: { where: { userId: a.id }, select: { allowUntil: true, exempt: true } },
            submissions: {
              where: { userId: a.id },
              orderBy: { version: 'desc' },
              take: 1,
              select: { status: true },
            },
          },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          take: LIMIT + 1,
        });
        truncated ||= assignments.length > LIMIT;
        for (const task of assignments.slice(0, LIMIT)) {
          const exception = student ? task.exceptions[0] : undefined;
          const dueAt = new Date(Math.max(task.dueAt.getTime(), exception?.allowUntil?.getTime() ?? 0));
          if (dueAt < start || dueAt >= end) continue;
          const status = exception?.exempt
            ? 'exempt'
            : student
              ? (task.submissions[0]?.status ?? 'not_submitted')
              : 'published';
          items.push({
            id: `assignment:${task.id}`,
            type: 'assignment',
            title: task.title,
            startAt: dueAt,
            originalDueAt: task.dueAt,
            courseId: task.courseId,
            courseTitle: titles.get(task.courseId),
            path: `/assignments/${task.id}`,
            status,
            description: exception?.exempt
              ? '本人已获作业豁免'
              : dueAt > task.dueAt
                ? '显示个人补交截止时间；迟交仍按原截止时间判定。'
                : '作业截止时间',
          });
        }
      }
      if (q.type === 'all' || q.type === 'exam') {
        const exams = await this.db.exam.findMany({
          where: {
            organizationId: a.organizationId,
            courseId: { in: ids },
            status: { in: ['published', 'cancelled'] },
            startsAt: { lt: end },
            AND: [
              {
                OR: [
                  { endsAt: { gt: start } },
                  ...(student
                    ? [
                        { extensions: { some: { userId: a.id, deadlineAt: { gt: start } } } },
                        {
                          attempts: {
                            some: { userId: a.id, status: 'in_progress', deadlineAt: { gt: start } },
                          },
                        },
                      ]
                    : []),
                ],
              },
            ],
            ...(student ? { audience: { some: { userId: a.id, eligible: true } } } : {}),
          },
          select: {
            id: true,
            title: true,
            courseId: true,
            status: true,
            startsAt: true,
            endsAt: true,
            entryClosesAt: true,
            extensions: { where: { userId: a.id }, select: { deadlineAt: true } },
            attempts: {
              where: { userId: a.id },
              orderBy: { number: 'desc' },
              take: 1,
              select: { id: true, status: true, deadlineAt: true },
            },
          },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          take: LIMIT + 1,
        });
        truncated ||= exams.length > LIMIT;
        for (const exam of exams.slice(0, LIMIT)) {
          const attempt = student ? exam.attempts[0] : undefined;
          const extension = student ? exam.extensions[0] : undefined;
          const effectiveEnd =
            attempt?.status === 'in_progress' ? attempt.deadlineAt : (extension?.deadlineAt ?? exam.endsAt);
          if (effectiveEnd <= start) continue;
          items.push({
            id: `exam:${exam.id}`,
            type: 'exam',
            title: exam.title,
            startAt: exam.startsAt,
            endAt: effectiveEnd,
            entryClosesAt: extension?.deadlineAt ?? exam.entryClosesAt,
            courseId: exam.courseId,
            courseTitle: titles.get(exam.courseId),
            path: attempt?.status === 'in_progress' ? `/exam-attempts/${attempt.id}` : `/exams/${exam.id}`,
            status: exam.status === 'cancelled' ? 'cancelled' : (attempt?.status ?? exam.status),
            description:
              attempt?.status === 'in_progress'
                ? '结束时间为本人答卷的实际交卷截止时间'
                : extension
                  ? '结束时间为本人获准的延长窗口'
                  : '显示考试窗口；实际作答时长以开始考试后显示的倒计时为准',
          });
        }
      }
    }
    items.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id));
    return { items, truncated, timezone: 'Asia/Shanghai', serverTime: new Date().toISOString() };
  }
  @Post('tasks')
  @ApiOperation({ summary: '新增仅本人可见的个人待办' })
  create(@CurrentActor() a: Actor, @Body() body: unknown) {
    return this.db.personalTask.create({
      data: { ...taskInput.parse(body), organizationId: a.organizationId, userId: a.id },
    });
  }
  private async current(a: Actor, id: string) {
    const task = await this.db.personalTask.findFirst({
      where: { id, userId: a.id, organizationId: a.organizationId },
    });
    if (!task) throw new NotFoundException('个人待办不存在');
    return task;
  }
  @Get('tasks/:id')
  @ApiOperation({ summary: '获取本人待办的最新内容及版本' })
  task(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.current(a, id);
  }
  @Patch('tasks/:id')
  @ApiOperation({ summary: '通过revision并发校验编辑或完成本人待办' })
  async update(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const { revision, completed, ...input } = taskPatch.parse(body);
    const task = await this.current(a, id);
    return this.db.$transaction(async (tx) => {
      const changed = await tx.personalTask.updateMany({
        where: { id, userId: a.id, organizationId: a.organizationId, revision },
        data: {
          ...input,
          ...(completed === undefined
            ? {}
            : { completedAt: completed ? (task.completedAt ?? new Date()) : null }),
          revision: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException('待办已在其他页面修改，请刷新后再保存');
      return tx.personalTask.findUniqueOrThrow({ where: { id } });
    });
  }
  @Delete('tasks/:id')
  @ApiOperation({ summary: '删除本人待办并校验revision' })
  async remove(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const { revision } = taskDelete.parse(body);
    await this.current(a, id);
    const result = await this.db.personalTask.deleteMany({
      where: { id, userId: a.id, organizationId: a.organizationId, revision },
    });
    if (!result.count) throw new ConflictException('待办已在其他页面修改，请刷新后再删除');
    return { deleted: true };
  }
}
