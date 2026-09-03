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
 * Business Trips controller — planned/active/completed trip management.
 * Base /api/v1/fleet/trips. All routes require JWT + fleet.trip.* permissions.
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
import { BusinessTrip } from '../domain/index.js';
import { BusinessTripNotFoundError } from '../domain/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs BusinessTripRepository at runtime for reflect-metadata.
import {
  BusinessTripRepository,
  type TripFilters,
} from '../infrastructure/persistence/business-trip.repository.js';
import {
  type CompleteTripDto,
  type CreateTripDto,
  type UpdateTripDto,
  completeTripSchema,
  createTripSchema,
  updateTripSchema,
} from './fleet.dto.js';

@Controller('api/v1/fleet/trips')
export class BusinessTripsController {
  constructor(private readonly trips: BusinessTripRepository) {}

  @Get()
  @RequirePermissions('fleet.trip.read')
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Query('status') status?: string,
    @Query('driverId') driverId?: string,
    @Query('vehicleId') vehicleId?: string,
    @Req() req?: Request,
  ) {
    const p = getPrincipal(req as Request);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    const filters: TripFilters = {};
    if (status) filters.status = status as TripFilters['status'];
    if (driverId) filters.driverId = driverId;
    if (vehicleId) filters.vehicleId = vehicleId;
    return this.trips.listPage(p.tenantId, page.limit, filters, cursor);
  }

  @Get(':id')
  @RequirePermissions('fleet.trip.read')
  public async get(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const trip = await this.trips.findById(p.tenantId, params.id);
    if (!trip) throw new BusinessTripNotFoundError();
    return { data: trip };
  }

  @Post()
  @RequirePermissions('fleet.trip.create')
  public async create(
    @Body(new ZodValidationPipe(createTripSchema)) body: CreateTripDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const trip = BusinessTrip.create(undefined, {
      tenantId: p.tenantId,
      driverId: body.driver_id ?? null,
      vehicleId: body.vehicle_id ?? null,
      originLabel: body.origin_label ?? null,
      originLat: body.origin_lat ?? null,
      originLng: body.origin_lng ?? null,
      destinationLabel: body.destination_label ?? null,
      destinationLat: body.destination_lat ?? null,
      destinationLng: body.destination_lng ?? null,
      purpose: body.purpose ?? null,
      notes: body.notes ?? null,
      plannedStart: body.planned_start ? new Date(body.planned_start) : null,
      plannedEnd: body.planned_end ? new Date(body.planned_end) : null,
    });
    await this.trips.create(trip);
    return { data: { id: trip.id } };
  }

  @Put(':id')
  @RequirePermissions('fleet.trip.update')
  public async update(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Body(new ZodValidationPipe(updateTripSchema)) body: UpdateTripDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const trip = await this.trips.findById(p.tenantId, params.id);
    if (!trip) throw new BusinessTripNotFoundError();
    trip.updateDetails({
      driverId: body.driver_id,
      vehicleId: body.vehicle_id,
      originLabel: body.origin_label,
      destinationLabel: body.destination_label,
      purpose: body.purpose,
      notes: body.notes,
      plannedStart: body.planned_start ? new Date(body.planned_start) : undefined,
      plannedEnd: body.planned_end ? new Date(body.planned_end) : undefined,
    });
    await this.trips.update(trip);
    return { data: { id: trip.id } };
  }

  @Post(':id/start')
  @RequirePermissions('fleet.trip.update')
  public async start(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const trip = await this.trips.findById(p.tenantId, params.id);
    if (!trip) throw new BusinessTripNotFoundError();
    trip.start();
    await this.trips.update(trip);
    return { data: { id: trip.id, status: trip.status } };
  }

  @Post(':id/complete')
  @RequirePermissions('fleet.trip.update')
  public async complete(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Body(new ZodValidationPipe(completeTripSchema)) body: CompleteTripDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const trip = await this.trips.findById(p.tenantId, params.id);
    if (!trip) throw new BusinessTripNotFoundError();
    trip.complete(body.distance_km, body.duration_sec);
    await this.trips.update(trip);
    return { data: { id: trip.id, status: trip.status } };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fleet.trip.update')
  public async cancel(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const trip = await this.trips.findById(p.tenantId, params.id);
    if (!trip) throw new BusinessTripNotFoundError();
    trip.cancel();
    await this.trips.update(trip);
    return { data: { id: trip.id, status: trip.status } };
  }
}
