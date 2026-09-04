import { createHash } from 'node:crypto';
/**
 * AlarmEvaluatorService — the orchestrator that processes incoming telemetry
 * signals, evaluates them against active alarm rules, runs dedup, and creates
 * alarm occurrences + emits realtime events.
 *
 * Flow: Kafka consumer → processPosition/processDeviceStatus/processTrip
 *   → load enabled rules for the tenant
 *   → for each rule matching the vehicle, run the evaluator
 *   → if an AlarmEvent is produced, check dedup (Redis)
 *   → if not suppressed, create an AlarmOccurrence (persist) + emit WS event
 *
 * Sprint G adds inline handling for overspeed (grace period + recovery) — see
 * evaluateOverspeed. Geofence alarms were ALSO inline (per-position PostGIS
 * ST_Covers) in Sprint G; Sprint I moves the geospatial detection to the
 * gps-engine evaluator, which publishes geofence.entered/exited/dwell
 * FleetEvents — this service now consumes those EVENTS (processGeofence) and
 * stays purely an alarm engine (no second spatial evaluation, no double
 * firing). The architectural change is documented in
 * docs/implementation/SPRINT-I-GEOFENCE-TRACKING.md.
 *
 * Sprint G semantics implemented here:
 *   - Rule scope precedence (Part 9): a vehicle-scoped rule of a given type
 *     suppresses tenant-wide rules of the SAME type for that vehicle
 *     (vehicle > tenant — there is no fleet scope yet; fleet membership lives
 *     in fleet-management-service and is not duplicated here).
 *   - Overspeed grace period (Part 13): conditions.gracePeriodSec > 0 requires
 *     sustained speeding before raising.
 *   - Overspeed recovery (Part 14): speed back at/below the limit auto-resolves
 *     the OPEN alarm (actor `system`) — no flapping: re-raising requires a new
 *     grace window.
 *   - Device recovery (Part 17): a device ONLINE transition auto-resolves OPEN
 *     device_offline alarms for that vehicle.
 *   - One-open-alarm dedup (Part 12): while an OPEN alarm exists for a
 *     (rule, vehicle, type) triple, additional detections UPDATE its metadata
 *     (occurrenceCount/lastSeenAt) instead of creating new alarms.
 */
import { randomUUID } from 'node:crypto';
import type { TelemetryMetrics } from '@fleetvision/observability';
import { Injectable, Logger } from '@nestjs/common';
import type { AlarmEvent } from '../domain/alarm-event.js';
import { AlarmOccurrence } from '../domain/alarm-occurrence.js';
import type { AlarmRule } from '../domain/alarm-rule.js';
import type { AlarmStateCache } from '../infrastructure/cache/alarm-state-cache.js';
import type { AlarmOccurrenceRepository } from '../infrastructure/persistence/alarm-occurrence.repository.js';
import type { AlarmRuleRepository } from '../infrastructure/persistence/alarm-rule.repository.js';
import type { AlarmRealtimeGateway } from '../infrastructure/websocket/alarm-realtime.gateway.js';
import { buildEvaluatorRegistry } from './evaluators/evaluators.js';
import type { InputSignal } from './evaluators/rule-evaluator.js';
import type { NotificationDispatcherService } from './notification-dispatcher.service.js';

export interface AlarmEvaluatorDeps {
  readonly rules: AlarmRuleRepository;
  readonly alarms: AlarmOccurrenceRepository;
  readonly stateCache: AlarmStateCache;
  readonly gateway: AlarmRealtimeGateway | null;
  readonly dispatcher: NotificationDispatcherService | null;
  /** Sprint G observability (optional — unit tests construct without). */
  readonly metrics?: TelemetryMetrics | null;
}

@Injectable()
export class AlarmEvaluatorService {
  private readonly logger = new Logger('AlarmEvaluator');
  private readonly evaluators = buildEvaluatorRegistry();
  private readonly metrics: TelemetryMetrics | null;

  constructor(private readonly deps: AlarmEvaluatorDeps) {
    this.metrics = deps.metrics ?? null;
  }

  // ── Device alarms (DMS/ADAS/SOS/… straight from the device, rule-free) ─────

  /**
   * Process a DEVICE alarm published by the device-gateway
   * (`fleetvision.telemetry.alarm.raw`) — the device is the source of truth,
   * so no rule evaluation: dedup (60s per tenant+code+device) then raise or
   * bump the open occurrence. DMS/ADAS codes map to the 'dms' catalog type.
   */
  public async processDeviceAlarm(alarm: {
    tenantId: string;
    vehicleId: string | null;
    deviceId: string;
    serialOrImei: string | null;
    code: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    source: string | null;
    detail: Record<string, unknown> | null;
    lat: number | null;
    lng: number | null;
    detectedAt: Date;
  }): Promise<void> {
    try {
      const ruleId = deviceAlarmRuleId(alarm.code);
      const vehicleKey = alarm.vehicleId ?? alarm.deviceId;
      const suppress = await this.deps.stateCache.shouldSuppress(
        alarm.tenantId,
        ruleId,
        vehicleKey,
        DEVICE_ALARM_DEDUP_WINDOW_SEC,
      );
      if (suppress) {
        await this.deps.stateCache.incrementOccurrenceCount(alarm.tenantId, ruleId, vehicleKey);
        this.metrics?.duplicateEvents.inc({ source: 'device-alarm' });
        return;
      }

      // One-open-alarm gate — bump occurrences while the same alarm is open.
      const open = await this.deps.alarms.findOpenByRuleAndVehicle(
        alarm.tenantId,
        ruleId,
        vehicleKey,
        alarm.code,
      );
      if (open) {
        const count = await this.deps.stateCache.incrementOccurrenceCount(
          alarm.tenantId,
          ruleId,
          vehicleKey,
        );
        await this.deps.alarms.updateDetail(open, {
          ...(open.detail ?? {}),
          occurrenceCount: count,
          lastSeenAt: alarm.detectedAt.toISOString(),
          lastDetection: alarm.detail ?? null,
        });
        return;
      }

      const type = deviceAlarmCatalogType(alarm.code);
      const severity = DEVICE_ALARM_SEVERITY[alarm.severity] ?? 'MEDIUM';
      const id = randomUUID();
      const dmsDetail = alarm.detail?.dmsDetail ? String(alarm.detail.dmsDetail) : '';
      const message = `Device alarm ${alarm.code}${dmsDetail ? ` — ${dmsDetail}` : ''}`;
      const occurrence = AlarmOccurrence.create(id, {
        tenantId: alarm.tenantId,
        ruleId,
        type,
        severity,
        vehicleId: alarm.vehicleId,
        lat: alarm.lat,
        lng: alarm.lng,
        message,
        detail: {
          deviceAlarm: true,
          alarmCode: alarm.code,
          alarmDetail: dmsDetail,
          ...(alarm.detail ?? {}),
        },
        sourceEvents: [
          {
            type: `device.alarm.${alarm.code}.v1`,
            ts: alarm.detectedAt.toISOString(),
            detail: JSON.stringify({
              deviceId: alarm.deviceId,
              imei: alarm.serialOrImei,
              source: alarm.source,
              ...(alarm.detail ?? {}),
            }),
          },
        ],
        raisedAt: alarm.detectedAt,
      });
      await this.deps.alarms.create(occurrence);
      this.metrics?.alarmsOpened.inc({ type });

      this.deps.gateway?.emitAlarmCreated(alarm.tenantId, occurrence);
      if (this.deps.dispatcher) {
        try {
          await this.deps.dispatcher.dispatchAlarm(occurrence);
        } catch (err) {
          this.logger.warn(`Notification dispatch error: ${(err as Error).message}`);
        }
      }
      this.logger.log(
        `Raised device alarm ${alarm.code} alarmId=${id} vehicle=${alarm.vehicleId} tenant=${alarm.tenantId}`,
      );
    } catch (err) {
      // Device alarms are best-effort telemetry — never crash the consumer.
      this.logger.warn(`Device alarm ${alarm.code} processing failed: ${(err as Error).message}`);
    }
  }

  /** Process a position signal from Kafka. */
  public async processPosition(signal: InputSignal & { kind: 'position' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        if (rule.type === 'overspeed') {
          await this.evaluateOverspeed(signal, rule);
          continue;
        }
        if (
          rule.type === 'geofence_enter' ||
          rule.type === 'geofence_exit' ||
          rule.type === 'geofence_dwell'
        ) {
          // Sprint I — geofence alarms are event-driven now: the gps-engine
          // evaluator publishes geofence.* FleetEvents which arrive via
          // processGeofence. Raw positions no longer trigger geofence alarms
          // (no double evaluation, no per-position PostGIS round-trip here).
          continue;
        }
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'position' });
      this.logger.warn(`Position alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process a device-status signal (session lifecycle or FleetEvent). */
  public async processDeviceStatus(signal: InputSignal & { kind: 'device_status' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        if (rule.type === 'device_offline') {
          if (signal.state === 'ONLINE') {
            // Part 17 — device recovered: auto-resolve the open offline alarm.
            await this.autoResolve(
              signal.tenantId,
              rule,
              signal.vehicleId,
              'device_offline',
              'Device back online.',
            );
            continue;
          }
          const evaluator = this.evaluators.get(rule.type);
          if (!evaluator) continue;
          const event = evaluator.evaluate(signal, rule);
          if (event) await this.raiseIfAllowed(event, rule);
          continue;
        }
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'session' });
      this.logger.warn(`Device-status alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process a trip boundary signal (gps-engine FleetEvent topic). */
  public async processTrip(signal: InputSignal & { kind: 'trip' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'tracking' });
      this.logger.warn(`Trip alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process an idle FSM signal (gps-engine FleetEvent topic — Sprint G Part 19). */
  public async processIdle(signal: InputSignal & { kind: 'idle' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'tracking' });
      this.logger.warn(`Idle alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process a parking FSM signal (gps-engine FleetEvent topic — Sprint G Part 19). */
  public async processParking(signal: InputSignal & { kind: 'parking' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'tracking' });
      this.logger.warn(`Parking alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /**
   * Rule scope precedence (Part 9): within one rule TYPE, a vehicle-scoped
   * rule (entityId === vehicleId) suppresses tenant-wide rules (entityId ===
   * null) for that vehicle. Deterministic, documented, no silent conflicts.
   */
  private rulesForVehicle(rules: readonly AlarmRule[], vehicleId: string): AlarmRule[] {
    const applicable = rules.filter((r) => r.appliesTo(vehicleId));
    const vehicleScopedTypes = new Set(
      applicable.filter((r) => r.entityId === vehicleId).map((r) => r.type),
    );
    return applicable.filter((r) => r.entityId !== null || !vehicleScopedTypes.has(r.type));
  }

  /**
   * Overspeed with grace period + recovery (Parts 13/14). Inline (like
   * geofence) because it needs Redis state: when sustained speeding began.
   */
  private async evaluateOverspeed(
    signal: InputSignal & { kind: 'position' },
    rule: AlarmRule,
  ): Promise<void> {
    const threshold = rule.conditionNum('thresholdKmh', 120);
    const graceSec = rule.conditionNum('gracePeriodSec', 0);
    const speeding = signal.speedKph > threshold && signal.speedKph <= 300;

    if (!speeding) {
      // Condition cleared — recovery (Part 14). Resolve the open alarm once;
      // clearing the grace state makes re-raising require a fresh window.
      await this.deps.stateCache.clearOverspeedSince(signal.tenantId, rule.id, signal.vehicleId);
      await this.autoResolve(
        signal.tenantId,
        rule,
        signal.vehicleId,
        'overspeed',
        `Speed returned to ${signal.speedKph.toFixed(1)} km/h (limit ${threshold} km/h).`,
      );
      return;
    }

    const nowMs = Date.parse(signal.capturedAt);
    if (Number.isNaN(nowMs)) return; // invalid timestamp — validation should have caught
    if (graceSec > 0) {
      const since = await this.deps.stateCache.getOverspeedSince(
        signal.tenantId,
        rule.id,
        signal.vehicleId,
      );
      if (since === null) {
        // Window opens now — not yet sustained.
        await this.deps.stateCache.setOverspeedSince(
          signal.tenantId,
          rule.id,
          signal.vehicleId,
          nowMs,
        );
        return;
      }
      if (nowMs - since < graceSec * 1000) return; // still inside the grace period
    }

    await this.raiseIfAllowed(
      {
        ruleId: rule.id,
        type: 'overspeed',
        tenantId: signal.tenantId,
        vehicleId: signal.vehicleId,
        severity: rule.severity,
        lat: signal.lat,
        lng: signal.lng,
        message: `Vehicle exceeded speed limit: ${signal.speedKph.toFixed(1)} km/h (limit ${threshold} km/h)`,
        sourceEvent: {
          kind: 'position',
          speedKph: signal.speedKph,
          capturedAt: signal.capturedAt,
          sourceEventId: signal.sourceEventId,
        },
        detectedAt: new Date(signal.capturedAt),
      },
      rule,
    );
  }

  /**
   * Sprint I — process a geofence membership FleetEvent (gps-engine evaluator
   * → `fleetvision.tracking.events`). This is the ONLY geofence alarm path:
   * detection (PostGIS, jitter-protected, dwell-aware) already happened in the
   * GPS Engine; here we only match rules.
   *
   * Matching:
   *   geofence_enter rule ← geofence.entered event
   *   geofence_exit  rule ← geofence.exited event
   *   geofence_dwell rule ← geofence.dwell event (rule.dwellSec, when set,
   *                          requires the event's elapsed dwellSec ≥ it)
   * A rule's conditions.geofenceId (when set) must match the event's
   * geofenceId; without it the rule matches ANY geofence.
   */
  public async processGeofence(signal: InputSignal & { kind: 'geofence' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      const applicable = this.rulesForVehicle(rules, signal.vehicleId).filter(
        (r) =>
          r.type === 'geofence_enter' || r.type === 'geofence_exit' || r.type === 'geofence_dwell',
      );
      if (applicable.length === 0) return;
      for (const rule of applicable) {
        const targetGeofenceId = rule.conditions.geofenceId as string | undefined;
        if (targetGeofenceId && signal.geofenceId && targetGeofenceId !== signal.geofenceId) {
          continue;
        }
        const fenceLabel = signal.geofenceName ?? signal.geofenceId ?? 'a geofence zone';
        let matched: AlarmEvent | null = null;
        if (rule.type === 'geofence_enter' && signal.type === 'geofence.entered') {
          matched = {
            ruleId: rule.id,
            type: 'geofence_enter',
            tenantId: signal.tenantId,
            vehicleId: signal.vehicleId,
            severity: rule.severity,
            lat: signal.lat,
            lng: signal.lng,
            message: `Entered geofence ${fenceLabel}`,
            sourceEvent: {
              kind: 'geofence',
              eventType: signal.type,
              geofenceId: signal.geofenceId,
              geofenceName: signal.geofenceName,
              occurredAt: signal.occurredAt,
              sourceEventId: signal.sourceEventId,
            },
            detectedAt: new Date(signal.occurredAt),
          };
        } else if (rule.type === 'geofence_exit' && signal.type === 'geofence.exited') {
          matched = {
            ruleId: rule.id,
            type: 'geofence_exit',
            tenantId: signal.tenantId,
            vehicleId: signal.vehicleId,
            severity: rule.severity,
            lat: signal.lat,
            lng: signal.lng,
            message:
              signal.dwellSec !== null
                ? `Exited geofence ${fenceLabel} after ${Math.round(signal.dwellSec / 60)} min`
                : `Exited geofence ${fenceLabel}`,
            sourceEvent: {
              kind: 'geofence',
              eventType: signal.type,
              geofenceId: signal.geofenceId,
              geofenceName: signal.geofenceName,
              dwellSec: signal.dwellSec,
              occurredAt: signal.occurredAt,
              sourceEventId: signal.sourceEventId,
            },
            detectedAt: new Date(signal.occurredAt),
          };
        } else if (rule.type === 'geofence_dwell' && signal.type === 'geofence.dwell') {
          const threshold = rule.conditionNum('dwellSec', 0);
          if (signal.dwellSec !== null && signal.dwellSec >= Math.max(1, threshold)) {
            matched = {
              ruleId: rule.id,
              type: 'geofence_dwell',
              tenantId: signal.tenantId,
              vehicleId: signal.vehicleId,
              severity: rule.severity,
              lat: signal.lat,
              lng: signal.lng,
              message: `Dwelt in geofence ${fenceLabel} for ${Math.round(signal.dwellSec / 60)} min`,
              sourceEvent: {
                kind: 'geofence',
                eventType: signal.type,
                geofenceId: signal.geofenceId,
                geofenceName: signal.geofenceName,
                dwellSec: signal.dwellSec,
                occurredAt: signal.occurredAt,
                sourceEventId: signal.sourceEventId,
              },
              detectedAt: new Date(signal.occurredAt),
            };
          }
        }
        if (matched) await this.raiseIfAllowed(matched, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'tracking' });
      this.logger.warn(`Geofence alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /**
   * Run dedup check; if allowed, persist the occurrence + emit realtime.
   *
   * Dedup strategy (Part 12):
   *   1. Redis time-window gate (dedupWindowSec) — cheapest, storm breaker.
   *      Suppressed detections increment a per-rule+vehicle counter (metadata
   *      for the open alarm) and do NOT touch PostgreSQL.
   *   2. One-open-alarm gate — when the window expires but the condition is
   *      still active and an OPEN alarm exists for (rule, vehicle, type), the
   *      existing alarm's detail is UPDATED (occurrenceCount/lastSeenAt/last
   *      detection) instead of creating a second OPEN alarm.
   */
  private async raiseIfAllowed(event: AlarmEvent, rule: AlarmRule): Promise<void> {
    const vehicleKey = event.vehicleId ?? '_tenant';
    const suppress = await this.deps.stateCache.shouldSuppress(
      event.tenantId,
      rule.id,
      vehicleKey,
      Math.max(1, rule.dedupWindowSec),
    );
    if (suppress) {
      // Within the dedup window — count, don't persist.
      await this.deps.stateCache.incrementOccurrenceCount(event.tenantId, rule.id, vehicleKey);
      this.metrics?.duplicateEvents.inc({ source: 'alarm' });
      return;
    }

    // One-open-alarm gate (Part 12).
    const open = await this.deps.alarms.findOpenByRuleAndVehicle(
      event.tenantId,
      rule.id,
      vehicleKey,
      event.type,
    );
    if (open) {
      const count = await this.deps.stateCache.incrementOccurrenceCount(
        event.tenantId,
        rule.id,
        vehicleKey,
      );
      const detail = {
        ...(open.detail ?? {}),
        occurrenceCount: count,
        lastSeenAt: new Date().toISOString(),
        lastDetection: event.sourceEvent ?? null,
      };
      await this.deps.alarms.updateDetail(open, detail);
      this.logger.debug(
        `Updated OPEN alarm ${open.id} (${event.type}) — occurrence #${count} for vehicle ${event.vehicleId}`,
      );
      return;
    }

    // Create + persist the occurrence.
    const id = randomUUID();
    const occurrence = AlarmOccurrence.create(id, {
      tenantId: event.tenantId,
      ruleId: event.ruleId,
      type: event.type,
      severity: event.severity,
      vehicleId: event.vehicleId,
      lat: event.lat,
      lng: event.lng,
      message: event.message,
      detail: {},
      sourceEvents: [event.sourceEvent],
      raisedAt: event.detectedAt,
    });
    await this.deps.alarms.create(occurrence);
    this.metrics?.alarmsOpened.inc({ type: event.type });

    // Emit realtime alarm event (best-effort — WS may be disabled).
    this.deps.gateway?.emitAlarmCreated(event.tenantId, occurrence);

    // Dispatch notifications (in-app, websocket, email) — decoupled from delivery.
    // The dispatcher handles preferences, dedup, retry, and channel selection.
    if (this.deps.dispatcher) {
      try {
        await this.deps.dispatcher.dispatchAlarm(occurrence);
      } catch (err) {
        this.logger.warn(`Notification dispatch error: ${(err as Error).message}`);
      }
    }

    this.logger.log(
      `Raised alarm ${event.type} alarmId=${id} ruleId=${rule.id} vehicle=${event.vehicleId} tenant=${event.tenantId}`,
    );
  }

  /**
   * System auto-resolve (Parts 14/17): resolve the OPEN alarm of the given
   * type for a rule+vehicle, actor `system`, with an audit row. No-op when
   * no open alarm exists (also clears flapping: RESOLVED → nothing).
   */
  private async autoResolve(
    tenantId: string,
    rule: AlarmRule,
    vehicleId: string,
    type: string,
    reason: string,
  ): Promise<void> {
    const open = await this.deps.alarms.findOpenByRuleAndVehicle(
      tenantId,
      rule.id,
      vehicleId,
      type,
    );
    if (!open || open.status === 'RESOLVED') return;
    const prev = open.status;
    open.resolve(null, reason); // null actor = system auto-resolve (uuid-safe)
    await this.deps.alarms.updateStatus(open, 'RESOLVE', prev, open.status, null, reason);
    this.metrics?.alarmsResolved.inc({ actor: 'system' });
    this.deps.gateway?.emitAlarmResolved(tenantId, open);
    this.logger.log(
      `Auto-resolved alarm ${open.id} (${type}) vehicle=${vehicleId} tenant=${tenantId} — ${reason}`,
    );
  }
}

// ── Device-alarm helpers ─────────────────────────────────────────────────────

/** Dedup window for device alarms (device resends + DMS bursts). */
const DEVICE_ALARM_DEDUP_WINDOW_SEC = 60;

/** Gateway severity → notification alert severity. */
const DEVICE_ALARM_SEVERITY: Readonly<Record<string, 'INFO' | 'MEDIUM' | 'CRITICAL'>> = {
  INFO: 'INFO',
  WARNING: 'MEDIUM',
  CRITICAL: 'CRITICAL',
};

/**
 * Deterministic pseudo-rule UUID per device alarm code (uuid v5-style, SHA-1
 * based) — keeps the one-open-alarm gate + dedup keys stable across restarts.
 */
function deviceAlarmRuleId(code: string): string {
  const hash = createHash('sha1').update('fleetvision:device-alarm:').update(code).digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50; // version 5
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80; // variant
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Device alarm code → dashboard alarm catalog type. */
function deviceAlarmCatalogType(code: string): string {
  if (code.startsWith('DMS_') || code.startsWith('ADAS_') || code.startsWith('FATIGUE')) {
    return 'dms';
  }
  if (code.startsWith('VIDEO_') || code.startsWith('STORAGE_')) return 'camera';
  switch (code) {
    case 'SOS':
      return 'sos';
    case 'OVERSPEED':
      return 'overspeed';
    case 'GEOFENCE_ENTER':
    case 'GEOFENCE_EXIT':
      return 'geofence';
    case 'FUEL_THEFT':
    case 'FUEL_LOW':
    case 'FUEL_FULL':
    case 'FUEL_FILLING':
      return 'fuel-theft';
    case 'TEMPERATURE_HIGH':
    case 'TEMPERATURE_LOW':
      return 'temperature';
    case 'ACCIDENT':
    case 'BRAKING':
    case 'ACCELERATION':
    case 'CORNERING':
    case 'DRIVING_BEHAVIOR':
      return 'collision';
    case 'TOW':
      return 'tow';
    case 'JAMMING':
      return 'jamming';
    case 'POWER_CUT':
    case 'POWER_RESTORED':
    case 'LOW_POWER':
      return 'power';
    case 'LOW_BATTERY':
      return 'battery';
    default:
      return 'other';
  }
}
