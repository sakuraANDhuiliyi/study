import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AdminController } from '../admin/admin.controller';
import { CommunicationService } from '../communication/communication.service';
import * as policy from './mobile-admin-controls.policy';

@Controller('mobile/admin-controls')
@UseGuards(AuthGuard)
export class MobileAdminControlsController {
  constructor(
    private readonly auth: AuthService,
    private readonly admin: AdminController,
    private readonly communication: CommunicationService,
  ) {}
  private async current(actor: Actor, permission: string, communication = false) {
    if (
      actor.clientType !== 'MOBILE' ||
      actor.accountMode !== 'ORGANIZATION' ||
      !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)
    )
      throw new ForbiddenException('请使用机构管理员手机身份');
    const fresh = await this.auth.resolveMobileSessionId(actor.sessionId!);
    if (
      !fresh ||
      fresh.id !== actor.id ||
      fresh.role !== actor.role ||
      fresh.organizationId !== actor.organizationId ||
      fresh.accountMode !== 'ORGANIZATION'
    )
      throw new UnauthorizedException('管理身份已变化，请重新登录');
    this.auth.require(fresh, permission);
    if (communication) await this.auth.checkFeature(fresh, '/api/communication');
    return fresh;
  }
  @Get('reports') async reports(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const q = policy.mobileAdminReportQuery.parse(query);
    const result = await this.communication.reports(
      await this.current(actor, 'communication.moderate', true),
      q.page,
      q.pageSize,
      q.status,
    );
    await this.current(actor, 'communication.moderate', true);
    return result;
  }
  @Post('reports/:id/resolve') async resolve(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = policy.mobileAdminReportResolution.parse(body);
    return this.communication.resolveReport(
      await this.current(actor, 'communication.moderate', true),
      policy.mobileAdminId.parse(id),
      input.action,
      input.reason,
    );
  }
  @Get('audit') async audit(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const { page, pageSize, ...filters } = policy.mobileAdminAuditQuery.parse(query);
    const result = await this.admin.auditList(await this.current(actor, 'audit.read'), {
      ...filters,
      page: String(page),
      pageSize: String(pageSize),
    });
    return {
      ...result,
      items: result.items.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        actorName: r.actorName,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        requestId: r.requestId,
      })),
    };
  }
  @Get('settings') async settings(@CurrentActor() actor: Actor) {
    const result = await this.admin.settings(await this.current(actor, 'settings.org'));
    await this.current(actor, 'settings.org');
    return {
      items: result.items
        .filter((row) => (policy.mobileAdminSettingKeys as readonly string[]).includes(row.key))
        .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt })),
    };
  }
  @Patch('settings') async updateSettings(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const input = policy.mobileAdminSettingInput.parse(body);
    // The existing controller additionally requires settings.platform for security/feature keys and audits the reason.
    const result = await this.admin.settingsUpdate(await this.current(actor, 'settings.org'), input);
    return { key: result.key, value: result.value, updatedAt: result.updatedAt };
  }
}
