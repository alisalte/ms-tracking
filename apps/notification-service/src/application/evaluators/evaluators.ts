/**
 * Concrete rule evaluators — one per alarm type. Each is a pure function that
 * checks whether an incoming signal matches the rule's conditions.
 *
 * Geofence evaluation is handled separately (by the AlarmEvaluatorService) because
 * it requires async spatial queries + Redis state tracking.
 */
import type { AlarmEvent } from '../../domain/alarm-event.js';
import type { AlarmRule } from '../../domain/alarm-rule.js';
import type { InputSignal, RuleEvaluator } from './rule-evaluator.js';

/** Overspeed: position speed exceeds the rule's thresholdKmh. */
export class OverspeedEvaluator implements RuleEvaluator {
  public evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null {
    if (signal.kind !== 'position') return null;
    const threshold = rule.conditionNum('thresholdKmh', 120);
    if (signal.speedKph <= threshold) return null;
    return {
      ruleId: rule.id,
      type: 'overspeed',
      tenantId: signal.tenantId,
      vehicleId: signal.vehicleId,
      severity: rule.severity,
      lat: signal.lat,
      lng: signal.lng,
      message: `Vehicle exceeded speed limit: ${signal.speedKph.toFixed(1)} km/h (limit ${threshold} km/h)`,
      sourceEvent: { kind: 'position', speedKph: signal.speedKph, capturedAt: signal.capturedAt },
      detectedAt: new Date(signal.capturedAt),
    };
  }
}

/** Ignition on/off: fires on ignition state change (needs ignitionOn from the envelope). */
export class IgnitionOnEvaluator implements RuleEvaluator {
  public evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null {
    if (signal.kind !== 'position' || signal.ignitionOn !== true) return null;
    return {
      ruleId: rule.id,
      type: 'ignition_on',
      tenantId: signal.tenantId,
      vehicleId: signal.vehicleId,
      severity: rule.severity,
      lat: signal.lat,
      lng: signal.lng,
      message: 'Ignition turned on',
      sourceEvent: { kind: 'position', ignitionOn: true, capturedAt: signal.capturedAt },
      detectedAt: new Date(signal.capturedAt),
    };
  }
}

export class IgnitionOffEvaluator implements RuleEvaluator {
  public evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null {
    if (signal.kind !== 'position' || signal.ignitionOn !== false) return null;
    return {
      ruleId: rule.id,
      type: 'ignition_off',
      tenantId: signal.tenantId,
      vehicleId: signal.vehicleId,
      severity: rule.severity,
      lat: signal.lat,
      lng: signal.lng,
      message: 'Ignition turned off',
      sourceEvent: { kind: 'position', ignitionOn: false, capturedAt: signal.capturedAt },
      detectedAt: new Date(signal.capturedAt),
    };
  }
}

/** Device offline: fires when device status transitions to OFFLINE/STALE. */
export class DeviceOfflineEvaluator implements RuleEvaluator {
  public evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null {
    if (signal.kind !== 'device_status') return null;
    if (signal.state === 'ONLINE') return null;
    return {
      ruleId: rule.id,
      type: 'device_offline',
      tenantId: signal.tenantId,
      vehicleId: signal.deviceId,
      severity: rule.severity,
      lat: null,
      lng: null,
      message: `Device went ${signal.state}`,
      sourceEvent: { kind: 'device_status', state: signal.state, lastSeenAt: signal.lastSeenAt },
      detectedAt: new Date(signal.lastSeenAt),
    };
  }
}

/** Trip started: fires on the trip.started event. */
export class TripStartedEvaluator implements RuleEvaluator {
  public evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null {
    if (signal.kind !== 'trip' || signal.type !== 'trip.started') return null;
    return {
      ruleId: rule.id,
      type: 'trip_started',
      tenantId: signal.tenantId,
      vehicleId: signal.vehicleId,
      severity: rule.severity,
      lat: null,
      lng: null,
      message: 'Trip started',
      sourceEvent: { kind: 'trip', type: signal.type, startedAt: signal.startedAt },
      detectedAt: new Date(signal.startedAt),
    };
  }
}

/** Trip ended: fires on the trip.ended event. */
export class TripEndedEvaluator implements RuleEvaluator {
  public evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null {
    if (signal.kind !== 'trip' || signal.type !== 'trip.ended') return null;
    return {
      ruleId: rule.id,
      type: 'trip_ended',
      tenantId: signal.tenantId,
      vehicleId: signal.vehicleId,
      severity: rule.severity,
      lat: null,
      lng: null,
      message: `Trip ended (${signal.distanceKm.toFixed(1)} km, ${signal.durationSec}s)`,
      sourceEvent: {
        kind: 'trip',
        type: signal.type,
        distanceKm: signal.distanceKm,
        durationSec: signal.durationSec,
      },
      detectedAt: new Date(signal.endedAt),
    };
  }
}

/** Excessive trip duration: trip.ended with duration > maxDurationSec. */
export class ExcessiveTripDurationEvaluator implements RuleEvaluator {
  public evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null {
    if (signal.kind !== 'trip' || signal.type !== 'trip.ended') return null;
    const max = rule.conditionNum('maxDurationSec', 14_400); // default 4h
    if (signal.durationSec <= max) return null;
    return {
      ruleId: rule.id,
      type: 'excessive_trip_duration',
      tenantId: signal.tenantId,
      vehicleId: signal.vehicleId,
      severity: rule.severity,
      lat: null,
      lng: null,
      message: `Trip duration exceeded limit: ${signal.durationSec}s (max ${max}s)`,
      sourceEvent: { kind: 'trip', durationSec: signal.durationSec },
      detectedAt: new Date(signal.endedAt),
    };
  }
}

/** Evaluator registry — maps rule type to evaluator instance. */
export function buildEvaluatorRegistry(): Map<string, RuleEvaluator> {
  const map = new Map<string, RuleEvaluator>();
  const evaluators: RuleEvaluator[] = [
    new OverspeedEvaluator(),
    new IgnitionOnEvaluator(),
    new IgnitionOffEvaluator(),
    new DeviceOfflineEvaluator(),
    new TripStartedEvaluator(),
    new TripEndedEvaluator(),
    new ExcessiveTripDurationEvaluator(),
  ];
  // Each evaluator handles one type; the AlarmEvaluatorService dispatches by rule.type.
  // The registry maps the type string → evaluator. An evaluator may handle multiple types.
  const typeMap: Record<string, RuleEvaluator> = {
    overspeed: new OverspeedEvaluator(),
    ignition_on: new IgnitionOnEvaluator(),
    ignition_off: new IgnitionOffEvaluator(),
    device_offline: new DeviceOfflineEvaluator(),
    trip_started: new TripStartedEvaluator(),
    trip_ended: new TripEndedEvaluator(),
    excessive_trip_duration: new ExcessiveTripDurationEvaluator(),
  };
  for (const [type, evalInstance] of Object.entries(typeMap)) {
    map.set(type, evalInstance);
  }
  void evaluators; // retained for documentation — the typeMap is the actual registry
  return map;
}
