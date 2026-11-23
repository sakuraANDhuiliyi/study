import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AlgorithmsService } from '../algorithms/algorithms.service';
import { AlgorithmTrainingPlansService } from '../algorithms/training-plan.service';
import { AlgorithmForumService } from '../algorithm-forum/algorithm-forum.service';
import { algorithmAnalysisInput } from '../algorithms/algorithms.schemas';
import { forumPostInput, forumReplyInput } from '../algorithm-forum/algorithm-forum.schemas';
import { mobileForumListQuery, mobileForumPageQuery } from './mobile-algorithms.schemas';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

@Controller('mobile/algorithms')
@UseGuards(AuthGuard)
export class MobileAlgorithmLearningController {
  constructor(
    private auth: AuthService,
    private algorithms: AlgorithmsService,
    private plans: AlgorithmTrainingPlansService,
    private forum: AlgorithmForumService,
  ) {}
  private async current(actor: Actor, forum = false) {
    if (actor.clientType !== 'MOBILE' || actor.role !== 'STUDENT')
      throw new ForbiddenException('请使用学生手机会话');
    const current = actor.sessionId ? await this.auth.resolveMobileSessionId(actor.sessionId) : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.organizationId !== actor.organizationId ||
      current.role !== 'STUDENT'
    )
      throw new ForbiddenException('当前学习会话已失效');
    this.auth.require(current, 'learning.use');
    await this.auth.checkFeature(current, forum ? '/api/algorithm-forum' : '/api/algorithms');
    return current;
  }
  private async run<T>(actor: Actor, work: (current: Actor) => Promise<T>, forum = false) {
    const current = await this.current(actor, forum),
      result = await work(current);
    await this.current(actor, forum);
    return result;
  }
  @Get('training-plans') listPlans(@CurrentActor() actor: Actor) {
    return this.run(actor, (a) => this.plans.list(a));
  }
  @Post('training-plans') createPlan(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.run(actor, (a) => this.plans.create(a, body));
  }
  @Patch('training-plans/:id') patchPlan(
    @CurrentActor() actor: Actor,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return this.run(actor, (a) => this.plans.patch(a, id.parse(value), body));
  }
  @Delete('training-plans/:id') deletePlan(
    @CurrentActor() actor: Actor,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return this.run(actor, (a) => this.plans.delete(a, id.parse(value), body));
  }
  @Post('problems/:id/analysis') analyze(
    @CurrentActor() actor: Actor,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    const input = algorithmAnalysisInput.parse(body);
    return this.run(actor, (a) => this.algorithms.analyze(a, id.parse(value), input));
  }
  @Get('problems/:id/analyses') analyses(@CurrentActor() actor: Actor, @Param('id') value: string) {
    return this.run(actor, (a) => this.algorithms.analyses(a, id.parse(value)));
  }
  @Get('forum/status') forumStatus(@CurrentActor() actor: Actor) {
    return this.run(actor, (a) => this.forum.status(a), true);
  }
  @Get('forum/posts') posts(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.run(actor, (a) => this.forum.list(a, mobileForumListQuery.parse(query)), true);
  }
  @Post('forum/posts') createPost(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.run(actor, (a) => this.forum.create(a, forumPostInput.parse(body)), true);
  }
  @Get('forum/posts/:id') post(@CurrentActor() actor: Actor, @Param('id') value: string) {
    return this.run(actor, (a) => this.forum.detail(a, id.parse(value)), true);
  }
  @Get('forum/posts/:id/replies') replies(
    @CurrentActor() actor: Actor,
    @Param('id') value: string,
    @Query() query: unknown,
  ) {
    return this.run(
      actor,
      (a) => this.forum.replies(a, id.parse(value), mobileForumPageQuery.parse(query)),
      true,
    );
  }
  @Post('forum/posts/:id/replies') reply(
    @CurrentActor() actor: Actor,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return this.run(actor, (a) => this.forum.reply(a, id.parse(value), forumReplyInput.parse(body)), true);
  }
}
