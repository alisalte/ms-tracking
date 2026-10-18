import { describe, expect, it } from 'vitest';

import { formatCanFact } from '@/lib/cce-can';
import type { CceRecord } from '@/types/fleet.types';

const t = (key: string, opts?: Record<string, unknown>) => {
  if (key === 'map.popup.canUnknown') return '—';
  if (key === 'map.popup.canAbsent') return 'absent';
  if (key === 'map.popup.canFuel') return `fuel ${opts?.pct}%`;
  if (key === 'map.popup.canPedal') return `pedal ${opts?.pct}%`;
  if (key === 'map.popup.canCoolant') return `coolant ${opts?.temp}`;
  if (key === 'map.popup.canHours') return `${opts?.hours} h`;
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
