/**
 * Positions REST API (07 §12.5 replay; last-position cache→DB fallback §13.5).
 *
 *   GET /positions/:vehicleId/latest        — last known position (Redis → DB).
 *   GET /positions/:vehicleId?from=&to=      — position history (hypertable scan).
 *
 * Tenant scoping is via the `tenant-id` header/query for Sprint 7 (the identity-
 * service JWT middleware integrates in a later sprint to set this from the token).
 */
import { Controller, Get, HttpException, HttpStatus, Param, Query, Req } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';
import type { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
import type { PositionRepository } from '../infrastructure/persistence/position.repository.js';
import { POSITION_CACHE, POSITION_REPOSITORY } from './tokens.js';

@Controller('positions')
export class PositionsController {
  constructor(
    @Inject(POSITION_CACHE) private readonly cache: RedisPositionCache,
    @Inject(POSITION_REPOSITORY) private readonly repo: PositionRepository,
  ) {}

  /** Latest position: Redis cache → TimescaleDB fallback (07 §13.5). */
  @Get(':vehicleId/latest')
  public async latest(@Param('vehicleId') vehicleId: string, @Req() req: Request) {
    const tenantId = tenantOf(req);
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
  public async range(
    @Param('vehicleId') vehicleId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ) {
    const tenantId = tenantOf(req);
    const now = new Date();
    const fromTime = from ? new Date(from) : new Date(now.getTime() - 86_400_000); // default 24h
    const toTime = to ? new Date(to) : now;
    const max = limit ? Number.parseInt(limit, 10) : 1000;
    return this.repo.findRange(tenantId, vehicleId, fromTime, toTime, max);
  }
}

/** Extract the tenant id from the request (header or query; JWT later). */
function tenantOf(req?: Request): string {
  const tid =
    (req?.headers['tenant-id'] as string | undefined) ??
    (req?.query['tenant-id'] as string | undefined);
  if (!tid) {
    throw new HttpException('tenant-id header or query is required.', HttpStatus.BAD_REQUEST);
  }
  return tid;
}
