import { changePassword } from '../auth/change-password';
import { PrismaService } from '../common/prisma.service';
import {
  Body,
  Patch,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type Request } from 'express';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { AccountsService } from '../accounts/accounts.service';
import { z } from 'zod';
@Controller('mobile/organization')
@UseGuards(AuthGuard)
export class MobileOrganizationController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly db: PrismaService,
  ) {}
  private student(a: Actor) {
    if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT') throw new ForbiddenException('需要学生手机会话');
    return a;
  }
  @Patch('profile') async profile(@CurrentActor() a: Actor, @Body() b: unknown) {
    if (a.clientType !== 'MOBILE') throw new ForbiddenException();
    await this.accounts.updateProfile(a, b);
    return { ok: true };
  }
  @Post('password') async password(@CurrentActor() a: Actor, @Body() b: unknown, @Req() req: Request) {
    if (a.clientType !== 'MOBILE') throw new ForbiddenException();
    await changePassword(this.db, a, b, req.ip || 'unknown');
    return { loginRequired: true };
  }
  @Get() info(@CurrentActor() a: Actor) {
    return this.accounts.organization(this.student(a));
  }
  @Get('requests') list(@CurrentActor() a: Actor) {
    return this.accounts.requests(this.student(a));
  }
  @Post('requests') join(@CurrentActor() a: Actor, @Body() b: unknown, @Req() req: Request) {
    return this.accounts.apply(this.student(a), b, req.ip || 'unknown');
  }
  @Post('requests/:id/cancel') cancel(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    z.object({}).strict().parse(b);
    return this.accounts.cancel(this.student(a), id);
  }
  @Post('leave') leave(@CurrentActor() a: Actor, @Body() b: unknown) {
    z.object({}).strict().parse(b);
    return this.accounts.leave(this.student(a));
  }
}
