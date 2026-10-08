import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AccountsService } from './accounts.service';

@ApiTags('个人账号与机构加入')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly accounts: AccountsService) {}
  @Get('organization') organization(@CurrentActor() actor: Actor) {
    return this.accounts.organization(actor);
  }
  @Get('join-requests') requests(@CurrentActor() actor: Actor) {
    return this.accounts.requests(actor);
  }
  @Post('join-requests') apply(@CurrentActor() actor: Actor, @Body() body: unknown, @Req() request: Request) {
    return this.accounts.apply(actor, body, request.ip || 'unknown');
  }
  @Post('join-requests/:id/cancel') cancel(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.accounts.cancel(actor, id);
  }
  @Post('leave-organization') async leave(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    z.object({}).strict().parse(body);
    const result = await this.accounts.leave(actor);
    response.clearCookie('lms_session', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
    });
    return result;
  }
}

@ApiTags('机构加入申请管理')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('admin')
export class AdminAccountController {
  constructor(private readonly accounts: AccountsService) {}
  @Get('join-settings') settings(@CurrentActor() actor: Actor) {
    return this.accounts.joinSettings(actor);
  }
  @Patch('join-settings') updateSettings(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const input = z.object({ joinEnabled: z.boolean() }).strict().parse(body);
    return this.accounts.updateJoinSettings(actor, input.joinEnabled);
  }
  @Post('join-settings/rotate-code') rotate(@CurrentActor() actor: Actor, @Body() body: unknown) {
    z.object({}).strict().parse(body);
    return this.accounts.updateJoinSettings(actor, undefined, true);
  }
  @Get('join-requests') requests(@CurrentActor() actor: Actor, @Query() query: Record<string, string>) {
    return this.accounts.adminRequests(actor, query);
  }
  @Patch('join-requests/:id') review(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.accounts.review(actor, id, body);
  }
}
