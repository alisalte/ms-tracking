/**
 * Derive map motion state from connection presence + last fix.
 *
 * Rules (§18):
 * - OFFLINE / UNKNOWN → offline (never "driving" from a leftover speed)
 * - STALE → stopped
 * - ONLINE with a fresh fix → driving / idle / overspeed from speed
 * - ONLINE with an aged fix → idle/stopped — last km/h must not look live
 */
import { TRIP_SPEED_LIMIT_KMH } from '@/lib/trip-events';
import type { MapVehicle, VehiclePresence } from '@/types/fleet.types';

/** Last fix older than this is not "in motion" even if speedKph was high. */
export const MOTION_FRESH_MS = 5 * 60_000;

export interface MotionInput {
  presence: VehiclePresence | undefined;
  speedKph: number;
  ignitionOn?: boolean | null;
  /** ISO timestamp of the last position fix. */
  capturedAt?: string | null;
  /** Optional clock override (tests). */
  nowMs?: number;
}

export interface MotionResult {
  state: MapVehicle['state'];
  /** Speed shown in the UI — 0 when not live-online. */
  speed: number;
  presence: VehiclePresence;
}

function fixAgeMs(capturedAt: string | null | undefined, nowMs: number): number {
  // Missing timestamp → treat as fresh. Real GPS rows always carry capturedAt;
  // demo/partial rows must not be forced "idle" just because the clock is absent.
  if (!capturedAt) return 0;
  const ts = Date.parse(capturedAt);
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, nowMs - ts);
}

/**
 * Normalize presence + motion so list cards and the detail drawer never disagree
 * (e.g. "در حرکت" on the roster while the drawer says "آفلاین").
 */
export function deriveVehicleMotion(input: MotionInput): MotionResult {
  const nowMs = input.nowMs ?? Date.now();
  const presence = input.presence ?? 'UNKNOWN';
  const age = fixAgeMs(input.capturedAt, nowMs);
  const fresh = age <= MOTION_FRESH_MS;

  if (presence === 'OFFLINE' || presence === 'UNKNOWN') {
    return { state: 'offline', speed: 0, presence };
  }
  if (presence === 'STALE') {
    return { state: 'stopped', speed: 0, presence };
  }

  // ONLINE — only advertise motion while the fix itself is fresh.
  if (!fresh) {
    return {
      state: input.ignitionOn === false ? 'stopped' : 'idle',
      speed: 0,
      presence,
    };
  }

  const speed = Number.isFinite(input.speedKph) ? Math.max(0, input.speedKph) : 0;
  if (speed > TRIP_SPEED_LIMIT_KMH) return { state: 'overspeed', speed, presence };
  if (speed > 2) return { state: 'driving', speed, presence };
  return {
    state: input.ignitionOn === false ? 'stopped' : 'idle',
    speed,
    presence,
  };
}

/**
 * A live WebSocket fix is proof of life. Upgrade STALE/OFFLINE/UNKNOWN so a
 * vehicle that is actively reporting is never stuck "آفلاین" on the drawer
 * while the roster still shows motion from the same packet.
 */
export function presenceFromLiveFix(
  current: VehiclePresence | undefined,
  hasFreshLiveFix: boolean,
): VehiclePresence {
  if (hasFreshLiveFix) return 'ONLINE';
  return current ?? 'UNKNOWN';
}
