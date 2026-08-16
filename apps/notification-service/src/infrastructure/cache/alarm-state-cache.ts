/**
 * Alarm state cache — Redis-backed per-vehicle alarm dedup state + geofence
 * enter/exit tracking. Best-effort: Redis down means dedup resets (acceptable —
 * the worst case is a duplicate alarm, not a missed one).
 *
 * Key scheme:
 *   tenant:<tid>:alarm_dedup:<ruleId>:<vehicleId> — SET with TTL = dedup window.
 *   tenant:<tid>:vehicle:<vid>:geofence_state     — JSON map of geofence IDs → boolean (inside).
 *   tenant:<tid>:event_dedup:<eventId>            — FleetEvent idempotency (Sprint G Part 6).
 *   tenant:<tid>:overspeed_since:<ruleId>:<vid>   — overspeed grace-period state (Part 13).
 *   tenant:<tid>:occ_count:<ruleId>:<vid>         — suppressed-occurrence counter (Part 12).
 */
import type { Redis } from '@fleetvision/cache-redis';

export class AlarmStateCache {
  constructor(private readonly redis: Redis) {}

  // ── Dedup ──

  /**
   * Check if an alarm for this rule+vehicle is within the dedup window.
   * Returns true if the alarm should be SUPPRESSED (a recent one was already raised).
   * If not suppressed, marks the dedup key with the given TTL.
   */
  public async shouldSuppress(
    tenantId: string,
    ruleId: string,
    vehicleId: string,
    dedupWindowSec: number,
  ): Promise<boolean> {
    const key = `tenant:${tenantId}:alarm_dedup:${ruleId}:${vehicleId}`;
    try {
      // SET NX = only set if not exists; returns 'OK' if set (first occurrence).
      const result = await this.redis.set(key, '1', 'EX', dedupWindowSec, 'NX');
      // If result is 'OK', the key was newly set → NOT suppressed (first alarm in window).
      // If result is null, the key already exists → SUPPRESSED (duplicate within window).
      return result !== 'OK';
    } catch {
      // Redis error → don't suppress (fail-open: better a duplicate than a missed alarm).
      return false;
    }
  }

  // ── FleetEvent idempotency (Sprint G Part 6) ──

  /**
   * Returns true when this eventId has already been processed (Kafka
   * redelivery / at-least-once duplication). Marks it seen for 24h otherwise.
   */
  public async isDuplicateEvent(tenantId: string, eventId: string): Promise<boolean> {
    const key = `tenant:${tenantId}:event_dedup:${eventId}`;
    try {
      const result = await this.redis.set(key, '1', 'EX', 86_400, 'NX');
      return result !== 'OK';
    } catch {
      return false; // fail-open — alarm-level dedup still guards
    }
  }

  // ── Overspeed grace period (Part 13) ──

  /**
   * Record/inspect when sustained speeding began for a rule+vehicle.
   * Returns the stored epoch-ms start, or null when no window is open.
   */
  public async getOverspeedSince(
    tenantId: string,
    ruleId: string,
    vehicleId: string,
  ): Promise<number | null> {
    try {
      const raw = await this.redis.get(`tenant:${tenantId}:overspeed_since:${ruleId}:${vehicleId}`);
      return raw === null ? null : Number(raw);
    } catch {
      return null;
    }
  }

  /** Open (or refresh) the sustained-speeding window start. */
  public async setOverspeedSince(
    tenantId: string,
    ruleId: string,
    vehicleId: string,
    sinceMs: number,
  ): Promise<void> {
    try {
      await this.redis.set(
        `tenant:${tenantId}:overspeed_since:${ruleId}:${vehicleId}`,
        String(sinceMs),
        'EX',
        3_600,
      );
    } catch {
      // best-effort
    }
  }

  /** Clear the sustained-speeding window (condition recovered). */
  public async clearOverspeedSince(
    tenantId: string,
    ruleId: string,
    vehicleId: string,
  ): Promise<void> {
    try {
      await this.redis.del(`tenant:${tenantId}:overspeed_since:${ruleId}:${vehicleId}`);
    } catch {
      // best-effort
    }
  }

  // ── Suppressed-occurrence counter (Part 12 — metadata on the open alarm) ──

  /** Increment + return how many detections were suppressed for this alarm window. */
  public async incrementOccurrenceCount(
    tenantId: string,
    ruleId: string,
    vehicleId: string,
  ): Promise<number> {
    try {
      const n = await this.redis.incr(`tenant:${tenantId}:occ_count:${ruleId}:${vehicleId}`);
      if (n === 1) {
        await this.redis.expire(`tenant:${tenantId}:occ_count:${ruleId}:${vehicleId}`, 86_400);
      }
      return n;
    } catch {
      return 1;
    }
  }

  // Sprint I — the geofence inside-set state moved to the gps-engine evaluator
  // (durable tracking.geofence_state in PostgreSQL); the Redis helpers were
  // removed with the inline per-position evaluation.
}
