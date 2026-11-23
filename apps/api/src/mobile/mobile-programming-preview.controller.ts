import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { ProgrammingService } from '../programming/programming.service';
import { ProgrammingPreviewService } from '../programming/programming-preview.service';
import { AuthService } from '../auth/auth.service';
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
@Controller('mobile/programming-preview')
@UseGuards(AuthGuard)
export class MobileProgrammingPreviewController {
  constructor(
    private programming: ProgrammingService,
    private previews: ProgrammingPreviewService,
    private auth: AuthService,
  ) {}
  private async actor(a: Actor) {
    if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT') throw new ForbiddenException('请使用学生手机会话');
    const current = a.sessionId ? await this.auth.resolveMobileSessionId(a.sessionId) : null;
    if (
      !current ||
      current.id !== a.id ||
      current.organizationId !== a.organizationId ||
      current.role !== a.role ||
      current.accountMode !== a.accountMode
    )
      throw new ForbiddenException('当前手机会话已变化');
    this.auth.require(current, 'learning.use');
    await this.auth.checkFeature(current, '/api/programming');
    return current;
  }
  @Get('status') async status(@CurrentActor() a: Actor) {
    await this.actor(a);
    return this.previews.status();
  }
  @Post('projects/:id') async issue(
    @CurrentActor() a: Actor,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const input = z
        .object({ revision: z.number().int().min(0) })
        .strict()
        .parse(body),
      id = idSchema.parse(raw),
      actor = await this.actor(a),
      project = await this.programming.detail(actor, id);
    const out = await this.programming.preview(actor, id, { revision: input.revision, files: project.files });
    await this.actor(a);
    return { ...out, origin: this.previews.status().origin };
  }
}
