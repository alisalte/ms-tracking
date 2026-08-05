/**
 * API key repository — maps the ApiKey aggregate to `iam.api_keys`.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import {
  type ApiKey,
  ApiKey as ApiKeyClass,
  type ApiKeyProps,
  type ApiKeyStatus,
  type EventContext,
} from '../../domain/index.js';
import { withTenantContext } from './tenant-context.js';

export interface ApiKeyRow {
  id: string;
  tenant_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  assigned_user_id: string | null;
  expires_at: Date | null;
  last_used_at: Date | null;
  status: ApiKeyStatus;
  ip_allowlist: string[];
  version: number;
}

export class ApiKeyRepository {
  constructor(private readonly knex: Knex) {}

  public async findById(tenantId: string, id: string): Promise<ApiKey | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<ApiKeyRow>('iam.api_keys').where({ id, tenant_id: tenantId }).first();
      return row ? this.toDomain(row) : null;
    });
  }

  public async list(tenantId: string): Promise<ApiKey[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx<ApiKeyRow>('iam.api_keys')
        .where({ tenant_id: tenantId })
        .orderBy('created_at', 'desc');
      return (rows as ApiKeyRow[]).map((r) => this.toDomain(r));
    });
  }

  /**
   * Find a candidate API key by its prefix, then the application layer verifies
   * the Argon2id hash against the presented secret. (No oracle: a missing prefix
   * returns an empty list and the caller treats it as invalid.)
   */
  public async findByPrefix(prefix: string): Promise<ApiKey[]> {
    return withTenantContext(this.knex, '00000000-0000-0000-0000-000000000000', async (trx) => {
      // Prefix lookup must be cross-tenant (the caller's tenant is unknown until
      // the key resolves); bypass RLS via a platform-scoped transaction.
      const result = (await trx.raw('SELECT * FROM iam.api_keys WHERE key_prefix = ?', [
        prefix,
      ])) as {
        rows: ApiKeyRow[];
      };
      return result.rows.map((r) => this.toDomain(r));
    });
  }

  public async save(key: ApiKey, ctx: EventContext): Promise<void> {
    const events = key.pullEvents();
    await withTenantContext(this.knex, key.tenantId, async (trx) => {
      const isNew =
        (await trx('iam.api_keys')
          .where({ id: key.id as string })
          .first()) === undefined;
      const row: Record<string, unknown> = {
        id: key.id as string,
        tenant_id: key.tenantId,
        name: key.name,
        key_hash: key.keyHash,
        key_prefix: key.keyPrefix,
        scopes: JSON.stringify(key.scopes),
        assigned_user_id: key.assignedUserId,
        expires_at: key.expiresAt,
        last_used_at: key.lastUsedAt,
        status: key.status,
        ip_allowlist: JSON.stringify(key.ipAllowlist),
      };
      if (isNew) {
        await trx('iam.api_keys').insert({ ...row, version: 1 });
      } else {
        const updated = await trx('iam.api_keys')
          .where({ id: key.id as string, tenant_id: key.tenantId, version: key.version })
          .update({ ...row, version: this.knex.raw('version + 1') });
        if (updated === 0) throw new Error('Optimistic concurrency conflict on api_key save.');
      }
      if (events.length > 0) {
        await trx('event_outbox').insert(
          events.map((e) => ({
            aggregate_type: ctx.aggregateType,
            aggregate_id: key.id as string,
            tenant_id: key.tenantId,
            event_type: e.type,
            payload: JSON.stringify({ id: e.id, type: e.type, source: e.source, time: e.time }),
            headers: JSON.stringify({ correlation_id: ctx.correlationId }),
          })),
        );
      }
    });
    key.markEventsCommitted();
  }

  private toDomain(row: ApiKeyRow): ApiKey {
    const props: ApiKeyProps = {
      tenantId: row.tenant_id,
      name: row.name,
      keyHash: row.key_hash,
      keyPrefix: row.key_prefix,
      scopes: row.scopes ?? [],
      assignedUserId: row.assigned_user_id,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      status: row.status,
      ipAllowlist: row.ip_allowlist ?? [],
    };
    return ApiKeyClass.rehydrate(row.id, row.version, props);
  }
}
