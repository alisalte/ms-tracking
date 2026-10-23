/**
 * Mine operations reads.
 *
 *   GET /api/v1/reports/device-activity   — first fix, volume, offline, distance
 *   GET /api/v1/reports/haul-cycles       — origin → destination services
 *   GET /api/v1/reports/haul-periods      — services per day / week / month
 *   GET /api/v1/reports/haul-analysis     — wasted time, idle stops, driver and shovel scores
 *
 * All require `report.read`. Responses are raw (no `{ data }` envelope),
 * matching the rest of the reporting API.
 */
import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
import { Controller, Get, HttpException, HttpStatus, Inject, Query } from '@nestjs/common';
import type { OperationsReportService } from '../application/operations-report.service.js';
import { ReportInputError } from '../application/report.service.js';
import { OPERATIONS_REPORT_SERVICE } from './tokens.js';

@Controller('api/v1/reports')
export class OperationsReportsController {
  constructor(
    @Inject(OPERATIONS_REPORT_SERVICE) private readonly operations: OperationsReportService,
  ) {}

  @Get('device-activity')
  @RequirePermissions('report.read')
  public async deviceActivity(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.guard(() => this.operations.deviceActivity(tenantId, { preset, from, to }));
  }

  @Get('haul-cycles')
  @RequirePermissions('report.read')
  public async haulCycles(
    @CurrentTenant() tenantId: string,
    @Query('routeId') routeId?: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.guard(() => this.operations.haulCycles(tenantId, routeId, { preset, from, to }));
  }

  @Get('haul-periods')
  @RequirePermissions('report.read')
  public async haulPeriods(
    @CurrentTenant() tenantId: string,
    @Query('routeId') routeId?: string,
    @Query('granularity') granularity?: string,
    @Query('calendar') calendar?: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.guard(() =>
      this.operations.haulPeriods(tenantId, routeId, {
        preset,
        from,
        to,
        granularity,
        calendar,
      }),
    );
  }

  @Get('haul-analysis')
  @RequirePermissions('report.read')
  public async haulAnalysis(
    @CurrentTenant() tenantId: string,
    @Query('routeId') routeId?: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('targetLoadMin') targetLoadMin?: string,
    @Query('targetTravelMin') targetTravelMin?: string,
    @Query('targetUnloadMin') targetUnloadMin?: string,
    @Query('targetReturnMin') targetReturnMin?: string,
    @Query('stopMin') stopMin?: string,
  ) {
    return this.guard(() =>
      this.operations.haulAnalysis(tenantId, routeId, {
        preset,
        from,
        to,
        targetLoadMin,
        targetTravelMin,
        targetUnloadMin,
        targetReturnMin,
        stopMin,
      }),
    );
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
