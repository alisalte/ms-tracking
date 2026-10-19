/**
 * Last-known CAN reading per vehicle.
 *
 * An MD300 sends CAN IDs only in some CCE records, so the latest position row
 * often says `can.present = false` even though CAN arrived a minute earlier.
 * This remembers the last record that carried CAN (long TTL, independent of the
 * 2-minute position cache) and attaches it as `cce.lastCan` to a CAN-less
 * record, so the dashboard shows the value with its age instead of "absent".
 *
 * The device-gateway writes the same key (`tenant:<tid>:vehicle:<vid>:can`, value
 * `{seenAt, can}`) for CCE records that carry CAN but no GPS fix, which never
 * become positions. Reads (`attachLatest`) therefore consult the key, so those
 * readings show up too.
 */
import type { Redis } from '@fleetvision/cache-redis';
import { PositionEvent } from '../../domain/position-event.js';
import type { LatestPosition } from '../persistence/position.repository.js';

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

  /** Newest remembered readings for these vehicles (missing/corrupt → no entry). */
  private async readMany(
    tenantId: string,
    vehicleIds: readonly string[],
  ): Promise<Map<string, StoredCan>> {
    const out = new Map<string, StoredCan>();
    if (vehicleIds.length === 0) return out;
    try {
      const raws = await this.redis.mget(...vehicleIds.map((id) => this.key(tenantId, id)));
      raws.forEach((raw, i) => {
        const id = vehicleIds[i];
        if (!raw || id === undefined) return;
        const stored = JSON.parse(raw) as StoredCan;
        if (stored?.can && typeof stored.seenAt === 'string') out.set(id, stored);
      });
    } catch {
      /* best-effort */
    }
    return out;
  }

  /**
   * Latest-position read path: when a position's record has no CAN, attach the
   * remembered reading if it is newer than the one already on the record
   * (e.g. written by the gateway from a record that had no GPS fix).
   */
  public async attachLatest<T extends LatestPosition>(positions: readonly T[]): Promise<T[]> {
    const wanted = positions.filter((p) => p.cce && !p.cce.can.present);
    if (wanted.length === 0) return [...positions];
    const tenantId = wanted[0]?.tenantId;
    if (!tenantId) return [...positions];
    const stored = await this.readMany(tenantId, [...new Set(wanted.map((p) => p.vehicleId))]);
    return positions.map((p) => {
      const mem = p.cce && !p.cce.can.present ? stored.get(p.vehicleId) : undefined;
      if (!p.cce || !mem) return p;
      const current = (p.cce as { lastCan?: { seenAt?: string } }).lastCan?.seenAt;
      if (current && Date.parse(current) >= Date.parse(mem.seenAt)) return p;
      return { ...p, cce: { ...p.cce, lastCan: { seenAt: mem.seenAt, ...mem.can } } };
    });
  }
}
