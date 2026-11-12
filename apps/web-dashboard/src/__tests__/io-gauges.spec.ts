import { describe, expect, it } from 'vitest';

import { buildGaugeView, calibrate, engineTempLevel, fuelLevel } from '@/lib/io-gauges';
import type { FmbIoPanel } from '@/types/fleet.types';

describe('calibrate', () => {
  const pts = [
    { v: 4.5, value: 100 },
    { v: 0.5, value: 0 },
  ];

  it('interpolates between points regardless of their order', () => {
    expect(calibrate(pts, 2.5)).toBe(50);
  });

  it('holds the end values outside the calibrated range', () => {
    expect(calibrate(pts, 0)).toBe(0);
    expect(calibrate(pts, 9)).toBe(100);
  });

  it('follows several segments (non-linear sender) and inverted senders', () => {
    const ntc = [
      { v: 0.5, value: 120 },
      { v: 1.5, value: 90 },
      { v: 3.5, value: 30 },
    ];
    expect(calibrate(ntc, 1)).toBe(105);
    expect(calibrate(ntc, 2.5)).toBe(60);
  });

  it('needs two points', () => {
    expect(calibrate([{ v: 1, value: 1 }], 1)).toBeNull();
  });
});

describe('levels', () => {
  it('flags low fuel and hot engines', () => {
    expect(fuelLevel(60)).toBe('normal');
    expect(fuelLevel(20)).toBe('warning');
    expect(fuelLevel(5)).toBe('critical');
    expect(engineTempLevel(20)).toBe('cold');
    expect(engineTempLevel(90)).toBe('normal');
    expect(engineTempLevel(102)).toBe('warning');
    expect(engineTempLevel(112)).toBe('critical');
  });
});

describe('buildGaugeView', () => {
  const at = new Date().toISOString();
  const panel: FmbIoPanel = {
    updatedAt: at,
    groups: {
      ain: [{ id: 9, key: 'ain1', group: 'ain', value: 2.5, unit: 'V', at }],
      can: [
        { id: 89, key: 'canFuelLevelPct', group: 'can', value: 40, unit: '%', at },
        { id: 85, key: 'canRpm', group: 'can', value: 1500, unit: 'rpm', at },
      ],
      onewire: [{ id: 72, key: 'temp1', group: 'onewire', value: -4.5, unit: '°C', at }],
      other: [{ id: 300, key: null, group: 'other', value: 1, at }],
    },
  };

  it('keeps an analog input a voltmeter until a sensor is set', () => {
    const view = buildGaugeView(panel);
    const dial = view.sections.find((s) => s.section === 'dial')?.gauges ?? [];
    expect(dial.map((g) => g.code)).toContain('AIN1');
    expect(view.hidden).toBe(1);
  });

  it('turns a calibrated input into a fuel gauge next to the CAN one', () => {
    const view = buildGaugeView(panel, [
      {
        input: 'ain1',
        kind: 'fuel',
        tankLiters: 80,
        points: [
          { v: 0.5, value: 0 },
          { v: 4.5, value: 100 },
        ],
      },
    ]);
    const fuel = view.sections.find((s) => s.section === 'fuel')?.gauges ?? [];
    expect(fuel).toHaveLength(2);
    expect(fuel[0]).toMatchObject({ type: 'fuel', percent: 50, liters: 40, volts: 2.5 });
    expect(view.sections.map((s) => s.section)).toEqual(['fuel', 'temp', 'dial']);
  });
});
