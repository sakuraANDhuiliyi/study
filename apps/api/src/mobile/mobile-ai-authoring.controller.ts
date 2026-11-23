import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AiAuthoringService } from '../ai-authoring/ai-authoring.service';
import { authoringCommitInput, authoringGenerateInput } from '../ai-authoring/ai-authoring.schemas';
import { mobileAuthoringListQuery } from './mobile-teaching-tools.schemas';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
@Controller('mobile/ai-authoring')
@UseGuards(AuthGuard)
export class MobileAiAuthoringController {
  constructor(
    private service: AiAuthoringService,
    private auth: AuthService,
  ) {}
  private async current(a: Actor) {
    if (a.clientType !== 'MOBILE' || a.role !== 'TEACHER') throw new ForbiddenException('请使用教师手机会话');
    const current = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (
      !current ||
      current.id !== a.id ||
      current.organizationId !== a.organizationId ||
      current.role !== a.role
    )
      throw new UnauthorizedException('教师会话已变化，请重新登录');
    if ([...current.permissions].sort().join('|') !== [...a.permissions].sort().join('|'))
      throw new ForbiddenException('教师授权已变化，请重新加载');
    this.auth.require(current, 'question.manage');
    this.auth.require(current, 'course.read');
    await this.auth.checkFeature(current, '/api/ai-authoring');
    return current;
  }
  private async run<T>(a: Actor, action: (current: Actor) => T | Promise<T>) {
    const result = await action(await this.current(a));
    await this.current(a);
    return result;
  }
  @Get('status') status(@CurrentActor() a: Actor) {
    return this.run(a, (actor) => ({
      ...this.service.status(actor),
      canCreatePaper: actor.permissions.includes('assessment.manage'),
    }));
  }
  @Get('drafts') list(@CurrentActor() a: Actor, @Query() query: unknown) {
    return this.run(a, (actor) => this.service.list(actor, mobileAuthoringListQuery.parse(query)));
  }
  @Post('drafts') create(@CurrentActor() a: Actor, @Body() body: unknown) {
    return this.run(a, (actor) => this.service.create(actor, authoringGenerateInput.parse(body)));
  }
  @Get('drafts/:id') read(@CurrentActor() a: Actor, @Param('id') value: string) {
    return this.run(a, (actor) => this.service.detail(actor, id.parse(value)));
  }
  @Post('drafts/:id/commit') commit(
    @CurrentActor() a: Actor,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return this.run(a, (actor) =>
      this.service.commit(actor, id.parse(value), authoringCommitInput.parse(body)),
    );
  }
  @Delete('drafts/:id') remove(@CurrentActor() a: Actor, @Param('id') value: string) {
    return this.run(a, (actor) => this.service.remove(actor, id.parse(value)));
  }
}
