/**
 * GPS fix gate for speed-based alarms.
 *
 * This service consumes the RAW position topic, ahead of the gps-engine's fix
 * filter. A receiver with a poor sky view (an excavator in a pit) reports
 * Doppler speeds of 40–100 km/h while standing still; the gps-engine zeroes
 * those fixes, so speed alarms must ignore them too or the alarm list
 * contradicts the track. Thresholds mirror the gps-engine GPS_FILTER_* defaults.
 *
 * Pure — the caller supplies the previous trusted fix and the machine type.
 */

export interface GpsFixGateOptions {
  readonly minSatellites: number;
  readonly maxHdop: number;
  /** Speed cap for machines with no type-specific cap (km/h). */
  readonly maxSpeedKmh: number;
  /** Per-machine-type caps (km/h), keyed by fleet.vehicles.machine_type. */
  readonly machineMaxSpeedKmh: Readonly<Record<string, number>>;
  /** Mismatch check applies only above this reported speed (km/h). */
  readonly mismatchMinSpeedKmh: number;
  /** Reported speed is a spike when > distance-speed × factor + slack. */
  readonly mismatchFactor: number;
  readonly mismatchSlackKmh: number;
  /** Distance checks only use a previous fix at most this old (seconds). */
  readonly maxGapS: number;
}

export const DEFAULT_GPS_FIX_GATE: GpsFixGateOptions = {
  minSatellites: 5,
  maxHdop: 5,
  maxSpeedKmh: 200,
  machineMaxSpeedKmh: { SHOVEL: 15 },
  mismatchMinSpeedKmh: 20,
  mismatchFactor: 3,
  mismatchSlackKmh: 10,
  maxGapS: 10,
};

export interface GateFix {
  readonly lat: number;
  readonly lng: number;
  readonly speedKph: number;
  readonly satellites: number | null;
  readonly hdop: number | null;
  readonly capturedAtMs: number;
}

export interface PrevGateFix {
  readonly lat: number;
  readonly lng: number;
  readonly capturedAtMs: number;
}

/** Steps shorter than this are a repeated fix, not a measurement (meters). */
const REPEATED_FIX_M = 1;
/** A position step shorter than this is never a jump (meters). */
const JUMP_MIN_DISTANCE_M = 50;

/** Why a fix's speed cannot be trusted, or null when it can. */
export function untrustedSpeedReason(
  fix: GateFix,
  prev: PrevGateFix | null,
  machineType: string | null,
  opts: GpsFixGateOptions = DEFAULT_GPS_FIX_GATE,
): string | null {
  if (fix.satellites !== null && fix.satellites < opts.minSatellites) return 'LOW_SATELLITES';
  if (fix.hdop !== null && fix.hdop > opts.maxHdop) return 'HIGH_HDOP';
  const typed = machineType ? opts.machineMaxSpeedKmh[machineType] : undefined;
  const capKmh = typed !== undefined ? Math.min(typed, opts.maxSpeedKmh) : opts.maxSpeedKmh;
  if (fix.speedKph > capKmh) return 'OVER_MACHINE_CAP';
  if (prev) {
    const dtS = (fix.capturedAtMs - prev.capturedAtMs) / 1000;
    if (dtS >= 1 && dtS <= opts.maxGapS) {
      const stepM = haversineMeters(prev.lat, prev.lng, fix.lat, fix.lng);
      const distanceSpeedKmh = (stepM / dtS) * 3.6;
      if (
        stepM >= REPEATED_FIX_M &&
        fix.speedKph > opts.mismatchMinSpeedKmh &&
        fix.speedKph > distanceSpeedKmh * opts.mismatchFactor + opts.mismatchSlackKmh
      ) {
        return 'SPEED_DISTANCE_MISMATCH';
      }
      if (distanceSpeedKmh > capKmh && stepM >= JUMP_MIN_DISTANCE_M) return 'POSITION_JUMP';
    }
  }
  return null;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
