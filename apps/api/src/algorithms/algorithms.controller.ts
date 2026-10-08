import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AlgorithmsService } from './algorithms.service';
import {
  algorithmAnalysisInput,
  algorithmDraftInput,
  algorithmSubmissionQuery,
  algorithmProblemQuery,
  algorithmSubmissionInput,
  algorithmLearningInput,
} from './algorithms.schemas';

@ApiTags('学生算法练习')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('algorithms')
export class AlgorithmsController {
  constructor(private readonly service: AlgorithmsService) {}
  @Get('status') status(@CurrentActor() actor: Actor) {
    return this.service.status(actor);
  }
  @Get('overview') overview(@CurrentActor() actor: Actor) {
    return this.service.overview(actor);
  }
  @Get('problems') list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.service.list(actor, algorithmProblemQuery.parse(query));
  }
  @Get('problems/:id') problem(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.problem(actor, id);
  }
  @Get('problems/:id/learning') learning(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.learning(actor, id);
  }
  @Patch('problems/:id/learning') updateLearning(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateLearning(actor, id, algorithmLearningInput.parse(body));
  }
  @Get('problems/:id/editorial') editorial(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.editorial(actor, id);
  }
  @Put('problems/:id/draft') draft(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveDraft(actor, id, algorithmDraftInput.parse(body));
  }
  @Post('problems/:id/submissions')
  @HttpCode(201)
  submit(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.submit(actor, id, algorithmSubmissionInput.parse(body));
  }
  @Get('problems/:id/submissions') submissions(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.service.submissions(actor, id, algorithmSubmissionQuery.parse(query));
  }
  @Get('submissions/:id') submission(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.submission(actor, id);
  }
  @Post('problems/:id/analysis') analysis(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.analyze(actor, id, algorithmAnalysisInput.parse(body));
  }
  @Get('problems/:id/analyses') analyses(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.analyses(actor, id);
  }
}
