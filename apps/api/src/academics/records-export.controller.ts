import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AcademicRecordExportService } from './records-export.service';

@ApiTags('专业学习记录导出')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller('academics/records')
export class AcademicRecordExportController {
  constructor(private readonly exports: AcademicRecordExportService) {}
  @Post('export')
  @HttpCode(200)
  async export(@CurrentActor() actor: Actor, @Body() body: unknown, @Res() response: Response) {
    const output = await this.exports.export(actor, body);
    response.setHeader('X-Export-Matched-Count', output.matchedCount);
    response.setHeader('X-Export-Record-Count', output.recordCount);
    response.setHeader('X-Export-Truncated', String(output.truncated));
    response.type(output.contentType).attachment(output.filename).send(output.buffer);
  }
}
