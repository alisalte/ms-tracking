/**
 * Last-known CAN reading per vehicle.
 *
 * An MD300 sends CAN IDs only in some CCE records, so the latest position row
 * often says `can.present = false` even though CAN arrived a minute earlier.
 * This remembers the last record that carried CAN (long TTL, independent of the
 * 2-minute position cache) and attaches it as `cce.lastCan` to a CAN-less
 * record, so the dashboard shows the value with its age instead of "absent".
 */
import type { Redis } from '@fleetvision/cache-redis';
import { PositionEvent } from '../../domain/position-event.js';

/** Seven days — a parked vehicle keeps its last reading visible. */
const LAST_CAN_TTL_SECONDS = 7 * 24 * 3600;

interface StoredCan {
  readonly seenAt: string;
  readonly can: Record<string, unknown>;
}

export class LastCanMemory {
  constructor(private readonly redis: Redis) {}

  private key(tenantId: string, vehicleId: string): string {
    return `tenant:${tenantId}:vehicle:${vehicleId}:can`;
  }

  /**
   * Remember CAN from this record, or attach the remembered CAN when the record
   * has none. Best-effort: any Redis failure returns the event unchanged.
   */
  public async apply(event: PositionEvent): Promise<PositionEvent> {
    const cce = event.metadata?.cce;
    if (!cce || typeof cce !== 'object' || Array.isArray(cce)) return event;
    const rec = cce as { can?: { present?: unknown } } & Record<string, unknown>;
    const key = this.key(event.tenantId, event.vehicleId);
    try {
      if (rec.can?.present !== true && rec.can?.present !== false) return event;
      const raw = await this.redis.get(key);
      const stored = raw ? (JSON.parse(raw) as StoredCan) : null;
      const valid = stored?.can && typeof stored.seenAt === 'string' ? stored : null;
      if (rec.can.present === true) {
        // A cached backlog record must not replace a newer reading.
        if (valid && Date.parse(valid.seenAt) >= event.capturedAt.getTime()) return event;
        const next: StoredCan = {
          seenAt: event.capturedAt.toISOString(),
          can: rec.can as Record<string, unknown>,
        };
        await this.redis.set(key, JSON.stringify(next), 'EX', LAST_CAN_TTL_SECONDS);
        return event;
      }
      if (!valid) return event;
      return new PositionEvent({
        ...event,
        metadata: {
          ...event.metadata,
          cce: { ...rec, lastCan: { seenAt: valid.seenAt, ...valid.can } },
        },
      });
    } catch {
      return event;
    }
  }
}
