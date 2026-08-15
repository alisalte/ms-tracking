/**
 * FleetRepository — maps the Fleet aggregate to `fleet.fleets`.
 *
 * Reads are tenant-scoped (`WHERE tenant_id = ?::uuid`, the enforcing boundary).
 * Writes accept a transaction so the service can keep them atomic with audit
 * (Sprint C §28) and binding/cascade logic.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
import type { FleetRecord, FleetStatus } from '../../domain/fleet/fleet-types.js';
import { listPaginated } from './list-pagination.js';

const SCHEMA = 'fleet';
const TABLE = 'fleets';

export interface FleetRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly code: string;
  readonly description: string | null;
  readonly status: FleetStatus;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface FleetListFilters {
  readonly status?: FleetStatus;
  readonly search?: string;
}

export class FleetRepository {
  constructor(private readonly knex: Knex) {}

  public async findById(tenantId: string, id: string): Promise<FleetRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .first();
    return (row as FleetRow | undefined) ?? null;
  }

  public async findByCode(tenantId: string, code: string): Promise<FleetRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .where('code', code)
      .first();
    return (row as FleetRow | undefined) ?? null;
  }

  public async list(
    tenantId: string,
    filters: FleetListFilters,
    opts: { cursor?: string; limit: number },
  ): Promise<Page<FleetRow>> {
    const base = this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId]);
    if (filters.status) base.where('status', filters.status);
    if (filters.search) {
      const term = `%${filters.search}%`;
      base.where((b) => b.whereILike('name', term).orWhereILike('code', term));
    }
    return listPaginated<FleetRow>(base, opts);
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
    input: { name: string; code: string; description?: string | null },
  ): Promise<FleetRow> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: trx.raw('?::uuid', [tenantId]),
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        status: 'ACTIVE',
      })
      .returning('*');
    return row as FleetRow;
  }

  public async update(
    trx: Knex.Transaction,
    tenantId: string,
    id: string,
    patch: { name: string; code: string; description?: string | null },
    expectedVersion: number,
  ): Promise<FleetRow | null> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .where('version', expectedVersion)
      .update({
        name: patch.name,
        code: patch.code,
        description: patch.description ?? null,
        updated_at: trx.fn.now(),
        version: trx.raw('version + 1'),
      })
      .returning('*');
    return (row as FleetRow | undefined) ?? null;
  }

  /** Soft-archive (§27): sets status ARCHIVED. Never a hard delete. */
  public async archive(
    trx: Knex.Transaction,
    tenantId: string,
    id: string,
    expectedVersion: number,
  ): Promise<FleetRow | null> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .where('version', expectedVersion)
      .update({ status: 'ARCHIVED', updated_at: trx.fn.now(), version: trx.raw('version + 1') })
      .returning('*');
    return (row as FleetRow | undefined) ?? null;
  }

  public static toRecord(row: FleetRow): FleetRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      code: row.code,
      description: row.description,
      status: row.status,
      version: row.version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
