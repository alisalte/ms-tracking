/**
 * VehicleRepository — maps the Vehicle aggregate to `fleet.vehicles`.
 * Tenant + fleet scoped. Writes accept a transaction for atomic audit/binding.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
import type { VehicleRecord, VehicleStatus } from '../../domain/vehicle/vehicle-types.js';
import { listPaginated } from './list-pagination.js';

const SCHEMA = 'fleet';
const TABLE = 'vehicles';

export interface VehicleRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly fleet_id: string;
  readonly name: string;
  readonly code: string;
  readonly plate: string | null;
  readonly vin: string | null;
  readonly status: VehicleStatus;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface VehicleListFilters {
  readonly fleetId?: string;
  readonly status?: VehicleStatus;
  readonly search?: string;
}

export class VehicleRepository {
  constructor(private readonly knex: Knex) {}

  public async findById(tenantId: string, id: string): Promise<VehicleRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .first();
    return (row as VehicleRow | undefined) ?? null;
  }

  /** Tenant-scoped lookup by the short code (Excel import). */
  public async findByCode(tenantId: string, code: string): Promise<VehicleRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .where('code', code)
      .first();
    return (row as VehicleRow | undefined) ?? null;
  }

  public async list(
    tenantId: string,
    filters: VehicleListFilters,
    opts: { cursor?: string; limit: number },
  ): Promise<Page<VehicleRow>> {
    const base = this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId]);
    if (filters.fleetId) base.whereRaw('fleet_id = ?::uuid', [filters.fleetId]);
    if (filters.status) base.where('status', filters.status);
    if (filters.search) {
      const term = `%${filters.search}%`;
      base.where((b) =>
        b.whereILike('name', term).orWhereILike('code', term).orWhereILike('plate', term),
      );
    }
    return listPaginated<VehicleRow>(base, opts);
  }

  /** Row counts per status for the tenant (Sprint E dashboard summary). */
  public async countByStatus(tenantId: string): Promise<Record<string, number>> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .select('status')
      .count<{ status: string; count: string | number }[]>({ count: '*' })
      .groupBy('status');
    const out: Record<string, number> = {};
    for (const row of rows) out[row.status] = Number(row.count);
    return out;
  }

  public async create(
    trx: Knex.Transaction,
    tenantId: string,
    input: {
      fleetId: string;
      name: string;
      code: string;
      plate?: string | null;
      vin?: string | null;
    },
  ): Promise<VehicleRow> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: trx.raw('?::uuid', [tenantId]),
        fleet_id: trx.raw('?::uuid', [input.fleetId]),
        name: input.name,
        code: input.code,
        plate: input.plate ?? null,
        vin: input.vin ?? null,
        status: 'ACTIVE',
      })
      .returning('*');
    return row as VehicleRow;
  }

  public async update(
    trx: Knex.Transaction,
    tenantId: string,
    id: string,
    patch: {
      fleetId?: string;
      name: string;
      code: string;
      plate?: string | null;
      vin?: string | null;
    },
    expectedVersion: number,
  ): Promise<VehicleRow | null> {
    const updates: Record<string, unknown> = {
      name: patch.name,
      code: patch.code,
      plate: patch.plate ?? null,
      vin: patch.vin ?? null,
      updated_at: trx.fn.now(),
      version: trx.raw('version + 1'),
    };
    if (patch.fleetId) updates.fleet_id = trx.raw('?::uuid', [patch.fleetId]);
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .where('version', expectedVersion)
      .update(updates)
      .returning('*');
    return (row as VehicleRow | undefined) ?? null;
  }

  public async archive(
    trx: Knex.Transaction,
    tenantId: string,
    id: string,
    expectedVersion: number,
  ): Promise<VehicleRow | null> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .where('version', expectedVersion)
      .update({ status: 'ARCHIVED', updated_at: trx.fn.now(), version: trx.raw('version + 1') })
      .returning('*');
    return (row as VehicleRow | undefined) ?? null;
  }

  public static toRecord(row: VehicleRow): VehicleRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      fleetId: row.fleet_id,
      name: row.name,
      code: row.code,
      plate: row.plate,
      vin: row.vin,
      status: row.status,
      version: row.version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
