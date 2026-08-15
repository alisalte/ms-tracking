import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * NotificationDispatcherService — the orchestrator between business events
 * (alarms) and delivery channels (Sprint H).
 *
 * When an alarm is raised (dedup policy: ON_OPEN — Sprint H §18):
 *
 * 1. Renders localized (fa/en) title/body from the template registry.
 * 2. Resolves recipients from the trusted user directory (iam.users).
 * 3. For each recipient: resolves preferences → enabled channels ∩
 *    CONFIGURED providers → per-tenant/user/channel rate limit.
 * 4. Creates ONE per-user Notification record (idempotent via the
 *    (tenant_id, user_id, source_type, source_id) unique constraint —
 *    Kafka redeliveries never duplicate notifications, Sprint H §17).
 * 5. For each enabled channel: creates a NotificationDelivery (PENDING)
 *    and attempts it via the DeliveryExecutor. Retries are DURABLE
 *    (next_attempt_at in PostgreSQL, drained by DeliveryRetryWorker) —
 *    not in-memory timers.
 *
 * The Alarm Engine calls `dispatchAlarm()` — it is NOT coupled to email/SMS
 * or any specific delivery provider (the registry owns provider selection).
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AlarmOccurrence } from '../domain/alarm-occurrence.js';
import { NotificationDelivery } from '../domain/notification-delivery.js';
import { TEMPLATE_DATA_KEYS, type TemplateData } from '../domain/notification-template.js';
import { mapAlarmSeverity } from '../domain/notification-types.js';
import { Notification } from '../domain/notification.js';
import type { NotificationRateLimiter } from '../infrastructure/cache/notification-rate-limiter.js';
import type { NotificationDeliveryRepository } from '../infrastructure/persistence/notification-delivery.repository.js';
import type { NotificationPreferenceRepository } from '../infrastructure/persistence/notification-preference.repository.js';
import type { NotificationRepository } from '../infrastructure/persistence/notification.repository.js';
import type { UserDirectory } from '../infrastructure/persistence/user-directory.js';
import type { ChannelProvider } from './channels/channel-provider.js';
import type { NotificationProviderRegistry } from './channels/provider-registry.js';
import type { DeliveryExecutor } from './delivery-executor.js';
import {
  type NotificationLocale,
  renderNotificationContent,
} from './templates/notification-templates.js';

export interface NotificationDispatcherDeps {
  readonly notifications: NotificationRepository;
  readonly preferences: NotificationPreferenceRepository;
  readonly deliveries: NotificationDeliveryRepository;
  readonly registry: NotificationProviderRegistry;
  readonly userDirectory: UserDirectory;
  readonly rateLimiter: NotificationRateLimiter;
  readonly executor: DeliveryExecutor;
  readonly metrics: TelemetryMetrics | null;
  readonly defaultLocale: NotificationLocale;
  /** Master switch (NOTIFICATION_ENABLED) — false disables all dispatch. */
  readonly enabled: boolean;
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger('NotificationDispatcher');

  constructor(private readonly deps: NotificationDispatcherDeps) {}

  /** Dispatch per-user notifications for an alarm occurrence (ON_OPEN only). */
  public async dispatchAlarm(alarm: AlarmOccurrence): Promise<void> {
    if (!this.deps.enabled) {
      this.logger.debug('Notification dispatch disabled (NOTIFICATION_ENABLED=false).');
      return;
    }
    const severity = mapAlarmSeverity(alarm.severity);
    const templateData = this.extractTemplateData(alarm);

    // Recipients come from the trusted backend directory — never from the
    // alarm payload (Sprint H §20).
    const recipients = await this.deps.userDirectory.listTenantUsers(alarm.tenantId);
    if (recipients.length === 0) {
      this.logger.warn(
        `No active recipients for tenant ${alarm.tenantId} — alarm ${alarm.id} not notified.`,
      );
      return;
    }

    for (const recipient of recipients) {
      try {
        await this.dispatchToRecipient(alarm, recipient, severity, templateData);
      } catch (err) {
        // One recipient's failure must not block the others.
        this.logger.error(
          `Failed to notify user ${recipient.userId} for alarm ${alarm.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async dispatchToRecipient(
    alarm: AlarmOccurrence,
    recipient: { userId: string; displayName: string | null },
    severity: Notification['severity'],
    templateData: TemplateData,
  ): Promise<void> {
    const { tenantId } = alarm;

    // 1. Preference resolution: enabled channels for this user+category
    //    (defaults: in-app + websocket only — email/sms/push stay opt-in).
    const preference = await this.deps.preferences.getOrDefault(
      tenantId,
      recipient.userId,
      'alarm',
    );
    const enabledChannels = preference.enabled
      ? preference.channels.filter(
          (c) => preference.shouldDeliver(severity, c) && this.deps.registry.isDispatchable(c),
        )
      : [];
    if (enabledChannels.length === 0) {
      // All channels disabled — record the decision (log + metric), no row,
      // no retry loop (Sprint H §23).
      this.logger.debug(
        `User ${recipient.userId} has no enabled channels for alarm category — skipped alarm ${alarm.id}.`,
      );
      return;
    }

    // 2. Rate limiting per tenant/user/channel (storm protection, §33).
    const allowedChannels: string[] = [];
    for (const channel of enabledChannels) {
      if (await this.deps.rateLimiter.allow(tenantId, recipient.userId, channel)) {
        allowedChannels.push(channel);
      } else {
        this.deps.metrics?.notificationsRateLimited.inc({ channel });
        this.logger.warn(
          `Rate limit exceeded for tenant=${tenantId} user=${recipient.userId} channel=${channel} — suppressed alarm ${alarm.id}.`,
        );
      }
    }
    if (allowedChannels.length === 0) return;

    // 3. Render localized content (fa/en templates; fallback = alarm message).
    const locale = this.deps.defaultLocale;
    const content = renderNotificationContent(
      alarm.type,
      locale,
      { ...templateData, vehicleName: templateData.vehicleName ?? alarm.vehicleId ?? '' },
      {
        title: `Alarm: ${alarm.type.replace(/_/g, ' ')}`,
        body: alarm.message,
      },
    );

    // 4. Create the per-user notification (idempotent — duplicate alarm
    //    sources, incl. Kafka redeliveries, do not duplicate rows, §17).
    const notification = Notification.create(undefined, {
      tenantId,
      userId: recipient.userId,
      category: 'alarm',
      severity,
      eventType: alarm.type,
      vehicleId: alarm.vehicleId,
      title: content.title,
      body: content.body,
      link: `/alarms?id=${alarm.id}`,
      sourceType: 'alarm',
      sourceId: alarm.id,
      metadata: templateData as Record<string, unknown>,
    });
    const created = await this.deps.notifications.create(notification);
    if (!created) {
      this.deps.metrics?.notificationsDeduplicated.inc({ type: alarm.type });
      return;
    }
    this.deps.metrics?.notificationsCreated.inc({ type: alarm.type });

    // 5. Dispatch through each enabled channel via the registry.
    for (const channel of allowedChannels) {
      const provider = this.deps.registry.get(channel) as ChannelProvider | undefined;
      if (!provider) continue;
      const delivery = NotificationDelivery.create(
        tenantId,
        notification.id,
        channel as NotificationDelivery['channel'],
        provider.providerName,
      );
      await this.deps.deliveries.create(delivery);
      await this.deps.executor.execute(provider, notification, delivery);
    }
  }

  /**
   * Whitelisted template context from the alarm's server-side detail —
   * only TEMPLATE_DATA_KEYS may reach templates (Sprint H §28).
   */
  private extractTemplateData(alarm: AlarmOccurrence): TemplateData {
    const detail = alarm.detail ?? {};
    const data: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(detail)) {
      if (
        value !== null &&
        value !== undefined &&
        (typeof value === 'string' || typeof value === 'number') &&
        (TEMPLATE_DATA_KEYS as readonly string[]).includes(key)
      ) {
        data[key] = value;
      }
    }
    if (alarm.raisedAt) data.occurredAt = alarm.raisedAt.toISOString();
    return data as TemplateData;
  }
}
