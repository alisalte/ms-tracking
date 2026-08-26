/**
 * Tenant repository. `iam.tenants` is the documented RLS exception — it is
 * cross-tenant readable by platform services. Writes happen during provisioning
 * (before a tenant has any session context), so they run WITHOUT tenant scope.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import {
  type EventContext,
  type Tenant,
  Tenant as TenantClass,
  type TenantProps,
  type TenantStatus,
  type TenantTier,
} from '../../domain/index.js';
import { withoutTenantContext } from './tenant-context.js';
import { mergeTenantSettings, type TenantSettings, type TenantSettingsPatch } from '../../domain/tenant-settings.js';

export interface TenantRow {
  id: string;
  tenant_id: string;
  name: string;
  tier: TenantTier;
  region: string;
  status: TenantStatus;
  feature_flags: Record<string, unknown>;
  kek_ref: string | null;
  root_org_id: string | null;
  settings: Record<string, unknown> | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class TenantRepository {
  constructor(private readonly knex: Knex) {}

  public async findById(id: string): Promise<Tenant | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<TenantRow>('iam.tenants').where({ id }).first();
      return row ? this.toDomain(row) : null;
    });
  }

  /**
   * Resolve a tenant identifier to its canonical UUID.
   *
   * Accepts either a UUID (returned as-is when the tenant exists) or a tenant
   * name/slug (case-insensitive exact match on `iam.tenants.name`). Used by the
   * auth controller to turn the `X-Tenant-Id` header — which a human types as a
   * name like "FleetVision" — into the verified UUID the security model requires
   * (INV-I02: tenant_id is always derived from a server-verified source, never
   * the request body). Returns `null` when no tenant matches.
   */
  public async resolveId(rawTenantId: string): Promise<string | null> {
    const trimmed = rawTenantId.trim();
    if (!trimmed) return null;
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<TenantRow>('iam.tenants')
        .whereRaw('LOWER(name) = LOWER(?)', trimmed)
        .first();
      return row?.id ?? null;
    });
  }

  public async save(tenant: Tenant, ctx: EventContext): Promise<void> {
    const events = tenant.pullEvents();
    await withoutTenantContext(this.knex, async (trx) => {
      const row = this.toRow(tenant);
      const existing = await trx('iam.tenants')
        .where({ id: tenant.id as string })
        .first();
      if (!existing) {
        await trx('iam.tenants').insert({ ...row, version: tenant.version });
      } else {
        const updated = await trx('iam.tenants')
          .where({ id: tenant.id as string, version: existing.version })
          .update({ ...row, version: this.knex.raw('version + 1') });
        if (updated === 0) throw new Error('Optimistic concurrency conflict on tenant save.');
      }
      if (events.length > 0) {
        await trx('event_outbox').insert(
          events.map((e) => ({
            aggregate_type: ctx.aggregateType,
            aggregate_id: tenant.id as string,
            tenant_id: tenant.id as string,
            event_type: e.type,
            payload: JSON.stringify({ id: e.id, type: e.type, source: e.source, time: e.time }),
            headers: JSON.stringify({ correlation_id: ctx.correlationId }),
          })),
        );
      }
    });
    tenant.markEventsCommitted();
  }

  public async readSettings(id: string): Promise<TenantSettings | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<TenantRow>('iam.tenants').where({ id }).first();
      if (!row) return null;
      return mergeTenantSettings(row.settings, row.name);
    });
  }

  public async saveSettings(id: string, patch: TenantSettingsPatch): Promise<TenantSettings | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<TenantRow>('iam.tenants').where({ id }).first();
      if (!row) return null;
      const next = mergeTenantSettings(row.settings, row.name, patch);
      const updated = await trx('iam.tenants')
        .where({ id, version: row.version })
        .update({
          settings: JSON.stringify(next),
          updated_at: this.knex.fn.now(),
          version: this.knex.raw('version + 1'),
        });
      if (updated === 0) throw new Error('Optimistic concurrency conflict on tenant settings.');
      return next;
    });
  }

  private toRow(tenant: Tenant): Record<string, unknown> {
    return {
      id: tenant.id as string,
      tenant_id: tenant.id as string, // self-reference for RLS uniformity
      name: tenant.name,
      tier: tenant.tier,
      region: tenant.region,
      status: tenant.status,
      feature_flags: JSON.stringify(tenant.featureFlags),
      kek_ref: tenant.kekRef,
      root_org_id: tenant.rootOrgId,
      version: tenant.version,
    };
  }

  private toDomain(row: TenantRow): Tenant {
    const props: TenantProps = {
      name: row.name,
      tier: row.tier,
      region: row.region,
      status: row.status,
      featureFlags: row.feature_flags ?? {},
      rootOrgId: row.root_org_id,
      kekRef: row.kek_ref,
    };
    return TenantClass.rehydrate(row.id, row.version, props);
  }
}
