/**
 * Business trip repository — CRUD for fleet.business_trips. Tenant-scoped.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { type Page, toCursor } from '@fleetvision/shared-kernel';
import {
  type BusinessTrip,
  BusinessTrip as TripClass,
  type TripStatus,
} from '../../domain/index.js';

export interface BusinessTripRow {
  id: string;
  tenant_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  status: TripStatus;
  origin_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_label: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  distance_km: number;
  duration_sec: number;
  purpose: string | null;
  notes: string | null;
  planned_start: Date | null;
  planned_end: Date | null;
  actual_start: Date | null;
  actual_end: Date | null;
  version: number;
  created_at: Date;
}

export interface TripFilters {
  status?: TripStatus;
  driverId?: string;
  vehicleId?: string;
}

export class BusinessTripRepository {
  constructor(private readonly knex: Knex) {}

  public async create(trip: BusinessTrip): Promise<void> {
    await withTenantContext(this.knex, trip.tenantId, async (trx) => {
      await trx('fleet.business_trips').insert({
        id: trip.id,
        tenant_id: trip.tenantId,
        driver_id: trip.driverId,
        vehicle_id: trip.vehicleId,
        status: trip.status,
        origin_label: trip.originLabel,
        origin_lat: trip.originLat,
        origin_lng: trip.originLng,
        destination_label: trip.destinationLabel,
        destination_lat: trip.destinationLat,
        destination_lng: trip.destinationLng,
        distance_km: trip.distanceKm,
        duration_sec: trip.durationSec,
        purpose: trip.purpose,
        notes: trip.notes,
        planned_start: trip.plannedStart,
        planned_end: trip.plannedEnd,
      });
    });
  }

  public async findById(tenantId: string, id: string): Promise<BusinessTrip | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<BusinessTripRow>('fleet.business_trips')
        .where({ id, tenant_id: tenantId })
        .first();
      return row ? this.toDomain(row) : null;
    });
  }

  public async listPage(
    tenantId: string,
    limit: number,
    filters: TripFilters,
    cursor?: { createdAt: string; id: string },
  ): Promise<Page<BusinessTrip>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      let query = trx<BusinessTripRow>('fleet.business_trips').where({ tenant_id: tenantId });
      if (filters.status) query = query.where({ status: filters.status });
      if (filters.driverId) query = query.where({ driver_id: filters.driverId });
      if (filters.vehicleId) query = query.where({ vehicle_id: filters.vehicleId });
      if (cursor) {
        query = query.where((q) =>
          q
            .where('created_at', '<', cursor.createdAt)
            .orWhere((q2) =>
              q2.where('created_at', '=', cursor.createdAt).andWhere('id', '<', cursor.id),
            ),
        );
      }
      const rows = (await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1)) as BusinessTripRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        data: page.map((r) => this.toDomain(r)),
        nextCursor:
          hasMore && last ? toCursor('created_at', last.created_at.toISOString(), last.id) : null,
      };
    });
  }

  public async update(trip: BusinessTrip): Promise<void> {
    await withTenantContext(this.knex, trip.tenantId, async (trx) => {
      const updated = await trx('fleet.business_trips')
        .where({ id: trip.id, tenant_id: trip.tenantId, version: trip.version })
        .update({
          driver_id: trip.driverId,
          vehicle_id: trip.vehicleId,
          status: trip.status,
          origin_label: trip.originLabel,
          destination_label: trip.destinationLabel,
          distance_km: trip.distanceKm,
          duration_sec: trip.durationSec,
          purpose: trip.purpose,
          notes: trip.notes,
          planned_start: trip.plannedStart,
          planned_end: trip.plannedEnd,
          actual_start: trip.actualStart,
          actual_end: trip.actualEnd,
          version: this.knex.raw('version + 1'),
          updated_at: this.knex.fn.now(),
        });
      if (updated === 0)
        throw new Error('Optimistic concurrency conflict on business trip update.');
    });
  }

  private toDomain(row: BusinessTripRow): BusinessTrip {
    return TripClass.rehydrate(row.id, row.version, {
      tenantId: row.tenant_id,
      driverId: row.driver_id,
      vehicleId: row.vehicle_id,
      status: row.status,
      originLabel: row.origin_label,
      originLat: row.origin_lat,
      originLng: row.origin_lng,
      destinationLabel: row.destination_label,
      destinationLat: row.destination_lat,
      destinationLng: row.destination_lng,
      distanceKm: row.distance_km,
      durationSec: row.duration_sec,
      purpose: row.purpose,
      notes: row.notes,
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end,
      actualStart: row.actual_start,
      actualEnd: row.actual_end,
    });
  }
}
