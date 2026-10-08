import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AiStudyService } from './ai-study.service';
import { aiExportQuery, aiReportQuery, createAiReportInput, searchAiReportInput } from './ai-study.schemas';

@ApiTags('AI 错题复盘')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('ai-study')
export class AiStudyController {
  constructor(private readonly service: AiStudyService) {}
  @Get('status') status(@CurrentActor() actor: Actor) {
    return this.service.status(actor);
  }
  @Get('reports') list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.service.list(actor, aiReportQuery.parse(query));
  }
  @Post('reports') create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.create(actor, createAiReportInput.parse(body));
  }
  @Get('reports/:id') report(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.report(actor, id);
  }
  @Delete('reports/:id') remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.remove(actor, id);
  }
  @Post('reports/:id/search') search(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.search(actor, id, searchAiReportInput.parse(body).query);
  }
  @Get('reports/:id/export') async export(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
    @Res() response: Response,
  ) {
    const result = await this.service.export(actor, id, aiExportQuery.parse(query).format);
    response.type(result.contentType).attachment(result.filename).send(result.text);
  }
  @Post('reports/:id/sources/:sourceId/download')
  @HttpCode(200)
  async download(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Res() response: Response,
  ) {
    const result = await this.service.download(actor, id, sourceId);
    response.type(result.contentType).attachment(result.filename).send(result.buffer);
  }
}
