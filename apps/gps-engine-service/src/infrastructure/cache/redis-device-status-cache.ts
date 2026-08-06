/**
 * Redis device-status cache — online/offline/stale hot-path projection
 * (06 §12.1, 03 §18.1). Key: `tenant:<tid>:device:<devId>:status`.
 *
 * Write-through from the session-lifecycle consumer; the API reads this first
 * and falls back to `tracking.device_status` on miss. The TTL is generous
 * (1 hour) so a transient Redis blip doesn't lose offline state.
 */
import type { Redis } from '@fleetvision/cache-redis';
import { DeviceStatusRecord } from '../../domain/device-status.js';

interface CachedStatus {
  readonly st: string; // state
  readonly proto: string | null;
  readonly rsn: string | null;
  readonly ts: string; // ISO last-seen
}

const TTL_SECONDS = 3600;

export class RedisDeviceStatusCache {
  constructor(private readonly redis: Redis) {}

  private key(tenantId: string, deviceId: string): string {
    return `tenant:${tenantId}:device:${deviceId}:status`;
  }

  /** Write-through a device-status update (best-effort; never throws). */
  public async setStatus(record: DeviceStatusRecord): Promise<void> {
    const value: CachedStatus = {
      st: record.state,
      proto: record.protocolId,
      rsn: record.reason,
      ts: record.lastSeenAt.toISOString(),
    };
    try {
      await this.redis.set(
        this.key(record.tenantId, record.deviceId),
        JSON.stringify(value),
        'EX',
        TTL_SECONDS,
      );
    } catch {
      /* best-effort */
    }
  }

  /** Read a device's status; null on miss or Redis error. */
  public async getStatus(tenantId: string, deviceId: string): Promise<DeviceStatusRecord | null> {
    try {
      const raw = await this.redis.get(this.key(tenantId, deviceId));
      if (!raw) return null;
      const c = JSON.parse(raw) as CachedStatus;
      return new DeviceStatusRecord({
        deviceId,
        tenantId,
        state: c.st as DeviceStatusRecord['state'],
        protocolId: c.proto,
        reason: c.rsn,
        lastSeenAt: new Date(c.ts),
      });
    } catch {
      return null;
    }
  }
}
