/**
 * Vehicles REST API + the vehicle↔device binding routes (Sprint C §11, §14).
 *
 *   POST   /api/v1/vehicles
 *   GET    /api/v1/vehicles                 (?cursor&limit&fleetId&status&search)
 *   GET    /api/v1/vehicles/:id
 *   PATCH  /api/v1/vehicles/:id
 *   DELETE /api/v1/vehicles/:id             (archive)
 *   GET    /api/v1/vehicles/:id/devices     (devices bound to the vehicle)
 *   POST   /api/v1/vehicles/:id/devices/:deviceId   (bind)
 *   DELETE /api/v1/vehicles/:id/devices/:deviceId   (unbind)
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { BindingService } from '../application/binding.service.js';
import {
  bindBodySchema,
  createVehicleSchema,
  updateVehicleSchema,
  vehicleListQuerySchema,
} from '../application/validation/schemas.js';
import type { VehicleService } from '../application/vehicle.service.js';
import { actorFrom, readActor } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { BINDING_SERVICE, VEHICLE_SERVICE } from './tokens.js';

@Controller('api/v1/vehicles')
export class VehiclesController {
  constructor(
    @Inject(VEHICLE_SERVICE) private readonly vehicles: VehicleService,
    @Inject(BINDING_SERVICE) private readonly bindings: BindingService,
  ) {}

  @Post()
  @RequirePermissions('vehicle.write')
  public async create(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Body(new ZodValidationPipe(createVehicleSchema)) body: unknown,
  ) {
    const vehicle = await this.vehicles.create(actorFrom(auth, req), body as never);
    return { data: vehicle };
  }

  @Get()
  @RequirePermissions('vehicle.read')
  public async list(@CurrentUser() auth: AuthenticatedContext, @Query() query: unknown) {
    const q = vehicleListQuerySchema.parse(query);
    const page = await this.vehicles.list(
      readActor(auth),
      { fleetId: q.fleetId, status: q.status, search: q.search },
      { cursor: q.cursor, limit: q.limit },
    );
    return page;
  }

  @Get(':id')
  @RequirePermissions('vehicle.read')
  public async get(@CurrentUser() auth: AuthenticatedContext, @Param('id') id: string) {
    return { data: await this.vehicles.get(readActor(auth), id) };
  }

  @Patch(':id')
  @RequirePermissions('vehicle.write')
  public async update(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVehicleSchema)) body: unknown,
  ) {
    return { data: await this.vehicles.update(actorFrom(auth, req), id, body as never) };
  }

  @Delete(':id')
  @RequirePermissions('vehicle.write')
  @HttpCode(204)
  public async delete(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    await this.vehicles.archive(actorFrom(auth, req), id);
  }

  // --- Binding routes (vehicle-centric) -------------------------------------

  @Get(':id/devices')
  @RequirePermissions('vehicle.read')
  public async listDevices(@CurrentUser() auth: AuthenticatedContext, @Param('id') id: string) {
    const data = await this.bindings.listDevicesForVehicle(readActor(auth), id);
    return { data };
  }

  @Post(':id/devices/:deviceId')
  @RequirePermissions('vehicle.write')
  public async bind(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(bindBodySchema)) body: unknown,
  ) {
    const data = await this.bindings.bind(actorFrom(auth, req), id, deviceId, body as never);
    return { data };
  }

  @Delete(':id/devices/:deviceId')
  @RequirePermissions('vehicle.write')
  @HttpCode(204)
  public async unbind(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Param('deviceId') deviceId: string,
  ) {
    await this.bindings.unbind(actorFrom(auth, req), id, deviceId);
  }
}
