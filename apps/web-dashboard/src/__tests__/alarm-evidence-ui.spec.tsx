import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlarmEvidence } from '@/components/alarms/AlarmEvidence';
import { i18n } from '@/i18n';
import type { Alarm } from '@/types/alarm.types';

const evidence = vi.hoisted(() => ({
  current: {
    dms: false,
    eventPhotoName: undefined as string | undefined,
    eventPhoto: null,
    photoUrl: null as string | null,
    photoBlob: null,
    photoError: null as string | null,
    videoChannel: null as { id: string; deviceId: string; label: string } | null,
    videoWindow: null as { fromMs: number; toMs: number } | null,
    window: { fromMs: 0, toMs: 1 },
    hasCamera: true,
    channelsLoading: false,
    status: 'idle' as 'idle' | 'listing' | 'ready' | 'error',
    error: null as string | null,
    videos: [] as {
      resource: { startTime: string; endTime: string; avType: number };
      channel: { id: string; label: string; deviceId?: string };
    }[],
    photos: [] as {
      resource: { startTime: string; endTime: string; avType: number };
      channel: { id: string; label: string; deviceId?: string };
    }[],
    mdvrChannels: [{ id: 'ch-1', deviceId: 'dev-1', label: 'Cabin' }],
    loadRequested: false,
    includeNearby: false,
    hasNearbyExtras: false,
    requestLoad: vi.fn(),
    requestNearby: vi.fn(),
  },
}));

vi.mock('@/hooks/useAlarmEvidence', () => ({
  useAlarmEvidence: () => evidence.current,
}));

vi.mock('@/api/alarm.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/alarm.api')>();
  return {
    ...actual,
    useAlarmPlatformEvidence: () => ({
      data: null,
      isLoading: false,
      isError: false,
    }),
  };
});

vi.mock('@/components/alarms/AlarmEventVideo', () => ({
  AlarmEventVideo: () => createElement('div', { 'data-testid': 'event-video' }),
}));

const alarm: Alarm = {
  id: 'al-1',
  type: 'overspeed',
  severity: 'major',
  status: 'raised',
  vehicleId: 'veh-1',
  vehicleLabel: 'TRK-1',
  lat: 35.7,
  lng: 51.4,
  address: 'Tehran',
  raisedAt: '2026-09-05T12:00:00.000Z',
  escalationStep: 0,
  message: 'Overspeed',
  detail: '',
  sourceEvents: [],
};

function renderEvidence(overrides: Partial<typeof evidence.current> = {}) {
  evidence.current = {
    ...evidence.current,
    requestLoad: vi.fn(),
    requestNearby: vi.fn(),
    ...overrides,
  };
  return render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, null, createElement(AlarmEvidence, { alarm })),
    ),
  );
}

describe('AlarmEvidence', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    evidence.current.requestLoad.mockReset();
    evidence.current.requestNearby.mockReset();
  });

  it('asks before listing nearby saved media on a non-DMS alarm', () => {
    renderEvidence({ dms: false, status: 'idle', hasCamera: true });
    expect(screen.getByRole('button', { name: /Show saved photos & videos/i })).toBeInTheDocument();
    expect(screen.queryByText('Videos')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show saved photos & videos/i }));
    expect(evidence.current.requestLoad).toHaveBeenCalled();
  });

  it('asks before listing DMS event photos and videos', () => {
    renderEvidence({ dms: true, status: 'idle', hasCamera: true, eventPhotoName: 'E126S1.jpg' });
    expect(screen.getByRole('button', { name: /Show event photos & videos/i })).toBeInTheDocument();
    expect(screen.queryByText('Videos')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show event photos & videos/i }));
    expect(evidence.current.requestLoad).toHaveBeenCalled();
  });

  it('lists DMS event photos and videos after the operator asks', () => {
    renderEvidence({
      dms: true,
      status: 'ready',
      loadRequested: true,
      eventPhotoName: 'E126S1.jpg',
      photoUrl: 'blob:event-photo',
      videoChannel: { id: 'ch-1', deviceId: 'dev-1', label: 'Driver' },
      videoWindow: { fromMs: 1, toMs: 2 },
    });
    expect(screen.getByText(/captured for this DMS alarm/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'E126S1.jpg' })).toHaveAttribute(
      'src',
      'blob:event-photo',
    );
    expect(screen.getByRole('button', { name: /Download photo/i })).toBeInTheDocument();
    expect(screen.getByTestId('event-video')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Show event photos & videos/i }),
    ).not.toBeInTheDocument();
  });
});
