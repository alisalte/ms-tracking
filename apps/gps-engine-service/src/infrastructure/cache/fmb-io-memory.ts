/**
 * Last known FMB640 I/O panel per vehicle.
 *
 * The device-gateway merges every Teltonika record into the Redis hash
 * `tenant:<tid>:vehicle:<vid>:fmbio` (field = AVL id, value = point JSON). It
 * does so for records without a GPS fix too, which never become positions, so
 * the REST read path consults the hash to show the panel in that case as well.
 * Positions that do arrive carry the merged panel on the websocket directly.
 */
import type { Redis } from '@fleetvision/cache-redis';

export type FmbIoGroup =
  | 'din'
  | 'dout'
  | 'ain'
  | 'onewire'
  | 'serial'
  | 'can'
  | 'j1708'
  | 'kline'
  | 'other';

export interface FmbIoPoint {
  readonly id: number;
  readonly key: string | null;
  readonly group: FmbIoGroup;
  readonly value: number | boolean | string;
  readonly unit?: string;
  readonly at: string;
}

export interface FmbIoPanel {
  readonly updatedAt: string;
  readonly groups: Partial<Record<FmbIoGroup, readonly FmbIoPoint[]>>;
}

export class FmbIoMemory {
  /**
   * @param redis the Redis the device-gateway writes to
   * @param ownsClient true when this class created `redis` (a separate gateway
   *   connection) and must close it on shutdown
   */
  constructor(
    private readonly redis: Redis,
    private readonly ownsClient = false,
  ) {}

  /** Nest shutdown hook — closes a connection created just for the gateway's database. */
  public async onApplicationShutdown(): Promise<void> {
    if (!this.ownsClient) return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  /** The merged panel for one vehicle; null when nothing is stored or Redis fails. */
  public async read(tenantId: string, vehicleId: string): Promise<FmbIoPanel | null> {
    try {
      const all = await this.redis.hgetall(`tenant:${tenantId}:vehicle:${vehicleId}:fmbio`);
      const points: FmbIoPoint[] = [];
      for (const raw of Object.values(all)) {
        try {
          const p = JSON.parse(raw) as Partial<FmbIoPoint>;
          if (typeof p.id === 'number' && typeof p.group === 'string' && typeof p.at === 'string') {
            points.push(p as FmbIoPoint);
          }
        } catch {
          /* skip a corrupt field */
        }
      }
      if (points.length === 0) return null;
      const groups: Partial<Record<FmbIoGroup, FmbIoPoint[]>> = {};
      let newest = 0;
      for (const p of points.sort((a, b) => a.id - b.id)) {
        const list = groups[p.group] ?? [];
        list.push(p);
        groups[p.group] = list;
        newest = Math.max(newest, Date.parse(p.at) || 0);
      }
      return { updatedAt: new Date(newest).toISOString(), groups };
    } catch {
      return null;
    }
  }
}

/** Accept only a well-formed panel from an envelope. */
export function isFmbIoPanel(value: unknown): value is FmbIoPanel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as { updatedAt?: unknown; groups?: unknown };
  return (
    typeof v.updatedAt === 'string' &&
    !!v.groups &&
    typeof v.groups === 'object' &&
    !Array.isArray(v.groups)
  );
}
