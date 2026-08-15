import {
  type PageRequestDto,
  RequirePermissions,
  ZodValidationPipe,
  getPrincipal,
  pageRequestSchema,
} from '@fleetvision/auth';
import { decodeCursor } from '@fleetvision/shared-kernel';
/**
 * Events controller — FleetEvent history query API (Sprint G Part 35).
 * Base /api/v1/notification/events. Tenant comes from the JWT principal;
 * filters are bounded + cursor-paginated (no full-table dumps to the browser).
 */
import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type {
  FleetEventFilters,
  FleetEventRepository,
} from '../infrastructure/persistence/fleet-event.repository.js';

@Controller('api/v1/notification/events')
export class EventsController {
  constructor(private readonly events: FleetEventRepository) {}

  @Get()
  @RequirePermissions('notification.event.read')
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Query('vehicleId') vehicleId?: string,
    @Query('type') eventType?: string,
    @Query('severity') severity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: Request,
  ) {
    const p = getPrincipal(req as Request);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { occurredAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    const filters: FleetEventFilters = {};
    if (vehicleId) filters.vehicleId = vehicleId;
    if (eventType) filters.eventType = eventType;
    if (severity) filters.severity = severity;
    if (from) filters.from = new Date(from);
    if (to) filters.to = new Date(to);
    return this.events.listPage(p.tenantId, page.limit, filters, cursor);
  }
}
