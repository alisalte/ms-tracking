/**
 * SessionRedisStore — the global (Redis) tier of the two-tier session store
 * (06 §6.2, §16.1).
 *
 * Keys follow the canonical `tenant:<tid>:` namespace (06 §6.2 / 03 §18.3):
 *   tenant:<tid>:device:<did>:session → JSON {instanceID, sessionID, protocol,
 *                                          transport, since, lastSeen, ...}
 *
 * TTL: 60s for TCP (06 §16.1), 2x report interval for UDP pseudo-sessions
 * (06 §4.4). The owning instance writes here; any pod reads here to answer
 * "which pod holds this device?" for downstream command dispatch (06 §6.2).
 */
import type { Redis } from '@fleetvision/cache-redis';
import type { DeviceSessionSnapshot } from '../../domain/device-session.js';

/** Redis value shape (JSON). Field names match 06 §16.1. */
export interface SessionRedisValue {
  readonly instanceID: string;
  readonly sessionID: string;
  readonly protocol: string;
  readonly transport: string;
  readonly state: string;
  readonly deviceId: string;
  readonly tenantId: string;
  readonly serialOrImei: string | null;
  readonly remoteAddress: string;
  readonly remotePort: number;
  readonly since: string;
  readonly lastSeen: string;
  readonly firstDataAt: string | null;
  readonly lastDataAt: string | null;
  readonly closeReason: string | null;
}

export class SessionRedisStore {
  constructor(private readonly redis: Redis) {}

  /** Build the global key for a device's session. */
  private key(tenantId: string, deviceId: string): string {
    return `tenant:${tenantId}:device:${deviceId}:session`;
  }

  /**
   * Upsert a session globally with a TTL. On reconnect (roaming between pods),
   * last-write-wins on Redis — the prior instance detects its session superseded
   * (06 §6.3). Returns true if this write displaced a different instance's session.
   */
  public async upsert(
    tenantId: string,
    deviceId: string,
    value: SessionRedisValue,
    ttlSeconds: number,
  ): Promise<{ displaced: boolean }> {
    const key = this.key(tenantId, deviceId);
    const prevRaw = await this.redis.get(key);
    let displaced = false;
    if (prevRaw) {
      try {
        const prev = JSON.parse(prevRaw) as SessionRedisValue;
        if (prev.instanceID !== value.instanceID) displaced = true;
      } catch {
        // Corrupt entry — treat as displaced so the caller can reconcile.
        displaced = true;
      }
    }
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    return { displaced };
  }

  /** Read the global session entry for a device (cross-instance lookup). */
  public async get(tenantId: string, deviceId: string): Promise<SessionRedisValue | null> {
    const raw = await this.redis.get(this.key(tenantId, deviceId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionRedisValue;
    } catch {
      return null;
    }
  }

  /** Remove the global session entry (on close / disconnect). */
  public async remove(tenantId: string, deviceId: string): Promise<void> {
    await this.redis.del(this.key(tenantId, deviceId));
  }

  /** Convenience: upsert from a domain snapshot. */
  public async upsertSnapshot(
    snapshot: DeviceSessionSnapshot,
    ttlSeconds: number,
    instanceId: string,
  ): Promise<{ displaced: boolean }> {
    if (!snapshot.tenantId || !snapshot.deviceId) {
      // Cannot key globally until the device is resolved (pre-auth). No-op.
      return { displaced: false };
    }
    const value: SessionRedisValue = {
      instanceID: instanceId,
      sessionID: snapshot.sessionId,
      protocol: snapshot.protocolId,
      transport: snapshot.transport,
      state: snapshot.state,
      deviceId: snapshot.deviceId,
      tenantId: snapshot.tenantId,
      serialOrImei: snapshot.serialOrImei,
      remoteAddress: snapshot.remoteAddress,
      remotePort: snapshot.remotePort,
      since: snapshot.since,
      lastSeen: snapshot.lastSeen,
      firstDataAt: snapshot.firstDataAt,
      lastDataAt: snapshot.lastDataAt,
      closeReason: snapshot.closeReason,
    };
    return this.upsert(snapshot.tenantId, snapshot.deviceId, value, ttlSeconds);
  }
}
