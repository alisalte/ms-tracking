import {
  type PageRequestDto,
  RequirePermissions,
  type UuidParamDto,
  ZodValidationPipe,
  getPrincipal,
  pageRequestSchema,
  uuidParamSchema,
} from '@fleetvision/auth';
import { METRICS_TOKEN, type TelemetryMetrics } from '@fleetvision/observability';
import { decodeCursor } from '@fleetvision/shared-kernel';
/**
 * Alarms controller — alarm list/detail + acknowledge/resolve lifecycle.
 * Base /api/v1/notification/alerts. All routes require JWT + permissions.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AlarmNotFoundError } from '../domain/index.js';
import type { AlarmListFilters } from '../infrastructure/persistence/alarm-occurrence.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { AlarmEvidenceService } from '../application/alarm-evidence.service.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { AlarmOccurrenceRepository } from '../infrastructure/persistence/alarm-occurrence.repository.js';
import type { AlarmRealtimeGateway } from '../infrastructure/websocket/alarm-realtime.gateway.js';
import { type ResolveAlarmDto, resolveAlarmSchema } from './notification.dto.js';
import { ALARM_REALTIME_GATEWAY } from './notification.tokens.js';

@Controller('api/v1/notification/alerts')
export class AlarmsController {
  constructor(
    private readonly alarms: AlarmOccurrenceRepository,
    private readonly evidence: AlarmEvidenceService,
    @Optional()
    @Inject(ALARM_REALTIME_GATEWAY)
    private readonly gateway: AlarmRealtimeGateway | null,
    @Optional() @Inject(METRICS_TOKEN) private readonly metrics: TelemetryMetrics | null,
  ) {}

  @Get()
  @RequirePermissions('notification.alert.read')
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: Request,
  ) {
    const p = getPrincipal(req as Request);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { raisedAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    const filters: AlarmListFilters = {};
    if (status) filters.status = status as AlarmListFilters['status'];
    if (severity) filters.severity = severity as AlarmListFilters['severity'];
    if (vehicleId) filters.vehicleId = vehicleId;
    if (from) filters.from = new Date(from);
    if (to) filters.to = new Date(to);
    return this.alarms.listPage(p.tenantId, page.limit, filters, cursor);
  }

  @Get(':id/evidence')
  @RequirePermissions('notification.alert.read')
  public async getEvidence(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const alarm = await this.alarms.findById(p.tenantId, params.id);
    if (!alarm) throw new AlarmNotFoundError();
    const row = await this.evidence.getForAlert(p.tenantId, params.id);
    return { data: row };
  }

  @Get(':id/evidence/photo')
  @RequirePermissions('notification.alert.read')
  public async getEvidencePhoto(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const p = getPrincipal(req);
    const alarm = await this.alarms.findById(p.tenantId, params.id);
    if (!alarm) throw new AlarmNotFoundError();
    const photo = await this.evidence.getPhoto(p.tenantId, params.id);
    if (!photo) {
      throw new HttpException('Evidence photo not available', HttpStatus.NOT_FOUND);
    }
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${photo.filename}"`);
    res.send(photo.bytes);
  }

  @Get(':id')
  @RequirePermissions('notification.alert.read')
  public async get(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const alarm = await this.alarms.findById(p.tenantId, params.id);
    if (!alarm) throw new AlarmNotFoundError();
    return { data: alarm };
  }

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification.alert.ack')
  public async acknowledge(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const alarm = await this.alarms.findById(p.tenantId, params.id);
    if (!alarm) throw new AlarmNotFoundError();
    const prev = alarm.status;
    alarm.acknowledge(p.userId);
    await this.alarms.updateStatus(alarm, 'ACKNOWLEDGE', prev, alarm.status, p.userId);
    this.metrics?.alarmsAcknowledged.inc({ actor: 'user' });
    this.gateway?.emitAlarmAcknowledged(p.tenantId, alarm);
    return { data: { id: alarm.id, status: alarm.status } };
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification.alert.resolve')
  public async resolve(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Body(new ZodValidationPipe(resolveAlarmSchema)) body: ResolveAlarmDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const alarm = await this.alarms.findById(p.tenantId, params.id);
    if (!alarm) throw new AlarmNotFoundError();
    const prev = alarm.status;
    alarm.resolve(p.userId, body.reason);
    await this.alarms.updateStatus(alarm, 'RESOLVE', prev, alarm.status, p.userId, body.reason);
    this.metrics?.alarmsResolved.inc({ actor: 'user' });
    this.gateway?.emitAlarmResolved(p.tenantId, alarm);
    return { data: { id: alarm.id, status: alarm.status } };
  }
}
