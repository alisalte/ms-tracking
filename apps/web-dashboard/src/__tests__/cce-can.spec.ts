import { describe, expect, it } from 'vitest';

import { formatCanFact, formatDeviceFact } from '@/lib/cce-can';
import type { CceRecord } from '@/types/fleet.types';

const t = (key: string, opts?: Record<string, unknown>) => {
  if (key === 'map.popup.canUnknown') return '—';
  if (key === 'map.popup.canAbsent') return 'absent';
  if (key === 'map.popup.canFuel') return `fuel ${opts?.pct}%`;
  if (key === 'map.popup.canPedal') return `pedal ${opts?.pct}%`;
  if (key === 'map.popup.canCoolant') return `coolant ${opts?.temp}`;
  if (key === 'map.popup.canHours') return `${opts?.hours} h`;
  if (key === 'map.popup.devicePower') return `power ${opts?.volts} V`;
  if (key === 'map.popup.deviceBattery') return `battery ${opts?.pct}%`;
  if (key === 'map.popup.deviceGsm') return `GSM ${opts?.level}`;
  if (key === 'map.popup.deviceSats') return `${opts?.count} sats`;
  if (key === 'map.popup.deviceCameras') return `cameras ${opts?.connected}/${opts?.supported}`;
  return key;
};

function record(can: CceRecord['can']): CceRecord {
  return { event: 0, paramIds: [], params: {}, can };
}

describe('formatCanFact', () => {
  it('says the packet was stored without CAN', () => {
    expect(formatCanFact(record({ present: false, ids: [] }), t)).toBe('absent');
  });

  it('leaves a dash when this fix has no CCE record', () => {
    expect(formatCanFact(null, t)).toBe('—');
    expect(formatCanFact(undefined, t)).toBe('—');
  });

  it('shows the scaled CAN fields that arrived', () => {
    expect(
      formatCanFact(
        record({
          present: true,
          ids: ['0x99', '0x9d', '0x97'],
          rpm: 1042,
          fuelLevelPct: 35,
          acceleratorPedalPct: 20,
        }),
        t,
      ),
    ).toBe('1042 rpm · fuel 35% · pedal 20%');
  });
});

describe('formatDeviceFact', () => {
  it('is unknown for records stored before the status IDs were decoded', () => {
    expect(formatDeviceFact(record({ present: false, ids: [] }), t)).toBe('—');
    expect(formatDeviceFact(null, t)).toBe('—');
  });

  it('summarises power, signal, GPS and cameras from cce.status', () => {
    const cce: CceRecord = {
      ...record({ present: false, ids: [] }),
      status: {
        externalPowerV: 13.18,
        batteryPct: 98,
        gsmSignal: 21,
        satellites: 10,
        altitudeM: 38,
        cameras: { supported: 4, connected: [1] },
      },
    };
    expect(formatDeviceFact(cce, t)).toBe(
      'power 13.18 V · battery 98% · GSM 21 · 10 sats · 38 m · cameras 1/4',
    );
  });
});
