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
import type { AlarmEvidenceService } from './alarm-evidence.service.js';
import { buildEvaluatorRegistry } from './evaluators/evaluators.js';
import { untrustedSpeedReason } from './evaluators/gps-fix-gate.js';
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
  /** F-07 Slice 1 — auto evidence enqueue (optional in unit tests). */
  readonly evidence?: AlarmEvidenceService | null;
  /** fleet.vehicles machine type for the GPS fix gate (optional in unit tests). */
  readonly machineType?: ((tenantId: string, vehicleId: string) => Promise<string | null>) | null;
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
    /** Device-reported speed / ignition at the alarm instant (null = unknown). */
    speedKph?: number | null;
    ignitionOn?: boolean | null;
    detectedAt: Date;
  }): Promise<void> {
    try {
      // Defense in depth: periodic track / heartbeat codes are position reports,
      // not operator alarms (even if an older gateway still classifies them as ALARM).
      if (isNonAlarmDeviceCode(alarm.code)) {
        this.logger.debug(`Skipping non-alarm device event ${alarm.code} device=${alarm.deviceId}`);
        return;
      }
      const implausible = implausibleDeviceAlarm(
        alarm.code,
        alarm.speedKph ?? null,
        alarm.ignitionOn ?? null,
      );
      if (implausible) {
        this.logger.debug(
          `Skipping implausible device alarm ${alarm.code} device=${alarm.deviceId}: ${implausible}`,
        );
        return;
      }
      const ruleId = deviceAlarmRuleId(alarm.code);
      // Catalog type is what we PERSIST (`dms`, `sos`, …). The open-gate MUST
      // look up the same type — looking up `DMS_PHONE_CALL` never matched a
      // stored `dms` row, so coalescing was broken for every device alarm.
      const type = deviceAlarmCatalogType(alarm.code);
      // Persist + look up the same vehicle key (nullable). Redis dedup may use a
      // device fallback string; never pass a non-UUID device id into vehicle_id.
      const vehicleId = alarm.vehicleId;
      const dedupKey = vehicleId ?? `device:${alarm.deviceId}`;

      // One-open-alarm gate FIRST — bump while the same catalog alarm is open
      // AND still active (a burst). Device alarms never auto-resolve, so an
      // open alarm older than the coalesce window is superseded, not bumped —
      // otherwise one stale open alarm swallowed every later occurrence.
      const open = await this.deps.alarms.findOpenByRuleAndVehicle(
        alarm.tenantId,
        ruleId,
        vehicleId,
        type,
      );
      if (open && !isBurstOf(open, alarm.detectedAt)) {
        const prev = open.status;
        open.resolve(null, 'Superseded by a new occurrence.');
        await this.deps.alarms.updateStatus(
          open,
          'RESOLVE',
          prev,
          open.status,
          null,
          'Superseded by a new occurrence.',
        );
        this.deps.gateway?.emitAlarmResolved(alarm.tenantId, open);
      } else if (open) {
        const count = await this.deps.stateCache.incrementOccurrenceCount(
          alarm.tenantId,
          ruleId,
          dedupKey,
        );
        await this.deps.alarms.updateDetail(open, {
          ...(open.detail ?? {}),
          occurrenceCount: count,
          lastSeenAt: alarm.detectedAt.toISOString(),
          lastDetection: alarm.detail ?? null,
        });
        return;
      }

      const suppress = await this.deps.stateCache.shouldSuppress(
        alarm.tenantId,
        ruleId,
        dedupKey,
        DEVICE_ALARM_DEDUP_WINDOW_SEC,
      );
      if (suppress) {
        await this.deps.stateCache.incrementOccurrenceCount(alarm.tenantId, ruleId, dedupKey);
        this.metrics?.duplicateEvents.inc({ source: 'device-alarm' });
        return;
      }

      const severity = DEVICE_ALARM_SEVERITY[alarm.severity] ?? 'MEDIUM';
      const id = randomUUID();
      const dmsDetail = alarm.detail?.dmsDetail ? String(alarm.detail.dmsDetail) : '';
      const message = `Device alarm ${alarm.code}${dmsDetail ? ` — ${dmsDetail}` : ''}`;
      const occurrence = AlarmOccurrence.create(id, {
        tenantId: alarm.tenantId,
        ruleId,
        type,
        severity,
        vehicleId,
        lat: alarm.lat,
        lng: alarm.lng,
        message,
        detail: {
          deviceAlarm: true,
          alarmCode: alarm.code,
          alarmDetail: dmsDetail,
          deviceId: alarm.deviceId,
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
      try {
        await this.deps.alarms.create(occurrence);
      } catch (err) {
        // Release the Redis claim so a transient DB blip does not black-hole
        // DMS/SOS for the whole dedup window.
        await this.deps.stateCache.clearDedup(alarm.tenantId, ruleId, dedupKey);
        throw err;
      }
      this.metrics?.alarmsOpened.inc({ type });

      if (this.deps.evidence) {
        try {
          await this.deps.evidence.enqueueForDeviceAlarm({
            tenantId: alarm.tenantId,
            alertId: id,
            deviceId: alarm.deviceId,
            vehicleId,
            alarmCode: alarm.code,
            detail: alarm.detail,
            raisedAt: alarm.detectedAt,
          });
        } catch (err) {
          this.logger.warn(`Evidence enqueue failed: ${(err as Error).message}`);
        }
      }

      if (isStaleDetection(alarm.detectedAt)) {
        this.logger.log(
          `Recorded stale device alarm ${alarm.code} alarmId=${id} detectedAt=${alarm.detectedAt.toISOString()} — not notified`,
        );
        return;
      }
      this.deps.gateway?.emitAlarmCreated(alarm.tenantId, occurrence);
      if (this.deps.dispatcher) {
        try {
          await this.deps.dispatcher.dispatchAlarm(occurrence);
        } catch (err) {
          this.logger.warn(`Notification dispatch error: ${(err as Error).message}`);
        }
      }
      this.logger.log(
        `Raised device alarm ${alarm.code} type=${type} alarmId=${id} vehicle=${vehicleId} tenant=${alarm.tenantId}`,
      );
    } catch (err) {
      // Device alarms are best-effort telemetry — never crash the consumer.
      this.logger.warn(`Device alarm ${alarm.code} processing failed: ${(err as Error).message}`);
    }
  }

  /** Process a position signal from Kafka. */
  public async processPosition(input: InputSignal & { kind: 'position' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(input.tenantId);
      const applicable = this.rulesForVehicle(rules, input.vehicleId);
      const signal = applicable.some((r) => r.type === 'ignition_on' || r.type === 'ignition_off')
        ? { ...input, ignitionEdge: await this.ignitionEdge(input, applicable) }
        : input;
      for (const rule of applicable) {
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
   * Derive the ignition transition this position carries and close the
   * opposite open alarm (an ignition_on alarm ends when the ignition goes off,
   * and vice versa). The first sighting of a vehicle is not a transition.
   */
  private async ignitionEdge(
    signal: InputSignal & { kind: 'position' },
    rules: readonly AlarmRule[],
  ): Promise<'on' | 'off' | null> {
    if (signal.ignitionOn === null) return null;
    const atMs = Date.parse(signal.capturedAt);
    if (Number.isNaN(atMs)) return null;
    const prev = await this.deps.stateCache.swapIgnitionState(
      signal.tenantId,
      signal.vehicleId,
      signal.ignitionOn,
      atMs,
    );
    if (prev === null || prev === 'stale' || prev === signal.ignitionOn) return null;
    const edge = signal.ignitionOn ? 'on' : 'off';
    const closes = edge === 'on' ? 'ignition_off' : 'ignition_on';
    for (const rule of rules) {
      if (rule.type !== closes) continue;
      await this.autoResolve(
        signal.tenantId,
        rule,
        signal.vehicleId,
        closes,
        `Ignition turned ${edge}.`,
      );
    }
    return edge;
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
    const nowMs = Date.parse(signal.capturedAt);
    if (Number.isNaN(nowMs)) return; // invalid timestamp — validation should have caught

    // GPS fix gate: a drifting fix (few satellites, Doppler spike, position
    // jump, over the machine's cap) says nothing about speed — neither raise
    // nor resolve on it, matching the gps-engine which zeroes such fixes.
    const untrusted = await this.untrustedSpeed(signal, nowMs);
    if (untrusted) {
      if (signal.speedKph > threshold) {
        this.logger.debug(
          `Overspeed ignored: ${signal.speedKph} km/h untrusted (${untrusted}) vehicle=${signal.vehicleId}`,
        );
      }
      return;
    }
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
   * Run the GPS fix gate against the vehicle's last trusted fix; a trusted fix
   * becomes the new reference. Returns the rejection reason, or null.
   */
  private async untrustedSpeed(
    signal: InputSignal & { kind: 'position' },
    nowMs: number,
  ): Promise<string | null> {
    const [prev, machineType] = await Promise.all([
      this.deps.stateCache.getLastFix(signal.tenantId, signal.vehicleId),
      this.deps.machineType?.(signal.tenantId, signal.vehicleId) ?? Promise.resolve(null),
    ]);
    const reason = untrustedSpeedReason(
      {
        lat: signal.lat,
        lng: signal.lng,
        speedKph: signal.speedKph,
        satellites: signal.satellites ?? null,
        hdop: signal.hdop ?? null,
        capturedAtMs: nowMs,
      },
      prev,
      machineType,
    );
    if (reason === null && (prev === null || nowMs > prev.capturedAtMs)) {
      await this.deps.stateCache.setLastFix(signal.tenantId, signal.vehicleId, {
        lat: signal.lat,
        lng: signal.lng,
        capturedAtMs: nowMs,
      });
    }
    return reason;
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
   *   2. One-open-alarm gate — CONDITION alarms only (overspeed,
   *      device_offline: they auto-resolve when the condition clears). When the
   *      window expires but the condition is still active and an OPEN alarm
   *      exists for (rule, vehicle, type), the existing alarm's detail is
   *      UPDATED (occurrenceCount/lastSeenAt/last detection) instead of
   *      creating a second OPEN alarm. Point events (ignition, idle, geofence,
   *      trip…) never auto-resolve, so gating them on an open alarm silently
   *      swallowed every later occurrence.
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

    // One-open-alarm gate (Part 12) — condition alarms only.
    const open = CONDITION_ALARM_TYPES.has(event.type)
      ? await this.deps.alarms.findOpenByRuleAndVehicle(
          event.tenantId,
          rule.id,
          vehicleKey,
          event.type,
        )
      : null;
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

    // A detection replayed from a device buffer is history, not news: keep the
    // record, but do not push it to operators.
    // (device_offline is stamped with the last-seen time, old by definition.)
    if (event.type !== 'device_offline' && isStaleDetection(event.detectedAt)) {
      this.logger.log(
        `Recorded stale alarm ${event.type} alarmId=${id} detectedAt=${event.detectedAt.toISOString()} — not notified`,
      );
      return;
    }

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

/** Alarm types that auto-resolve when their condition clears. */
const CONDITION_ALARM_TYPES: ReadonlySet<string> = new Set(['overspeed', 'device_offline']);

/** Detections older than this (device buffer replays) are recorded but not notified. */
const MAX_NOTIFY_AGE_MS = 30 * 60_000;

function isStaleDetection(detectedAt: Date): boolean {
  return Date.now() - detectedAt.getTime() > MAX_NOTIFY_AGE_MS;
}

// ── Device-alarm helpers ─────────────────────────────────────────────────────

/** Dedup window for device alarms (device resends + DMS bursts). */
const DEVICE_ALARM_DEDUP_WINDOW_SEC = 60;

/** An open device alarm last seen within this window absorbs a repeat (burst). */
const DEVICE_ALARM_COALESCE_MS = 10 * 60_000;

function isBurstOf(open: AlarmOccurrence, detectedAt: Date): boolean {
  const lastSeen = Date.parse(String(open.detail?.lastSeenAt ?? ''));
  const last = Number.isNaN(lastSeen) ? open.raisedAt.getTime() : lastSeen;
  return Math.abs(detectedAt.getTime() - last) <= DEVICE_ALARM_COALESCE_MS;
}

/**
 * G-sensor alarms the device's own state contradicts (field data: every TOW
 * fired at 0 km/h — six with the ignition off and no movement at all, one
 * mid-drive; a "BRAKING" at 513 km/h). Real towing is detected from the GPS
 * track by the gps-engine (parking.tamper). Returns why, or null.
 */
function implausibleDeviceAlarm(
  code: string,
  speedKph: number | null,
  ignitionOn: boolean | null,
): string | null {
  switch (code) {
    case 'TOW':
      if (ignitionOn === true) return 'ignition on — vehicle is being driven, not towed';
      if (speedKph !== null && speedKph < 5) return 'vehicle not moving';
      return null;
    case 'BRAKING':
    case 'ACCELERATION':
    case 'CORNERING':
      if (speedKph !== null && speedKph > 300) return `impossible speed ${speedKph} km/h`;
      if (ignitionOn === false) return 'ignition off';
      return null;
    default:
      return null;
  }
}

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

/**
 * Periodic track / heartbeat / unused MDVR channel noise — never raise an
 * AlarmOccurrence. Meitrack MD300 units commonly report VIDEO_LOSS on CH3–CH8
 * even when only cameras 1–2 are wired; those slots are not operator-actionable.
 */
function isNonAlarmDeviceCode(code: string): boolean {
  const u = code.toUpperCase();
  if (
    u === 'TRACK_BY_INTERVAL' ||
    u === 'TRACK_BY_DISTANCE' ||
    u === 'REPLY_CURRENT' ||
    u === 'HEARTBEAT'
  ) {
    return true;
  }
  if (/^EVENT_(0|31|33|34|35)$/.test(u)) return true;
  // Device state notices — ignition, motion, sleep, GPS and power status are
  // tracked from positions (ignition/idle/trip rules, device status); as
  // alarms they flooded the center with hundreds of non-actionable rows.
  if (DEVICE_STATUS_NOTICES.has(u) || /^INPUT_\d+_(IN)?ACTIVE$/.test(u)) return true;
  // EVENT_675: unmapped MD300 status event seen on every unit at standstill,
  // no operator meaning. Other unmapped EVENT_n stay — on older gateways they
  // carry ADAS/DMS alarms (e.g. EVENT_648 = forward collision warning).
  if (u === 'EVENT_675') return true;
  // Unused camera slots (CH3–CH8) on 2-camera MDVR fleets.
  if (/^VIDEO_(LOSS|RECOVERY)_CH([3-8])$/.test(u)) return true;
  return false;
}

const DEVICE_STATUS_NOTICES: ReadonlySet<string> = new Set([
  'START_MOVING',
  'STOP_MOVING',
  'ENTER_SLEEP',
  'EXIT_SLEEP',
  'DEVICE_REBOOT',
  'GPS_SIGNAL_LOST',
  'GPS_RECOVERED',
  'SPEED_RECOVERY',
  'POWER_RESTORED',
]);

/** Device alarm code → dashboard alarm catalog type. */
function deviceAlarmCatalogType(code: string): string {
  if (
    code.startsWith('DMS_') ||
    code.startsWith('ADAS_') ||
    code.startsWith('BSD_') ||
    code.startsWith('FATIGUE')
  ) {
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
    case 'ROLLOVER':
      return 'collision';
    case 'IDLE_OVERTIME':
    case 'IDLE_RECOVERY':
      return 'idle';
    case 'TOW':
      return 'tow';
    case 'JAMMING':
      return 'jamming';
    case 'POWER_CUT':
    case 'POWER_RESTORED':
    case 'LOW_POWER':
    case 'POWER_OFF':
      return 'power';
    case 'LOW_BATTERY':
      return 'battery';
    case 'STOP_MOVING':
    case 'START_MOVING':
      // Motion start/stop is not the same as prolonged idle — keep it generic.
      return 'other';
    case 'DEVICE_REBOOT':
    case 'ENTER_SLEEP':
    case 'EXIT_SLEEP':
      // Sleep/reboot are device-state notices, not "went offline" connectivity.
      return 'other';
    case 'FACE_ID_ALARM':
      return 'dms';
    default:
      // This MD300 uploads driver monitoring as events 655–663 (and 126 on
      // other firmware). An older gateway still emits EVENT_n for those.
      if (/^EVENT_(126|65[5-9]|66[0-3])$/.test(code)) return 'dms';
      if (code.startsWith('INPUT_')) return 'ignition';
      return 'other';
  }
}
