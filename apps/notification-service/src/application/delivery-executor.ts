import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * DeliveryExecutor — executes a single delivery attempt through a channel
 * provider and persists the outcome. Shared by the dispatcher (first
 * attempt) and the durable retry worker (subsequent attempts) so both
 * follow the exact same state machine.
 */
import { Logger } from '@nestjs/common';
import {
  type NotificationDelivery,
  classifyDeliveryError,
} from '../domain/notification-delivery.js';
import type { Notification } from '../domain/notification.js';
import type { NotificationDeliveryRepository } from '../infrastructure/persistence/notification-delivery.repository.js';
import type { ChannelProvider } from './channels/channel-provider.js';

export interface DeliveryExecutorDeps {
  readonly deliveries: NotificationDeliveryRepository;
  readonly metrics: TelemetryMetrics | null;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
}

export class DeliveryExecutor {
  private readonly logger = new Logger('DeliveryExecutor');

  constructor(private readonly deps: DeliveryExecutorDeps) {}

  /**
   * Attempt one delivery. On success → SENT (+ providerMessageId).
   * On failure → PERMANENT errors fail fast; TRANSIENT errors are scheduled
   * for a durable retry (next_attempt_at) or terminal FAILED when the
   * attempt budget is exhausted.
   */
  public async execute(
    provider: ChannelProvider,
    notification: Notification,
    delivery: NotificationDelivery,
    isRetry = false,
  ): Promise<void> {
    this.deps.metrics?.notificationsDispatched.inc({ channel: delivery.channel });
    if (isRetry) this.deps.metrics?.notificationsRetried.inc({ channel: delivery.channel });

    let outcome: Awaited<ReturnType<ChannelProvider['deliver']>>;
    try {
      outcome = await provider.deliver(notification);
    } catch (err) {
      outcome = {
        success: false,
        error: (err as Error).message,
        errorClass: classifyDeliveryError(err),
      };
    }

    if (outcome.success) {
      delivery.markSent(outcome.providerMessageId);
      this.deps.metrics?.notificationsSent.inc({ channel: delivery.channel });
      this.deps.metrics?.notificationProvider.inc({
        channel: delivery.channel,
        result: 'success',
      });
    } else {
      const errorClass = outcome.errorClass ?? classifyDeliveryError(outcome.error);
      delivery.markFailed(
        outcome.error ?? 'Unknown delivery error',
        errorClass,
        this.deps.maxAttempts,
        this.deps.retryBaseMs,
      );
      this.deps.metrics?.notificationProvider.inc({
        channel: delivery.channel,
        result: 'failure',
      });
      if (delivery.status === 'FAILED') {
        // Terminal — permanent error or retry budget exhausted.
        this.deps.metrics?.notificationsFailed.inc({ channel: delivery.channel });
        this.deps.metrics?.notificationsDlq.inc({ channel: delivery.channel });
        this.logger.error(
          `Delivery ${delivery.id} (channel=${delivery.channel} notification=${delivery.notificationId}) FAILED terminally after ${delivery.attempts} attempt(s): ${delivery.error} [${errorClass}]`,
        );
      } else {
        this.logger.warn(
          `Delivery ${delivery.id} (channel=${delivery.channel} notification=${delivery.notificationId}) failed (attempt ${delivery.attempts}), durable retry scheduled at ${delivery.nextAttemptAt?.toISOString()}: ${delivery.error} [${errorClass}]`,
        );
      }
    }

    await this.deps.deliveries.updateStatus(delivery);
  }
}
