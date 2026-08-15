/**
 * Alarm rule repository — CRUD for notification.alert_rules.
 * Tenant-scoped via withTenantContext (RLS enforced).
 *
 * Sprint G Part 38: `listEnabled` (called per consumed event) is backed by a
 * short-TTL Redis cache, invalidated on EVERY rule mutation (create/update/
 * delete/enable/disable all funnel through update()/delete() here) — a
 * disabled rule can never keep triggering for longer than the TTL.
 */
import type { Redis } from '@fleetvision/cache-redis';
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { type Page, toCursor } from '@fleetvision/shared-kernel';
import {
  type AlarmRule,
  AlarmRule as AlarmRuleClass,
  type AlarmRuleType,
  type AlarmSeverity,
  type RepeatPolicy,
} from '../../domain/index.js';

export interface AlarmRuleRow {
  id: string;
  tenant_id: string;
  name: string;
  type: AlarmRuleType;
  severity: AlarmSeverity;
  enabled: boolean;
  entity_type: string;
  entity_id: string | null;
  conditions: Record<string, unknown>;
  cooldown_sec: number;
  dedup_window_sec: number;
  repeat_policy: RepeatPolicy;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class AlarmRuleRepository {
  constructor(
    private readonly knex: Knex,
    private readonly redis: Redis | null = null,
    private readonly cacheTtlSec = 30,
  ) {}

  private cacheKey(tenantId: string): string {
    return `tenant:${tenantId}:rules:enabled`;
  }

  /** Drop the tenant's enabled-rule cache (call-site: any rule mutation). */
  public async invalidateCache(tenantId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.cacheKey(tenantId));
    } catch {
      // best-effort — TTL bounds staleness anyway
    }
  }

  /** Create a new rule. */
  public async create(rule: AlarmRule): Promise<void> {
    await withTenantContext(this.knex, rule.tenantId, async (trx) => {
      await trx('notification.alert_rules').insert({
        id: rule.id,
        tenant_id: rule.tenantId,
        name: rule.name,
        type: rule.type,
        severity: rule.severity,
        enabled: rule.enabled,
        entity_type: rule.entityType,
        entity_id: rule.entityId,
        conditions: JSON.stringify(rule.conditions),
        cooldown_sec: rule.cooldownSec,
        dedup_window_sec: rule.dedupWindowSec,
        repeat_policy: rule.repeatPolicy,
        version: rule.version,
      });
    });
    await this.invalidateCache(rule.tenantId);
  }

  /** Find a rule by id. */
  public async findById(tenantId: string, id: string): Promise<AlarmRule | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<AlarmRuleRow>('notification.alert_rules')
        .where({ id, tenant_id: tenantId })
        .first();
      return row ? this.toDomain(row) : null;
    });
  }

  /**
   * List all enabled rules for a tenant (used by the evaluator to load active
   * rules). Redis-cached with a short TTL (Sprint G Part 38) — invalidated on
   * every mutation above, so a disabled rule stops triggering immediately.
   */
  public async listEnabled(tenantId: string): Promise<AlarmRule[]> {
    if (this.redis) {
      try {
        const cached = await this.redis.get(this.cacheKey(tenantId));
        if (cached) {
          const rows = JSON.parse(cached) as AlarmRuleRow[];
          return rows.map((r) =>
            this.toDomain({
              ...r,
              created_at: new Date(r.created_at),
              updated_at: new Date(r.updated_at),
            }),
          );
        }
      } catch {
        // cache read failure → fall through to the DB
      }
    }
    const rules = await withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx<AlarmRuleRow>('notification.alert_rules').where({
        tenant_id: tenantId,
        enabled: true,
      });
      return rows.map((r) => this.toDomain(r));
    });
    if (this.redis) {
      try {
        await this.redis.set(
          this.cacheKey(tenantId),
          JSON.stringify(rules.map((r) => this.toRow(r))),
          'EX',
          this.cacheTtlSec,
        );
      } catch {
        // best-effort
      }
    }
    return rules;
  }

  /** Cursor-paginated list. */
  public async listPage(
    tenantId: string,
    limit: number,
    cursor?: { createdAt: string; id: string },
  ): Promise<Page<AlarmRule>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      let query = trx<AlarmRuleRow>('notification.alert_rules').where({ tenant_id: tenantId });
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
        .limit(limit + 1)) as AlarmRuleRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? toCursor('created_at', last.created_at.toISOString(), last.id) : null;
      return { data: page.map((r) => this.toDomain(r)), nextCursor };
    });
  }

  /** Update an existing rule (optimistic version). */
  public async update(rule: AlarmRule): Promise<void> {
    await withTenantContext(this.knex, rule.tenantId, async (trx) => {
      const updated = await trx('notification.alert_rules')
        .where({ id: rule.id, tenant_id: rule.tenantId, version: rule.version })
        .update({
          name: rule.name,
          severity: rule.severity,
          enabled: rule.enabled,
          conditions: JSON.stringify(rule.conditions),
          cooldown_sec: rule.cooldownSec,
          dedup_window_sec: rule.dedupWindowSec,
          repeat_policy: rule.repeatPolicy,
          version: this.knex.raw('version + 1'),
          updated_at: this.knex.fn.now(),
        });
      if (updated === 0) throw new Error('Optimistic concurrency conflict on alarm rule update.');
    });
    await this.invalidateCache(rule.tenantId);
  }

  /** Delete a rule. */
  public async delete(tenantId: string, id: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('notification.alert_rules').where({ id, tenant_id: tenantId }).del();
    });
    await this.invalidateCache(tenantId);
  }

  /** Serialize a domain rule for the Redis cache. */
  private toRow(rule: AlarmRule): Record<string, unknown> {
    return {
      id: rule.id,
      tenant_id: rule.tenantId,
      name: rule.name,
      type: rule.type,
      severity: rule.severity,
      enabled: rule.enabled,
      entity_type: rule.entityType,
      entity_id: rule.entityId,
      conditions: rule.conditions,
      cooldown_sec: rule.cooldownSec,
      dedup_window_sec: rule.dedupWindowSec,
      repeat_policy: rule.repeatPolicy,
      version: rule.version,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private toDomain(row: AlarmRuleRow): AlarmRule {
    return AlarmRuleClass.rehydrate(row.id, row.version, {
      tenantId: row.tenant_id,
      name: row.name,
      type: row.type,
      severity: row.severity,
      enabled: row.enabled,
      entityType: row.entity_type,
      entityId: row.entity_id,
      conditions: row.conditions ?? {},
      cooldownSec: row.cooldown_sec,
      dedupWindowSec: row.dedup_window_sec,
      repeatPolicy: row.repeat_policy,
    });
  }
}
