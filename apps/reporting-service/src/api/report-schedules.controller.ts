/**
 * Report schedules REST API (Phase 1 / F-05).
 *
 *   GET    /api/v1/reports/schedules
 *   POST   /api/v1/reports/schedules
 *   PATCH  /api/v1/reports/schedules/:id
 *   DELETE /api/v1/reports/schedules/:id
 *   POST   /api/v1/reports/schedules/:id/run
 *   GET    /api/v1/reports/schedules/:id/jobs
 *   GET    /api/v1/reports/jobs/:jobId/download
 */
import {
  CurrentTenant,
  CurrentUser,
  RequirePermissions,
  ZodValidationPipe,
} from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ReportScheduleInputError,
  type ReportScheduleService,
} from '../application/report-schedule.service.js';
import { REPORT_SCHEDULE_SERVICE } from './tokens.js';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  reportType: z.enum(['trips', 'vehicle-utilization', 'alarms', 'haul-cycles', 'haul-shifts']),
  routeId: z.string().uuid().nullable().optional(),
  routeIds: z.array(z.string().uuid()).max(6).optional(),
  cadence: z.enum(['daily', 'weekly']),
  preset: z.enum(['today', 'yesterday', '7d', '30d']).optional(),
  enabled: z.boolean().optional(),
  recipients: z.array(z.string().max(254)).max(10).optional(),
});
type CreateDto = z.infer<typeof createSchema>;

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  cadence: z.enum(['daily', 'weekly']).optional(),
  routeId: z.string().uuid().nullable().optional(),
  routeIds: z.array(z.string().uuid()).max(6).optional(),
  preset: z.enum(['today', 'yesterday', '7d', '30d']).optional(),
  enabled: z.boolean().optional(),
  recipients: z.array(z.string().max(254)).max(10).optional(),
});
type UpdateDto = z.infer<typeof updateSchema>;

@Controller('api/v1/reports')
export class ReportSchedulesController {
  constructor(@Inject(REPORT_SCHEDULE_SERVICE) private readonly schedules: ReportScheduleService) {}

  @Get('schedules')
  @RequirePermissions('report.schedule')
  public async list(@CurrentTenant() tenantId: string) {
    return this.guard(() => this.schedules.list(tenantId));
  }

  @Post('schedules')
  @RequirePermissions('report.schedule')
  public async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Body(new ZodValidationPipe(createSchema)) body: CreateDto,
  ) {
    return this.guard(() => this.schedules.create(tenantId, user?.userId ?? null, body));
  }

  @Patch('schedules/:id')
  @RequirePermissions('report.schedule')
  public async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateDto,
  ) {
    return this.guard(() => this.schedules.update(tenantId, id, body));
  }

  @Delete('schedules/:id')
  @RequirePermissions('report.schedule')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    await this.guard(() => this.schedules.remove(tenantId, id));
  }

  @Post('schedules/:id/run')
  @RequirePermissions('report.schedule')
  public async runNow(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.guard(() => this.schedules.runNow(tenantId, id));
  }

  @Get('schedules/:id/jobs')
  @RequirePermissions('report.schedule')
  public async jobs(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.guard(() => this.schedules.listJobs(tenantId, id));
  }

  @Get('jobs/:jobId/download')
  @RequirePermissions('report.schedule')
  public async download(
    @CurrentTenant() tenantId: string,
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | StreamableFile> {
    const result = await this.guard(() => this.schedules.downloadJob(tenantId, jobId));
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return typeof result.content === 'string'
      ? result.content
      : new StreamableFile(Buffer.from(result.content));
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ReportScheduleInputError) {
        throw new HttpException(
          { message: err.message, code: err.code },
          err.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST,
        );
      }
      throw err;
    }
  }
}
