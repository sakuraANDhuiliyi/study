import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AlgorithmForumService } from './algorithm-forum.service';
import {
  forumListQuery,
  forumPageQuery,
  forumPostInput,
  forumPostUpdateInput,
  forumReplyInput,
  forumRevisionInput,
  forumModerationInput,
} from './algorithm-forum.schemas';
@ApiTags('算法论坛')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('algorithm-forum')
export class AlgorithmForumController {
  constructor(private readonly service: AlgorithmForumService) {}
  @Get('status') status(@CurrentActor() actor: Actor) {
    return this.service.status(actor);
  }
  @Get('posts') list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.service.list(actor, forumListQuery.parse(query));
  }
  @Post('posts') create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.create(actor, forumPostInput.parse(body));
  }
  @Get('posts/:id') detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.detail(actor, id);
  }
  @Patch('posts/:id') update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.update(actor, id, forumPostUpdateInput.parse(body));
  }
  @Delete('posts/:id') remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.remove(actor, id, forumRevisionInput.parse(body).revision);
  }
  @Patch('posts/:id/moderation') moderate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.moderate(actor, id, forumModerationInput.parse(body));
  }
  @Get('posts/:id/replies') replies(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.service.replies(actor, id, forumPageQuery.parse(query));
  }
  @Post('posts/:id/replies') reply(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.reply(actor, id, forumReplyInput.parse(body));
  }
  @Delete('posts/:postId/replies/:id') removeReply(
    @CurrentActor() actor: Actor,
    @Param('postId') postId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.removeReply(actor, postId, id, forumRevisionInput.parse(body).revision);
  }
}
