/**
 * Platform console routes for one customer tenant's fleets and device
 * assignment. The operator's JWT tenant is not the customer: the path id is.
 * Gated by `billing.tenant.manage` (same permission as identity's tenant routes).
 *
 *   GET    /api/v1/platform/tenants/:tenantId/fleets
 *   POST   /api/v1/platform/tenants/:tenantId/fleets
 *   GET    /api/v1/platform/tenants/:tenantId/devices
 *   PUT    /api/v1/platform/tenants/:tenantId/devices/:deviceId/fleet
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PlatformTenantAssetsService } from '../application/platform-tenant-assets.service.js';
import { assignDeviceFleetSchema, createFleetSchema } from '../application/validation/schemas.js';
import { actorForTenant } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { PLATFORM_TENANT_ASSETS_SERVICE } from './tokens.js';

const uuidSchema = z.string().uuid();

@Controller('api/v1/platform/tenants')
export class PlatformTenantAssetsController {
  constructor(
    @Inject(PLATFORM_TENANT_ASSETS_SERVICE)
    private readonly assets: PlatformTenantAssetsService,
  ) {}

  @Get(':tenantId/fleets')
  @RequirePermissions('billing.tenant.manage')
  public async listFleets(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
  ) {
    const data = await this.assets.listFleets(this.actor(auth, req, tenantId));
    return { data };
  }

  @Post(':tenantId/fleets')
  @RequirePermissions('billing.tenant.manage')
  public async createFleet(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createFleetSchema)) body: unknown,
  ) {
    const fleet = await this.assets.createFleet(this.actor(auth, req, tenantId), body as never);
    return { data: fleet };
  }

  @Get(':tenantId/devices')
  @RequirePermissions('billing.tenant.manage')
  public async listDevices(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
  ) {
    const data = await this.assets.listDevices(this.actor(auth, req, tenantId));
    return { data };
  }

  @Put(':tenantId/devices/:deviceId/fleet')
  @RequirePermissions('billing.tenant.manage')
  public async assignDevice(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(assignDeviceFleetSchema)) body: unknown,
  ) {
    const id = parseUuid(deviceId, 'deviceId');
    const fleetId = (body as { fleetId: string }).fleetId;
    const data = await this.assets.assignDeviceToFleet(
      this.actor(auth, req, tenantId),
      id,
      fleetId,
    );
    return { data };
  }

  private actor(auth: AuthenticatedContext, req: Request, tenantId: string) {
    return actorForTenant(auth, req, parseUuid(tenantId, 'tenantId'));
  }
}

function parseUuid(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(`${label} must be a UUID.`);
  return parsed.data;
}
