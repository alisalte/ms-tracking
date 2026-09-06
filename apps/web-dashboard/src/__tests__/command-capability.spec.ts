import { describe, expect, it } from 'vitest';

import {
  MDVR_ONLY_CATEGORIES,
  commandClassFromModel,
  filterCatalogForClass,
} from '@/lib/command-capability';
import { groupCommandHistory } from '@/lib/command-history-groups';
import type { CommandDef, DeviceCommandRecord } from '@/types/command.types';

function cmd(code: string, category: CommandDef['category']): CommandDef {
  return {
    code,
    name: code,
    nameFa: code,
    category,
    description: '',
    descriptionFa: '',
    params: [],
    expectResponse: false,
    supportsReadback: false,
  };
}

function row(
  id: string,
  deviceId: string,
  issuedAt: string,
  overrides: Partial<DeviceCommandRecord> = {},
): DeviceCommandRecord {
  return {
    id,
    tenantId: 't1',
    deviceId,
    commandCode: 'A12',
    category: 'tracking',
    params: { interval: 6 },
    payloadText: 'A12,6',
    payloadHex: null,
    status: 'ACKED',
    responseText: 'A12,OK',
    error: null,
    issuedBy: 'user-1',
    issuedAt,
    sentAt: issuedAt,
    ackedAt: issuedAt,
    expiresAt: issuedAt,
    version: 1,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    ...overrides,
  };
}

describe('commandClassFromModel', () => {
  it('treats T-series and GPS trackers as tracker', () => {
    expect(commandClassFromModel('T622')).toBe('tracker');
    expect(commandClassFromModel('T333')).toBe('tracker');
    expect(commandClassFromModel('MVT380')).toBe('tracker');
    expect(commandClassFromModel('MT90')).toBe('tracker');
  });

  it('treats MD-series as MDVR', () => {
    expect(commandClassFromModel('MD522S')).toBe('mdvr');
    expect(commandClassFromModel('MD300')).toBe('mdvr');
    expect(commandClassFromModel('MD511H')).toBe('mdvr');
  });

  it('defaults unknown / empty models to tracker so extra settings stay hidden', () => {
    expect(commandClassFromModel(null)).toBe('tracker');
    expect(commandClassFromModel('')).toBe('tracker');
    expect(commandClassFromModel('UNKNOWN-X')).toBe('tracker');
  });
});

describe('filterCatalogForClass', () => {
  const catalog = [
    cmd('A12', 'tracking'),
    cmd('C01', 'outputs'),
    cmd('AB2', 'media'),
    cmd('D10', 'rfid'),
    cmd('B21', 'temperature'),
  ];

  it('hides MDVR-only categories on a tracker', () => {
    const filtered = filterCatalogForClass(catalog, 'tracker');
    expect(filtered.map((c) => c.code)).toEqual(['A12', 'C01']);
    expect(filtered.every((c) => !MDVR_ONLY_CATEGORIES.has(c.category))).toBe(true);
  });

  it('keeps the full catalog for an MDVR', () => {
    expect(filterCatalogForClass(catalog, 'mdvr').map((c) => c.code)).toEqual([
      'A12',
      'C01',
      'AB2',
      'D10',
      'B21',
    ]);
  });
});

describe('groupCommandHistory', () => {
  it('collapses a bulk send into one group', () => {
    const t0 = '2026-09-06T08:00:00.000Z';
    const t1 = '2026-09-06T08:00:00.400Z';
    const groups = groupCommandHistory([
      row('c1', 'd1', t0),
      row('c2', 'd2', t1, { responseText: 'A12,OK' }),
      row('c3', 'd3', t1, { status: 'FAILED', responseText: null, error: 'OFFLINE' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.records).toHaveLength(3);
    expect(groups[0]?.commandCode).toBe('A12');
  });

  it('keeps two dispatches of the same command apart when the gap is large', () => {
    const groups = groupCommandHistory([
      row('c1', 'd1', '2026-09-06T08:00:00.000Z'),
      row('c2', 'd2', '2026-09-06T08:01:00.000Z'),
    ]);
    expect(groups).toHaveLength(2);
  });
});
