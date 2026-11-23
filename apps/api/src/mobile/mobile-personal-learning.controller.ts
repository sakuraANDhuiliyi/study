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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { NotesService } from '../notes/notes.service';
import { FocusController } from '../focus/focus.controller';
import { mobilePersonalNoteQuery, mobilePersonalLessonNoteQuery } from './mobile-personal-learning.schemas';
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
function mobile(actor: Actor) {
  if (actor.clientType !== 'MOBILE' || !['STUDENT', 'TEACHER'].includes(actor.role))
    throw new ForbiddenException('请使用学生或教师手机会话');
}
function noteDto(detail: Awaited<ReturnType<NotesService['read']>>) {
  const n = detail.note;
  return {
    ...detail,
    note: n
      ? { id: n.id, body: n.body, pinned: n.pinned, revision: n.revision, updatedAt: n.updatedAt }
      : null,
  };
}
@Controller('mobile/personal')
@UseGuards(AuthGuard)
export class MobilePersonalLearningController {
  private focus: FocusController;
  constructor(
    db: PrismaService,
    private notes: NotesService,
  ) {
    this.focus = new FocusController(db);
  }
  @Get('notes') list(@CurrentActor() a: Actor, @Query() q: unknown) {
    mobile(a);
    return this.notes.listCombined(a, mobilePersonalNoteQuery.parse(q));
  }
  @Get('notes/standalone') standalone(@CurrentActor() a: Actor, @Query() q: unknown) {
    mobile(a);
    return this.notes.listCombined(a, { ...mobilePersonalNoteQuery.parse(q), source: 'standalone' });
  }
  @Post('notes/standalone') create(@CurrentActor() a: Actor, @Body() body: unknown) {
    mobile(a);
    return this.notes.createStandalone(a, body);
  }
  @Get('notes/standalone/:id') read(@CurrentActor() a: Actor, @Param('id') id: string) {
    mobile(a);
    return this.notes.readStandalone(a, idSchema.parse(id));
  }
  @Patch('notes/standalone/:id') patch(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    mobile(a);
    return this.notes.updateStandalone(a, idSchema.parse(id), body);
  }
  @Delete('notes/standalone/:id') remove(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    mobile(a);
    return this.notes.removeStandalone(a, idSchema.parse(id), body);
  }
  @Get('lesson-notes') lessons(@CurrentActor() a: Actor, @Query() q: unknown) {
    mobile(a);
    return this.notes.list(a, mobilePersonalLessonNoteQuery.parse(q), true);
  }
  @Get('lessons/:id/note') async lesson(@CurrentActor() a: Actor, @Param('id') id: string) {
    mobile(a);
    return noteDto(await this.notes.read(a, idSchema.parse(id)));
  }
  @Put('lessons/:id/note') async saveLesson(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    mobile(a);
    return noteDto(await this.notes.save(a, idSchema.parse(id), body));
  }
  @Delete('lessons/:id/note') deleteLesson(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    mobile(a);
    return this.notes.remove(a, idSchema.parse(id), body);
  }
  @Get('focus/sessions') focusList(@CurrentActor() a: Actor, @Query() q: unknown) {
    mobile(a);
    return this.focus.list(a, q);
  }
  @Get('focus/summary') summary(@CurrentActor() a: Actor, @Query() q: unknown) {
    mobile(a);
    return this.focus.summary(a, q);
  }
  @Post('focus/sessions') focusCreate(@CurrentActor() a: Actor, @Body() body: unknown, @Query() q: unknown) {
    mobile(a);
    return this.focus.create(a, body, q);
  }
  @Get('focus/sessions/:id') focusRead(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    mobile(a);
    return this.focus.read(a, id, q);
  }
  @Delete('focus/sessions/:id') focusDelete(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
    @Body() body: unknown,
  ) {
    mobile(a);
    return this.focus.remove(a, id, q, body);
  }
}
