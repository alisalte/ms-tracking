/**
 * Alarm occurrence repository — persists + queries notification.alerts.
 * Tenant-scoped via withTenantContext (RLS enforced). Cursor-paginated reads
 * with filters (status/severity/vehicleId/dateRange).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { type Page, toCursor } from '@fleetvision/shared-kernel';
import {
  type AlarmOccurrence,
  type AlarmSeverity,
  type AlarmStatus,
  AlarmOccurrence as OccurrenceClass,
} from '../../domain/index.js';

export interface AlarmOccurrenceRow {
  id: string;
  tenant_id: string;
  rule_id: string;
  type: string;
  severity: AlarmSeverity;
  status: AlarmStatus;
  vehicle_id: string | null;
  lat: number | null;
  lng: number | null;
  message: string;
  detail: Record<string, unknown>;
  source_events: unknown[];
  raised_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_reason: string | null;
  version: number;
}

export interface AlarmListFilters {
  status?: AlarmStatus;
  severity?: AlarmSeverity;
  vehicleId?: string;
  from?: Date;
  to?: Date;
}

export class AlarmOccurrenceRepository {
  constructor(private readonly knex: Knex) {}

  /** Create (raise) a new alarm occurrence. */
  public async create(alarm: AlarmOccurrence): Promise<void> {
    await withTenantContext(this.knex, alarm.tenantId, async (trx) => {
      await trx('notification.alerts').insert({
        id: alarm.id,
        tenant_id: alarm.tenantId,
        rule_id: alarm.ruleId,
        type: alarm.type,
        severity: alarm.severity,
        status: alarm.status,
        vehicle_id: alarm.vehicleId,
        lat: alarm.lat,
        lng: alarm.lng,
        message: alarm.message,
        detail: JSON.stringify(alarm.detail),
        source_events: JSON.stringify(alarm.sourceEvents),
        raised_at: alarm.raisedAt,
        version: alarm.version,
      });
    });
  }

  /** Find an alarm by id. */
  public async findById(tenantId: string, id: string): Promise<AlarmOccurrence | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<AlarmOccurrenceRow>('notification.alerts')
        .where({ id, tenant_id: tenantId })
        .first();
      return row ? this.toDomain(row) : null;
    });
  }

  /**
   * Sprint G Part 12 — the one-open-alarm gate: find the OPEN alarm for a
   * (rule, vehicle, type) triple, if any. Additional detections while this
   * row exists update its detail instead of creating new OPEN alarms.
   */
  public async findOpenByRuleAndVehicle(
    tenantId: string,
    ruleId: string,
    vehicleId: string,
    type: string,
  ): Promise<AlarmOccurrence | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<AlarmOccurrenceRow>('notification.alerts')
        .where({
          tenant_id: tenantId,
          rule_id: ruleId,
          vehicle_id: vehicleId,
          type,
          status: 'OPEN',
        })
        .orderBy('raised_at', 'desc')
        .first();
      return row ? this.toDomain(row) : null;
    });
  }

  /**
   * Sprint G Part 12 — merge detection metadata into an OPEN alarm's detail
   * (occurrenceCount/lastSeenAt/last detection). Optimistic-versioned.
   */
  public async updateDetail(
    alarm: AlarmOccurrence,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await withTenantContext(this.knex, alarm.tenantId, async (trx) => {
      await trx('notification.alerts')
        .where({ id: alarm.id, tenant_id: alarm.tenantId, version: alarm.version })
        .update({
          detail: JSON.stringify(detail),
          version: this.knex.raw('version + 1'),
          updated_at: this.knex.fn.now(),
        });
    });
  }

  /**
   * Cursor-paginated list with optional filters. Ordered by raised_at DESC + id
   * for stable keyset pagination.
   */
  public async listPage(
    tenantId: string,
    limit: number,
    filters: AlarmListFilters,
    cursor?: { raisedAt: string; id: string },
  ): Promise<Page<AlarmOccurrence>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      let query = trx<AlarmOccurrenceRow>('notification.alerts').where({ tenant_id: tenantId });
      if (filters.status) query = query.where({ status: filters.status });
      if (filters.severity) query = query.where({ severity: filters.severity });
      if (filters.vehicleId) query = query.where({ vehicle_id: filters.vehicleId });
      if (filters.from) query = query.where('raised_at', '>=', filters.from);
      if (filters.to) query = query.where('raised_at', '<=', filters.to);
      if (cursor) {
        query = query.where((q) =>
          q
            .where('raised_at', '<', cursor.raisedAt)
            .orWhere((q2) =>
              q2.where('raised_at', '=', cursor.raisedAt).andWhere('id', '<', cursor.id),
            ),
        );
      }
      const rows = (await query
        .orderBy('raised_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1)) as AlarmOccurrenceRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? toCursor('raised_at', last.raised_at.toISOString(), last.id) : null;
      return { data: page.map((r) => this.toDomain(r)), nextCursor };
    });
  }

  /** Persist a lifecycle transition (acknowledge/resolve) + append audit row. */
  public async updateStatus(
    alarm: AlarmOccurrence,
    action: 'ACKNOWLEDGE' | 'RESOLVE',
    previousStatus: AlarmStatus,
    newStatus: AlarmStatus,
    actorId: string | null,
    reason?: string,
  ): Promise<void> {
    await withTenantContext(this.knex, alarm.tenantId, async (trx) => {
      await trx('notification.alerts')
        .where({ id: alarm.id, tenant_id: alarm.tenantId, version: alarm.version })
        .update({
          status: newStatus,
          acknowledged_at: alarm.acknowledgedAt,
          acknowledged_by: alarm.acknowledgedBy,
          resolved_at: alarm.resolvedAt,
          resolved_by: alarm.resolvedBy,
          resolution_reason: alarm.resolutionReason,
          version: this.knex.raw('version + 1'),
          updated_at: this.knex.fn.now(),
        });
      await trx('notification.alert_acknowledgements').insert({
        tenant_id: alarm.tenantId,
        alert_id: alarm.id,
        action,
        actor_id: actorId,
        reason: reason ?? null,
        previous_status: previousStatus,
        new_status: newStatus,
      });
    });
  }

  private toDomain(row: AlarmOccurrenceRow): AlarmOccurrence {
    return OccurrenceClass.rehydrate(row.id, row.version, {
      tenantId: row.tenant_id,
      ruleId: row.rule_id,
      type: row.type,
      severity: row.severity,
      status: row.status,
      vehicleId: row.vehicle_id,
      lat: row.lat,
      lng: row.lng,
      message: row.message,
      detail: row.detail ?? {},
      sourceEvents: Array.isArray(row.source_events) ? row.source_events : [],
      raisedAt: row.raised_at,
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBy: row.acknowledged_by,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      resolutionReason: row.resolution_reason,
    });
  }
}
