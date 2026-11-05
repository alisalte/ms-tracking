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
 *   tenant:<tid>:vehicle:<vid>:last_fix          — last trusted fix (GPS fix gate).
 *   tenant:<tid>:vehicle:<vid>:ignition          — last seen ignition state (edge detection).
 *   tenant:<tid>:vehicle:<vid>:accident_hold     — accident awaiting stop confirmation.
 *   accident_hold_due                             — ZSET of holds by confirmation deadline.
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

  /**
   * Drop a previously claimed dedup key (e.g. after a failed DB insert) so the
   * next device-alarm delivery is not black-holed for the whole window.
   */
  public async clearDedup(tenantId: string, ruleId: string, vehicleId: string): Promise<void> {
    const key = `tenant:${tenantId}:alarm_dedup:${ruleId}:${vehicleId}`;
    try {
      await this.redis.del(key);
    } catch {
      // best-effort
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

  // ── GPS fix gate: last trusted fix per vehicle ──

  public async getLastFix(
    tenantId: string,
    vehicleId: string,
  ): Promise<{ lat: number; lng: number; capturedAtMs: number } | null> {
    try {
      const raw = await this.redis.get(`tenant:${tenantId}:vehicle:${vehicleId}:last_fix`);
      if (raw === null) return null;
      const [lat, lng, ts] = raw.split(',').map(Number);
      if (![lat, lng, ts].every((n) => Number.isFinite(n))) return null;
      return { lat: lat as number, lng: lng as number, capturedAtMs: ts as number };
    } catch {
      return null;
    }
  }

  public async setLastFix(
    tenantId: string,
    vehicleId: string,
    fix: { lat: number; lng: number; capturedAtMs: number },
  ): Promise<void> {
    try {
      await this.redis.set(
        `tenant:${tenantId}:vehicle:${vehicleId}:last_fix`,
        `${fix.lat},${fix.lng},${fix.capturedAtMs}`,
        'EX',
        3_600,
      );
    } catch {
      // best-effort
    }
  }

  // ── Ignition edge detection ──

  /**
   * Record the vehicle's ignition state at `atMs` and return the previous
   * state. Returns 'stale' (state untouched) for a fix older than the stored
   * one — a replayed buffer must not fabricate on/off edges — and null when
   * the previous state is unknown (first sighting or Redis down).
   */
  public async swapIgnitionState(
    tenantId: string,
    vehicleId: string,
    on: boolean,
    atMs: number,
  ): Promise<boolean | null | 'stale'> {
    const key = `tenant:${tenantId}:vehicle:${vehicleId}:ignition`;
    try {
      const raw = await this.redis.get(key);
      const [prevState, prevTs] = (raw ?? '').split(',');
      if (raw !== null && Number(prevTs) > atMs) return 'stale';
      await this.redis.set(key, `${on ? '1' : '0'},${atMs}`, 'EX', 7 * 86_400);
      return raw === null ? null : prevState === '1';
    } catch {
      return null;
    }
  }

  // ── Accident confirmation hold ──

  /**
   * Hold an accident alarm until the vehicle's behaviour confirms or cancels
   * it. Throws when Redis is down — the caller then notifies immediately.
   */
  public async holdAccident(
    tenantId: string,
    vehicleId: string,
    hold: { alertId: string; detectedAtMs: number },
    deadlineMs: number,
  ): Promise<void> {
    await this.redis.set(accidentHoldKey(tenantId, vehicleId), JSON.stringify(hold), 'EX', 3_600);
    await this.redis.zadd(ACCIDENT_HOLD_DUE, deadlineMs, `${tenantId}:${vehicleId}`);
  }

  public async getAccidentHold(
    tenantId: string,
    vehicleId: string,
  ): Promise<{ alertId: string; detectedAtMs: number } | null> {
    try {
      const raw = await this.redis.get(accidentHoldKey(tenantId, vehicleId));
      return raw === null ? null : (JSON.parse(raw) as { alertId: string; detectedAtMs: number });
    } catch {
      return null;
    }
  }

  /**
   * Take ownership of a hold (confirm or cancel). Exactly one caller wins, so
   * a position and the deadline sweep can never both notify.
   */
  public async claimAccidentHold(
    tenantId: string,
    vehicleId: string,
  ): Promise<{ alertId: string; detectedAtMs: number } | null> {
    const key = accidentHoldKey(tenantId, vehicleId);
    try {
      const raw = await this.redis.get(key);
      const deleted = await this.redis.del(key);
      await this.redis.zrem(ACCIDENT_HOLD_DUE, `${tenantId}:${vehicleId}`);
      if (raw === null || deleted !== 1) return null;
      return JSON.parse(raw) as { alertId: string; detectedAtMs: number };
    } catch {
      return null;
    }
  }

  /** Holds whose confirmation deadline has passed. */
  public async dueAccidentHolds(
    nowMs: number,
  ): Promise<Array<{ tenantId: string; vehicleId: string }>> {
    try {
      const members = await this.redis.zrangebyscore(ACCIDENT_HOLD_DUE, 0, nowMs);
      return members.flatMap((m) => {
        const [tenantId, vehicleId] = m.split(':');
        return tenantId && vehicleId ? [{ tenantId, vehicleId }] : [];
      });
    } catch {
      return [];
    }
  }

  // Sprint I — the geofence inside-set state moved to the gps-engine evaluator
  // (durable tracking.geofence_state in PostgreSQL); the Redis helpers were
  // removed with the inline per-position evaluation.
}

const ACCIDENT_HOLD_DUE = 'accident_hold_due';

function accidentHoldKey(tenantId: string, vehicleId: string): string {
  return `tenant:${tenantId}:vehicle:${vehicleId}:accident_hold`;
}
