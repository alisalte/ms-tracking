/**
 * Notification delivery repository — persists + updates notification.notification_deliveries.
 * Tracks delivery status (PENDING/SENT/DELIVERED/FAILED/READ) + durable retry
 * attempts per channel (next_attempt_at scheduling — Sprint H).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withPlatformContext, withTenantContext } from '@fleetvision/persistence-knex';
import {
  NotificationDelivery as DeliveryEntity,
  type DeliveryErrorClass,
} from '../../domain/notification-delivery.js';
import type { NotificationChannel, NotificationStatus } from '../../domain/notification-types.js';
import {
  Notification as NotificationClass,
  type Notification as NotificationEntity,
} from '../../domain/notification.js';

export interface DeliveryRow {
  id: string;
  tenant_id: string;
  notification_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  error_code: string | null;
  provider: string | null;
  provider_message_id: string | null;
  sent_at: Date | null;
  next_attempt_at: Date | null;
  created_at: Date;
}

/** Claimed delivery with its notification rehydrated for re-dispatch. */
export interface ClaimedDelivery {
  delivery: DeliveryEntity;
  notification: NotificationEntity;
}

export class NotificationDeliveryRepository {
  constructor(
    private readonly knex: Knex,
    private readonly platformKnex?: Knex,
  ) {}

  /** Create a PENDING delivery record. */
  public async create(delivery: DeliveryEntity): Promise<void> {
    await withTenantContext(this.knex, delivery.tenantId, async (trx) => {
      await trx('notification.notification_deliveries').insert({
        id: delivery.id,
        tenant_id: delivery.tenantId,
        notification_id: delivery.notificationId,
        channel: delivery.channel,
        status: delivery.status,
        attempts: delivery.attempts,
        error: delivery.error,
        error_code: delivery.errorCode,
        provider: delivery.provider,
        provider_message_id: delivery.providerMessageId,
        sent_at: delivery.sentAt,
        next_attempt_at: delivery.nextAttemptAt,
      });
    });
  }

  /** Update delivery status after a send attempt. */
  public async updateStatus(delivery: DeliveryEntity): Promise<void> {
    await withTenantContext(this.knex, delivery.tenantId, async (trx) => {
      await trx('notification.notification_deliveries').where({ id: delivery.id }).update({
        status: delivery.status,
        attempts: delivery.attempts,
        error: delivery.error,
        error_code: delivery.errorCode,
        provider_message_id: delivery.providerMessageId,
        sent_at: delivery.sentAt,
        next_attempt_at: delivery.nextAttemptAt,
      });
    });
  }

  /** List deliveries for a notification (tenant-scoped, oldest first). */
  public async listForNotification(
    tenantId: string,
    notificationId: string,
  ): Promise<DeliveryEntity[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx<DeliveryRow>('notification.notification_deliveries')
        .where({ tenant_id: tenantId, notification_id: notificationId })
        .orderBy('created_at', 'asc');
      return rows.map((r) => this.toDomain(r));
    });
  }

  /**
   * Claim due retryable deliveries across tenants for the retry worker.
   * Uses SELECT … FOR UPDATE SKIP LOCKED so multiple workers never dispatch
   * the same delivery simultaneously (Sprint H §53). Runs on the platform
   * connection (system process — BYPASSRLS role) inside a short transaction;
   * claimed rows get a lease (next_attempt_at pushed past the lease window)
   * so concurrent workers skip them until the attempt finishes or the lease
   * expires (crash-safe — the row becomes claimable again).
   */
  public async claimDueDeliveries(batchSize: number, leaseMs: number): Promise<ClaimedDelivery[]> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    return withPlatformContext(this.platformKnex ?? this.knex, async (trx) => {
      const rows = await trx<DeliveryRow>('notification.notification_deliveries')
        .where({ status: 'PENDING' })
        .whereNotNull('next_attempt_at')
        .where('next_attempt_at', '<=', now)
        .orderBy('next_attempt_at', 'asc')
        .limit(batchSize)
        .forUpdate()
        .skipLocked();
      if (rows.length === 0) return [];

      const notificationIds = [...new Set(rows.map((r) => r.notification_id))];
      const notifications = await trx('notification.notifications')
        .whereIn('id', notificationIds)
        .select();
      const byId = new Map(notifications.map((n) => [n.id, n]));

      // Lease: push next_attempt_at past the lease window so concurrent
      // workers skip these rows until the current attempt finishes or the
      // lease expires (crash-safe — the row becomes visible again).
      await trx('notification.notification_deliveries')
        .whereIn(
          'id',
          rows.map((r) => r.id),
        )
        .update({ next_attempt_at: leaseUntil });

      return rows.flatMap((r) => {
        const n = byId.get(r.notification_id);
        if (!n) return [];
        const metadata =
          n.metadata && typeof n.metadata === 'object'
            ? (n.metadata as Record<string, unknown>)
            : {};
        const notification = NotificationClass.rehydrate(n.id, {
          tenantId: n.tenant_id,
          userId: n.user_id,
          category: n.category,
          severity: n.severity,
          eventType: n.event_type,
          vehicleId: n.vehicle_id,
          priority: n.priority,
          title: n.title,
          body: n.body,
          link: n.link,
          metadata,
          read: n.read,
          readAt: n.read_at,
          sourceType: n.source_type,
          sourceId: n.source_id,
          createdAt: n.created_at,
        });
        return [{ delivery: this.toDomain(r), notification }];
      });
    });
  }

  private toDomain(row: DeliveryRow): DeliveryEntity {
    return DeliveryEntity.rehydrate(row.id, {
      tenantId: row.tenant_id,
      notificationId: row.notification_id,
      channel: row.channel,
      status: row.status,
      attempts: row.attempts,
      error: row.error,
      errorCode: (row.error_code as DeliveryErrorClass | null) ?? null,
      provider: row.provider,
      providerMessageId: row.provider_message_id,
      sentAt: row.sent_at,
      nextAttemptAt: row.next_attempt_at,
      createdAt: row.created_at,
    });
  }
}
