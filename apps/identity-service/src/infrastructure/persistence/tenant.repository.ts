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
