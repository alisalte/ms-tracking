/** Orthophoto metadata in `geo.orthophotos`; every tenant read filters by tenant_id. */
import type { Knex } from '@fleetvision/persistence-knex';
import type { LngLatBounds } from '../../domain/orthophoto.js';

const SCHEMA = 'geo';
const TABLE = 'orthophotos';

export interface OrthophotoRow {
  id: string;
  tenant_id: string;
  original_name: string;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  min_lng: number | null;
  min_lat: number | null;
  max_lng: number | null;
  max_lat: number | null;
  min_zoom: number | null;
  max_zoom: number | null;
  cog_bytes: string | number | null;
  created_at: string | Date;
  ready_at: string | Date | null;
}

/** Thrown when the tenant already has a conversion running. */
export class OrthophotoBusyError extends Error {}

export class OrthophotoRepository {
  constructor(private readonly knex: Knex) {}

  private table(db: Knex | Knex.Transaction = this.knex) {
    return db.withSchema(SCHEMA).from<OrthophotoRow>(TABLE);
  }

  public async listForTenant(tenantId: string): Promise<OrthophotoRow[]> {
    return this.table().where({ tenant_id: tenantId }).orderBy('created_at', 'desc');
  }

  public async createProcessing(input: {
    tenantId: string;
    originalName: string;
    createdBy: string | null;
  }): Promise<string> {
    try {
      return await this.knex.transaction(async (trx) => {
        await this.table(trx).where({ tenant_id: input.tenantId, status: 'failed' }).delete();
        const [row] = await trx
          .withSchema(SCHEMA)
          .from(TABLE)
          .insert({
            tenant_id: input.tenantId,
            original_name: input.originalName,
            status: 'processing',
            created_by: input.createdBy,
          })
          .returning('id');
        return row.id as string;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new OrthophotoBusyError();
      throw err;
    }
  }

  /** Atomically publish `id` and return the ids of the versions it replaced. */
  public async activate(
    tenantId: string,
    id: string,
    meta: LngLatBounds & { minZoom: number; maxZoom: number; cogBytes: number },
  ): Promise<string[]> {
    return this.knex.transaction(async (trx) => {
      const old = await this.table(trx)
        .where({ tenant_id: tenantId, status: 'ready' })
        .delete()
        .returning('id');
      await this.table(trx)
        .where({ tenant_id: tenantId, id })
        .update({
          status: 'ready',
          min_lng: meta.minLng,
          min_lat: meta.minLat,
          max_lng: meta.maxLng,
          max_lat: meta.maxLat,
          min_zoom: meta.minZoom,
          max_zoom: meta.maxZoom,
          cog_bytes: meta.cogBytes,
          ready_at: trx.fn.now() as unknown as string,
        });
      return old.map((row) => row.id);
    });
  }

  public async markFailed(tenantId: string, id: string, error: string): Promise<void> {
    await this.table().where({ tenant_id: tenantId, id }).update({ status: 'failed', error });
  }

  /** After a restart nothing is converting any more: fail the orphans. */
  public async failInterrupted(error: string): Promise<void> {
    await this.table().where({ status: 'processing' }).update({ status: 'failed', error });
  }

  public async deleteReady(tenantId: string): Promise<string[]> {
    const rows = await this.table()
      .where({ tenant_id: tenantId, status: 'ready' })
      .delete()
      .returning('id');
    return rows.map((row) => row.id);
  }
}
