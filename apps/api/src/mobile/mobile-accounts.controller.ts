import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { MobileAccountsService } from './mobile-accounts.service';
import { assertPublicNativeAccountRequest } from './mobile-account.schemas';

@Controller('mobile/auth')
export class MobileAccountsController {
  constructor(private readonly accounts: MobileAccountsService) {}
  @Post('register')
  register(@Body() body: unknown, @Req() req: Request) {
    assertPublicNativeAccountRequest(req);
    return this.accounts.register(body, req.ip || 'unknown');
  }
  @Post('recover')
  recover(@Body() body: unknown, @Req() req: Request) {
    assertPublicNativeAccountRequest(req);
    return this.accounts.recover(body, req.ip || 'unknown');
  }
  @Get('recovery')
  @UseGuards(AuthGuard)
  recovery(@CurrentActor() actor: Actor) {
    return this.accounts.recovery(actor);
  }
  @Post('recovery-code')
  @UseGuards(AuthGuard)
  recoveryCode(@CurrentActor() actor: Actor, @Body() body: unknown, @Req() req: Request) {
    return this.accounts.recoveryCode(actor, body, req.ip || 'unknown');
  }
  @Get('sessions')
  @UseGuards(AuthGuard)
  sessions(@CurrentActor() actor: Actor) {
    return this.accounts.sessions(actor);
  }
  @Delete('sessions/:id')
  @UseGuards(AuthGuard)
  revoke(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.accounts.revoke(actor, id);
  }
  @Post('role')
  @UseGuards(AuthGuard)
  role(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.accounts.role(actor, body);
  }
}
