/**
 * Fleet Health Score v1 — rule-based (connectivity + open-alarm severity).
 * Higher = healthier. No ML / CMMS inputs in this phase.
 */

export type HealthPresence = 'ONLINE' | 'STALE' | 'OFFLINE' | 'UNKNOWN';

export type HealthAlarmSeverity = 'critical' | 'major' | 'minor' | 'info';

export interface VehicleHealthInput {
  vehicleId: string;
  presence?: HealthPresence | null;
}

export interface OpenAlarmInput {
  vehicleId: string;
  severity: HealthAlarmSeverity;
}

export interface VehicleHealthScoreResult {
  vehicleId: string;
  score: number;
  connectivity: number;
  alarmPenalty: number;
  openAlarmCount: number;
}

export interface FleetHealthScoreResult {
  score: number | null;
  vehicleCount: number;
  scoredCount: number;
  attentionCount: number;
  vehicles: VehicleHealthScoreResult[];
}

/** Connectivity component 0–100 from device presence. */
export function connectivityScore(presence: HealthPresence | null | undefined): number {
  switch (presence) {
    case 'ONLINE':
      return 100;
    case 'STALE':
      return 50;
    default:
      return 0;
  }
}

/** Cap alarm penalty at 70 so a connected vehicle never bottoms solely on alerts. */
export function alarmPenalty(severities: readonly HealthAlarmSeverity[]): number {
  let penalty = 0;
  for (const s of severities) {
    if (s === 'critical') penalty += 40;
    else if (s === 'major') penalty += 20;
    else if (s === 'minor') penalty += 10;
    else penalty += 5;
  }
  return Math.min(70, penalty);
}

/** Per-vehicle score: 60% connectivity + 40% (100 − alarm penalty). */
export function vehicleHealthScore(
  presence: HealthPresence | null | undefined,
  severities: readonly HealthAlarmSeverity[],
): { score: number; connectivity: number; alarmPenalty: number } {
  const connectivity = connectivityScore(presence);
  const penalty = alarmPenalty(severities);
  const score = Math.max(
    0,
    Math.min(100, Math.round(0.6 * connectivity + 0.4 * (100 - penalty))),
  );
  return { score, connectivity, alarmPenalty: penalty };
}

export const HEALTH_ATTENTION_THRESHOLD = 70;

/** Fleet rollup = mean of per-vehicle scores (vehicles with a row in the map join). */
export function computeFleetHealthScore(
  vehicles: readonly VehicleHealthInput[],
  openAlarms: readonly OpenAlarmInput[],
): FleetHealthScoreResult {
  const byVehicle = new Map<string, HealthAlarmSeverity[]>();
  for (const a of openAlarms) {
    if (!a.vehicleId) continue;
    const list = byVehicle.get(a.vehicleId) ?? [];
    list.push(a.severity);
    byVehicle.set(a.vehicleId, list);
  }

  const results: VehicleHealthScoreResult[] = vehicles.map((v) => {
    const severities = byVehicle.get(v.vehicleId) ?? [];
    const { score, connectivity, alarmPenalty: penalty } = vehicleHealthScore(
      v.presence,
      severities,
    );
    return {
      vehicleId: v.vehicleId,
      score,
      connectivity,
      alarmPenalty: penalty,
      openAlarmCount: severities.length,
    };
  });

  const scoredCount = results.length;
  const score =
    scoredCount === 0
      ? null
      : Math.round(results.reduce((sum, r) => sum + r.score, 0) / scoredCount);

  return {
    score,
    vehicleCount: vehicles.length,
    scoredCount,
    attentionCount: results.filter((r) => r.score <= HEALTH_ATTENTION_THRESHOLD).length,
    vehicles: results,
  };
}

export function healthScoreTone(
  score: number | null,
): 'success' | 'warning' | 'danger' | 'gray' {
  if (score == null) return 'gray';
  if (score >= 80) return 'success';
  if (score >= HEALTH_ATTENTION_THRESHOLD) return 'warning';
  return 'danger';
}
