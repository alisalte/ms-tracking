/**
 * Concrete channel providers (Sprint H).
 *
 * - WebSocketChannel: emits `notification.new` to the user's (or tenant's)
 *   notifications room via the existing alarm-realtime gateway.
 * - InAppChannel: the notification record IS the in-app delivery — creating it
 *   in the DB makes it visible. This channel is a no-op that always succeeds.
 * - SmtpEmailProvider: sends via nodemailer IF SMTP is configured; otherwise
 *   DISABLED. Recipient email is resolved from the trusted user directory —
 *   never from notification payloads.
 * - SmsProvider / PushProvider: provider-independent abstractions. No real
 *   provider is configured in this project, so they report DISABLED — they
 *   never fake delivery and never invent endpoints (Sprint H §12/§13).
 */
import { Logger } from '@nestjs/common';
import type { Notification } from '../../domain/notification.js';
import type { TenantUser } from '../../infrastructure/persistence/user-directory.js';
import type { AlarmRealtimeGateway } from '../../infrastructure/websocket/alarm-realtime.gateway.js';
import type { ChannelProvider, DeliveryOutcome, ProviderStatus } from './channel-provider.js';

/** WebSocket channel — pushes `notification.new` to the user/tenant notifications room. */
export class WebSocketChannel implements ChannelProvider {
  public readonly channel = 'websocket';
  public readonly providerName = 'socketio';
  public readonly status: ProviderStatus = 'CONFIGURED';

  constructor(private readonly gateway: AlarmRealtimeGateway | null) {}

  public async deliver(notification: Notification): Promise<DeliveryOutcome> {
    try {
      this.gateway?.emitNotification(notification.tenantId, notification);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message, errorClass: 'TRANSIENT' };
    }
  }
}

/** In-app channel — the notification record IS the delivery; always succeeds. */
export class InAppChannel implements ChannelProvider {
  public readonly channel = 'in_app';
  public readonly providerName = 'postgres';
  public readonly status: ProviderStatus = 'CONFIGURED';

  public async deliver(): Promise<DeliveryOutcome> {
    return { success: true };
  }
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
  readonly from: string;
}

/** Email channel — real SMTP via nodemailer, enabled only when configured. */
export class SmtpEmailProvider implements ChannelProvider {
  private readonly logger = new Logger('SmtpEmailProvider');
  public readonly channel = 'email';
  public readonly providerName = 'smtp';

  constructor(
    private readonly smtpConfig: SmtpConfig | null,
    private readonly resolveRecipient: (
      tenantId: string,
      userId: string,
    ) => Promise<TenantUser | null>,
  ) {}

  public get status(): ProviderStatus {
    return this.smtpConfig ? 'CONFIGURED' : 'DISABLED';
  }

  public async deliver(notification: Notification): Promise<DeliveryOutcome> {
    if (!this.smtpConfig) {
      // Should not happen — the registry only dispatches CONFIGURED providers.
      return { success: false, error: 'SMTP not configured', errorClass: 'PERMANENT' };
    }
    if (!notification.userId) {
      return { success: false, error: 'No target user for email', errorClass: 'PERMANENT' };
    }
    const recipient = await this.resolveRecipient(notification.tenantId, notification.userId);
    if (!recipient?.email) {
      return { success: false, error: 'User has no email address', errorClass: 'PERMANENT' };
    }
    try {
      // Dynamic import so the service boots even without nodemailer installed.
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: this.smtpConfig.host,
        port: this.smtpConfig.port,
        auth:
          this.smtpConfig.user && this.smtpConfig.pass
            ? { user: this.smtpConfig.user, pass: this.smtpConfig.pass }
            : undefined,
      });
      const info = await transporter.sendMail({
        from: this.smtpConfig.from,
        to: recipient.email,
        subject: notification.title,
        text: notification.body,
      });
      // SENT = provider accepted the message. nodemailer/SMTP gives no
      // end-user delivery confirmation, so DELIVERED is never claimed here.
      return { success: true, providerMessageId: info.messageId ?? undefined };
    } catch (err) {
      const message = (err as Error).message;
      const errorClass = /invalid|rejected|authentication|authorization/i.test(message)
        ? 'PERMANENT'
        : 'TRANSIENT';
      if (errorClass === 'TRANSIENT') {
        this.logger.warn(`SMTP send failed (transient): ${message}`);
      }
      return { success: false, error: message, errorClass };
    }
  }
}

/**
 * SMS channel abstraction. No real SMS provider is selected or configured in
 * this project — the provider is DISABLED and never dispatches. When a real
 * provider (e.g. Twilio/Kavenegar) is chosen, implement a SmsProvider by
 * supplying `send` backed by environment-driven configuration.
 */
export class SmsChannel implements ChannelProvider {
  public readonly channel = 'sms';
  public readonly providerName = 'none';
  public readonly status: ProviderStatus;

  constructor(smsEnabled: boolean) {
    this.status = smsEnabled ? 'UNAVAILABLE' : 'DISABLED';
  }

  public async deliver(): Promise<DeliveryOutcome> {
    // Unreachable in production wiring — the registry skips DISABLED channels.
    return { success: false, error: 'SMS provider not configured', errorClass: 'PERMANENT' };
  }
}

/**
 * PUSH channel abstraction. Interface + persistence-ready shape only — no
 * external push delivery is fabricated. When FCM/APNs credentials become
 * available, implement a PushProvider with env-driven config and device-token
 * lookup from notification.push_device_tokens.
 */
export class PushChannel implements ChannelProvider {
  public readonly channel = 'push';
  public readonly providerName = 'none';
  public readonly status: ProviderStatus;

  constructor(pushEnabled: boolean) {
    this.status = pushEnabled ? 'UNAVAILABLE' : 'DISABLED';
  }

  public async deliver(): Promise<DeliveryOutcome> {
    return { success: false, error: 'Push provider not configured', errorClass: 'PERMANENT' };
  }
}
