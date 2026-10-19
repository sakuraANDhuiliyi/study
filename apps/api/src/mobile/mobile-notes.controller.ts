import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { NotesService } from '../notes/notes.service';
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
function student(a: Actor) {
  if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT') throw new ForbiddenException('请使用学生手机会话');
}
function detail(d: Awaited<ReturnType<NotesService['read']>>) {
  const n = d.note;
  return {
    ...d,
    note: n
      ? { id: n.id, body: n.body, pinned: n.pinned, revision: n.revision, updatedAt: n.updatedAt }
      : null,
  };
}
@Controller('mobile')
@UseGuards(AuthGuard)
export class MobileNotesController {
  constructor(private readonly notes: NotesService) {}
  @Get('notes')
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    student(a);
    return this.notes.list(a, q, true);
  }
  @Get('lessons/:id/note')
  async read(@CurrentActor() a: Actor, @Param('id') id: string) {
    student(a);
    return detail(await this.notes.read(a, idSchema.parse(id)));
  }
  @Put('lessons/:id/note')
  async save(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    student(a);
    return detail(await this.notes.save(a, idSchema.parse(id), body));
  }
  @Delete('lessons/:id/note')
  remove(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    student(a);
    return this.notes.remove(a, idSchema.parse(id), body);
  }
}
