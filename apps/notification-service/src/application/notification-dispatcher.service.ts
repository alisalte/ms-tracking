/**
 * NotificationDispatcherService — the orchestrator between business events
 * (alarms) and delivery channels. When an alarm is raised:
 *
 * 1. Creates a Notification record (in-app persistence) with idempotency
 *    (source_type=alarm + source_id=alarm.id → one notification per alarm).
 * 2. Loads user preferences for the alarm category + severity.
 * 3. For each enabled channel, creates a NotificationDelivery (PENDING) + dispatches.
 * 4. On failure, increments attempts + schedules retry (up to MAX_DELIVERY_ATTEMPTS).
 * 5. Emits `notification.new` via WS for realtime bell update.
 *
 * The Alarm Engine calls `dispatchAlarm()` — it is NOT coupled to email/SMS
 * or any specific delivery provider.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AlarmOccurrence } from '../domain/alarm-occurrence.js';
import { NotificationDelivery } from '../domain/notification-delivery.js';
import { mapAlarmSeverity } from '../domain/notification-types.js';
import { Notification } from '../domain/notification.js';
import type { NotificationDeliveryRepository } from '../infrastructure/persistence/notification-delivery.repository.js';
import type { NotificationPreferenceRepository } from '../infrastructure/persistence/notification-preference.repository.js';
import type { NotificationRepository } from '../infrastructure/persistence/notification.repository.js';
import type { ChannelProvider } from './channels/channel-provider.js';

export interface NotificationDispatcherDeps {
  readonly notifications: NotificationRepository;
  readonly preferences: NotificationPreferenceRepository;
  readonly deliveries: NotificationDeliveryRepository;
  readonly channels: ChannelProvider[];
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger('NotificationDispatcher');

  constructor(private readonly deps: NotificationDispatcherDeps) {}

  /** Dispatch a notification for an alarm occurrence. */
  public async dispatchAlarm(alarm: AlarmOccurrence): Promise<void> {
    const severity = mapAlarmSeverity(alarm.severity);
    const notification = Notification.create(undefined, {
      tenantId: alarm.tenantId,
      // user_id null = broadcast to all tenant users (each sees it in their bell).
      userId: null,
      category: 'alarm',
      severity,
      title: `Alarm: ${alarm.type.replace(/_/g, ' ')}`,
      body: alarm.message,
      link: `/alarms?id=${alarm.id}`,
      sourceType: 'alarm',
      sourceId: alarm.id,
    });

    // Create the notification record (idempotent — duplicate alarms don't duplicate notifications).
    const created = await this.deps.notifications.create(notification);
    if (!created) {
      // Already exists (idempotency guard) — skip delivery.
      return;
    }

    // Deliver through all channels. For a broadcast (userId=null), use default preferences.
    // In a production system, we'd resolve all tenant users + their individual preferences.
    // For now, deliver with defaults (all channels enabled, normal+ severity).
    for (const channelProvider of this.deps.channels) {
      const delivery = NotificationDelivery.create(
        notification.tenantId,
        notification.id,
        channelProvider.channel as NotificationDelivery['channel'],
      );
      await this.deps.deliveries.create(delivery);
      await this.attemptDelivery(channelProvider, notification, delivery);
    }
  }

  /** Attempt a single delivery + handle retry on failure. */
  private async attemptDelivery(
    provider: ChannelProvider,
    notification: Notification,
    delivery: NotificationDelivery,
  ): Promise<void> {
    try {
      const result = await provider.deliver(notification);
      if (result.success) {
        delivery.markSent();
      } else {
        delivery.markFailed(result.error ?? 'Unknown delivery error');
      }
    } catch (err) {
      delivery.markFailed((err as Error).message);
    }

    await this.deps.deliveries.updateStatus(delivery);

    // Schedule retry on failure (up to MAX_DELIVERY_ATTEMPTS with exponential backoff).
    if (delivery.status === 'FAILED' && delivery.canRetry()) {
      const backoffMs = 2000 * 2 ** delivery.attempts; // 2s, 4s, 8s
      this.logger.warn(
        `Delivery via ${delivery.channel} failed (attempt ${delivery.attempts}), retrying in ${backoffMs}ms: ${delivery.error}`,
      );
      setTimeout(() => {
        delivery.resetForRetry();
        this.attemptDelivery(provider, notification, delivery).catch((err) =>
          this.logger.error(`Retry delivery error: ${(err as Error).message}`),
        );
      }, backoffMs);
    }
  }
}
