import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { AlarmLiveIndicator } from '@/components/alarms/AlarmLiveIndicator';

import { i18n } from '@/i18n';

/**
 * Phase 9: the Alarm Center must show an HONEST connection state, not a
 * decorative "Live" badge. `useAlarmRealtime` is real but degrades gracefully
 * (no WS server → disconnected). This pins the three honest states.
 */
vi.mock('@/hooks/useAlarmRealtime', () => ({
  useAlarmRealtime: vi.fn(() => ({
    events: [],
    clearEvents: vi.fn(),
    connectionState: 'disconnected',
  })),
}));

// Import after the mock is registered so the component sees the mock.
const { useAlarmRealtime } = await import('@/hooks/useAlarmRealtime');

function renderIndicator() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(I18nextProvider, { i18n }, createElement(AlarmLiveIndicator)),
    ),
  );
}

describe('AlarmLiveIndicator (honest connection state)', () => {
  it('shows "Polling" when disconnected (no realtime)', () => {
    vi.mocked(useAlarmRealtime).mockReturnValue({
      events: [],
      clearEvents: vi.fn(),
      connectionState: 'disconnected',
    });
    renderIndicator();
    expect(screen.getByText('Polling')).toBeInTheDocument();
  });

  it('shows "Connecting…" while connecting', () => {
    vi.mocked(useAlarmRealtime).mockReturnValue({
      events: [],
      clearEvents: vi.fn(),
      connectionState: 'connecting',
    });
    renderIndicator();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('shows "Live" when connected', () => {
    vi.mocked(useAlarmRealtime).mockReturnValue({
      events: [],
      clearEvents: vi.fn(),
      connectionState: 'connected',
    });
    renderIndicator();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });
});
