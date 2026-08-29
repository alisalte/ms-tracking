/**
 * Reporting REST API (Sprint J §19).
 *
 *   GET /api/v1/reports/fleet-overview       — KPI card aggregates (§6)
 *   GET /api/v1/reports/trend                — daily distance/trips/alarms (§13)
 *   GET /api/v1/reports/vehicle-utilization  — per-vehicle utilization (§7)
 *   GET /api/v1/reports/trips                — trip report (§9, cursor + sort whitelist)
 *   GET /api/v1/reports/distance             — distance report (§8)
 *   GET /api/v1/reports/speed                — speed report (§10)
 *   GET /api/v1/reports/idle-parking         — idle/parking periods (§11)
 *   GET /api/v1/reports/alarms               — alarm aggregates (§12)
 *   GET /api/v1/reports/alarm-trend          — daily alarm buckets (§13)
 *   GET /api/v1/reports/geofences            — geofence event aggregates (§14)
 *   GET /api/v1/reports/vehicle-meters       — odometer / engine-hours / stop durations
 *   GET /api/v1/reports/activity             — activity timeline (§15)
 *   GET /api/v1/reports/kpis                 — executive KPI scorecard vs prior window
 *   GET /api/v1/reports/fleet-comparison     — per-fleet distance/trips/utilization
 *   GET /api/v1/reports/safety               — safety indicators from the alarm engine
 *   GET /api/v1/reports/export/:report       — CSV export (§31; report.export)
 *
 * Reads require `report.read`; export requires `report.export`. Tenant ALWAYS
 * from the verified principal. All inputs validated (window §16, filters §20,
 * pagination §21, whitelisted sorting §22); errors are controlled 400s.
 */
import { CurrentTenant, CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportInputError, type ReportService } from '../application/report.service.js';
import { REPORT_SERVICE } from './tokens.js';

@Controller('api/v1/reports')
export class ReportsController {
  constructor(@Inject(REPORT_SERVICE) private readonly reports: ReportService) {}

  @Get('fleet-overview')
  @RequirePermissions('report.read')
  public async fleetOverview(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
  ) {
    return this.guard(async () =>
      this.reports.fleetOverview(tenantId, { preset, from, to, vehicleId, fleetId }),
    );
  }

  @Get('trend')
  @RequirePermissions('report.read')
  public async trend(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
  ) {
    return this.guard(async () =>
      this.reports.trend(tenantId, { preset, from, to, vehicleId, fleetId }),
    );
  }

  @Get('vehicle-utilization')
  @RequirePermissions('report.read')
  public async vehicleUtilization(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
    @Query('sort') sort?: string,
  ) {
    return this.guard(async () =>
      this.reports.vehicleUtilization(tenantId, { preset, from, to, vehicleId, fleetId, sort }),
    );
  }

  @Get('trips')
  @RequirePermissions('report.read')
  public async trips(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.guard(async () =>
      this.reports.trips(tenantId, { preset, from, to, vehicleId, fleetId, sort, limit, cursor }),
    );
  }

  @Get('distance')
  @RequirePermissions('report.read')
  public async distance(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.guard(async () =>
      this.reports.distance(tenantId, { preset, from, to, vehicleId, fleetId, limit, offset }),
    );
  }

  @Get('speed')
  @RequirePermissions('report.read')
  public async speed(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.guard(async () =>
      this.reports.speed(tenantId, { preset, from, to, vehicleId, fleetId, limit, offset }),
    );
  }

  @Get('idle-parking')
  @RequirePermissions('report.read')
  public async idleParking(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.guard(async () =>
      this.reports.idleParking(tenantId, {
        preset,
        from,
        to,
        vehicleId,
        fleetId,
        kind,
        limit,
        cursor,
      }),
    );
  }

  @Get('alarms')
  @RequirePermissions('report.read')
  public async alarms(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.guard(async () =>
      this.reports.alarms(tenantId, {
        preset,
        from,
        to,
        vehicleId,
        fleetId,
        type,
        severity,
        limit,
        offset,
      }),
    );
  }

  @Get('alarm-trend')
  @RequirePermissions('report.read')
  public async alarmTrend(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
  ) {
    return this.guard(async () =>
      this.reports.alarmTrend(tenantId, { preset, from, to, vehicleId, fleetId }),
    );
  }

  @Get('geofences')
  @RequirePermissions('report.read')
  public async geofences(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('geofenceId') geofenceId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.guard(async () =>
      this.reports.geofences(tenantId, { preset, from, to, vehicleId, geofenceId, limit, offset }),
    );
  }

  @Get('vehicle-meters')
  @RequirePermissions('report.read')
  public async vehicleMeters(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.guard(async () =>
      this.reports.vehicleMeters(tenantId, { preset, from, to, vehicleId, fleetId, limit, offset }),
    );
  }

  @Get('activity')
  @RequirePermissions('report.read')
  public async activity(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.guard(async () =>
      this.reports.activity(tenantId, { preset, from, to, vehicleId, limit, cursor }),
    );
  }

  @Get('kpis')
  @RequirePermissions('report.read')
  public async kpis(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
  ) {
    return this.guard(async () =>
      this.reports.kpiScorecard(tenantId, { preset, from, to, vehicleId, fleetId }),
    );
  }

  @Get('fleet-comparison')
  @RequirePermissions('report.read')
  public async fleetComparison(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.guard(async () => this.reports.fleetComparison(tenantId, { preset, from, to }));
  }

  @Get('safety')
  @RequirePermissions('report.read')
  public async safety(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.guard(async () => this.reports.safetyScorecard(tenantId, { preset, from, to }));
  }

  /** CSV export (§31/§32) — rate-limited, audited, streaming-friendly body. */
  @Get('export/:report')
  @RequirePermissions('report.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  public async exportCsv(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Param('report') report: string,
    @Res({ passthrough: true }) res: Response,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('fleetId') fleetId?: string,
    @Query('sort') sort?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
  ): Promise<string> {
    if (report !== 'trips' && report !== 'vehicle-utilization' && report !== 'alarms') {
      throw new HttpException(
        'report must be trips | vehicle-utilization | alarms',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.guard(async () =>
      this.reports.exportCsv(tenantId, user?.userId ?? null, report, {
        preset,
        from,
        to,
        vehicleId,
        fleetId,
        sort,
        type,
        severity,
      }),
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.csv;
  }

  /** Controlled 400s for input errors; db timeouts surface as 503 (§45/§46). */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ReportInputError) {
        throw new HttpException({ message: err.message, code: err.code }, HttpStatus.BAD_REQUEST);
      }
      const msg = String((err as Error)?.message ?? '');
      if (/statement timeout|canceling statement/i.test(msg)) {
        throw new HttpException(
          'Report query exceeded its time budget — narrow the range',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw err;
    }
  }
}
