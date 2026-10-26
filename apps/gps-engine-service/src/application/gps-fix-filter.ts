/**
 * GPS fix filter stage — applies the plausibility rules (domain/gps-fix-filter)
 * to an inbound position using the vehicle's previous fix and machine type.
 *
 * A flagged fix keeps its coordinates but is persisted with speed 0 and a
 * LOW_ACCURACY / SUSPECT_JUMP quality; the device's raw speed and the reasons
 * ride along in `metadata.gpsFilter`. STALE positions keep their STALE quality
 * (the freshness gate owns cache/broadcast for those) but still get the speed
 * zeroed when a rule trips.
 *
 * Best-effort: any lookup failure lets the position through unfiltered.
 */
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import {
  type GpsFilterOptions,
  type PrevFix,
  assessFix,
  hdopFromMetadata,
} from '../domain/gps-fix-filter.js';
import { PositionEvent } from '../domain/position-event.js';

export interface GpsFixFilterDeps {
  readonly options: GpsFilterOptions;
  readonly prevFix: (tenantId: string, vehicleId: string) => Promise<PrevFix | null>;
  readonly machineType: (tenantId: string, vehicleId: string) => Promise<string | null>;
}

export function gpsFilterOptions(c: GpsEngineConfig): GpsFilterOptions {
  return {
    minSatellites: c.GPS_FILTER_MIN_SATELLITES,
    maxHdop: c.GPS_FILTER_MAX_HDOP,
    maxSpeedKmh: c.GPS_FILTER_MAX_SPEED_KMH,
    machineMaxSpeedKmh: c.GPS_FILTER_MACHINE_MAX_SPEED_KMH,
    mismatchMinSpeedKmh: c.GPS_FILTER_MISMATCH_MIN_SPEED_KMH,
    mismatchFactor: c.GPS_FILTER_MISMATCH_FACTOR,
    mismatchSlackKmh: c.GPS_FILTER_MISMATCH_SLACK_KMH,
    maxGapS: c.GPS_FILTER_MAX_GAP_S,
    jumpMinDistanceM: c.GPS_FILTER_JUMP_MIN_DISTANCE_M,
  };
}

export class GpsFixFilter {
  constructor(private readonly deps: GpsFixFilterDeps) {}

  public async apply(event: PositionEvent): Promise<PositionEvent> {
    let prev: PrevFix | null = null;
    let machineType: string | null = null;
    try {
      [prev, machineType] = await Promise.all([
        this.deps.prevFix(event.tenantId, event.vehicleId),
        this.deps.machineType(event.tenantId, event.vehicleId),
      ]);
    } catch {
      /* best-effort — rules that need no lookup still run */
    }
    const verdict = assessFix(
      {
        latitude: event.latitude,
        longitude: event.longitude,
        speedKph: event.speedKph,
        satellites: event.satellites,
        hdop: hdopFromMetadata(event.metadata),
        capturedAt: event.capturedAt,
      },
      prev,
      machineType,
      this.deps.options,
    );
    if (verdict.quality === 'VALID') return event;
    return new PositionEvent({
      ...event,
      speedKph: verdict.speedKph,
      quality: event.quality === 'STALE' ? 'STALE' : verdict.quality,
      metadata: {
        ...event.metadata,
        gpsFilter: {
          rawSpeedKph: event.speedKph,
          reasons: verdict.reasons,
          distanceSpeedKmh: verdict.distanceSpeedKmh,
          capKmh: verdict.capKmh,
          ...(machineType ? { machineType } : {}),
        },
      },
    });
  }
}
