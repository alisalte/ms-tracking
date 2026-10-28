/**
 * Mine haul routes for the signed-in tenant.
 *
 *   GET    /api/v1/haul-routes
 *   POST   /api/v1/haul-routes
 *   PATCH  /api/v1/haul-routes/:id           — name, places, shifts
 *   DELETE /api/v1/haul-routes/:id           — archive (reports stop listing it)
 *   GET    /api/v1/haul-routes/:id/members
 *   PUT    /api/v1/haul-routes/:id/members
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
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { HaulMemberInput, HaulRouteService } from '../application/haul-route.service.js';
import { actorFrom } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { HAUL_ROUTE_SERVICE } from './tokens.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  originGeofenceId: z.string().uuid(),
  destinationGeofenceId: z.string().uuid(),
  shiftStartHour: z.coerce.number().int().min(0).max(23).optional(),
  shiftStartMinute: z.coerce.number().int().min(0).max(59).optional(),
  shiftDurationHours: z.coerce.number().int().min(0).max(24).optional(),
  shiftDurationMinutes: z.coerce.number().int().min(0).max(59).optional(),
  shiftCount: z.coerce.number().int().min(1).max(4).optional(),
  lunchStartMinute: z.coerce.number().int().min(0).max(1439).nullable().optional(),
  lunchEndMinute: z.coerce.number().int().min(0).max(1439).nullable().optional(),
  handoverWindowMinutes: z.coerce.number().int().min(0).max(120).optional(),
});

const updateSchema = createSchema.partial();

const membersSchema = z.object({
  members: z
    .array(
      z.object({
        deviceId: z.string().uuid(),
        /** Optional: defaults to the machine type defined on the vehicle. */
        role: z.enum(['TRUCK', 'SHOVEL']).optional(),
        /** Element `n - 1` is the driver of shift `n`. */
        shiftDrivers: z.array(z.string().uuid().nullable()).max(4).optional(),
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

  @Patch(':id')
  @RequirePermissions('fleet.write')
  public async update(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: unknown,
  ) {
    return { data: await this.routes.update(actorFrom(auth, req), id, body as never) };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('fleet.write')
  public async archive(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.routes.archive(actorFrom(auth, req), id);
  }

  @Get(':id/members')
  @RequirePermissions('fleet.read')
  public async members(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.routes.members(actorFrom(auth, req), id) };
  }

  @Put(':id/members')
  @RequirePermissions('fleet.write')
  public async setMembers(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(membersSchema)) body: unknown,
  ) {
    const members = (body as { members: HaulMemberInput[] }).members;
    return { data: await this.routes.setMembers(actorFrom(auth, req), id, members) };
  }
}
