import { describe, expect, it } from 'vitest';

import {
  haulAlertStatus,
  haulTag,
  isEmptyPlan,
  managedHaulRules,
  planHaulAlerts,
} from '@/lib/haul-alerts';
import type { AlarmRule } from '@/types/rule.types';

const labels = { load: 'Loading limit', unload: 'Unloading limit' };
const origin = {
  id: 'g-o',
  name: 'Pit',
  status: 'ACTIVE' as const,
  alertOn: ['ENTER' as const],
  dwellSec: null,
};
const destination = {
  id: 'g-d',
  name: 'Dump',
  status: 'ACTIVE' as const,
  alertOn: ['DWELL' as const],
  dwellSec: 600,
};
const trucks = [
  { vehicleId: 'v1', vehicleName: 'Truck 1' },
  { vehicleId: 'v2', vehicleName: 'Truck 2' },
];

function rule(over: Partial<AlarmRule>): AlarmRule {
  return {
    id: 'r1',
    tenantId: 't',
    name: 'x',
    type: 'geofence_dwell',
    severity: 'MEDIUM',
    enabled: true,
    entityType: 'vehicle',
    entityId: 'v1',
    conditions: {},
    cooldownSec: 0,
    dedupWindowSec: 60,
    repeatPolicy: 'ALWAYS',
    version: 1,
    ...over,
  };
}

const base = { routeId: 'route-1', routeName: 'Pit to dump', origin, destination, trucks, labels };

describe('haul live alerts', () => {
  it('sets the fence dwell and creates one rule per truck and phase', () => {
    const plan = planHaulAlerts({ ...base, limits: { load: 600, unload: 300 }, rules: [] });
    // Origin had no dwell alert; the destination dwell moves 600 → 300.
    expect(plan.fences).toEqual([
      expect.objectContaining({
        kind: 'load',
        geofenceId: 'g-o',
        fromDwellSec: null,
        toDwellSec: 600,
        alertOn: ['ENTER', 'DWELL'],
      }),
      expect.objectContaining({
        kind: 'unload',
        geofenceId: 'g-d',
        fromDwellSec: 600,
        toDwellSec: 300,
      }),
    ]);
    expect(plan.creates).toHaveLength(4);
    expect(plan.creates[0]).toMatchObject({
      type: 'geofence_dwell',
      entityId: 'v1',
      conditions: { geofenceId: 'g-o', dwellSec: 600 },
      repeatPolicy: 'ALWAYS',
    });
    expect(plan.creates[0]?.name).toContain(haulTag('route-1', 'load'));
  });

  it('is a no-op when the alerts already match, and leaves foreign rules alone', () => {
    const managed = [
      rule({
        id: 'a',
        name: `L ${haulTag('route-1', 'load')}`,
        entityId: 'v1',
        conditions: { geofenceId: 'g-o', dwellSec: 600 },
      }),
      rule({
        id: 'b',
        name: `L ${haulTag('route-1', 'load')}`,
        entityId: 'v2',
        conditions: { geofenceId: 'g-o', dwellSec: 600 },
      }),
    ];
    const foreign = rule({
      id: 'mine',
      name: 'Hand made dwell',
      conditions: { geofenceId: 'g-o', dwellSec: 60 },
    });
    const done = { ...base, origin: { ...origin, alertOn: ['DWELL' as const], dwellSec: 600 } };
    const plan = planHaulAlerts({
      ...done,
      limits: { load: 600, unload: null },
      rules: [...managed, foreign],
    });
    expect(isEmptyPlan(plan)).toBe(true);
    expect(managedHaulRules([...managed, foreign], 'route-1').map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('updates a changed limit, re-enables a disabled rule and drops rules of trucks that left', () => {
    const tag = haulTag('route-1', 'load');
    const rules = [
      rule({
        id: 'a',
        name: `L ${tag}`,
        entityId: 'v1',
        conditions: { geofenceId: 'g-o', dwellSec: 300 },
      }),
      rule({
        id: 'b',
        name: `L ${tag}`,
        entityId: 'v2',
        enabled: false,
        conditions: { geofenceId: 'g-o', dwellSec: 600 },
      }),
      rule({
        id: 'gone',
        name: `L ${tag}`,
        entityId: 'v9',
        conditions: { geofenceId: 'g-o', dwellSec: 600 },
      }),
      rule({
        id: 'dup',
        name: `L ${tag}`,
        entityId: 'v1',
        conditions: { geofenceId: 'g-o', dwellSec: 600 },
      }),
    ];
    const plan = planHaulAlerts({ ...base, limits: { load: 600, unload: null }, rules });
    expect(plan.updates.map((u) => u.id)).toEqual(['a']);
    expect(plan.updates[0]?.changes.conditions).toEqual({ geofenceId: 'g-o', dwellSec: 600 });
    expect(plan.enables).toEqual(['b']);
    expect(plan.deletes.sort()).toEqual(['dup', 'gone']);
    expect(plan.creates).toHaveLength(0);
  });

  it("turning a phase off deletes only that phase's managed rules", () => {
    const rules = [
      rule({ id: 'l', name: `L ${haulTag('route-1', 'load')}`, entityId: 'v1' }),
      rule({ id: 'u', name: `U ${haulTag('route-1', 'unload')}`, entityId: 'v1' }),
      rule({ id: 'other-route', name: `L ${haulTag('route-2', 'load')}`, entityId: 'v1' }),
    ];
    const plan = planHaulAlerts({ ...base, limits: { load: null, unload: 600 }, rules });
    expect(plan.deletes).toEqual(['l']);
  });

  it('does nothing for a phase whose geofence is gone', () => {
    const plan = planHaulAlerts({
      ...base,
      origin: null,
      limits: { load: 600, unload: null },
      rules: [],
    });
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('flags an inactive geofence and reports coverage', () => {
    const plan = planHaulAlerts({
      ...base,
      origin: { ...origin, status: 'INACTIVE' },
      limits: { load: 600, unload: null },
      rules: [],
    });
    expect(plan.fences[0]?.inactive).toBe(true);
    const rules = [
      rule({
        id: 'l',
        name: `L ${haulTag('route-1', 'load')}`,
        conditions: { geofenceId: 'g-o', dwellSec: 900 },
      }),
    ];
    expect(haulAlertStatus(rules, 'route-1', 2)).toEqual({
      load: { active: 1, limitSec: 900, trucks: 2 },
      unload: { active: 0, limitSec: null, trucks: 2 },
    });
  });
});
