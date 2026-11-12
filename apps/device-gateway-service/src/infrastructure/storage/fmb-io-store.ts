/**
 * Last known value of every FMB640 IO element, per vehicle.
 *
 * A Teltonika record carries only the elements that changed, so the dashboard
 * would flicker between partial views. The gateway merges each record into a
 * Redis hash (`tenant:<tid>:vehicle:<vid>:fmbio`, field = AVL id, value = the
 * point as JSON) and sends the merged panel on. gps-engine reads the same hash
 * for records without a GPS fix, which never become positions.
 */
import type { Redis } from '@fleetvision/cache-redis';
import type { FmbIoPanel, FmbIoPoint } from '../../domain/fmb-io-panel.js';
import { toFmbIoPanel } from '../adapters/teltonika/teltonika.io-panel.js';

/** Seven days — keep in step with gps-engine `FmbIoMemory`. */
const TTL_SECONDS = 7 * 24 * 3600;

export function fmbIoKey(tenantId: string, vehicleId: string): string {
  return `tenant:${tenantId}:vehicle:${vehicleId}:fmbio`;
}

export function parsePoint(raw: string | null | undefined): FmbIoPoint | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<FmbIoPoint>;
    if (typeof p.id !== 'number' || typeof p.group !== 'string' || typeof p.at !== 'string') {
      return null;
    }
    return p as FmbIoPoint;
  } catch {
    return null;
  }
}

export class FmbIoStore {
  constructor(private readonly redis: Redis) {}

  /**
   * Merge `points` (newer device time wins per element) and return the full
   * panel. Best-effort: on any Redis failure the record's own points are
   * returned, so a Redis outage degrades to partial data, never to no data.
   */
  public async merge(
    tenantId: string,
    vehicleId: string,
    points: readonly FmbIoPoint[],
    now: Date,
  ): Promise<FmbIoPanel> {
    const key = fmbIoKey(tenantId, vehicleId);
    try {
      const ids = points.map((p) => String(p.id));
      const prev = ids.length > 0 ? await this.redis.hmget(key, ...ids) : [];
      const fresh: Record<string, string> = {};
      points.forEach((p, i) => {
        const old = parsePoint(prev[i]);
        if (old && Date.parse(old.at) > Date.parse(p.at)) return; // backlog record
        fresh[String(p.id)] = JSON.stringify(p);
      });
      if (Object.keys(fresh).length > 0) {
        await this.redis.hset(key, fresh);
        await this.redis.expire(key, TTL_SECONDS);
      }
      const all = await this.redis.hgetall(key);
      const merged = Object.values(all)
        .map((raw) => parsePoint(raw))
        .filter((p): p is FmbIoPoint => p !== null);
      return toFmbIoPanel(merged, newest(merged) ?? now);
    } catch {
      return toFmbIoPanel(points, newest(points) ?? now);
    }
  }
}

function newest(points: readonly FmbIoPoint[]): Date | null {
  let max = 0;
  for (const p of points) max = Math.max(max, Date.parse(p.at) || 0);
  return max > 0 ? new Date(max) : null;
}
