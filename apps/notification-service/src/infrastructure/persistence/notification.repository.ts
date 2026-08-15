/**
 * Notification repository — persists + queries notification.notifications.
 * Tenant-scoped via withTenantContext (RLS enforced). Cursor-paginated reads.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { type Page, toCursor } from '@fleetvision/shared-kernel';
import type {
  NotificationCategory,
  NotificationPriority,
  NotificationSeverity,
} from '../../domain/notification-types.js';
import {
  Notification as NotificationClass,
  type Notification as NotificationEntity,
} from '../../domain/notification.js';

export interface NotificationRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  category: NotificationCategory;
  severity: NotificationSeverity;
  event_type: string;
  vehicle_id: string | null;
  priority: NotificationPriority;
  title: string;
  body: string;
  link: string | null;
  metadata: Record<string, unknown>;
  read: boolean;
  read_at: Date | null;
  source_type: string;
  source_id: string | null;
  created_at: Date;
}

/** Filters for notification history queries (Sprint H §35/§42). */
export interface NotificationListFilters {
  eventType?: string;
  severity?: NotificationSeverity;
  vehicleId?: string;
  from?: Date;
  to?: Date;
}

export class NotificationRepository {
  constructor(private readonly knex: Knex) {}

  /** Create a notification. Returns false if a duplicate (source_type+source_id+user_id) already exists (idempotency). */
  public async create(notification: NotificationEntity): Promise<boolean> {
    try {
      await withTenantContext(this.knex, notification.tenantId, async (trx) => {
        await trx('notification.notifications').insert({
          id: notification.id,
          tenant_id: notification.tenantId,
          user_id: notification.userId,
          category: notification.category,
          severity: notification.severity,
          event_type: notification.eventType,
          vehicle_id: notification.vehicleId,
          priority: notification.priority,
          title: notification.title,
          body: notification.body,
          link: notification.link,
          metadata: JSON.stringify(notification.metadata ?? {}),
          source_type: notification.sourceType,
          source_id: notification.sourceId,
        });
      });
      return true;
    } catch {
      // Unique constraint violation → duplicate, idempotency guard.
      return false;
    }
  }

  /** Cursor-paginated list for a user (own + broadcast). */
  public async listPage(
    tenantId: string,
    userId: string | null,
    limit: number,
    unreadOnly: boolean,
    cursor?: { createdAt: string; id: string },
    filters: NotificationListFilters = {},
  ): Promise<Page<NotificationEntity>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      let query = trx<NotificationRow>('notification.notifications').where((q) => {
        if (userId === null) return;
        q.where({ user_id: userId }).orWhereNull('user_id');
      });
      if (unreadOnly) query = query.where({ read: false });
      if (filters.eventType) query = query.where({ event_type: filters.eventType });
      if (filters.severity) query = query.where({ severity: filters.severity });
      if (filters.vehicleId) query = query.where({ vehicle_id: filters.vehicleId });
      if (filters.from) query = query.where('created_at', '>=', filters.from);
      if (filters.to) query = query.where('created_at', '<=', filters.to);
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
        .limit(limit + 1)) as NotificationRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? toCursor('created_at', last.created_at.toISOString(), last.id) : null;
      return { data: page.map((r) => this.toDomain(r)), nextCursor };
    });
  }

  /** Get a single notification by id (tenant-scoped). */
  public async getById(
    tenantId: string,
    userId: string | null,
    notificationId: string,
  ): Promise<NotificationEntity | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<NotificationRow>('notification.notifications')
        .where({ id: notificationId, tenant_id: tenantId })
        .where((q) => {
          if (userId === null) return;
          q.where({ user_id: userId }).orWhereNull('user_id');
        })
        .first();
      return row ? this.toDomain(row) : null;
    });
  }

  /** Get unread count + breakdown by severity. */
  public async getUnreadCount(
    tenantId: string,
    userId: string,
  ): Promise<{ total: number; critical: number; high: number }> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx('notification.notifications')
        .where((q) => q.where({ user_id: userId }).orWhereNull('user_id'))
        .where({ read: false })
        .select('severity')
        .count('* as cnt')
        .groupBy('severity')) as { severity: string; cnt: string }[];
      const map: Record<string, number> = {};
      for (const r of rows) map[r.severity] = Number(r.cnt);
      return {
        total: Object.values(map).reduce((a, b) => a + b, 0),
        critical: map.critical ?? 0,
        high: map.high ?? 0,
      };
    });
  }

  /** Mark one notification as read. */
  public async markRead(tenantId: string, userId: string, notificationId: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('notification.notifications')
        .where({ id: notificationId, tenant_id: tenantId })
        .where((q) => q.where({ user_id: userId }).orWhereNull('user_id'))
        .update({ read: true, read_at: new Date() });
    });
  }

  /** Mark all unread notifications for a user as read. */
  public async markAllRead(tenantId: string, userId: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('notification.notifications')
        .where((q) => q.where({ user_id: userId }).orWhereNull('user_id'))
        .where({ read: false })
        .update({ read: true, read_at: new Date() });
    });
  }

  private toDomain(row: NotificationRow): NotificationEntity {
    const metadata =
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {};
    return NotificationClass.rehydrate(row.id, {
      tenantId: row.tenant_id,
      userId: row.user_id,
      category: row.category,
      severity: row.severity,
      eventType: row.event_type,
      vehicleId: row.vehicle_id,
      priority: row.priority,
      title: row.title,
      body: row.body,
      link: row.link,
      metadata,
      read: row.read,
      readAt: row.read_at,
      sourceType: row.source_type,
      sourceId: row.source_id,
      createdAt: row.created_at,
    });
  }
}
