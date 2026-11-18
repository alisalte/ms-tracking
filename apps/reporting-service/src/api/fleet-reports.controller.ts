/**
 * Fleet-wide tabular reports.
 *
 *   GET /api/v1/reports/overspeed            — high speeds of every vehicle (limitKmh, minDurationSec)
 *   GET /api/v1/reports/mileage              — km per vehicle, fleet subtotals, grand total (hideZero)
 *   GET /api/v1/reports/temperature          — probe readings outside the allowed band (minC, maxC, minDurationSec)
 *   GET /api/v1/reports/objects              — every vehicle with its tracker and newest fix (live status)
 *   GET /api/v1/reports/objects/csv          — the same as CSV in the legacy column order (report.export)
 *   GET /api/v1/reports/workbook/:report     — any of the four as .xlsx (lang=fa|en; report.export)
 *
 * Every endpoint takes the shared window (preset | from+to) and the optional
 * vehicleId / fleetId filter. Tenant always from the verified principal.
 */
import { CurrentTenant, CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import type { FleetReportQuery, FleetReportService } from '../application/fleet-report.service.js';
import { ReportInputError } from '../application/report.service.js';
import { XLSX_MIME } from '../domain/xlsx.js';
import { FLEET_REPORT_SERVICE } from './tokens.js';

@Controller('api/v1/reports')
export class FleetReportsController {
  constructor(@Inject(FLEET_REPORT_SERVICE) private readonly reports: FleetReportService) {}

  @Get('overspeed')
  @RequirePermissions('report.read')
  public async overspeed(@CurrentTenant() tenantId: string, @Query() q: FleetReportQuery) {
    return this.guard(() => this.reports.overspeed(tenantId, pick(q)));
  }

  @Get('mileage')
  @RequirePermissions('report.read')
  public async mileage(@CurrentTenant() tenantId: string, @Query() q: FleetReportQuery) {
    return this.guard(() => this.reports.mileage(tenantId, pick(q)));
  }

  @Get('temperature')
  @RequirePermissions('report.read')
  public async temperature(@CurrentTenant() tenantId: string, @Query() q: FleetReportQuery) {
    return this.guard(() => this.reports.temperature(tenantId, pick(q)));
  }

  @Get('objects')
  @RequirePermissions('report.read')
  public async objects(@CurrentTenant() tenantId: string, @Query() q: FleetReportQuery) {
    return this.guard(() => this.reports.objects(tenantId, pick(q)));
  }

  /** The objects list as CSV, in the previous system's column order. */
  @Get('objects/csv')
  @RequirePermissions('report.export')
  public async objectsCsv(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Res({ passthrough: true }) res: Response,
    @Query() q: FleetReportQuery & { lang?: string },
  ): Promise<string> {
    const result = await this.guard(() =>
      this.reports.objectsCsv(
        tenantId,
        user?.userId ?? null,
        pick(q),
        q.lang === 'en' ? 'en' : 'fa',
      ),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.csv;
  }

  @Get('workbook/:report')
  @RequirePermissions('report.export')
  public async workbook(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Param('report') report: string,
    @Res({ passthrough: true }) res: Response,
    @Query() q: FleetReportQuery & { lang?: string },
  ): Promise<StreamableFile> {
    const result = await this.guard(() =>
      this.reports.workbook(
        tenantId,
        user?.userId ?? null,
        report,
        pick(q),
        q.lang === 'en' ? 'en' : 'fa',
      ),
    );
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return new StreamableFile(Buffer.from(result.bytes));
  }

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

/** Only the known query keys, as single strings (a repeated key keeps its first value). */
function pick(query: object): FleetReportQuery {
  const q = query as Record<string, unknown>;
  const one = (v: unknown): string | undefined =>
    Array.isArray(v) ? one(v[0]) : typeof v === 'string' ? v : undefined;
  return {
    preset: one(q.preset),
    from: one(q.from),
    to: one(q.to),
    vehicleId: one(q.vehicleId),
    fleetId: one(q.fleetId),
    limitKmh: one(q.limitKmh),
    minDurationSec: one(q.minDurationSec),
    hideZero: one(q.hideZero),
    minC: one(q.minC),
    maxC: one(q.maxC),
  };
}
