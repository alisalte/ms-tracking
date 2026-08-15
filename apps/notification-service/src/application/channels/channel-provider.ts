/**
 * Channel provider interface — each delivery channel implements this.
 * The dispatcher asks the provider registry for CONFIGURED providers only;
 * business logic never branches on concrete channel implementations
 * (Sprint H §14).
 *
 * Implemented channels: websocket, in_app, email (SMTP).
 * Provider-ready but DISABLED unless configured: sms, push, webhook.
 */
import type { Notification } from '../../domain/notification.js';

/** Provider readiness (Sprint H §48) — never marks missing optional providers as failure. */
export type ProviderStatus = 'CONFIGURED' | 'DISABLED' | 'UNAVAILABLE';

export interface DeliveryOutcome {
  success: boolean;
  error?: string;
  /** Permanent errors are never retried; transient errors get bounded retries. */
  errorClass?: 'PERMANENT' | 'TRANSIENT';
  /** Provider reference id (e.g. SMTP message id) for correlation. */
  providerMessageId?: string;
}

export interface ChannelProvider {
  /** The channel type this provider handles. */
  readonly channel: string;

  /** Provider name for delivery audit records (e.g. 'smtp', 'fcm'). */
  readonly providerName: string;

  /** Whether this provider is configured and eligible for dispatch. */
  readonly status: ProviderStatus;

  /**
   * Attempt to deliver a notification through this channel.
   * Returns { success: true } on success, { success: false, error } on failure.
   */
  deliver(notification: Notification): Promise<DeliveryOutcome>;
}

export const DISABLED_OUTCOME: DeliveryOutcome = {
  success: false,
  error: 'Provider not configured',
  errorClass: 'PERMANENT',
};
