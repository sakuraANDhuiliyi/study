import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AcademicGoalsService } from './goals.service';

@ApiTags('专业学习目标')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('academics/goals')
export class AcademicGoalsController {
  constructor(private readonly goals: AcademicGoalsService) {}
  @Get() list(@CurrentActor() actor: Actor, @Query() query: Record<string, string>) {
    return this.goals.list(actor, query);
  }
  @Post() create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.goals.create(actor, body);
  }
  @Patch(':id') patch(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.goals.patch(actor, id, body);
  }
  @Delete(':id') delete(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.goals.delete(actor, id, body);
  }
}
