/**
 * Alarm Center domain types (UI-facing, camelCase).
 *
 * Mirrors the consumption-side contract of the Alarm Engine
 * (`docs/specs/12_Alarm_Engine.md`): the 8-type catalog (§2.1), the 4-level
 * severity matrix (§2.11), the Alert state machine (§6.1–6.2), the operator
 * actions (§5.3), and the linked artifacts (§5.4). The wire (`*Wire`)
 * snake_case variants will be added here when the `notification-service` alarm
 * endpoints land; today the Alarm Center reads from static mock data
 * (`mock/alarm-data.ts`) so the UI is fully demoable.
 *
 * Color semantics live in `theme/palette.ts` (`status.*`); the string keys
 * here (e.g. `'critical'`, `'raised'`) map to those tokens so the UI never
 * hardcodes hex values.
 *
 * Note: this is distinct from the dashboard's simpler `AlertSeverity`
 * (`critical|warning|info`) in `fleet.types.ts` — the Alarm Center uses the
 * engine's full 4-level matrix per §2.11.
 */

/** The 8 catalog alarm types (12_Alarm_Engine.md §2.1) + an "other" catch-all. */
export type AlarmType =
  | 'sos'
  | 'overspeed'
  | 'geofence'
  | 'offline'
  | 'fuel-theft'
  | 'temperature'
  | 'collision'
  | 'camera'
  | 'other';

/** The 4-level severity matrix (§2.11). */
export type AlarmSeverity = 'critical' | 'major' | 'minor' | 'info';

/** Alert lifecycle state (§6.2 state machine). */
export type AlarmStatus = 'raised' | 'acked' | 'escalated' | 'resolved';

/** A triggering source event (the `sourceEvents` JSONB entries, §6.1). */
export interface AlarmSourceEvent {
  id: string;
  /** Event type, e.g. `tracking.speed.exceeded.v1`. */
  type: string;
  /** ISO timestamp. */
  ts: string;
  /** Human detail, e.g. "128 km/h (limit 100)". */
  detail: string;
}

/**
 * An alarm — the raised `Alert` instance (§6.1).
 *
 * One per (rule, entity, dedup-window). Status is the lifecycle state;
 * severity is immutable after raise (escalation changes step, not severity).
 */
export interface Alarm {
  id: string;
  type: AlarmType;
  severity: AlarmSeverity;
  status: AlarmStatus;
  /** Owning vehicle id. */
  vehicleId: string;
  /** Vehicle display label. */
  vehicleLabel: string;
  /** Driver display name, if known. */
  driver?: string;
  /** Decimal degrees (WGS84) of the triggering position. */
  lat: number;
  lng: number;
  /** Reverse-geocoded address. */
  address: string;
  /** ISO timestamp the alert was raised. */
  raisedAt: string;
  /** ISO timestamp of operator acknowledgement, if acked. */
  ackedAt?: string;
  /** ISO timestamp of resolution, if resolved. */
  resolvedAt?: string;
  /** Escalation chain step (0 = just raised, §6.3). */
  escalationStep: number;
  /** Short headline, e.g. "Overspeed 128 km/h". */
  message: string;
  /** Longer detail, e.g. "Sustained 18s on Hemmat Hwy". */
  detail: string;
  /** Triggering source events (immutable, §6.1). */
  sourceEvents: AlarmSourceEvent[];
  /** Linked video clip id (auto-captured on collision/AI, §5.4). */
  linkedClipId?: string;
  /** Linked trip id. */
  linkedTripId?: string;
}

/** One hour bucket of the 24h timeline view. */
export interface AlarmTimelineBucket {
  /** Hour of day 0–23. */
  hour: number;
  alarms: Alarm[];
}

/** Filter shape shared by the list, timeline, and map views. */
export interface AlarmFilters {
  type: AlarmType | 'all';
  severity: AlarmSeverity | 'all';
  status: AlarmStatus | 'all';
  /** Free-text over vehicle label / driver / id. */
  query: string;
}
