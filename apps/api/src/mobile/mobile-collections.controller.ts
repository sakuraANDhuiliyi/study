import { Body, Controller, ForbiddenException, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { PracticeService } from '../assessment/practice.service';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const query = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(10),
    courseId: id.optional(),
    mastered: z.enum(['true', 'false']).optional(),
  })
  .strict();
function student(a: Actor) {
  if (a.role !== 'STUDENT' || a.clientType !== 'MOBILE') throw new ForbiddenException('请使用学生手机会话');
}
@Controller('mobile/collections')
@UseGuards(AuthGuard)
export class MobileCollectionsController {
  constructor(private readonly service: PracticeService) {}
  @Get(':kind') list(@CurrentActor() a: Actor, @Param('kind') kind: string, @Query() q: unknown) {
    student(a);
    const type = z.enum(['mistakes', 'favorites']).parse(kind);
    const parsed = (type === 'mistakes' ? query : query.omit({ mastered: true })).parse(q);
    return this.service.mobileCollection(a, type, parsed);
  }
  @Put('mistakes/:id') master(@CurrentActor() a: Actor, @Param('id') value: string, @Body() b: unknown) {
    student(a);
    const input = z
      .object({ mastered: z.boolean(), expected: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(b);
    return this.service.mobileMaster(a, id.parse(value), input.mastered, input.expected);
  }
  @Put('favorites/:id') favorite(@CurrentActor() a: Actor, @Param('id') value: string, @Body() b: unknown) {
    student(a);
    const input = z.object({ favorite: z.boolean(), expected: id.nullable() }).strict().parse(b);
    return this.service.mobileFavorite(a, id.parse(value), input.favorite, input.expected);
  }
}
