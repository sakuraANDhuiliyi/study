import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AiAuthoringService } from './ai-authoring.service';
import { authoringCommitInput, authoringGenerateInput, authoringListQuery } from './ai-authoring.schemas';

@ApiTags('AI 出题与组卷')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('ai-authoring')
export class AiAuthoringController {
  constructor(private readonly service: AiAuthoringService) {}
  @Get('status') status(@CurrentActor() actor: Actor) {
    return this.service.status(actor);
  }
  @Get('drafts') list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.service.list(actor, authoringListQuery.parse(query));
  }
  @Post('drafts') create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.create(actor, authoringGenerateInput.parse(body));
  }
  @Get('drafts/:id') detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.detail(actor, id);
  }
  @Post('drafts/:id/commit') commit(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.commit(actor, id, authoringCommitInput.parse(body));
  }
  @Delete('drafts/:id') remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.remove(actor, id);
  }
}
