/**
 * Notification preference repository — persists + queries notification.notification_preferences.
 * Returns defaults when no preference is set for a category.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withPlatformContext, withTenantContext } from '@fleetvision/persistence-knex';
import { NotificationPreference } from '../../domain/notification-preference.js';
import type { NotificationChannel, NotificationSeverity } from '../../domain/notification-types.js';

export interface PreferenceRow {
  id: string;
  tenant_id: string;
  user_id: string;
  category: string;
  min_severity: NotificationSeverity;
  channels: NotificationChannel[];
  enabled: boolean;
}

export class NotificationPreferenceRepository {
  constructor(
    private readonly knex: Knex,
    private readonly platformKnex: Knex,
  ) {}

  /** Get the preference for a user+category, or return the default if none set. */
  public async getOrDefault(
    tenantId: string,
    userId: string,
    category: string,
  ): Promise<NotificationPreference> {
    const row = await withTenantContext(this.knex, tenantId, async (trx) => {
      return trx<PreferenceRow>('notification.notification_preferences')
        .where({ tenant_id: tenantId, user_id: userId, category })
        .first();
    });
    if (row) return this.toDomain(row);
    return NotificationPreference.default(tenantId, userId, category);
  }

  /** List all preferences for a user. */
  public async listForUser(tenantId: string, userId: string): Promise<NotificationPreference[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx<PreferenceRow>('notification.notification_preferences').where({
        tenant_id: tenantId,
        user_id: userId,
      });
      return rows.map((r) => this.toDomain(r));
    });
  }

  /** Upsert (create or update) a preference. */
  public async upsert(pref: NotificationPreference): Promise<void> {
    await withPlatformContext(this.platformKnex, async (trx) => {
      // Check if preference exists (cross-tenant lookup needs platform scope).
      const existing = await trx<PreferenceRow>('notification.notification_preferences')
        .where({
          tenant_id: pref.tenantId,
          user_id: pref.userId,
          category: pref.category,
        })
        .first();
      if (existing) {
        await trx('notification.notification_preferences')
          .where({ id: existing.id })
          .update({
            min_severity: pref.minSeverity,
            channels: JSON.stringify(pref.channels),
            enabled: pref.enabled,
            updated_at: trx.fn.now(),
          });
      } else {
        await trx('notification.notification_preferences').insert({
          tenant_id: pref.tenantId,
          user_id: pref.userId,
          category: pref.category,
          min_severity: pref.minSeverity,
          channels: JSON.stringify(pref.channels),
          enabled: pref.enabled,
        });
      }
    });
  }

  private toDomain(row: PreferenceRow): NotificationPreference {
    return new NotificationPreference({
      tenantId: row.tenant_id,
      userId: row.user_id,
      category: row.category,
      minSeverity: row.min_severity,
      channels: Array.isArray(row.channels) ? row.channels : JSON.parse(row.channels as string),
      enabled: row.enabled,
    });
  }
}
