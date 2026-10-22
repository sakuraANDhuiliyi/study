import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { announcementScope, readAnnouncement } from './mobile-announcements';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const query = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(10),
    scope: z.enum(['all', 'organization', 'courses']).default('all'),
    courseId: id.optional(),
    search: z.string().trim().max(100).default(''),
  })
  .strict()
  .refine((q) => !q.courseId || q.scope !== 'organization', '课程与机构筛选不能同时使用');
@Controller('mobile/announcements')
@UseGuards(AuthGuard)
export class MobileAnnouncementsController {
  constructor(private db: PrismaService) {}
  @Get() list(@CurrentActor() a: Actor, @Query() input: unknown) {
    const q = query.parse(input);
    return announcementScope(this.db, a, async (tx, auth, actor) => {
      const ids = await auth.courseIds(actor);
      if (q.courseId) await auth.course(actor, q.courseId);
      const where: Prisma.AnnouncementWhereInput = {
        organizationId: actor.organizationId,
        ...(q.courseId
          ? { courseId: q.courseId }
          : q.scope === 'organization'
            ? { courseId: null }
            : q.scope === 'courses'
              ? { courseId: { in: ids } }
              : { OR: [{ courseId: null }, { courseId: { in: ids } }] }),
        ...(q.search
          ? { title: { contains: q.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } }
          : {}),
      };
      const items = await tx.announcement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, title: true, createdAt: true, courseId: true },
      });
      const courses = await tx.course.findMany({
        where: { id: { in: ids }, organizationId: actor.organizationId },
        select: { id: true, title: true },
      });
      return {
        items: items.map((row) => ({
          ...row,
          courseTitle: courses.find((c) => c.id === row.courseId)?.title ?? null,
        })),
        total: await tx.announcement.count({ where }),
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }
  @Get(':id') read(@CurrentActor() a: Actor, @Param('id') value: string) {
    return announcementScope(this.db, a, (tx, auth, actor) =>
      readAnnouncement(tx, auth, actor, id.parse(value)),
    );
  }
}
