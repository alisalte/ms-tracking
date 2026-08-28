/**
 * Devices REST API + the device-gateway's IMEI resolution endpoint (Sprint C
 * §8, §14, §18, §19).
 *
 *   GET    /api/v1/devices/resolve?imei=    ← SERVICE-ONLY (API key). Global IMEI → trusted identity.
 *   POST   /api/v1/devices
 *   GET    /api/v1/devices                  (?cursor&limit&status&protocol&manufacturer&vehicleId&imei&search)
 *   GET    /api/v1/devices/:id
 *   PATCH  /api/v1/devices/:id
 *   DELETE /api/v1/devices/:id              (DECOMMISSION — archive, never hard delete)
 *   GET    /api/v1/devices/:id/vehicle      (the vehicle a device is bound to)
 *
 * The resolve route is declared before `:id` so the static segment wins. It is
 * API-key-only: even a tenant-admin JWT (wildcard `*`) is rejected, so no user can
 * enumerate cross-tenant devices (§33). Only the device-gateway's service API key
 * carries `device.registry.resolve`.
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import type { DeviceService } from '../application/device.service.js';
import {
  createDeviceSchema,
  deviceListQuerySchema,
  importDevicesBodySchema,
  updateDeviceSchema,
} from '../application/validation/schemas.js';
import { actorFrom, readActor } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { BINDING_SERVICE, DEVICE_SERVICE } from './tokens.js';

@Controller('api/v1/devices')
export class DevicesController {
  constructor(
    @Inject(DEVICE_SERVICE) private readonly devices: DeviceService,
    @Inject(BINDING_SERVICE) private readonly bindings: BindingService,
  ) {}

  // --- Service-only IMEI resolution (device-gateway) ------------------------

  @Get('resolve')
  @RequirePermissions('device.registry.resolve')
  public async resolve(@CurrentUser() auth: AuthenticatedContext, @Query('imei') imei?: string) {
    // Defense-in-depth: even though `device.registry.resolve` is granted to no
    // user role, a tenant-admin's wildcard `*` would satisfy the PermissionsGuard.
    // Reject any JWT (user) caller outright — only API-key (service) callers reach here.
    if (auth.authMethod !== 'API_KEY') {
      throw new ForbiddenException('IMEI resolution is a service-only endpoint.');
    }
    if (!imei) return { found: false, tenantActive: false };
    const result = await this.devices.resolve(imei);
    if (!result.found) return { found: false, tenantActive: result.tenantActive };
    return {
      found: true,
      tenantActive: result.tenantActive,
      device: result.device,
    };
  }

  // --- Management API -------------------------------------------------------

  @Post()
  @RequirePermissions('device.write')
  public async create(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Body(new ZodValidationPipe(createDeviceSchema)) body: unknown,
  ) {
    return { data: await this.devices.create(actorFrom(auth, req), body as never) };
  }

  /**
   * Spreadsheet import. Static `import` is declared before `:id` so it wins.
   * Partial success: some rows may create while others fail.
   */
  @Post('import')
  @HttpCode(200)
  @RequirePermissions('device.write')
  public async importRows(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Body(new ZodValidationPipe(importDevicesBodySchema)) body: { rows: Record<string, unknown>[] },
  ) {
    return { data: await this.devices.importMany(actorFrom(auth, req), body.rows) };
  }

  @Get()
  @RequirePermissions('device.read')
  public async list(@CurrentUser() auth: AuthenticatedContext, @Query() query: unknown) {
    const q = deviceListQuerySchema.parse(query);
    return this.devices.list(
      readActor(auth),
      {
        status: q.status,
        protocol: q.protocol,
        manufacturer: q.manufacturer,
        vehicleId: q.vehicleId,
        imei: q.imei,
        search: q.search,
      },
      { cursor: q.cursor, limit: q.limit },
    );
  }

  @Get(':id')
  @RequirePermissions('device.read')
  public async get(@CurrentUser() auth: AuthenticatedContext, @Param('id') id: string) {
    return { data: await this.devices.get(readActor(auth), id) };
  }

  @Patch(':id')
  @RequirePermissions('device.write')
  public async update(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDeviceSchema)) body: unknown,
  ) {
    return { data: await this.devices.update(actorFrom(auth, req), id, body as never) };
  }

  @Delete(':id')
  @RequirePermissions('device.write')
  @HttpCode(204)
  public async delete(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    // DELETE = DECOMMISSION (archive). Telemetry history is never destroyed (§27).
    await this.devices.setStatus(actorFrom(auth, req), id, 'DECOMMISSIONED', 'device.disabled');
  }

  @Get(':id/vehicle')
  @RequirePermissions('device.read')
  public async vehicle(@CurrentUser() auth: AuthenticatedContext, @Param('id') id: string) {
    const vehicle = await this.bindings.getVehicleOfDevice(readActor(auth), id);
    return { data: vehicle };
  }
}
