import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { liveHand, livePresence, liveRevision } from './live.schemas';
import { LiveService } from './live.service';

@ApiTags('互动直播课堂')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('live')
export class LiveController {
  constructor(private live: LiveService) {}
  @Get('status') status() {
    return this.live.status();
  }
  @Get('classes')
  @ApiOperation({ summary: '分页列出当前授权课程的直播预约及历史' })
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.live.list(a, q);
  }
  @Post('classes') create(@CurrentActor() a: Actor, @Body() body: unknown) {
    return this.live.create(a, body);
  }
  @Get('classes/:id') detail(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.live.detail(a, id);
  }
  @Post('classes/:id/start') start(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.live.start(a, id, liveRevision.parse(body).revision);
  }
  @Post('classes/:id/end') end(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.live.end(a, id, liveRevision.parse(body).revision);
  }
  @Post('classes/:id/join') join(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    liveRevision.pick({}).parse(body);
    return this.live.join(a, id);
  }
  @Post('classes/:id/heartbeat') heartbeat(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.live.presence(a, id, 'heartbeat', livePresence.parse(body).connectionId);
  }
  @Post('classes/:id/leave') leave(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.live.presence(a, id, 'leave', livePresence.parse(body).connectionId);
  }
  @Post('classes/:id/hand') hand(@CurrentActor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = liveHand.parse(body);
    return this.live.presence(a, id, 'raise', b.connectionId, b.raised);
  }
  @Post('classes/:id/members/:memberId') moderate(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: unknown,
  ) {
    return this.live.moderate(a, id, memberId, body);
  }
  @Post('classes/:id/messages') message(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.live.message(a, id, body);
  }
  @Post('classes/:id/revoke-all') revokeAll(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    liveRevision.pick({}).parse(body);
    return this.live.revokeAll(a, id);
  }
}
