/**
 * NotificationDelivery — the delivery audit record for one channel attempt.
 *
 * Lifecycle: PENDING → SENT (success) or PENDING → FAILED (error, may retry).
 * The dispatcher retries up to MAX_DELIVERY_ATTEMPTS with exponential backoff.
 */
import { randomUUID } from 'node:crypto';
import type { NotificationChannel, NotificationStatus } from './notification-types.js';

export const MAX_DELIVERY_ATTEMPTS = 3;

export interface NotificationDeliveryProps {
  readonly tenantId: string;
  readonly notificationId: string;
  readonly channel: NotificationChannel;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  sentAt: Date | null;
  readonly createdAt: Date;
}

export class NotificationDelivery {
  public readonly tenantId: string;
  public readonly notificationId: string;
  public readonly channel: NotificationChannel;
  public status: NotificationStatus;
  public attempts: number;
  public error: string | null;
  public sentAt: Date | null;
  public readonly createdAt: Date;
  public readonly id: string;

  private constructor(id: string, props: NotificationDeliveryProps) {
    this.id = id;
    this.tenantId = props.tenantId;
    this.notificationId = props.notificationId;
    this.channel = props.channel;
    this.status = props.status;
    this.attempts = props.attempts;
    this.error = props.error;
    this.sentAt = props.sentAt;
    this.createdAt = props.createdAt;
  }

  public static create(
    tenantId: string,
    notificationId: string,
    channel: NotificationChannel,
  ): NotificationDelivery {
    return new NotificationDelivery(randomUUID(), {
      tenantId,
      notificationId,
      channel,
      status: 'PENDING',
      attempts: 0,
      error: null,
      sentAt: null,
      createdAt: new Date(),
    });
  }

  public static rehydrate(id: string, props: NotificationDeliveryProps): NotificationDelivery {
    return new NotificationDelivery(id, props);
  }

  /** Mark as successfully sent. */
  public markSent(): void {
    this.status = 'SENT';
    this.sentAt = new Date();
    this.error = null;
  }

  /** Mark as failed with an error message. */
  public markFailed(error: string): void {
    this.status = 'FAILED';
    this.error = error;
    this.attempts += 1;
  }

  /** Can this delivery be retried? (under the max attempts limit). */
  public canRetry(maxAttempts = MAX_DELIVERY_ATTEMPTS): boolean {
    return this.status === 'FAILED' && this.attempts < maxAttempts;
  }

  /** Reset to PENDING for a retry attempt. */
  public resetForRetry(): void {
    if (!this.canRetry()) return;
    this.status = 'PENDING';
    this.error = null;
  }
}
