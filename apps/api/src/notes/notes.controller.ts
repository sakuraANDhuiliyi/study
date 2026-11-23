import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { NotesService } from './notes.service';
export { noteInput } from './notes.schemas';
@ApiTags('私人学习笔记')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller()
export class NotesController {
  constructor(private readonly notes: NotesService) {}
  @Get('notes')
  list(@CurrentActor() actor: Actor, @Query() query: Record<string, string>) {
    return 'source' in query ? this.notes.listCombined(actor, query) : this.notes.list(actor, query);
  }
  @Get('notes/standalone')
  listStandalone(@CurrentActor() actor: Actor, @Query() query: Record<string, string>) {
    return this.notes.listCombined(actor, { ...query, source: 'standalone' });
  }
  @Post('notes/standalone')
  createStandalone(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.notes.createStandalone(actor, body);
  }
  @Get('notes/standalone/:id')
  readStandalone(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.notes.readStandalone(actor, id);
  }
  @Patch('notes/standalone/:id')
  updateStandalone(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.notes.updateStandalone(actor, id, body);
  }
  @Delete('notes/standalone/:id')
  removeStandalone(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.notes.removeStandalone(actor, id, body);
  }
  @Get('lessons/:id/note')
  read(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.notes.read(actor, id);
  }
  @Put('lessons/:id/note')
  save(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.notes.save(actor, id, body);
  }
  @Delete('lessons/:id/note')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.notes.remove(actor, id, body);
  }
}
