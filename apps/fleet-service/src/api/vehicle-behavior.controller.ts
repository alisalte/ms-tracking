import {
  RequirePermissions,
  type UuidParamDto,
  ZodValidationPipe,
  getPrincipal,
  uuidParamSchema,
} from '@fleetvision/auth';
/**
 * Vehicle driving-behavior view — score, per-driver split and events for a car.
 * Base /api/v1/fleet/vehicles (routed to fleet-service by the `/api/v1/fleet/` prefix;
 * the vehicle registry itself lives in fleet-management under /api/v1/vehicles).
 * Exposes driver names, so it is gated by fleet.driver.read like the driver view.
 */
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { DriverBehaviorService } from '../application/driver-behavior.service.js';

const behaviorRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
type BehaviorRangeDto = z.infer<typeof behaviorRangeSchema>;

@Controller('api/v1/fleet/vehicles')
export class VehicleBehaviorController {
  constructor(private readonly behavior: DriverBehaviorService) {}

  @Get(':id/behavior-score')
  @RequirePermissions('fleet.driver.read')
  public async behaviorScore(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Query(new ZodValidationPipe(behaviorRangeSchema)) range: BehaviorRangeDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const { from, to } = this.resolveRange(range);
    const data = await this.behavior.getVehicleBehavior(p.tenantId, params.id, from, to);
    return { data };
  }

  @Get(':id/behavior-events')
  @RequirePermissions('fleet.driver.read')
  public async behaviorEvents(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Query(new ZodValidationPipe(behaviorRangeSchema)) range: BehaviorRangeDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const { from, to } = this.resolveRange(range);
    const data = await this.behavior.listVehicleEvents(p.tenantId, params.id, from, to);
    return { data };
  }

  private resolveRange(range: BehaviorRangeDto): { from: Date; to: Date } {
    const defaults = this.behavior.defaultPeriod();
    return {
      from: range.from ? new Date(range.from) : defaults.from,
      to: range.to ? new Date(range.to) : defaults.to,
    };
  }
}
