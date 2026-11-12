import type { Redis } from '@fleetvision/cache-redis';
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
 *
 * "Best-effort" does not mean silent: a Redis outage makes every vehicle start a
 * new trip on each position (it once produced ~9,500 orphan trips in one day with
 * no trace in the logs), so failures are logged, at most once per minute.
 */
import { Logger } from '@nestjs/common';

/** Per-FSM TTL in seconds (07 §13.5). */
const TTL: Record<string, number> = {
  tripfsm: 6 * 3600,
  idlefsm: 1 * 3600,
  parkfsm: 24 * 3600,
  odo: 24 * 3600,
  enginehours: 24 * 3600,
};

/** Minimum gap between two failure log lines. */
const FAILURE_LOG_INTERVAL_MS = 60_000;

export class RedisFsmCache {
  private readonly logger = new Logger('RedisFsmCache');
  private lastFailureLogAt = 0;
  private failuresSinceLog = 0;

  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
  ) {}

  /** Log a failed operation; repeats within a minute are only counted. */
  private logFailure(op: string, fsm: string, err: unknown): void {
    this.failuresSinceLog += 1;
    const t = this.now();
    if (t - this.lastFailureLogAt < FAILURE_LOG_INTERVAL_MS) return;
    this.lastFailureLogAt = t;
    const n = this.failuresSinceLog;
    this.failuresSinceLog = 0;
    this.logger.warn(
      `FSM state ${op} failed (${fsm}): ${(err as Error)?.message ?? String(err)} — ` +
        `${n} failure(s) since the last log. Trips restart from defaults while this lasts.`,
    );
  }

  private key(tenantId: string, vehicleId: string, fsm: string): string {
    return `tenant:${tenantId}:vehicle:${vehicleId}:${fsm}`;
  }

  /** Load a JSON-serialized FSM state; null on miss/error. */
  public async get<T>(tenantId: string, vehicleId: string, fsm: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.key(tenantId, vehicleId, fsm));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logFailure('read', fsm, err);
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
    } catch (err) {
      this.logFailure('write', fsm, err);
    }
  }

  /** Get a numeric scalar (odometer/engine-hours); 0 on miss. */
  public async getNumber(tenantId: string, vehicleId: string, fsm: string): Promise<number> {
    try {
      const raw = await this.redis.get(this.key(tenantId, vehicleId, fsm));
      return raw ? Number(raw) || 0 : 0;
    } catch (err) {
      this.logFailure('read', fsm, err);
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
    } catch (err) {
      this.logFailure('write', fsm, err);
    }
  }
}
