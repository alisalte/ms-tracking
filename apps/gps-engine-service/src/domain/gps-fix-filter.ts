import type { Quality } from './quality.js';
/**
 * GPS fix plausibility filter — catches drift that the per-position range gates
 * (quality.ts) cannot see.
 *
 * A receiver with a poor sky view (few satellites, high HDOP) reports Doppler
 * speeds and positions that jump around while the machine stands still: an
 * excavator in a pit was seen at 107 km/h and once 566 km/h, its altitude
 * swinging 240 m in 14 s. These rules flag such fixes and zero their speed so
 * reports, live views and the trip FSMs never treat drift as movement. The raw
 * device speed is kept for audit in `metadata.gpsFilter`.
 *
 * Rules (first match wins the quality tag; all matching reasons are recorded):
 *   LOW_ACCURACY  — satellites < minSatellites, or HDOP > maxHdop.
 *   SUSPECT_JUMP  — reported speed above the machine-type cap;
 *                   reported speed far above the distance actually travelled
 *                   since the previous fix (Doppler spike);
 *                   distance since the previous fix implies a speed above the cap.
 *
 * Pure — no I/O; the pipeline supplies the previous fix and the machine type.
 */
import { haversineMeters } from './trip/haversine.js';

/** Steps shorter than this are a repeated fix, not a measurement (meters). */
const REPEATED_FIX_M = 1;

export type GpsFilterReason =
  | 'LOW_SATELLITES'
  | 'HIGH_HDOP'
  | 'OVER_MACHINE_CAP'
  | 'SPEED_DISTANCE_MISMATCH'
  | 'POSITION_JUMP';

export interface GpsFilterOptions {
  /** Fixes with fewer satellites are LOW_ACCURACY. */
  readonly minSatellites: number;
  /** Fixes with a larger HDOP are LOW_ACCURACY. */
  readonly maxHdop: number;
  /** Speed cap for machines with no type-specific cap (km/h). */
  readonly maxSpeedKmh: number;
  /** Per-machine-type speed caps (km/h), e.g. `{ SHOVEL: 15 }`. */
  readonly machineMaxSpeedKmh: Readonly<Record<string, number>>;
  /** Mismatch check applies only above this reported speed (km/h). */
  readonly mismatchMinSpeedKmh: number;
  /** Reported speed is a spike when > distance-speed × factor + slack. */
  readonly mismatchFactor: number;
  readonly mismatchSlackKmh: number;
  /** Distance-based checks only use a previous fix at most this old (seconds). */
  readonly maxGapS: number;
  /** A position step shorter than this is never a jump (meters; absorbs fix noise). */
  readonly jumpMinDistanceM: number;
}

export interface GpsFixInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly satellites: number | null;
  readonly hdop: number | null;
  readonly capturedAt: Date;
}

export interface PrevFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly capturedAt: Date;
}

export interface GpsFilterVerdict {
  /** VALID when nothing tripped, otherwise LOW_ACCURACY or SUSPECT_JUMP. */
  readonly quality: Extract<Quality, 'VALID' | 'LOW_ACCURACY' | 'SUSPECT_JUMP'>;
  /** Speed to persist/broadcast: the reported speed, or 0 for a flagged fix. */
  readonly speedKph: number;
  readonly reasons: readonly GpsFilterReason[];
  /** Speed implied by the step from the previous fix (null when not comparable). */
  readonly distanceSpeedKmh: number | null;
  readonly capKmh: number;
}

export function speedCapFor(machineType: string | null, opts: GpsFilterOptions): number {
  const typed = machineType ? opts.machineMaxSpeedKmh[machineType] : undefined;
  return typed !== undefined ? Math.min(typed, opts.maxSpeedKmh) : opts.maxSpeedKmh;
}

export function assessFix(
  fix: GpsFixInput,
  prev: PrevFix | null,
  machineType: string | null,
  opts: GpsFilterOptions,
): GpsFilterVerdict {
  const reasons: GpsFilterReason[] = [];
  const capKmh = speedCapFor(machineType, opts);

  if (fix.satellites !== null && fix.satellites < opts.minSatellites)
    reasons.push('LOW_SATELLITES');
  if (fix.hdop !== null && fix.hdop > opts.maxHdop) reasons.push('HIGH_HDOP');

  if (fix.speedKph > capKmh) reasons.push('OVER_MACHINE_CAP');

  let distanceSpeedKmh: number | null = null;
  let stepM = 0;
  if (prev) {
    const dtS = (fix.capturedAt.getTime() - prev.capturedAt.getTime()) / 1000;
    if (dtS >= 1 && dtS <= opts.maxGapS) {
      stepM = haversineMeters(prev.latitude, prev.longitude, fix.latitude, fix.longitude);
      distanceSpeedKmh = (stepM / dtS) * 3.6;
    }
  }
  if (distanceSpeedKmh !== null) {
    // An unchanged coordinate is a repeated fix (devices re-send the last
    // position with a fresh timestamp), not evidence the machine stood still.
    if (
      stepM >= REPEATED_FIX_M &&
      fix.speedKph > opts.mismatchMinSpeedKmh &&
      fix.speedKph > distanceSpeedKmh * opts.mismatchFactor + opts.mismatchSlackKmh
    ) {
      reasons.push('SPEED_DISTANCE_MISMATCH');
    }
    if (distanceSpeedKmh > capKmh && stepM >= opts.jumpMinDistanceM) reasons.push('POSITION_JUMP');
  }

  const jump = reasons.some(
    (r) => r === 'OVER_MACHINE_CAP' || r === 'SPEED_DISTANCE_MISMATCH' || r === 'POSITION_JUMP',
  );
  const quality = jump ? 'SUSPECT_JUMP' : reasons.length > 0 ? 'LOW_ACCURACY' : 'VALID';
  return {
    quality,
    speedKph: quality === 'VALID' ? fix.speedKph : 0,
    reasons,
    distanceSpeedKmh: distanceSpeedKmh === null ? null : Math.round(distanceSpeedKmh * 10) / 10,
    capKmh,
  };
}

/** HDOP from a decoded Meitrack CCE record (`metadata.cce.status.hdop`), if any. */
export function hdopFromMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): number | null {
  const cce = metadata?.cce as { status?: { hdop?: unknown } } | undefined;
  const hdop = cce?.status?.hdop;
  return typeof hdop === 'number' && Number.isFinite(hdop) ? hdop : null;
}
