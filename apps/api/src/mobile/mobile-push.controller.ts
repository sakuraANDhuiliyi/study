import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { MobilePushService } from './mobile-push.service';
import { mobilePushBindInput, mobilePushEmpty } from './mobile-push.schemas';
@Controller('mobile/push')
@UseGuards(AuthGuard)
export class MobilePushController {
  constructor(private service: MobilePushService) {}
  @Get('status') status(@CurrentActor() a: Actor) {
    return this.service.status(a);
  }
  @Post('device') bind(@CurrentActor() a: Actor, @Body() input: unknown) {
    return this.service.bind(a, mobilePushBindInput.parse(input));
  }
  @Delete('device') remove(@CurrentActor() a: Actor, @Body() input: unknown) {
    mobilePushEmpty.parse(input || {});
    return this.service.remove(a);
  }
}
