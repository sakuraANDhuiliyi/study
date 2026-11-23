import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AiStudyService } from '../ai-study/ai-study.service';
import { aiExportQuery, createAiReportInput, searchAiReportInput } from '../ai-study/ai-study.schemas';
import { mobileAiReportQuery } from './mobile-ai-study.schemas';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
@Controller('mobile/ai-study')
@UseGuards(AuthGuard)
export class MobileAiStudyController {
  constructor(
    private service: AiStudyService,
    private auth: AuthService,
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
      throw new UnauthorizedException('登录身份已变化，请重新登录');
    this.auth.require(current, 'learning.use');
    this.auth.require(current, 'course.read');
    await this.auth.checkFeature(current, '/api/ai-study');
    return current;
  }
  private async run<T>(a: Actor, action: (current: Actor) => T | Promise<T>) {
    const result = await action(await this.current(a));
    await this.current(a);
    return result;
  }
  @Get('status') status(@CurrentActor() a: Actor) {
    return this.run(a, (actor) => this.service.status(actor));
  }
  @Get('reports') list(@CurrentActor() a: Actor, @Query() query: unknown) {
    return this.run(a, (actor) => this.service.list(actor, mobileAiReportQuery.parse(query)));
  }
  @Post('reports') create(@CurrentActor() a: Actor, @Body() body: unknown) {
    return this.run(a, (actor) => this.service.create(actor, createAiReportInput.parse(body)));
  }
  @Get('reports/:id') read(@CurrentActor() a: Actor, @Param('id') value: string) {
    return this.run(a, (actor) => this.service.report(actor, id.parse(value)));
  }
  @Delete('reports/:id') remove(@CurrentActor() a: Actor, @Param('id') value: string) {
    return this.run(a, (actor) => this.service.remove(actor, id.parse(value)));
  }
  @Post('reports/:id/search') search(
    @CurrentActor() a: Actor,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return this.run(a, (actor) =>
      this.service.search(actor, id.parse(value), searchAiReportInput.parse(body).query),
    );
  }
  @Get('reports/:id/export') async export(
    @CurrentActor() a: Actor,
    @Param('id') value: string,
    @Query() query: unknown,
    @Res() response: Response,
  ) {
    const output = await this.run(a, (actor) =>
      this.service.export(actor, id.parse(value), aiExportQuery.parse(query).format),
    );
    response.type(output.contentType).attachment(output.filename).send(output.text);
  }
  @Post('reports/:id/sources/:sourceId/download') @HttpCode(200) async download(
    @CurrentActor() a: Actor,
    @Param('id') value: string,
    @Param('sourceId') sourceId: string,
    @Res() response: Response,
  ) {
    const output = await this.run(a, (actor) =>
      this.service.download(actor, id.parse(value), id.parse(sourceId)),
    );
    response.type(output.contentType).attachment(output.filename).send(output.buffer);
  }
}
