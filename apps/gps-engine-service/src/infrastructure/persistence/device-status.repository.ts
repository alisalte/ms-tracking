/**
 * Device status repository — `tracking.device_status` projection (06 §12.1).
 *
 * Upserts a device's online/offline/stale state from the gateway's
 * session-lifecycle events. Single row per device (primary key).
 *
 * Reads are tenant-scoped (withTenantContext) so RLS enforces isolation; the
 * explicit tenant_id filter is belt-and-braces. Writes come from the ingestion
 * pipeline which carries the verified tenant_id in the event payload.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { DeviceStatusRecord } from '../../domain/device-status.js';

const TABLE = 'device_status';
const SCHEMA = 'tracking';

export class DeviceStatusRepository {
  constructor(private readonly knex: Knex) {}

  /** Insert or update a device's status (idempotent on device_id). */
  public async upsert(record: DeviceStatusRecord): Promise<void> {
    // Writes carry the verified tenant_id from the ingestion event; run under
    // tenant context so the RLS WITH CHECK admits the row.
    await withTenantContext(this.knex, record.tenantId, async (trx) => {
      await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .insert({
          device_id: trx.raw('?::uuid', [record.deviceId]),
          tenant_id: trx.raw('?::uuid', [record.tenantId]),
          state: record.state,
          protocol_id: record.protocolId,
          reason: record.reason,
          last_seen_at: record.lastSeenAt,
          updated_at: trx.fn.now(),
        })
        .onConflict('device_id')
        .merge();
    });
  }

  /** Read a device's current status within the caller's tenant. Null if unknown. */
  public async find(tenantId: string, deviceId: string): Promise<DeviceStatusRecord | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx
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
    });
  }
}
