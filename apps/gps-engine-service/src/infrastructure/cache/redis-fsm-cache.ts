/**
 * Redis FSM-state cache — persists per-vehicle FSM snapshots so a pod restart
 * resumes mid-trip without spurious boundaries (07 §13.5).
 *
 * Keys (tenant-namespaced, colocating a tenant's hot keys on one Redis shard):
 *   tenant:<tid>:vehicle:<vid>:tripfsm   TTL 6h
 *   tenant:<tid>:vehicle:<vid>:idlefsm   TTL 1h
 *   tenant:<tid>:vehicle:<vid>:parkfsm   TTL 24h
 *   tenant:<tid>:vehicle:<vid>:odo       TTL 24h
 *   tenant:<tid>:vehicle:<vid>:enginehours TTL 24h
 *
 * Values are JSON. All operations are best-effort (Redis down → the FSM
 * restarts from defaults; a few spurious boundaries on failover are acceptable).
 */
import type { Redis } from '@fleetvision/cache-redis';

/** Per-FSM TTL in seconds (07 §13.5). */
const TTL: Record<string, number> = {
  tripfsm: 6 * 3600,
  idlefsm: 1 * 3600,
  parkfsm: 24 * 3600,
  odo: 24 * 3600,
  enginehours: 24 * 3600,
};

export class RedisFsmCache {
  constructor(private readonly redis: Redis) {}

  private key(tenantId: string, vehicleId: string, fsm: string): string {
    return `tenant:${tenantId}:vehicle:${vehicleId}:${fsm}`;
  }

  /** Load a JSON-serialized FSM state; null on miss/error. */
  public async get<T>(tenantId: string, vehicleId: string, fsm: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.key(tenantId, vehicleId, fsm));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Save an FSM state with the FSM's canonical TTL. Best-effort. */
  public async set<T>(tenantId: string, vehicleId: string, fsm: string, value: T): Promise<void> {
    try {
      await this.redis.set(
        this.key(tenantId, vehicleId, fsm),
        JSON.stringify(value),
        'EX',
        TTL[fsm] ?? 3600,
      );
    } catch {
      /* best-effort */
    }
  }

  /** Get a numeric scalar (odometer/engine-hours); 0 on miss. */
  public async getNumber(tenantId: string, vehicleId: string, fsm: string): Promise<number> {
    try {
      const raw = await this.redis.get(this.key(tenantId, vehicleId, fsm));
      return raw ? Number(raw) || 0 : 0;
    } catch {
      return 0;
    }
  }

  /** Set a numeric scalar (odometer/engine-hours). Best-effort. */
  public async setNumber(
    tenantId: string,
    vehicleId: string,
    fsm: string,
    value: number,
  ): Promise<void> {
    try {
      await this.redis.set(
        this.key(tenantId, vehicleId, fsm),
        String(value),
        'EX',
        TTL[fsm] ?? 3600,
      );
    } catch {
      /* best-effort */
    }
  }
}
