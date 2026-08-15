/**
 * Device status repository — `tracking.device_status` projection (06 §12.1).
 *
 * Upserts a device's online/offline/stale state from the gateway's
 * session-lifecycle events. Single row per device (primary key).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { DeviceStatusRecord } from '../../domain/device-status.js';

const TABLE = 'device_status';
const SCHEMA = 'tracking';

export class DeviceStatusRepository {
  constructor(private readonly knex: Knex) {}

  /** Insert or update a device's status (idempotent on device_id). */
  public async upsert(record: DeviceStatusRecord): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        device_id: this.knex.raw('?::uuid', [record.deviceId]),
        tenant_id: this.knex.raw('?::uuid', [record.tenantId]),
        state: record.state,
        protocol_id: record.protocolId,
        reason: record.reason,
        last_seen_at: record.lastSeenAt,
        updated_at: this.knex.fn.now(),
      })
      .onConflict('device_id')
      .merge();
  }

  /**
   * Read a device's current status, scoped to the caller's tenant (Sprint B
   * WS7). Null if unknown OR if the device belongs to a different tenant — so a
   * cross-tenant caller learns nothing (no enumeration oracle).
   */
  public async find(tenantId: string, deviceId: string): Promise<DeviceStatusRecord | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('device_id = ?::uuid', [deviceId])
      .first();
    if (!row) return null;
    return new DeviceStatusRecord({
      deviceId: String(row.device_id),
      tenantId: String(row.tenant_id),
      state: row.state,
      protocolId: row.protocol_id ?? null,
      reason: row.reason ?? null,
      lastSeenAt: new Date(row.last_seen_at),
    });
  }

  /**
   * Refresh last_seen_at only (Sprint D §9). Called throttled from the position
   * pipeline (≈ once per GPS_LAST_SEEN_FLUSH_SECONDS per device — never per
   * packet). UPDATE-only: 0 rows when the lifecycle pipeline hasn't created the
   * device's row yet (it will, on the next lifecycle event).
   */
  public async touchLastSeen(tenantId: string, deviceId: string, lastSeenAt: Date): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('device_id = ?::uuid', [deviceId])
      .update({ last_seen_at: lastSeenAt, updated_at: this.knex.fn.now() });
  }

  /**
   * ONLINE → STALE sweep (Sprint D §10): transitions devices whose last_seen_at
   * is older than `staleAfterSeconds` (covers a crashed gateway that never
   * emitted DISCONNECTED — the Redis session entry TTL-expires and the next
   * reconnect re-ONLINEs the device). Returns the transitioned rows so the
   * caller can broadcast STALE signals.
   */
  public async markStale(staleAfterSeconds: number, limit = 500): Promise<DeviceStatusRecord[]> {
    const rows = (await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw("state = 'ONLINE' AND last_seen_at < now() - (? || ' seconds')::interval", [
        String(staleAfterSeconds),
      ])
      .limit(limit)
      .update({ state: 'STALE', updated_at: this.knex.fn.now() })
      .returning([
        'device_id',
        'tenant_id',
        'state',
        'protocol_id',
        'reason',
        'last_seen_at',
      ])) as Record<string, unknown>[];
    return rows.map(
      (row) =>
        new DeviceStatusRecord({
          deviceId: String(row.device_id),
          tenantId: String(row.tenant_id),
          state: row.state as DeviceStatusRecord['state'],
          protocolId: (row.protocol_id as string | null) ?? null,
          reason: (row.reason as string | null) ?? null,
          lastSeenAt: new Date(row.last_seen_at as string),
        }),
    );
  }
}
