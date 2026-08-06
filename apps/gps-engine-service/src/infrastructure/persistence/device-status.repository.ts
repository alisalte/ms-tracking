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

  /** Read a device's current status. Null if unknown. */
  public async find(deviceId: string): Promise<DeviceStatusRecord | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
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
}
