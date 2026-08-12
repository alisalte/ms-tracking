/**
 * NotificationPreference — per-user channel + severity preferences.
 *
 * Controls which notifications a user receives, through which channels, and at
 * what minimum severity. When no preference exists for a category, the
 * dispatcher uses defaults (all channels, min_severity = normal).
 */
import {
  DEFAULT_CHANNELS,
  DEFAULT_MIN_SEVERITY,
  type NotificationChannel,
  type NotificationSeverity,
  notifSeverityRank,
} from './notification-types.js';

export interface NotificationPreferenceProps {
  readonly tenantId: string;
  readonly userId: string;
  category: string;
  minSeverity: NotificationSeverity;
  channels: NotificationChannel[];
  enabled: boolean;
}

export class NotificationPreference {
  public readonly tenantId: string;
  public readonly userId: string;
  public category: string;
  public minSeverity: NotificationSeverity;
  public channels: NotificationChannel[];
  public enabled: boolean;

  constructor(props: NotificationPreferenceProps) {
    this.tenantId = props.tenantId;
    this.userId = props.userId;
    this.category = props.category;
    this.minSeverity = props.minSeverity;
    this.channels = props.channels;
    this.enabled = props.enabled;
  }

  /**
   * Should a notification with the given severity be delivered through the
   * given channel? Checks: preference enabled, severity ≥ minSeverity, channel
   * in the enabled list.
   */
  public shouldDeliver(severity: NotificationSeverity, channel: NotificationChannel): boolean {
    if (!this.enabled) return false;
    if (notifSeverityRank[severity] < notifSeverityRank[this.minSeverity]) return false;
    return this.channels.includes(channel);
  }

  /** Default preference for a category when none is set. */
  public static default(
    tenantId: string,
    userId: string,
    category: string,
  ): NotificationPreference {
    return new NotificationPreference({
      tenantId,
      userId,
      category,
      minSeverity: DEFAULT_MIN_SEVERITY,
      channels: [...DEFAULT_CHANNELS],
      enabled: true,
    });
  }
}
