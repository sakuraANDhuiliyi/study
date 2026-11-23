import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { ProgrammingService } from '../programming/programming.service';
import * as schema from '../programming/programming.schemas';
import { programmingBackupSchema } from '../programming/programming.backup';
import { creativeFavoriteInput, creativeProjectInput } from '../programming/creative.schemas';
import {
  mobileCreativeQuery,
  mobileProgrammingId,
  mobileProgrammingQuery,
} from './mobile-programming.policy';
@Controller('mobile/programming')
@UseGuards(AuthGuard)
export class MobileProgrammingController {
  constructor(
    private readonly auth: AuthService,
    private readonly service: ProgrammingService,
  ) {}
  private async current(actor: Actor) {
    if (actor.clientType !== 'MOBILE' || actor.role !== 'STUDENT')
      throw new ForbiddenException('请使用学生手机身份');
    const fresh = await this.auth.resolveMobileSessionId(actor.sessionId!);
    if (
      !fresh ||
      fresh.id !== actor.id ||
      fresh.organizationId !== actor.organizationId ||
      fresh.role !== actor.role
    )
      throw new UnauthorizedException('学习身份已变化，请重新登录');
    this.auth.require(fresh, 'learning.use');
    await this.auth.checkFeature(fresh, '/api/programming');
    return fresh;
  }
  private async read<T>(actor: Actor, query: (fresh: Actor) => Promise<T>) {
    const result = await query(await this.current(actor));
    await this.current(actor);
    return result;
  }
  @Get('status') status(@CurrentActor() actor: Actor) {
    return this.read(actor, async (fresh) => {
      const { ai, limits } = await this.service.status(fresh);
      return { ai, limits };
    });
  }
  @Get('templates') templates(@CurrentActor() actor: Actor) {
    return this.read(actor, (fresh) => this.service.templates(fresh));
  }
  @Get('projects') list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.read(actor, (fresh) => this.service.list(fresh, mobileProgrammingQuery.parse(query)));
  }
  @Post('projects') async create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.create(await this.current(actor), schema.programmingCreateInput.parse(body));
  }
  @Post('projects/import') async import(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.importProject(await this.current(actor), programmingBackupSchema.parse(body));
  }
  @Get('projects/:id') detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.read(actor, (fresh) => this.service.detail(fresh, mobileProgrammingId.parse(id)));
  }
  @Patch('projects/:id') async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(
      await this.current(actor),
      mobileProgrammingId.parse(id),
      schema.programmingUpdateInput.parse(body),
    );
  }
  @Delete('projects/:id') async remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.remove(await this.current(actor), mobileProgrammingId.parse(id));
  }
  @Post('projects/:id/duplicate') async duplicate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.duplicate(
      await this.current(actor),
      mobileProgrammingId.parse(id),
      schema.programmingDuplicateInput.parse(body),
    );
  }
  @Get('projects/:id/versions') versions(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.read(actor, (fresh) => this.service.versions(fresh, mobileProgrammingId.parse(id)));
  }
  @Get('projects/:id/versions/:versionId') version(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.read(actor, (fresh) =>
      this.service.version(fresh, mobileProgrammingId.parse(id), mobileProgrammingId.parse(versionId)),
    );
  }
  @Post('projects/:id/versions') async saveVersion(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveVersion(
      await this.current(actor),
      mobileProgrammingId.parse(id),
      schema.programmingVersionInput.parse(body),
    );
  }
  @Post('projects/:id/restore') async restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.restore(
      await this.current(actor),
      mobileProgrammingId.parse(id),
      schema.programmingRestoreInput.parse(body),
    );
  }
  @Get('projects/:id/backup') async backup(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const out = await this.read(actor, (fresh) => this.service.backup(fresh, mobileProgrammingId.parse(id)));
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('application/json').attachment(out.filename).send(JSON.stringify(out.bundle));
  }
  @Get('projects/:id/export') async export(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const out = await this.read(actor, (fresh) => this.service.export(fresh, mobileProgrammingId.parse(id)));
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('application/zip').attachment(out.filename).send(out.buffer);
  }
  @Get('projects/:id/ai-drafts') drafts(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.read(actor, (fresh) => this.service.drafts(fresh, mobileProgrammingId.parse(id)));
  }
  @Get('projects/:id/ai-drafts/:draftId') draft(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('draftId') draftId: string,
  ) {
    return this.read(actor, (fresh) =>
      this.service.draft(fresh, mobileProgrammingId.parse(id), mobileProgrammingId.parse(draftId)),
    );
  }
  @Post('projects/:id/ai-drafts') async generate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(
      await this.current(actor),
      mobileProgrammingId.parse(id),
      schema.programmingAiInput.parse(body),
    );
  }
  @Post('projects/:id/ai-drafts/:draftId/apply') async apply(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
  ) {
    return this.service.apply(
      await this.current(actor),
      mobileProgrammingId.parse(id),
      mobileProgrammingId.parse(draftId),
      schema.programmingApplyInput.parse(body),
    );
  }
  @Get('creative') creative(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.read(actor, (fresh) => this.service.creativeList(fresh, mobileCreativeQuery.parse(query)));
  }
  @Get('creative/:id') idea(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.read(actor, (fresh) => this.service.creativeDetail(fresh, mobileProgrammingId.parse(id)));
  }
  @Put('creative/:id/favorite') async favorite(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.creativeFavorite(
      await this.current(actor),
      mobileProgrammingId.parse(id),
      creativeFavoriteInput.parse(body),
    );
  }
  @Post('creative/:id/projects') async fromIdea(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.creativeProject(
      await this.current(actor),
      mobileProgrammingId.parse(id),
      creativeProjectInput.parse(body),
    );
  }
  @Get('creative/:id/export') async exportIdea(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const out = await this.read(actor, (fresh) =>
      this.service.creativeExport(fresh, mobileProgrammingId.parse(id)),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('application/zip').attachment(out.filename).send(out.buffer);
  }
}
