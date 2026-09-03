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
import { Driver } from '../domain/index.js';
import { DriverNotFoundError, VehicleAlreadyAssignedError } from '../domain/index.js';
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

@Controller('api/v1/fleet/drivers')
export class DriversController {
  constructor(private readonly drivers: DriverRepository) {}

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
    driver.transitionTo('INACTIVE');
    if (driver.assignedVehicleId) driver.unassignVehicle();
    await this.drivers.update(driver);
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
    driver.assignVehicle(body.vehicle_id);
    await this.drivers.update(driver);
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
    driver.unassignVehicle();
    await this.drivers.update(driver);
  }
}
