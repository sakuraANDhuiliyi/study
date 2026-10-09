import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AlgorithmTrainingPlansService } from './training-plan.service';

@ApiTags('学生私人算法训练计划')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('algorithms/training-plans')
export class AlgorithmTrainingPlansController {
  constructor(private readonly service: AlgorithmTrainingPlansService) {}
  @Get()
  @ApiOperation({ summary: '本人当前学习空间的训练计划、公开题目摘要和配额' })
  list(@CurrentActor() actor: Actor) {
    return this.service.list(actor);
  }
  @Post()
  create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.create(actor, body);
  }
  @Patch(':id')
  patch(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.patch(actor, id, body);
  }
  @Delete(':id')
  delete(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.delete(actor, id, body);
  }
}
