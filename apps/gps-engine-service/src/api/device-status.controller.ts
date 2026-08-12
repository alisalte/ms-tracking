import { JwtAuthGuard, getPrincipal } from '@fleetvision/auth';
/**
 * Device-status REST API — the online/offline/stale projection (06 §12.1).
 *
 *   GET /devices/:deviceId/status  — current device status (Redis → DB).
 *
 * Authenticated: tenant_id comes from the verified JWT principal (INV-I02).
 */
import { Controller, Get, HttpException, HttpStatus, Param, Req, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';
import type { RedisDeviceStatusCache } from '../infrastructure/cache/redis-device-status-cache.js';
import type { DeviceStatusRepository } from '../infrastructure/persistence/device-status.repository.js';
import { DEVICE_STATUS_CACHE, DEVICE_STATUS_REPOSITORY } from './tokens.js';

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DeviceStatusController {
  constructor(
    @Inject(DEVICE_STATUS_CACHE) private readonly cache: RedisDeviceStatusCache,
    @Inject(DEVICE_STATUS_REPOSITORY) private readonly repo: DeviceStatusRepository,
  ) {}

  @Get(':deviceId/status')
  public async status(@Param('deviceId') deviceId: string, @Req() req: Request) {
    const tenantId = getPrincipal(req).tenantId;
    const cached = await this.cache.getStatus(tenantId, deviceId);
    if (cached) return cached;
    const fromDb = await this.repo.find(tenantId, deviceId);
    if (!fromDb) {
      throw new HttpException('No status found for this device.', HttpStatus.NOT_FOUND);
    }
    return fromDb;
  }
}
