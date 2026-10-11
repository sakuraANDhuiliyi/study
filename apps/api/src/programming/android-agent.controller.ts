import { All, Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { AndroidAgentService } from './android-agent.service';
@Controller('programming/android')
@UseGuards(AuthGuard)
export class AndroidAgentController {
  constructor(private readonly agent: AndroidAgentService) {}
  @Get('status') status(@CurrentActor() actor: Actor) {
    return this.agent.status(actor);
  }
  @Get('workbench/:asset') async asset(
    @CurrentActor() actor: Actor,
    @Param('asset') asset: string,
    @Res() res: Response,
  ) {
    const output = await this.agent.asset(actor, asset);
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(output.type).send(output.body);
  }
  @All('bridge/*path') async proxy(@CurrentActor() actor: Actor, @Req() req: Request, @Res() res: Response) {
    const prefix = '/api/programming/android/bridge/';
    const path = req.path.slice(prefix.length);
    const query = req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?').slice(1).join('?') : '';
    const out = await this.agent.request(actor, path, req.method, query, req.body);
    res.setHeader('Cache-Control', 'private, no-store');
    if (out.download) res.attachment(path.endsWith('/source.zip') ? 'android-source.zip' : 'android-app.apk');
    res.status(out.status).type(out.type).send(out.body);
  }
}
