import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { ProgrammingService } from './programming.service';
import {
  programmingCreateInput,
  programmingUpdateInput,
  programmingVersionInput,
  programmingRestoreInput,
  programmingAiInput,
  programmingApplyInput,
  programmingPreviewInput,
  programmingListQuery,
} from './programming.schemas';

@ApiTags('编程学习工作室')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('programming')
export class ProgrammingController {
  constructor(private readonly programming: ProgrammingService) {}
  @Get('status') status(@CurrentActor() actor: Actor) {
    return this.programming.status(actor);
  }
  @Get('templates') templates(@CurrentActor() actor: Actor) {
    return this.programming.templates(actor);
  }
  @Get('projects') list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.programming.list(actor, programmingListQuery.parse(query));
  }
  @Post('projects') create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.programming.create(actor, programmingCreateInput.parse(body));
  }
  @Get('projects/:id') detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.programming.detail(actor, id);
  }
  @Patch('projects/:id') update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.programming.update(actor, id, programmingUpdateInput.parse(body));
  }
  @Delete('projects/:id') remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.programming.remove(actor, id);
  }
  @Get('projects/:id/versions') versions(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.programming.versions(actor, id);
  }
  @Get('projects/:id/versions/:versionId') version(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.programming.version(actor, id, versionId);
  }
  @Post('projects/:id/versions') saveVersion(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.programming.saveVersion(actor, id, programmingVersionInput.parse(body));
  }
  @Post('projects/:id/restore') restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.programming.restore(actor, id, programmingRestoreInput.parse(body));
  }
  @Get('projects/:id/export') async export(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const output = await this.programming.export(actor, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.type('application/zip').attachment(output.filename).send(output.buffer);
  }
  @Post('projects/:id/preview') preview(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.programming.preview(actor, id, programmingPreviewInput.parse(body));
  }
  @Post('projects/:id/ai-drafts') generate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.programming.generate(actor, id, programmingAiInput.parse(body));
  }
  @Get('projects/:id/ai-drafts') drafts(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.programming.drafts(actor, id);
  }
  @Get('projects/:id/ai-drafts/:draftId') draft(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('draftId') draftId: string,
  ) {
    return this.programming.draft(actor, id, draftId);
  }
  @Post('projects/:id/ai-drafts/:draftId/apply') apply(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
  ) {
    return this.programming.apply(actor, id, draftId, programmingApplyInput.parse(body));
  }
}
