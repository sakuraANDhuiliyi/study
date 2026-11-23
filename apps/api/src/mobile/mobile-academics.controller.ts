import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AcademicsService } from '../academics/academics.service';
import { AcademicGoalsService } from '../academics/goals.service';
import { AcademicRecordExportService } from '../academics/records-export.service';
import { mobileAcademicRecordQuery } from './mobile-academics.schemas';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
@Controller('mobile/academics')
@UseGuards(AuthGuard)
export class MobileAcademicsController {
  constructor(
    private academics: AcademicsService,
    private auth: AuthService,
    private goals: AcademicGoalsService,
    private exports: AcademicRecordExportService,
  ) {}
  private async current(a: Actor) {
    if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT') throw new ForbiddenException('请使用学生手机会话');
    const current = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (
      !current ||
      current.id !== a.id ||
      current.organizationId !== a.organizationId ||
      current.role !== a.role ||
      current.accountMode !== a.accountMode
    )
      throw new UnauthorizedException('会话或身份已变化，请重新登录');
    this.auth.require(current, 'learning.use');
    await this.auth.checkFeature(current, '/api/practice');
    return current;
  }
  private async run<T>(a: Actor, action: (current: Actor) => Promise<T>) {
    const result = await action(await this.current(a));
    await this.current(a);
    return result;
  }
  @Get('catalog') catalog(@CurrentActor() a: Actor) {
    return this.run(a, (actor) => this.academics.catalog(actor));
  }
  @Get('me') me(@CurrentActor() a: Actor) {
    return this.run(a, (actor) => this.academics.me(actor));
  }
  @Patch('preferences') preferences(@CurrentActor() a: Actor, @Body() input: unknown) {
    return this.run(a, (actor) => this.academics.preferences(actor, input));
  }
  @Get('modules/:id') detail(@CurrentActor() a: Actor, @Param('id') key: string) {
    return this.run(a, (actor) => this.academics.detail(actor, id.parse(key)));
  }
  @Post('modules/:id/evaluate') evaluate(
    @CurrentActor() a: Actor,
    @Param('id') key: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.run(a, (actor) =>
      this.academics.evaluate(actor, id.parse(key), input, req.ip || req.socket.remoteAddress),
    );
  }
  @Get('records') records(@CurrentActor() a: Actor, @Query() query: unknown) {
    return this.run(a, (actor) => this.academics.records(actor, mobileAcademicRecordQuery.parse(query)));
  }
  @Post('records/export') @HttpCode(200) async export(
    @CurrentActor() a: Actor,
    @Body() input: unknown,
    @Res() response: Response,
  ) {
    const output = await this.run(a, (actor) => this.exports.export(actor, input));
    response.setHeader('X-Export-Matched-Count', output.matchedCount);
    response.setHeader('X-Export-Record-Count', output.recordCount);
    response.setHeader('X-Export-Truncated', String(output.truncated));
    response.type(output.contentType).attachment(output.filename).send(output.buffer);
  }
  @Get('records/:id') record(@CurrentActor() a: Actor, @Param('id') key: string) {
    return this.run(a, (actor) => this.academics.record(actor, id.parse(key)));
  }
  @Patch('records/:id') patch(@CurrentActor() a: Actor, @Param('id') key: string, @Body() input: unknown) {
    return this.run(a, (actor) => this.academics.patchRecord(actor, id.parse(key), input));
  }
  @Delete('records/:id') remove(@CurrentActor() a: Actor, @Param('id') key: string) {
    return this.run(a, (actor) => this.academics.deleteRecord(actor, id.parse(key)));
  }
  @Get('goals') listGoals(@CurrentActor() a: Actor, @Query() query: unknown) {
    return this.run(a, (actor) => this.goals.list(actor, query));
  }
  @Post('goals') createGoal(@CurrentActor() a: Actor, @Body() input: unknown) {
    return this.run(a, (actor) => this.goals.create(actor, input));
  }
  @Patch('goals/:id') patchGoal(@CurrentActor() a: Actor, @Param('id') key: string, @Body() input: unknown) {
    return this.run(a, (actor) => this.goals.patch(actor, id.parse(key), input));
  }
  @Delete('goals/:id') removeGoal(
    @CurrentActor() a: Actor,
    @Param('id') key: string,
    @Body() input: unknown,
  ) {
    return this.run(a, (actor) => this.goals.delete(actor, id.parse(key), input));
  }
}
