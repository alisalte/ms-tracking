import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PARAMETER_SECTION_DEFS,
  SHIPPED_PARAMETER_SECTIONS,
  loadParameterSnapshot,
  parameterCacheKey,
  parameterSourceI18nKey,
  resolveParameterSource,
  runParameterProbes,
  saveParameterSnapshot,
  stampParameterSnapshot,
  waitForParameterCommandAck,
} from '@/lib/device-parameter-state';
import type { DeviceCommandRecord } from '@/types/command.types';

describe('parameter section registry', () => {
  it('ships alarm+network+tracking+alerts+media+ai', () => {
    expect(SHIPPED_PARAMETER_SECTIONS).toEqual([
      'alarm',
      'network',
      'tracking',
      'alerts',
      'media',
      'ai',
    ]);
    expect(PARAMETER_SECTION_DEFS.map((s) => s.id)).toEqual([
      'alarm',
      'network',
      'tracking',
      'alerts',
      'media',
      'ai',
    ]);
  });
});

describe('parameter snapshot cache', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips stamped snapshots and legacy raw sett', () => {
    const key = parameterCacheKey('network', 'dev-1');
    saveParameterSnapshot(key, stampParameterSnapshot({ host: 'a.example' }, 'readback'));
    expect(loadParameterSnapshot(key, () => ({ host: '' })).sett.host).toBe('a.example');
    expect(loadParameterSnapshot(key, () => ({ host: '' })).source).toBe('readback');

    localStorage.setItem(
      parameterCacheKey('alarm', 'dev-1', 19),
      JSON.stringify({ host: 'legacy' }),
    );
    expect(
      loadParameterSnapshot(parameterCacheKey('alarm', 'dev-1', 19), () => ({ host: '' })).source,
    ).toBe('set');
  });
});

describe('resolveParameterSource', () => {
  it('prefers live then history', () => {
    expect(resolveParameterSource({ gotLive: true, fromHistory: true })).toBe('readback');
    expect(resolveParameterSource({ gotLive: false, fromHistory: true })).toBe('history');
    expect(resolveParameterSource({ gotLive: false, fromHistory: false })).toBe('set');
    expect(
      resolveParameterSource({ gotLive: false, fromHistory: false, fallback: 'default' }),
    ).toBe('default');
  });

  it('maps sources to i18n keys', () => {
    expect(parameterSourceI18nKey('readback')).toBe('sourceReadback');
    expect(parameterSourceI18nKey('default')).toBe('sourceDefault');
  });
});

describe('runParameterProbes', () => {
  it('soft-fails non-ACK and reports gotLive when onAcked returns true', async () => {
    const issue = vi
      .fn()
      .mockResolvedValueOnce({
        queued: [{ id: 'c1' } as DeviceCommandRecord],
        failed: [],
      })
      .mockResolvedValueOnce({
        queued: [{ id: 'c2' } as DeviceCommandRecord],
        failed: [],
      });

    const waitForAck = vi
      .fn()
      .mockResolvedValueOnce({ id: 'c1', status: 'FAILED' } as DeviceCommandRecord)
      .mockResolvedValueOnce({
        id: 'c2',
        status: 'ACKED',
        responseText: 'OK',
      } as DeviceCommandRecord);

    const onAcked = vi.fn().mockReturnValue(true);
    const { gotLive } = await runParameterProbes({
      deviceId: 'd1',
      probes: [
        { commandCode: 'B99', params: {}, label: 'p1' },
        { commandCode: 'CB8', params: {}, label: 'p2' },
      ],
      issue,
      waitForAck,
      onAcked,
    });

    expect(gotLive).toBe(true);
    expect(onAcked).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('throws when nothing is queued', async () => {
    await expect(
      runParameterProbes({
        deviceId: 'd1',
        probes: [{ commandCode: 'DB4', params: {}, label: 'dump' }],
        issue: async () => ({ queued: [], failed: [{ deviceId: 'd1', error: 'offline' }] }),
        onAcked: () => false,
      }),
    ).rejects.toThrow(/offline/);
  });
});

describe('waitForParameterCommandAck', () => {
  it('polls until leaving QUEUED/SENT', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ id: 'x', status: 'QUEUED' })
      .mockResolvedValueOnce({ id: 'x', status: 'ACKED', responseText: 'OK' });

    const row = await waitForParameterCommandAck('x', {
      timeoutMs: 5_000,
      pollMs: 1,
      fetch: fetch as (id: string) => Promise<DeviceCommandRecord>,
    });
    expect(row.status).toBe('ACKED');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
