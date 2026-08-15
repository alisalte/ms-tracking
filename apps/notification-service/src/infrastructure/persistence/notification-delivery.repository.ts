/**
 * Notification delivery repository — persists + updates notification.notification_deliveries.
 * Tracks delivery status (PENDING/SENT/FAILED) + retry attempts per channel.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import type { NotificationDelivery as DeliveryEntity } from '../../domain/notification-delivery.js';
import type { NotificationChannel, NotificationStatus } from '../../domain/notification-types.js';

export interface DeliveryRow {
  id: string;
  tenant_id: string;
  notification_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  sent_at: Date | null;
  created_at: Date;
}

export interface DeliveryRow {
  id: string;
  tenant_id: string;
  notification_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  sent_at: Date | null;
  created_at: Date;
}

export class NotificationDeliveryRepository {
  constructor(private readonly knex: Knex) {}

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
        sent_at: delivery.sentAt,
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
        sent_at: delivery.sentAt,
      });
    });
  }
}
