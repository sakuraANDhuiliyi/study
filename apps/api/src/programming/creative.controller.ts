import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { ProgrammingService } from './programming.service';
import {
  creativeFavoriteInput,
  creativeListQuery,
  creativeProjectInput,
  creativeRevisionInput,
} from './creative.schemas';

@ApiTags('编程创意广场')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('programming/creative')
export class CreativeController {
  constructor(private readonly programming: ProgrammingService) {}
  @Get() list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.programming.creativeList(actor, creativeListQuery.parse(query));
  }
  @Get(':id') detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.programming.creativeDetail(actor, id);
  }
  @Put(':id/favorite') favorite(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.programming.creativeFavorite(actor, id, creativeFavoriteInput.parse(body));
  }
  @Post(':id/preview') preview(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.programming.creativePreview(actor, id, creativeRevisionInput.parse(body));
  }
  @Post(':id/projects') create(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.programming.creativeProject(actor, id, creativeProjectInput.parse(body));
  }
  @Get(':id/export') async export(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const output = await this.programming.creativeExport(actor, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.type('application/zip').attachment(output.filename).send(output.buffer);
  }
}
