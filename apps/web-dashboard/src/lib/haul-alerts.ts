/**
 * Live alerts for a haul route's loading and unloading limits.
 *
 * Nothing new runs on the server: the GPS engine already raises one
 * `geofence.dwell` event per occupancy once a truck has been inside a
 * geofence for the fence's `dwellSec`, and the alarm engine turns that event
 * into an alarm through a `geofence_dwell` rule. So a limit becomes a live
 * alert in two steps:
 *
 *   1. the route's origin (loading) / destination (unloading) geofence gets
 *      `dwellSec = limit` and DWELL in its `alertOn`;
 *   2. every truck of the route gets a `geofence_dwell` rule on that fence.
 *      Rules are per truck so the shovel, which stands in the origin all day,
 *      never alarms.
 *
 * The rules this module manages carry a `#haul:<routeId>:<kind>` tag in
 * their name, so re-applying updates them instead of piling up duplicates and
 * a rule an operator wrote by hand is never touched.
 */
import type { AlertOn, Geofence } from '@/types/geofence.types';
import type { AlarmRule, CreateAlarmRulePayload, UpdateAlarmRulePayload } from '@/types/rule.types';

export type HaulAlertKind = 'load' | 'unload';

/** A limit in seconds; null = no alert for that phase. */
export interface HaulAlertLimits {
  readonly load: number | null;
  readonly unload: number | null;
}

export interface HaulAlertTruck {
  readonly vehicleId: string;
  readonly vehicleName: string;
}

export interface FenceChange {
  readonly kind: HaulAlertKind;
  readonly geofenceId: string;
  readonly name: string;
  readonly fromDwellSec: number | null;
  readonly toDwellSec: number;
  /** Alert triggers to store: the current ones plus DWELL. */
  readonly alertOn: AlertOn[];
  /** Only ACTIVE geofences are evaluated by the GPS engine. */
  readonly inactive: boolean;
}

export interface HaulAlertPlan {
  readonly fences: FenceChange[];
  readonly creates: CreateAlarmRulePayload[];
  readonly updates: Array<{ id: string; changes: UpdateAlarmRulePayload }>;
  readonly enables: string[];
  readonly deletes: string[];
}

export interface HaulAlertInput {
  readonly routeId: string;
  readonly routeName: string;
  readonly origin: Pick<Geofence, 'id' | 'name' | 'status' | 'alertOn' | 'dwellSec'> | null;
  readonly destination: Pick<Geofence, 'id' | 'name' | 'status' | 'alertOn' | 'dwellSec'> | null;
  readonly trucks: readonly HaulAlertTruck[];
  readonly limits: HaulAlertLimits;
  readonly rules: readonly AlarmRule[];
  /** Wording of the rule names. */
  readonly labels: Readonly<Record<HaulAlertKind, string>>;
}

export function haulTag(routeId: string, kind: HaulAlertKind): string {
  return `#haul:${routeId}:${kind}`;
}

function kindOfRule(rule: AlarmRule, routeId: string): HaulAlertKind | null {
  if (rule.type !== 'geofence_dwell') return null;
  if (rule.name.includes(haulTag(routeId, 'load'))) return 'load';
  if (rule.name.includes(haulTag(routeId, 'unload'))) return 'unload';
  return null;
}

/** The rules this module created for a route. */
export function managedHaulRules(
  rules: readonly AlarmRule[],
  routeId: string,
): Array<AlarmRule & { haulKind: HaulAlertKind }> {
  const out: Array<AlarmRule & { haulKind: HaulAlertKind }> = [];
  for (const rule of rules) {
    const haulKind = kindOfRule(rule, routeId);
    if (haulKind) out.push({ ...rule, haulKind });
  }
  return out;
}

function ruleName(input: HaulAlertInput, kind: HaulAlertKind, truck: HaulAlertTruck): string {
  const name = `${input.labels[kind]} · ${input.routeName} · ${truck.vehicleName}`;
  // Keep the tag intact when a long name has to be cut (rule names max 256).
  const tag = ` ${haulTag(input.routeId, kind)}`;
  return `${name.slice(0, 256 - tag.length)}${tag}`;
}

/** What has to change so the limits become live alerts. Pure; nothing is sent. */
export function planHaulAlerts(input: HaulAlertInput): HaulAlertPlan {
  const fences: FenceChange[] = [];
  const creates: CreateAlarmRulePayload[] = [];
  const updates: HaulAlertPlan['updates'] = [];
  const enables: string[] = [];
  const deletes: string[] = [];
  const managed = managedHaulRules(input.rules, input.routeId);
  const truckIds = new Set(input.trucks.map((truck) => truck.vehicleId));

  for (const kind of ['load', 'unload'] as const) {
    const limit = input.limits[kind];
    const fence = kind === 'load' ? input.origin : input.destination;
    const mine = managed.filter((rule) => rule.haulKind === kind);

    if (limit === null) {
      for (const rule of mine) deletes.push(rule.id);
      continue;
    }
    // The geofence is gone (archived): nothing to point a rule at.
    if (!fence) continue;

    if (fence.dwellSec !== limit || !fence.alertOn.includes('DWELL')) {
      fences.push({
        kind,
        geofenceId: fence.id,
        name: fence.name,
        fromDwellSec: fence.dwellSec,
        toDwellSec: limit,
        alertOn: fence.alertOn.includes('DWELL') ? [...fence.alertOn] : [...fence.alertOn, 'DWELL'],
        inactive: fence.status !== 'ACTIVE',
      });
    }

    const handled = new Set<string>();
    for (const truck of input.trucks) {
      const existing = mine.find((rule) => rule.entityId === truck.vehicleId);
      if (!existing) {
        creates.push({
          name: ruleName(input, kind, truck),
          type: 'geofence_dwell',
          severity: 'MEDIUM',
          entityId: truck.vehicleId,
          conditions: { geofenceId: fence.id, dwellSec: limit },
          // Every slow occupancy is its own alarm; the open-alarm gate still
          // folds repeats into one row until someone acknowledges it.
          cooldownSec: 0,
          dedupWindowSec: 60,
          repeatPolicy: 'ALWAYS',
        });
        continue;
      }
      handled.add(existing.id);
      const sameFence = existing.conditions.geofenceId === fence.id;
      const sameLimit = existing.conditions.dwellSec === limit;
      if (!sameFence || !sameLimit) {
        updates.push({
          id: existing.id,
          changes: {
            name: ruleName(input, kind, truck),
            conditions: { geofenceId: fence.id, dwellSec: limit },
          },
        });
      }
      if (!existing.enabled) enables.push(existing.id);
    }
    // Rules of trucks that left the route, and duplicates for one truck.
    for (const rule of mine) {
      const stale = rule.entityId === null || !truckIds.has(rule.entityId);
      const duplicate = !stale && !handled.has(rule.id);
      if (stale || duplicate) deletes.push(rule.id);
    }
  }
  return { fences, creates, updates, enables, deletes };
}

export function isEmptyPlan(plan: HaulAlertPlan): boolean {
  return (
    plan.fences.length === 0 &&
    plan.creates.length === 0 &&
    plan.updates.length === 0 &&
    plan.enables.length === 0 &&
    plan.deletes.length === 0
  );
}

/** Live-alert coverage of a route: enabled rules per kind against its trucks. */
export function haulAlertStatus(
  rules: readonly AlarmRule[],
  routeId: string,
  truckCount: number,
): Record<HaulAlertKind, { active: number; limitSec: number | null; trucks: number }> {
  const managed = managedHaulRules(rules, routeId).filter((rule) => rule.enabled);
  const of = (kind: HaulAlertKind) => {
    const list = managed.filter((rule) => rule.haulKind === kind);
    const limit = list[0]?.conditions.dwellSec;
    return {
      active: list.length,
      limitSec: typeof limit === 'number' ? limit : null,
      trucks: truckCount,
    };
  };
  return { load: of('load'), unload: of('unload') };
}
