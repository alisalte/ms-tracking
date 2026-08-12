import { describe, expect, it } from '@jest/globals';
import type { AlarmRuleProps } from '../domain/alarm-rule.js';
import {
  AlarmOccurrence,
  AlarmRule,
  type AlarmSeverity,
  IllegalStatusTransitionError,
  isValidTransition,
  severityRank,
} from '../domain/index.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEHICLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('AlarmRule', () => {
  function makeRule(overrides: Partial<AlarmRuleProps> = {}) {
    const base: AlarmRuleProps = {
      tenantId: TENANT,
      name: 'Speed limit',
      type: 'overspeed',
      severity: 'HIGH',
      enabled: true,
      entityType: 'vehicle',
      entityId: null,
      conditions: { thresholdKmh: 120 },
      cooldownSec: 300,
      dedupWindowSec: 600,
      repeatPolicy: 'COOLDOWN',
    };
    return AlarmRule.create(undefined, { ...base, ...overrides });
  }

  it('applies to all vehicles when entityId is null', () => {
    const rule = makeRule();
    expect(rule.appliesTo(VEHICLE)).toBe(true);
    expect(rule.appliesTo('any-other')).toBe(true);
  });

  it('applies only to the specific vehicle when entityId is set', () => {
    const rule = makeRule({ entityId: VEHICLE });
    expect(rule.appliesTo(VEHICLE)).toBe(true);
    expect(rule.appliesTo('other')).toBe(false);
  });

  it('does not apply when disabled', () => {
    const rule = makeRule({ enabled: false });
    expect(rule.appliesTo(VEHICLE)).toBe(false);
  });

  it('reads numeric conditions with a fallback', () => {
    const rule = makeRule({ conditions: {} });
    expect(rule.conditionNum('thresholdKmh', 100)).toBe(100);
  });

  it('can be enabled/disabled', () => {
    const rule = makeRule({ enabled: false });
    rule.enable();
    expect(rule.isEnabled()).toBe(true);
    rule.disable();
    expect(rule.isEnabled()).toBe(false);
  });
});

describe('AlarmOccurrence lifecycle', () => {
  function makeAlarm() {
    return AlarmOccurrence.create('alarm-1', {
      tenantId: TENANT,
      ruleId: 'rule-1',
      type: 'overspeed',
      severity: 'HIGH' as AlarmSeverity,
      vehicleId: VEHICLE,
      lat: 35.7,
      lng: 51.3,
      message: 'Speed exceeded',
      detail: {},
      sourceEvents: [],
      raisedAt: new Date(),
    });
  }

  it('starts as OPEN', () => {
    expect(makeAlarm().status).toBe('OPEN');
  });

  it('OPEN → ACKNOWLEDGED is valid', () => {
    const alarm = makeAlarm();
    alarm.acknowledge('user-1');
    expect(alarm.status).toBe('ACKNOWLEDGED');
    expect(alarm.acknowledgedBy).toBe('user-1');
    expect(alarm.acknowledgedAt).not.toBeNull();
  });

  it('OPEN → RESOLVED is valid (direct resolve)', () => {
    const alarm = makeAlarm();
    alarm.resolve('user-1', 'false positive');
    expect(alarm.status).toBe('RESOLVED');
    expect(alarm.resolvedBy).toBe('user-1');
    expect(alarm.resolutionReason).toBe('false positive');
  });

  it('ACKNOWLEDGED → RESOLVED is valid', () => {
    const alarm = makeAlarm();
    alarm.acknowledge('user-1');
    alarm.resolve('user-2');
    expect(alarm.status).toBe('RESOLVED');
  });

  it('RESOLVED → ACKNOWLEDGED is illegal', () => {
    const alarm = makeAlarm();
    alarm.resolve('user-1');
    expect(() => alarm.acknowledge('user-2')).toThrow(IllegalStatusTransitionError);
  });

  it('ACKNOWLEDGED → ACKNOWLEDGED is illegal', () => {
    const alarm = makeAlarm();
    alarm.acknowledge('user-1');
    expect(() => alarm.acknowledge('user-2')).toThrow(IllegalStatusTransitionError);
  });
});

describe('isValidTransition', () => {
  it('allows OPEN → ACKNOWLEDGED, OPEN → RESOLVED, ACK → RESOLVED', () => {
    expect(isValidTransition('OPEN', 'ACKNOWLEDGED')).toBe(true);
    expect(isValidTransition('OPEN', 'RESOLVED')).toBe(true);
    expect(isValidTransition('ACKNOWLEDGED', 'RESOLVED')).toBe(true);
  });

  it('rejects same-state, reverse, and illegal transitions', () => {
    expect(isValidTransition('OPEN', 'OPEN')).toBe(false);
    expect(isValidTransition('RESOLVED', 'OPEN')).toBe(false);
    expect(isValidTransition('RESOLVED', 'ACKNOWLEDGED')).toBe(false);
    expect(isValidTransition('ACKNOWLEDGED', 'OPEN')).toBe(false);
  });
});

describe('severityRank', () => {
  it('orders severities correctly', () => {
    expect(severityRank.INFO).toBeLessThan(severityRank.LOW);
    expect(severityRank.LOW).toBeLessThan(severityRank.MEDIUM);
    expect(severityRank.MEDIUM).toBeLessThan(severityRank.HIGH);
    expect(severityRank.HIGH).toBeLessThan(severityRank.CRITICAL);
  });
});
