import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Positions REST API (07 §12.5 replay; last-position cache→DB fallback §13.5).
 *
 *   GET /positions/latest                 — latest position per vehicle for the tenant (Sprint E).
 *   GET /positions/:vehicleId/latest      — last known position (Redis → DB).
 *   GET /positions/:vehicleId?from=&to=   — position history (hypertable scan).
 *
 * Sprint B: authentication + `tracking.read` are enforced by the global guards.
 * The tenant is taken from the verified JWT (INV-I02) — never a client header.
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Param, Query } from '@nestjs/common';
import type { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
import type { PositionRepository } from '../infrastructure/persistence/position.repository.js';
import { POSITION_CACHE, POSITION_REPOSITORY } from './tokens.js';

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
  public async latestForTenant(
    @CurrentTenant() tenantId: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Number.parseInt(limit, 10) : 500;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 2000) : 500;
    return this.repo.findLatestForTenant(tenantId, max);
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

  /** Position history range (hypertable scan, 07 §12.5). */
  @Get(':vehicleId')
  @RequirePermissions('tracking.read')
  public async range(
    @Param('vehicleId') vehicleId: string,
    @CurrentTenant() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const now = new Date();
    const fromTime = from ? new Date(from) : new Date(now.getTime() - 86_400_000); // default 24h
    const toTime = to ? new Date(to) : now;
    // Sprint D §24 — clamp the row cap (a NaN/garbage/huge limit previously
    // passed straight into the hypertable scan).
    const parsed = limit ? Number.parseInt(limit, 10) : 1000;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10_000) : 1000;
    return this.repo.findRange(tenantId, vehicleId, fromTime, toTime, max);
  }
}
