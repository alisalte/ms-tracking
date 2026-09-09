import {
  type PageRequestDto,
  RequirePermissions,
  type UuidParamDto,
  ZodValidationPipe,
  getPrincipal,
  pageRequestSchema,
  uuidParamSchema,
} from '@fleetvision/auth';
import { decodeCursor } from '@fleetvision/shared-kernel';
/**
 * Drivers controller — driver management CRUD + vehicle assignment.
 * Base /api/v1/fleet/drivers. All routes require JWT + fleet.driver.* permissions.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Driver } from '../domain/index.js';
import { DriverNotFoundError, VehicleAlreadyAssignedError } from '../domain/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { DriverBehaviorService } from '../application/driver-behavior.service.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { DriverRepository } from '../infrastructure/persistence/driver.repository.js';
import {
  type AssignVehicleDto,
  type CreateDriverDto,
  type UpdateDriverDto,
  assignVehicleSchema,
  createDriverSchema,
  updateDriverSchema,
} from './fleet.dto.js';

const assignmentRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
type AssignmentRangeDto = z.infer<typeof assignmentRangeSchema>;

const behaviorRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
type BehaviorRangeDto = z.infer<typeof behaviorRangeSchema>;

@Controller('api/v1/fleet/drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriverRepository,
    private readonly behavior: DriverBehaviorService,
  ) {}

  @Get()
  @RequirePermissions('fleet.driver.read')
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Query('status') status?: string,
    @Req() req?: Request,
  ) {
    const p = getPrincipal(req as Request);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    return this.drivers.listPage(p.tenantId, page.limit, status as never, cursor);
  }

  @Get('behavior-ranking')
  @RequirePermissions('fleet.driver.read')
  public async behaviorRanking(
    @Query(new ZodValidationPipe(behaviorRangeSchema)) range: BehaviorRangeDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const defaults = this.behavior.defaultPeriod();
    const to = range.to ? new Date(range.to) : defaults.to;
    const from = range.from ? new Date(range.from) : defaults.from;
    const data = await this.behavior.listRanking(p.tenantId, from, to);
    return { data, meta: { from: from.toISOString(), to: to.toISOString() } };
  }

  @Get(':id/assignments')
  @RequirePermissions('fleet.driver.read')
  public async listAssignments(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Query(new ZodValidationPipe(assignmentRangeSchema)) range: AssignmentRangeDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const driver = await this.drivers.findById(p.tenantId, params.id);
    if (!driver) throw new DriverNotFoundError();

    const to = range.to ? new Date(range.to) : new Date();
    const from = range.from
      ? new Date(range.from)
      : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

    const data = await this.drivers.listAssignments(p.tenantId, params.id, { from, to });
    return { data };
  }

  @Get(':id/behavior-score')
  @RequirePermissions('fleet.driver.read')
  public async behaviorScore(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Query(new ZodValidationPipe(behaviorRangeSchema)) range: BehaviorRangeDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const driver = await this.drivers.findById(p.tenantId, params.id);
    if (!driver) throw new DriverNotFoundError();

    const defaults = this.behavior.defaultPeriod();
    const to = range.to ? new Date(range.to) : defaults.to;
    const from = range.from ? new Date(range.from) : defaults.from;
    const data = await this.behavior.getScore(p.tenantId, params.id, from, to);
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
    const driver = await this.drivers.findById(p.tenantId, params.id);
    if (!driver) throw new DriverNotFoundError();

    const defaults = this.behavior.defaultPeriod();
    const to = range.to ? new Date(range.to) : defaults.to;
    const from = range.from ? new Date(range.from) : defaults.from;
    const data = await this.behavior.listEvents(p.tenantId, params.id, from, to);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('fleet.driver.read')
  public async get(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const driver = await this.drivers.findById(p.tenantId, params.id);
    if (!driver) throw new DriverNotFoundError();
    return { data: driver };
  }

  @Post()
  @RequirePermissions('fleet.driver.create')
  public async create(
    @Body(new ZodValidationPipe(createDriverSchema)) body: CreateDriverDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const driver = Driver.create(undefined, {
      tenantId: p.tenantId,
      employeeId: body.employee_id ?? null,
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      licenseNumber: body.license_number,
      licenseClass: body.license_class ?? null,
      licenseIssued: body.license_issued ? new Date(body.license_issued) : null,
      licenseExpires: body.license_expires ? new Date(body.license_expires) : null,
      licenseCountry: body.license_country ?? null,
    });
    await this.drivers.create(driver);
    return { data: { id: driver.id } };
  }

  @Put(':id')
  @RequirePermissions('fleet.driver.update')
  public async update(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Body(new ZodValidationPipe(updateDriverSchema)) body: UpdateDriverDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const driver = await this.drivers.findById(p.tenantId, params.id);
    if (!driver) throw new DriverNotFoundError();
    driver.updateProfile({
      employeeId: body.employee_id,
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email,
      phone: body.phone,
      licenseNumber: body.license_number,
      licenseClass: body.license_class,
      licenseIssued: body.license_issued ? new Date(body.license_issued) : undefined,
      licenseExpires: body.license_expires ? new Date(body.license_expires) : undefined,
      licenseCountry: body.license_country,
    });
    await this.drivers.update(driver);
    return { data: { id: driver.id } };
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('fleet.driver.manage')
  public async deactivate(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ): Promise<void> {
    const p = getPrincipal(req);
    const driver = await this.drivers.findById(p.tenantId, params.id);
    if (!driver) throw new DriverNotFoundError();
    const previousVehicleId = driver.assignedVehicleId;
    driver.transitionTo('INACTIVE');
    if (previousVehicleId) driver.unassignVehicle();
    if (previousVehicleId) {
      await this.drivers.updateAndRecordAssignment(driver, {
        previousVehicleId,
        nextVehicleId: null,
        changedBy: p.userId,
      });
    } else {
      await this.drivers.update(driver);
    }
  }

  @Post(':id/assign-vehicle')
  @RequirePermissions('fleet.driver.update')
  public async assignVehicle(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Body(new ZodValidationPipe(assignVehicleSchema)) body: AssignVehicleDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const driver = await this.drivers.findById(p.tenantId, params.id);
    if (!driver) throw new DriverNotFoundError();
    const existing = await this.drivers.findActiveDriverForVehicle(p.tenantId, body.vehicle_id);
    if (existing && existing.id !== driver.id) throw new VehicleAlreadyAssignedError();
    const previousVehicleId = driver.assignedVehicleId;
    driver.assignVehicle(body.vehicle_id);
    await this.drivers.updateAndRecordAssignment(driver, {
      previousVehicleId,
      nextVehicleId: body.vehicle_id,
      changedBy: p.userId,
    });
    return { data: { id: driver.id, assigned_vehicle_id: body.vehicle_id } };
  }

  @Post(':id/unassign-vehicle')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('fleet.driver.update')
  public async unassignVehicle(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ): Promise<void> {
    const p = getPrincipal(req);
    const driver = await this.drivers.findById(p.tenantId, params.id);
    if (!driver) throw new DriverNotFoundError();
    const previousVehicleId = driver.assignedVehicleId;
    if (!previousVehicleId) return;
    driver.unassignVehicle();
    await this.drivers.updateAndRecordAssignment(driver, {
      previousVehicleId,
      nextVehicleId: null,
      changedBy: p.userId,
    });
  }
}
