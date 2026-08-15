/**
 * Registry cache invalidation — push-based, over the existing Redis (Sprint D §11).
 *
 * Sprint C documented TTL-bounded cache invalidation (≤30s window) as the
 * minimum. Sprint D §11 adds push-based invalidation for the changes that must
 * take effect faster than a TTL: device disabled/enabled, reassigned to another
 * vehicle, tenant ownership changed, or protocol changed.
 *
 * fleet-management-service publishes the affected IMEI to a Redis pub/sub
 * channel on those mutations (it already has Redis). Each gateway instance
 * subscribes and calls `AuthResolver.invalidate(imei)`, which clears L1 (and L2
 * best-effort) immediately. No new Kafka topic, no distributed cache framework.
 *
 * Channel payload (JSON): `{ imei, tenantId?, reason }`. The IMEI is all the
 * gateway needs (L1/L2 keys are IMEI-indexed). Falls back gracefully to TTL if
 * Redis pub/sub is unavailable — this is an optimization, not a hard dependency.
 */
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from '@fleetvision/cache-redis';
import type { AuthResolver } from '../../application/auth-resolver.js';

export const REGISTRY_INVALIDATION_CHANNEL = 'fleetvision:registry:invalidate';

export interface RegistryInvalidationMessage {
  readonly imei: string;
  readonly tenantId?: string | null;
  readonly reason?: string | null;
}

export class RegistryInvalidationSubscriber implements OnApplicationShutdown {
  private readonly logger = new Logger(RegistryInvalidationSubscriber.name);
  private listener: Redis | null = null;
  private started = false;

  constructor(
    private readonly redis: Redis | null,
    private readonly authResolver: AuthResolver,
  ) {}

  public async start(): Promise<void> {
    if (this.started || !this.redis) return;
    try {
      // Dedicated subscriber connection (Redis pub/sub requires a dedicated link).
      const sub = this.redis.duplicate();
      await sub.subscribe(REGISTRY_INVALIDATION_CHANNEL);
      sub.on('message', (_channel, payload) => this.handle(payload));
      this.listener = sub;
      this.started = true;
      this.logger.log(`Subscribed to registry invalidation channel.`);
    } catch (err) {
      // Non-fatal: TTL-bounded invalidation still applies (Sprint C baseline).
      this.logger.warn(
        `Could not subscribe to registry invalidation channel — degrading to TTL-only: ${(err as Error).message}`,
      );
    }
  }

  private handle(payload: string): void {
    let msg: RegistryInvalidationMessage;
    try {
      msg = JSON.parse(payload) as RegistryInvalidationMessage;
    } catch {
      this.logger.warn(`Malformed registry invalidation payload — ignored.`);
      return;
    }
    if (!msg || typeof msg.imei !== 'string' || msg.imei.length === 0) return;
    this.authResolver.invalidate(msg.imei);
    this.logger.debug(`Invalidated registry cache for imei=${msg.imei} (reason=${msg.reason ?? 'unknown'}).`);
  }

  public async onApplicationShutdown(): Promise<void> {
    if (!this.listener) return;
    try {
      await this.listener.unsubscribe(REGISTRY_INVALIDATION_CHANNEL);
      await this.listener.quit();
    } catch {
      /* best-effort */
    }
    this.listener = null;
    this.started = false;
  }
}
