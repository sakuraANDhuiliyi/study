import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { LearningActionsService } from './actions.service';

@ApiTags('学习日历与个人计划')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('planner/actions')
export class LearningActionsController {
  constructor(private readonly actions: LearningActionsService) {}
  @Get()
  @ApiOperation({ summary: '学生的今日、未来7日和逾期行动，按时间分桶独立分页并返回真实总数' })
  list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.actions.list(actor, query);
  }
}
