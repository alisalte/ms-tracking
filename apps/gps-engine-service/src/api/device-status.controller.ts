import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Device-status REST API — the online/offline/stale projection (06 §12.1).
 *
 *   GET /devices/status           — connection state of every tenant device (Sprint E).
 *   GET /devices/:deviceId/status — current device status (Redis → DB).
 *
 * Sprint B: authentication + `tracking.read` are enforced by the global guards.
 * The tenant is taken from the verified JWT (INV-I02) and threaded through to
 * the repository so a cross-tenant status read is impossible (WS7).
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Param, Query } from '@nestjs/common';
import type { RedisDeviceStatusCache } from '../infrastructure/cache/redis-device-status-cache.js';
import type { DeviceStatusRepository } from '../infrastructure/persistence/device-status.repository.js';
import { DEVICE_STATUS_CACHE, DEVICE_STATUS_REPOSITORY } from './tokens.js';

@Controller('devices')
export class DeviceStatusController {
  constructor(
    @Inject(DEVICE_STATUS_CACHE) private readonly cache: RedisDeviceStatusCache,
    @Inject(DEVICE_STATUS_REPOSITORY) private readonly repo: DeviceStatusRepository,
  ) {}

  /**
   * Connection state for EVERY device in the caller's tenant (Sprint E live-map
   * status/last-seen bootstrap — one request, no N+1). Declared before
   * `:deviceId/status` so the static `status` segment wins the route table.
   */
  @Get('status')
  @RequirePermissions('tracking.read')
  public async list(@CurrentTenant() tenantId: string, @Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 1000;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 5000) : 1000;
    return this.repo.listForTenant(tenantId, max);
  }

  @Get(':deviceId/status')
  @RequirePermissions('tracking.read')
  public async status(@Param('deviceId') deviceId: string, @CurrentTenant() tenantId: string) {
    const cached = await this.cache.getStatus(tenantId, deviceId);
    if (cached) return cached;
    const fromDb = await this.repo.find(tenantId, deviceId);
    if (!fromDb) {
      throw new HttpException('No status found for this device.', HttpStatus.NOT_FOUND);
    }
    return fromDb;
  }
}
