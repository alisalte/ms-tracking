/**
 * Concrete channel providers.
 *
 * - WebSocketChannel: emits `notification.new` to the tenant's notifications room
 *   via the existing alarm-realtime gateway. No external provider needed.
 * - InAppChannel: the notification record IS the in-app delivery — creating it
 *   in the DB makes it visible. This channel is a no-op that always succeeds.
 * - EmailChannel: sends via nodemailer IF SMTP is configured; otherwise logs a
 *   warning and returns failure. Does NOT pretend to send when unconfigured.
 */
import { Logger } from '@nestjs/common';
import type { Notification } from '../../domain/notification.js';
import type { AlarmRealtimeGateway } from '../../infrastructure/websocket/alarm-realtime.gateway.js';
import type { ChannelProvider } from './channel-provider.js';

/** WebSocket channel — pushes `notification.new` to the tenant's notifications room. */
export class WebSocketChannel implements ChannelProvider {
  public readonly channel = 'websocket';
  constructor(private readonly gateway: AlarmRealtimeGateway | null) {}

  public async deliver(notification: Notification): Promise<{ success: boolean; error?: string }> {
    try {
      this.gateway?.emitNotification(notification.tenantId, notification);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

/** In-app channel — the notification record IS the delivery; always succeeds. */
export class InAppChannel implements ChannelProvider {
  public readonly channel = 'in_app';

  public async deliver(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }
}

/** Email channel — sends via nodemailer only when SMTP is configured. */
export class EmailChannel implements ChannelProvider {
  private readonly logger = new Logger('EmailChannel');
  public readonly channel = 'email';

  constructor(
    private readonly smtpConfig: {
      host: string;
      port: number;
      user: string;
      pass: string;
      from: string;
    } | null,
    private readonly getUserEmail: (tenantId: string, userId: string) => Promise<string | null>,
  ) {}

  public async deliver(notification: Notification): Promise<{ success: boolean; error?: string }> {
    if (!this.smtpConfig) {
      this.logger.warn('Email channel skipped — SMTP not configured (NOTIF_SMTP_HOST unset).');
      return { success: false, error: 'SMTP not configured' };
    }
    if (!notification.userId) {
      return { success: false, error: 'No target user for email' };
    }
    const email = await this.getUserEmail(notification.tenantId, notification.userId);
    if (!email) {
      return { success: false, error: 'User has no email address' };
    }
    try {
      // Dynamic import so the service boots even without nodemailer installed.
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: this.smtpConfig.host,
        port: this.smtpConfig.port,
        auth: { user: this.smtpConfig.user, pass: this.smtpConfig.pass },
      });
      await transporter.sendMail({
        from: this.smtpConfig.from,
        to: email,
        subject: notification.title,
        text: notification.body,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
