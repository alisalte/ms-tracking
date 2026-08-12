/**
 * Channel provider interface — each delivery channel implements this.
 * The dispatcher calls `deliver()` for each enabled channel.
 *
 * Implemented channels: websocket, in_app, email.
 * Interface-only (not implemented unless a provider is available): sms, push, webhook.
 */
import type { Notification } from '../../domain/notification.js';

export interface ChannelProvider {
  /** The channel type this provider handles. */
  readonly channel: string;

  /**
   * Attempt to deliver a notification through this channel.
   * Returns { success: true } on success, { success: false, error } on failure.
   */
  deliver(notification: Notification): Promise<{ success: boolean; error?: string }>;
}
