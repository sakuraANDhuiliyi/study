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
  @Get('courses')
  @ApiOperation({ summary: '学生本人当前授权课程的轻量字面搜索与精确分页，含无行动课程' })
  courses(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.actions.courses(actor, query);
  }
  @Get()
  @ApiOperation({ summary: '学生的今日、未来7日和逾期行动，按课程及来源筛选后独立分页并返回真实总数' })
  list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.actions.list(actor, query);
  }
}
