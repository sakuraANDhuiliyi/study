import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AcademicsService } from './academics.service';

@ApiTags('学科专业学习')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('academics')
export class AcademicsController {
  constructor(private readonly academics: AcademicsService) {}
  @Get('catalog') catalog(@CurrentActor() actor: Actor) {
    return this.academics.catalog(actor);
  }
  @Get('me') me(@CurrentActor() actor: Actor) {
    return this.academics.me(actor);
  }
  @Patch('preferences') preferences(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.academics.preferences(actor, body);
  }
  @Get('modules/:id') detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.academics.detail(actor, id);
  }
  @Post('modules/:id/evaluate') evaluate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.academics.evaluate(actor, id, body);
  }
  @Get('records') records(@CurrentActor() actor: Actor, @Query() query: Record<string, string>) {
    return this.academics.records(actor, query);
  }
  @Get('records/:id') record(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.academics.record(actor, id);
  }
  @Patch('records/:id') patch(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.academics.patchRecord(actor, id, body);
  }
  @Delete('records/:id') delete(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.academics.deleteRecord(actor, id);
  }
  @Get('admin/subjects') subjects(@CurrentActor() actor: Actor) {
    return this.academics.adminSubjects(actor);
  }
  @Post('admin/subjects') createSubject(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.academics.createSubject(actor, body);
  }
  @Patch('admin/subjects/:id') patchSubject(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.academics.patchSubject(actor, id, body);
  }
  @Get('admin/majors') majors(@CurrentActor() actor: Actor) {
    return this.academics.adminMajors(actor);
  }
  @Post('admin/majors') createMajor(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.academics.createMajor(actor, body);
  }
  @Patch('admin/majors/:id') patchMajor(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.academics.patchMajor(actor, id, body);
  }
}
