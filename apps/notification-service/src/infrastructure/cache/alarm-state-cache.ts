/**
 * Alarm state cache — Redis-backed per-vehicle alarm dedup state + geofence
 * enter/exit tracking. Best-effort: Redis down means dedup resets (acceptable —
 * the worst case is a duplicate alarm, not a missed one).
 *
 * Key scheme:
 *   tenant:<tid>:alarm_dedup:<ruleId>:<vehicleId> — SET with TTL = dedup window.
 *   tenant:<tid>:vehicle:<vid>:geofence_state     — JSON map of geofence IDs → boolean (inside).
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

  // ── Geofence state ──

  /** Get the set of geofence IDs a vehicle is currently inside. */
  public async getGeofenceState(tenantId: string, vehicleId: string): Promise<Set<string>> {
    const key = `tenant:${tenantId}:vehicle:${vehicleId}:geofence_state`;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return new Set(Object.keys(parsed).filter((id) => parsed[id]));
    } catch {
      return new Set();
    }
  }

  /** Set the full geofence-inside state for a vehicle. */
  public async setGeofenceState(
    tenantId: string,
    vehicleId: string,
    insideGeofenceIds: Set<string>,
  ): Promise<void> {
    const key = `tenant:${tenantId}:vehicle:${vehicleId}:geofence_state`;
    try {
      const obj: Record<string, boolean> = {};
      for (const id of insideGeofenceIds) obj[id] = true;
      await this.redis.set(key, JSON.stringify(obj), 'EX', 86_400); // 24h TTL
    } catch {
      // Best-effort.
    }
  }
}
