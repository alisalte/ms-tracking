/**
 * Last CAN reading per vehicle, for CCE records that carry CAN but no GPS fix.
 *
 * Such records are not positions, so they never reach gps-engine's position
 * pipeline. The gateway keeps their CAN in the key gps-engine's `LastCanMemory`
 * reads (`tenant:<tid>:vehicle:<vid>:can`, value `{seenAt, can}`), so the
 * dashboard shows the reading even while the unit has no fix.
 */
import type { Redis } from '@fleetvision/cache-redis';

/** Seven days — keep in step with gps-engine `LAST_CAN_TTL_SECONDS`. */
const TTL_SECONDS = 7 * 24 * 3600;

export class CanSnapshotStore {
  constructor(private readonly redis: Redis) {}

  /** Store `can` unless a newer reading is already there. Best-effort; never throws. */
  public async remember(
    tenantId: string,
    vehicleId: string,
    seenAt: Date,
    can: Record<string, unknown>,
  ): Promise<void> {
    const key = `tenant:${tenantId}:vehicle:${vehicleId}:can`;
    try {
      const raw = await this.redis.get(key);
      if (raw) {
        const prev = JSON.parse(raw) as { seenAt?: unknown };
        if (typeof prev.seenAt === 'string' && Date.parse(prev.seenAt) >= seenAt.getTime()) return;
      }
      await this.redis.set(
        key,
        JSON.stringify({ seenAt: seenAt.toISOString(), can }),
        'EX',
        TTL_SECONDS,
      );
    } catch {
      /* best-effort — Redis may be down */
    }
  }
}
