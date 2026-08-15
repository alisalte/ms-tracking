/**
 * FleetEvent repository — idempotent persistence + tenant-scoped queries for
 * notification.fleet_events (Sprint G Part 35).
 *
 * `record` uses ON CONFLICT (id) DO NOTHING: the PK IS the deterministic
 * eventId, so a Kafka redelivery never duplicates a row (Part 6).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { type Page, toCursor } from '@fleetvision/shared-kernel';

export interface FleetEventRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly vehicleId: string | null;
  readonly deviceId: string | null;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly severity: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface FleetEventFilters {
  vehicleId?: string;
  eventType?: string;
  from?: Date;
  to?: Date;
  severity?: string;
}

export interface FleetEventRow {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  device_id: string | null;
  event_type: string;
  occurred_at: Date;
  severity: string | null;
  metadata: Record<string, unknown>;
}

export class FleetEventRepository {
  constructor(private readonly knex: Knex) {}

  /** Idempotently record a consumed FleetEvent (PK = eventId). */
  public async record(event: FleetEventRecord): Promise<void> {
    await withTenantContext(this.knex, event.tenantId, async (trx) => {
      await trx('notification.fleet_events')
        .insert({
          id: event.id,
          tenant_id: event.tenantId,
          vehicle_id: event.vehicleId,
          device_id: event.deviceId,
          event_type: event.eventType,
          occurred_at: event.occurredAt,
          severity: event.severity,
          metadata: JSON.stringify(event.metadata ?? {}),
        })
        .onConflict('id')
        .ignore();
    });
  }

  /** Cursor-paginated, filtered event history (occurred_at DESC, stable keyset). */
  public async listPage(
    tenantId: string,
    limit: number,
    filters: FleetEventFilters,
    cursor?: { occurredAt: string; id: string },
  ): Promise<Page<FleetEventRow>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      let query = trx<FleetEventRow>('notification.fleet_events').where({ tenant_id: tenantId });
      if (filters.vehicleId) query = query.where({ vehicle_id: filters.vehicleId });
      if (filters.eventType) query = query.where({ event_type: filters.eventType });
      if (filters.severity) query = query.where({ severity: filters.severity });
      if (filters.from) query = query.where('occurred_at', '>=', filters.from);
      if (filters.to) query = query.where('occurred_at', '<=', filters.to);
      if (cursor) {
        query = query.where((q) =>
          q
            .where('occurred_at', '<', cursor.occurredAt)
            .orWhere((q2) =>
              q2.where('occurred_at', '=', cursor.occurredAt).andWhere('id', '<', cursor.id),
            ),
        );
      }
      const rows = (await query
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1)) as FleetEventRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? toCursor('occurred_at', last.occurred_at.toISOString(), last.id) : null;
      return { data: page, nextCursor };
    });
  }
}
