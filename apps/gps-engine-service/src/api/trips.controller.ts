import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Trips REST API (Sprint F §11 — trip visualization from the existing Trip
 * Engine projections; the engine itself is NOT rebuilt).
 *
 *   GET /trips?vehicleId=&from=&to=&limit=  — trip list (newest first).
 *   GET /trips/:tripId                      — trip detail: waypoints (real
 *                                             positions between start/end) +
 *                                             idle/parking events from the
 *                                             existing projection tables.
 *
 * Sprint B: authentication + `tracking.read` enforced globally; tenant from the
 * verified JWT. Sprint F §21: validated time windows (from < to, max 31 days)
 * and bounded limits — no unlimited queries.
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Param, Query } from '@nestjs/common';
import type { PositionRepository } from '../infrastructure/persistence/position.repository.js';
import type { TripRepository } from '../infrastructure/persistence/trip.repository.js';
import { POSITION_REPOSITORY, TRIP_REPOSITORY } from './tokens.js';

const MAX_RANGE_MS = 31 * 86_400_000;

/** A timeline event rendered on the trip detail (idle/parking windows). */
interface TripTimelineEvent {
  readonly id: string;
  readonly type: 'idle' | 'stop';
  readonly ts: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly durationMin: number;
}

function parseTimeRange(from?: string, to?: string): { fromTime: Date; toTime: Date } {
  const now = new Date();
  const fromTime = from ? new Date(from) : new Date(now.getTime() - 7 * 86_400_000); // default 7d
  const toTime = to ? new Date(to) : now;
  if (Number.isNaN(fromTime.getTime()) || Number.isNaN(toTime.getTime())) {
    throw new HttpException('from/to must be valid ISO timestamps', HttpStatus.BAD_REQUEST);
  }
  if (fromTime >= toTime) {
    throw new HttpException('from must be before to', HttpStatus.BAD_REQUEST);
  }
  if (toTime.getTime() - fromTime.getTime() > MAX_RANGE_MS) {
    throw new HttpException('Time range too large (max 31 days)', HttpStatus.BAD_REQUEST);
  }
  return { fromTime, toTime };
}

@Controller('trips')
export class TripsController {
  constructor(
    @Inject(TRIP_REPOSITORY) private readonly trips: TripRepository,
    @Inject(POSITION_REPOSITORY) private readonly positions: PositionRepository,
  ) {}

  /** Trip list for the tenant (optionally filtered by vehicle). */
  @Get()
  @RequirePermissions('tracking.read')
  public async list(
    @CurrentTenant() tenantId: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const { fromTime, toTime } = parseTimeRange(from, to);
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
    return this.trips.findTrips(tenantId, { vehicleId, from: fromTime, to: toTime, limit: max });
  }

  /**
   * Trip detail: the trip record + real waypoints (positions captured during
   * the trip, capped) + timeline events (idle/parking projections). A
   * non-existent or cross-tenant trip id 404s without an enumeration oracle.
   */
  @Get(':tripId')
  @RequirePermissions('tracking.read')
  public async detail(@CurrentTenant() tenantId: string, @Param('tripId') tripId: string) {
    const trip = await this.trips.findTripById(tenantId, tripId);
    if (!trip) {
      throw new HttpException('Trip not found', HttpStatus.NOT_FOUND);
    }
    const windowEnd = trip.endedAt ?? new Date();
    const [waypoints, idle, parking] = await Promise.all([
      this.positions.findRange(tenantId, trip.vehicleId, trip.startedAt, windowEnd, 2000),
      this.trips.findIdlePeriods(tenantId, trip.vehicleId, trip.startedAt, windowEnd),
      this.trips.findParkingPeriods(tenantId, trip.vehicleId, trip.startedAt, windowEnd),
    ]);

    const events: TripTimelineEvent[] = [
      ...idle.map(
        (p, i): TripTimelineEvent => ({
          id: `idle-${i}`,
          type: 'idle',
          ts: p.startedAt.toISOString(),
          lat: null,
          lng: null,
          durationMin: Math.round(p.durationS / 60),
        }),
      ),
      ...parking.map(
        (p, i): TripTimelineEvent => ({
          id: `stop-${i}`,
          type: 'stop',
          ts: p.startedAt.toISOString(),
          lat: p.lat,
          lng: p.lng,
          durationMin: Math.round(p.durationS / 60),
        }),
      ),
    ].sort((a, b) => a.ts.localeCompare(b.ts));

    return {
      ...trip,
      avgSpeedKph:
        trip.durationS > 0 ? Number((trip.distanceKm / (trip.durationS / 3600)).toFixed(1)) : 0,
      waypoints: waypoints.map((p) => ({
        ts: p.capturedAt,
        lat: p.latitude,
        lng: p.longitude,
        speed: p.speedKph,
        heading: p.headingDeg,
      })),
      events,
    };
  }
}
