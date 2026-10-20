import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { PracticeService } from '../assessment/practice.service';
import {
  practiceSchema,
  answerSchema,
  practiceProgressSchema,
  listSchema,
} from '../assessment/assessment.schemas';
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const createSchema = practiceSchema
  .omit({ questionIds: true })
  .extend({
    count: z.number().int().min(1).max(30).optional(),
    type: z.enum(['single', 'multiple', 'boolean', 'blank', 'short', 'composite']).optional(),
    requestKey: z.string().uuid(),
  })
  .strict();
const querySchema = listSchema
  .pick({ page: true, pageSize: true, courseId: true })
  .extend({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(10),
    status: z.enum(['active', 'completed']).optional(),
  })
  .strict();
function student(a: Actor) {
  if (a.role !== 'STUDENT' || a.clientType !== 'MOBILE') throw new ForbiddenException('请使用学生手机会话');
}
@Controller('mobile/practice')
@UseGuards(AuthGuard)
export class MobilePracticeController {
  constructor(private readonly service: PracticeService) {}
  @Get() list(@CurrentActor() a: Actor, @Query() q: unknown) {
    student(a);
    return this.service.practices(a, querySchema.parse(q));
  }
  @Post() create(@CurrentActor() a: Actor, @Body() body: unknown) {
    student(a);
    const { requestKey, ...input } = createSchema.parse(body);
    return this.service.mobileCreate(a, input, requestKey);
  }
  @Get(':id') read(@CurrentActor() a: Actor, @Param('id') id: string) {
    student(a);
    return this.service.mobileRead(a, idSchema.parse(id));
  }
  @Post(':id/answer') answer(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    student(a);
    return this.service.mobileAnswer(a, idSchema.parse(id), answerSchema.strict().parse(body));
  }
  @Put(':id/progress') progress(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    student(a);
    return this.service.savePracticeProgress(
      a,
      idSchema.parse(id),
      practiceProgressSchema
        .extend({ revision: z.number().int().min(0).max(2147483646) })
        .strict()
        .parse(body),
    );
  }
}
