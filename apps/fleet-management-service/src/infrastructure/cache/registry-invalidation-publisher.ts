import type { Redis } from '@fleetvision/cache-redis';
/**
 * Registry cache invalidation publisher (Sprint D §11).
 *
 * After a device mutation that changes what the device-gateway must know —
 * status (disable/enable/decommission), protocol, tenant ownership, or the
 * vehicle binding — fleet-management publishes the affected IMEI to the shared
 * Redis pub/sub channel. Every gateway instance subscribed
 * (`RegistryInvalidationSubscriber` on the gateway side) clears its L1/L2
 * auth-resolver cache for that IMEI immediately, closing Sprint C's TTL-bounded
 * (≤30s) staleness window for the changes that matter most.
 *
 * Best-effort by design: if Redis is down the publish fails silently and the
 * TTL bound still applies (invalidation is an optimization over a correct
 * baseline, never a correctness dependency).
 *
 * The IMEI is the only required payload (gateway cache keys are IMEI-indexed).
 * Channel + payload shape are mirrored in the gateway's subscriber.
 */
import { Logger } from '@nestjs/common';

export const REGISTRY_INVALIDATION_CHANNEL = 'fleetvision:registry:invalidate';

export type RegistryInvalidationReason =
  | 'device.created'
  | 'device.updated'
  | 'device.status-changed'
  | 'device.binding-changed';

export class RegistryInvalidationPublisher {
  private readonly logger = new Logger(RegistryInvalidationPublisher.name);

  constructor(private readonly redis: Redis | null) {}

  /** Publish an invalidation for one IMEI (best-effort, never throws). */
  public invalidate(
    imei: string,
    reason: RegistryInvalidationReason,
    tenantId?: string | null,
  ): void {
    if (!this.redis || !imei) return;
    const payload = JSON.stringify({ imei, tenantId: tenantId ?? null, reason });
    this.redis.publish(REGISTRY_INVALIDATION_CHANNEL, payload).catch((err) => {
      this.logger.debug(
        `Registry invalidation publish failed (${reason}): ${(err as Error).message} — TTL bound still applies.`,
      );
    });
  }
}
