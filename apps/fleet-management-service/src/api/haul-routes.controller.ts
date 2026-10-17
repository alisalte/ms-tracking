/**
 * Mine haul routes for the signed-in tenant.
 *
 *   GET    /api/v1/haul-routes
 *   POST   /api/v1/haul-routes
 *   GET    /api/v1/haul-routes/:id/members
 *   PUT    /api/v1/haul-routes/:id/members
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import { Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { HaulRouteService } from '../application/haul-route.service.js';
import { actorFrom } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { HAUL_ROUTE_SERVICE } from './tokens.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  originGeofenceId: z.string().uuid(),
  destinationGeofenceId: z.string().uuid(),
  shiftStartHour: z.coerce.number().int().min(0).max(23).optional(),
  shiftDurationHours: z.coerce.number().int().min(1).max(24).optional(),
});

const membersSchema = z.object({
  members: z
    .array(
      z.object({
        deviceId: z.string().uuid(),
        role: z.enum(['TRUCK', 'SHOVEL']),
      }),
    )
    .max(500),
});

@Controller('api/v1/haul-routes')
export class HaulRoutesController {
  constructor(@Inject(HAUL_ROUTE_SERVICE) private readonly routes: HaulRouteService) {}

  @Get()
  @RequirePermissions('fleet.read')
  public async list(@CurrentUser() auth: AuthenticatedContext, @Req() req: Request) {
    return { data: await this.routes.list(actorFrom(auth, req)) };
  }

  @Post()
  @RequirePermissions('fleet.write')
  public async create(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Body(new ZodValidationPipe(createSchema)) body: unknown,
  ) {
    return { data: await this.routes.create(actorFrom(auth, req), body as never) };
  }

  @Get(':id/members')
  @RequirePermissions('fleet.read')
  public async members(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.routes.members(actorFrom(auth, req), id) };
  }

  @Put(':id/members')
  @RequirePermissions('fleet.write')
  public async setMembers(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(membersSchema)) body: unknown,
  ) {
    const members = (body as { members: Array<{ deviceId: string; role: 'TRUCK' | 'SHOVEL' }> })
      .members;
    return { data: await this.routes.setMembers(actorFrom(auth, req), id, members) };
  }
}
