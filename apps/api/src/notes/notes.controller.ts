import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
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
    return this.notes.list(actor, query);
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
