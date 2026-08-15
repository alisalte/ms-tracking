/**
 * NotificationProviderRegistry (Sprint H §14) — configuration-driven channel
 * → provider mapping. Business logic asks the registry which channels are
 * dispatchable; it never branches on concrete providers
 * ("if email then SMTP" lives here and nowhere else).
 */
import type { NotificationChannel } from '../../domain/notification-types.js';
import type { ChannelProvider, ProviderStatus } from './channel-provider.js';

export interface ProviderHealthSnapshot {
  readonly channel: string;
  readonly provider: string;
  readonly status: ProviderStatus;
}

export class NotificationProviderRegistry {
  private readonly providers = new Map<string, ChannelProvider>();

  public register(provider: ChannelProvider): this {
    this.providers.set(provider.channel, provider);
    return this;
  }

  public get(channel: string): ChannelProvider | undefined {
    return this.providers.get(channel);
  }

  /** All registered providers, in registration order. */
  public all(): ChannelProvider[] {
    return [...this.providers.values()];
  }

  /** Only CONFIGURED providers — these are the dispatchable channels. */
  public configured(): ChannelProvider[] {
    return this.all().filter((p) => p.status === 'CONFIGURED');
  }

  public isDispatchable(channel: NotificationChannel): boolean {
    return this.providers.get(channel)?.status === 'CONFIGURED';
  }

  /** Health/readiness snapshot (no secrets) — Sprint H §48. */
  public healthSnapshot(): ProviderHealthSnapshot[] {
    return this.all().map((p) => ({
      channel: p.channel,
      provider: p.providerName,
      status: p.status,
    }));
  }
}
