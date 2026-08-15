/**
 * Fleets REST API (Sprint C §14). Tenant derived from the verified credential
 * (INV-I02). Cursor pagination + status/search filters (§15). DELETE = archive.
 *
 *   POST   /api/v1/fleets
 *   GET    /api/v1/fleets            (?cursor&limit&status&search)
 *   GET    /api/v1/fleets/:id
 *   PATCH  /api/v1/fleets/:id
 *   DELETE /api/v1/fleets/:id        (archive)
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
import type { FleetService } from '../application/fleet.service.js';
import {
  createFleetSchema,
  fleetListQuerySchema,
  updateFleetSchema,
} from '../application/validation/schemas.js';
import { actorFrom, readActor } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { FLEET_SERVICE } from './tokens.js';

@Controller('api/v1/fleets')
export class FleetsController {
  constructor(@Inject(FLEET_SERVICE) private readonly fleets: FleetService) {}

  @Post()
  @RequirePermissions('fleet.write')
  public async create(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Body(new ZodValidationPipe(createFleetSchema)) body: unknown,
  ) {
    const fleet = await this.fleets.create(actorFrom(auth, req), body as never);
    return { data: fleet };
  }

  @Get()
  @RequirePermissions('fleet.read')
  public async list(@CurrentUser() auth: AuthenticatedContext, @Query() query: unknown) {
    const q = fleetListQuerySchema.parse(query);
    const page = await this.fleets.list(
      readActor(auth),
      { status: q.status, search: q.search },
      { cursor: q.cursor, limit: q.limit },
    );
    return page; // { data, nextCursor }
  }

  @Get(':id')
  @RequirePermissions('fleet.read')
  public async get(@CurrentUser() auth: AuthenticatedContext, @Param('id') id: string) {
    const fleet = await this.fleets.get(readActor(auth), id);
    return { data: fleet };
  }

  @Patch(':id')
  @RequirePermissions('fleet.write')
  public async update(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFleetSchema)) body: unknown,
  ) {
    const fleet = await this.fleets.update(actorFrom(auth, req), id, body as never);
    return { data: fleet };
  }

  @Delete(':id')
  @RequirePermissions('fleet.write')
  @HttpCode(204)
  public async delete(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    await this.fleets.archive(actorFrom(auth, req), id);
  }
}
