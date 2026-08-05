/**
 * BaseRepository — the thin knex-crud foundation every aggregate repository
 * extends (Codebase Architecture §7 / §10). No ORM magic: each concrete
 * repository owns its SQL and its domain↔row mapper. This base removes only the
 * repetitive CRUD scaffolding so the concrete class reads as domain intent.
 *
 * Multi-tenancy (INV-I02): every table is tenant-scoped, so `tenantId` is a
 * mandatory filter on every read/write. Concrete repositories receive it from
 * the request-scoped TenantContext rather than a method argument — that contract
 * is enforced by the application layer; the base trusts the supplied scope.
 */
import type { Knex } from './knex.factory.js';

/** Universal row shape every table shares (docs/specs/03_Database_Architecture.md §3.4). */
export interface Row {
  readonly id: string;
  readonly tenant_id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
}

export interface BaseRepositoryOptions {
  /** knex query builder bound to the right table. */
  table: Knex.QueryBuilder;
  /** The table name (for raw SQL when the builder is insufficient). */
  tableName: string;
}

export abstract class BaseRepository<TRow extends Row> {
  protected readonly table: Knex.QueryBuilder;
  protected readonly tableName: string;

  constructor(opts: BaseRepositoryOptions) {
    this.table = opts.table;
    this.tableName = opts.tableName;
  }

  /** Find a row by id, scoped to the tenant. Returns null when absent. */
  public async findById(tenantId: string, id: string): Promise<TRow | null> {
    const row = await this.table.where({ id, tenant_id: tenantId }).first();
    return (row as TRow | undefined) ?? null;
  }

  /** Paginated, tenant-scoped list ordered by created_at (oldest first). */
  public async list(
    tenantId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ rows: TRow[]; total: number }> {
    const [rows, countRow] = await Promise.all([
      this.table
        .where({ tenant_id: tenantId })
        .orderBy('created_at', 'asc')
        .limit(limit)
        .offset(offset),
      this.table.count({ total: '*' }).where({ tenant_id: tenantId }).first(),
    ]);
    const total = countRow ? Number((countRow as { total: string }).total) : 0;
    return { rows: rows as TRow[], total };
  }

  /** Insert a full row and return it. */
  public async insert(row: TRow): Promise<TRow> {
    const [inserted] = await this.table.insert(row).returning('*');
    return inserted as TRow;
  }

  /**
   * Patch a row by id within the tenant, bumping optimistic-concurrency version.
   * Returns the updated row or null if not found / version mismatch.
   */
  public async update(
    tenantId: string,
    id: string,
    patch: Partial<TRow>,
    expectedVersion?: number,
  ): Promise<TRow | null> {
    const clause: Record<string, unknown> = { id, tenant_id: tenantId };
    if (expectedVersion !== undefined) {
      clause.version = expectedVersion;
    }
    const [updated] = await this.table
      .update({ ...patch, version: this.table.client.raw('version + 1') })
      .where(clause)
      .returning('*');
    return (updated as TRow | undefined) ?? null;
  }

  /** Delete a row by id within the tenant. Returns rows affected (0 or 1). */
  public async delete(tenantId: string, id: string): Promise<number> {
    return this.table.delete().where({ id, tenant_id: tenantId });
  }
}
