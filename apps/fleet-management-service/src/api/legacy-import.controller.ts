/**
 * Migration from the previous tracking system.
 *
 *   POST /api/v1/vehicles/legacy-import — upsert legacy units (tracker + vehicle) by IMEI.
 *
 * Needs both vehicle.write and device.write: one row creates or updates a
 * fleet, a device, a vehicle and their binding.
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { LegacyImportService } from '../application/legacy-import.service.js';
import {
  type LegacyImportBody,
  legacyImportBodySchema,
} from '../application/validation/schemas.js';
import { actorFrom } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { LEGACY_IMPORT_SERVICE } from './tokens.js';

@Controller('api/v1/vehicles/legacy-import')
export class LegacyImportController {
  constructor(@Inject(LEGACY_IMPORT_SERVICE) private readonly service: LegacyImportService) {}

  @Post()
  @HttpCode(200)
  @RequirePermissions('vehicle.write', 'device.write')
  public async importUnits(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Body(new ZodValidationPipe(legacyImportBodySchema)) body: LegacyImportBody,
  ) {
    return {
      data: await this.service.importUnits(actorFrom(auth, req), body.rows, body.defaultProtocol),
    };
  }
}
