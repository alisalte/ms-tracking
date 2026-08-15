import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Positions REST API (07 §12.5 replay; last-position cache→DB fallback §13.5).
 *
 *   GET /positions/latest                      — latest per vehicle (Sprint E).
 *   GET /positions/nearby?lat=&lng=&radius=    — spatial nearest-vehicles query (Sprint F §17).
 *   GET /positions/in-bounds?n=&s=&e=&w=       — viewport bbox query (Sprint F §18).
 *   GET /positions/:vehicleId/latest           — last known position (Redis → DB).
 *   GET /positions/:vehicleId?from=&to=&limit= — historical track (hypertable scan).
 *
 * Sprint B: authentication + `tracking.read` are enforced by the global guards.
 * The tenant is taken from the verified JWT (INV-I02) — never a client header.
 * Sprint F §21: historical/spatial queries validate their inputs (parseable
 * UTC-ish ISO timestamps, from < to, bounded range) and reject unlimited scans.
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Param, Query } from '@nestjs/common';
import type { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
import type { PositionRepository } from '../infrastructure/persistence/position.repository.js';
import { POSITION_CACHE, POSITION_REPOSITORY } from './tokens.js';

/** Maximum historical track window (31 days) — Sprint F §21. */
const MAX_RANGE_MS = 31 * 86_400_000;

/** Parse + validate a timestamp pair; throws 400 on invalid or reversed input. */
function parseTimeRange(from?: string, to?: string): { fromTime: Date; toTime: Date } {
  const now = new Date();
  const fromTime = from ? new Date(from) : new Date(now.getTime() - 86_400_000); // default 24h
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

/** Parse a finite coordinate query param or throw 400. */
function parseCoord(name: string, value: string | undefined): number {
  const n = value !== undefined ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || Math.abs(n) > 180) {
    throw new HttpException(`Valid ${name} required`, HttpStatus.BAD_REQUEST);
  }
  return n;
}

@Controller('positions')
export class PositionsController {
  constructor(
    @Inject(POSITION_CACHE) private readonly cache: RedisPositionCache,
    @Inject(POSITION_REPOSITORY) private readonly repo: PositionRepository,
  ) {}

  /**
   * Latest position PER VEHICLE for the caller's tenant (Sprint E live-map
   * bootstrap). Declared BEFORE `:vehicleId` routes so the static segment wins.
   * One bounded query — the frontend must not do N per-vehicle lookups (§21).
   */
  @Get('latest')
  @RequirePermissions('tracking.read')
  public async latestForTenant(@CurrentTenant() tenantId: string, @Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 500;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 2000) : 500;
    return this.repo.findLatestForTenant(tenantId, max);
  }

  /**
   * Vehicles near a point (Sprint F §17): single PostGIS query over the
   * latest-per-vehicle projection (ST_DWithin on the GiST-indexed geography
   * column), tenant-scoped via the verified JWT. No app-level loops.
   */
  @Get('nearby')
  @RequirePermissions('tracking.read')
  public async nearby(
    @CurrentTenant() tenantId: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius') radius?: string,
    @Query('limit') limit?: string,
  ) {
    const latitude = parseCoord('lat', lat);
    const longitude = parseCoord('lng', lng);
    const radiusM = radius !== undefined ? Number(radius) : 1000;
    if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 100_000) {
      throw new HttpException('radius must be 1..100000 meters', HttpStatus.BAD_REQUEST);
    }
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 50;
    return this.repo.findNearby(tenantId, latitude, longitude, radiusM, max);
  }

  /**
   * Vehicles inside a map viewport (Sprint F §18): PostGIS bbox overlap on the
   * latest-per-vehicle projection. Tenant data only — cross-tenant rows are
   * filtered by the tenant predicate before the spatial filter.
   */
  @Get('in-bounds')
  @RequirePermissions('tracking.read')
  public async inBounds(
    @CurrentTenant() tenantId: string,
    @Query('north') north?: string,
    @Query('south') south?: string,
    @Query('east') east?: string,
    @Query('west') west?: string,
    @Query('limit') limit?: string,
  ) {
    const maxLat = parseCoord('north', north);
    const minLat = parseCoord('south', south);
    const maxLng = parseCoord('east', east);
    const minLng = parseCoord('west', west);
    if (minLat >= maxLat || minLng >= maxLng) {
      throw new HttpException('south/north and west/east must be ordered', HttpStatus.BAD_REQUEST);
    }
    const parsed = limit ? Number.parseInt(limit, 10) : 500;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 2000) : 500;
    return this.repo.findInBounds(tenantId, minLng, minLat, maxLng, maxLat, max);
  }

  /** Latest position: Redis cache → TimescaleDB fallback (07 §13.5). */
  @Get(':vehicleId/latest')
  @RequirePermissions('tracking.read')
  public async latest(@Param('vehicleId') vehicleId: string, @CurrentTenant() tenantId: string) {
    const cached = await this.cache.getLatest(tenantId, vehicleId);
    if (cached) return cached;
    const fromDb = await this.repo.findLatest(tenantId, vehicleId);
    if (!fromDb) {
      throw new HttpException('No position found for this vehicle.', HttpStatus.NOT_FOUND);
    }
    return fromDb;
  }

  /**
   * Position history / historical track (hypertable scan, 07 §12.5; Sprint F §8).
   * Tenant-scoped + validated time range; the row cap bounds the payload (the
   * client-side renderer splits the polyline at large temporal gaps).
   */
  @Get(':vehicleId')
  @RequirePermissions('tracking.read')
  public async range(
    @Param('vehicleId') vehicleId: string,
    @CurrentTenant() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const { fromTime, toTime } = parseTimeRange(from, to);
    // Sprint D §24 — clamp the row cap (a NaN/garbage/huge limit previously
    // passed straight into the hypertable scan).
    const parsed = limit ? Number.parseInt(limit, 10) : 1000;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10_000) : 1000;
    return this.repo.findRange(tenantId, vehicleId, fromTime, toTime, max);
  }
}
