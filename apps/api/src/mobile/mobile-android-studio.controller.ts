import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { MobileAndroidStudioService } from './mobile-android-studio.service';
import * as schema from './mobile-android-studio.schemas';
@Controller('mobile/android-studio')
@UseGuards(AuthGuard)
export class MobileAndroidStudioController {
  constructor(private service: MobileAndroidStudioService) {}
  @Get('status') status(@CurrentActor() a: Actor) {
    return this.service.status(a);
  }
  @Get('templates') templates(@CurrentActor() a: Actor) {
    return this.service.templates(a);
  }
  @Get('projects') projects(@CurrentActor() a: Actor) {
    return this.service.projects(a);
  }
  @Post('projects') create(@CurrentActor() a: Actor, @Body() body: unknown) {
    return this.service.create(a, schema.nativeAndroidCreate.parse(body));
  }
  @Get('projects/:id') project(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.detail(a, schema.nativeAndroidId.parse(id));
  }
  @Get('projects/:id/files') files(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.service.files(
      a,
      schema.nativeAndroidId.parse(id),
      schema.nativeAndroidFileQuery.parse(query).path,
    );
  }
  @Get('projects/:id/file') file(@CurrentActor() a: Actor, @Param('id') id: string, @Query() query: unknown) {
    return this.service.file(
      a,
      schema.nativeAndroidId.parse(id),
      schema.nativeAndroidFileQuery.parse(query).path,
    );
  }
  @Put('projects/:id/file') save(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.save(a, schema.nativeAndroidId.parse(id), schema.nativeAndroidWrite.parse(body));
  }
  @Get('projects/:id/jobs') jobs(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.jobs(a, schema.nativeAndroidId.parse(id));
  }
  @Post('projects/:id/generate') generate(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(
      a,
      schema.nativeAndroidId.parse(id),
      schema.nativeAndroidGenerate.parse(body),
    );
  }
  @Get('jobs/:id') task(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.task(a, schema.nativeAndroidId.parse(id));
  }
  @Post('jobs/:id/cancel') cancel(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    schema.nativeAndroidEmpty.parse(body);
    return this.service.task(a, schema.nativeAndroidId.parse(id), true);
  }
  @Get('jobs/:id/approvals') approvals(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.approvals(a, schema.nativeAndroidId.parse(id));
  }
  @Post('jobs/:id/approvals/:approvalId') approve(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('approvalId') approvalId: string,
    @Body() body: unknown,
  ) {
    return this.service.approve(
      a,
      schema.nativeAndroidId.parse(id),
      schema.nativeAndroidId.parse(approvalId),
      schema.nativeAndroidApproval.parse(body).approved,
    );
  }
  @Get('projects/:id/build') buildStatus(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.buildStatus(a, schema.nativeAndroidId.parse(id));
  }
  @Post('projects/:id/build') build(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    schema.nativeAndroidEmpty.parse(body);
    return this.service.build(a, schema.nativeAndroidId.parse(id));
  }
  @Post('projects/:id/build/cancel') cancelBuild(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    schema.nativeAndroidEmpty.parse(body);
    return this.service.cancelBuild(a, schema.nativeAndroidId.parse(id));
  }
  @Get('projects/:id/logs/:logId') log(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('logId') logId: string,
  ) {
    return this.service.log(a, schema.nativeAndroidId.parse(id), schema.nativeAndroidId.parse(logId));
  }
  private async fileResponse(a: Actor, id: string, source: boolean, res: Response) {
    const out = await this.service.download(a, schema.nativeAndroidId.parse(id), source);
    res.set('Cache-Control', 'private, no-store').type(out.type).attachment(out.filename).send(out.body);
  }
  @Get('projects/:id/apk') apk(@CurrentActor() a: Actor, @Param('id') id: string, @Res() res: Response) {
    return this.fileResponse(a, id, false, res);
  }
  @Get('projects/:id/source') source(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    return this.fileResponse(a, id, true, res);
  }
}
