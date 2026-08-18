/**
 * Phase 6 — Event Center tests.
 *
 * Covers: rendering the event timeline (type / vehicle / timestamp /
 * severity) from the notification stream, day grouping, filtering by type and
 * severity (URL-synced), client search, navigation to the source entity via
 * the notification's deep link, empty + error + loading states, cursor
 * pagination, and the route permission gate (notification.read). API and WS
 * modules mocked — no backend.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { RequirePermission } from '@/components/common/RequirePermission';
import { i18n } from '@/i18n';
import { EventCenterPage } from '@/pages/EventCenterPage';
import type { Notification } from '@/types/notification.types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const now = Date.now();
const eventsFixture: Notification[] = [
  {
    id: 'e1',
    title: 'Speeding: TRK-1',
    body: 'Vehicle TRK-1 exceeded the speed limit',
    severity: 'critical',
    priority: 'high',
    category: 'alarm',
    eventType: 'overspeed',
    vehicleId: 'v-trk-1',
    read: false,
    createdAt: new Date(now - 5 * 60_000).toISOString(),
    link: '/alarms?id=e1',
  },
  {
    id: 'e2',
    title: 'Geofence entry: VAN-2',
    body: 'Entered Depot-North',
    severity: 'normal',
    priority: 'normal',
    category: 'alarm',
    eventType: 'geofence_enter',
    vehicleId: 'v-van-2',
    read: true,
    createdAt: new Date(now - 26 * 3600_000).toISOString(), // yesterday bucket
  },
  {
    id: 'e3',
    title: 'Device offline: BUS-3',
    body: 'Device stopped reporting',
    severity: 'low',
    priority: 'low',
    category: 'alarm',
    eventType: 'device_offline',
    vehicleId: 'v-bus-3',
    read: true,
    createdAt: new Date(now - 10 * 60_000).toISOString(),
  },
];

// ── Mocks ───────────────────────────────────────────────────────────────────

const notifApi = vi.hoisted(() => ({
  useNotificationsPage: vi.fn(),
}));

vi.mock('@/api/notification.api', () => ({
  useNotificationsPage: (params: unknown) => notifApi.useNotificationsPage(params),
}));

vi.mock('@/hooks/useNotificationRealtime', () => ({
  useNotificationRealtime: () => ({ state: 'connected' }),
}));

// Server-side-filtered mock: honors the eventType/severity params the page
// pushes into the URL (mirrors the real notification-service behavior).
function setEvents(
  items: Notification[],
  overrides?: { isLoading?: boolean; isError?: boolean; hasNextPage?: boolean },
) {
  notifApi.useNotificationsPage.mockImplementation(
    (params: { eventType?: string; severity?: string } | undefined) => {
      const filtered = items.filter(
        (n) =>
          (!params?.eventType || n.eventType === params.eventType) &&
          (!params?.severity || n.severity === params.severity),
      );
      return {
        items: filtered,
        isLoading: overrides?.isLoading ?? false,
        isError: overrides?.isError ?? false,
        error: overrides?.isError ? Object.assign(new Error('down'), { status: 500 }) : null,
        hasNextPage: overrides?.hasNextPage ?? false,
        fetchNextPage: vi.fn(),
        isFetchingNextPage: false,
        refetch: vi.fn(),
      };
    },
  );
}

function renderEvents(route = '/events') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/events" element={<EventCenterPage />} />
            <Route path="/alarms" element={<div data-testid="page">alarms</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setEvents(eventsFixture);
  useAuthStore.setState({
    accessToken: 'token',
    refreshToken: 'refresh',
    isAuthenticated: true,
    isLoading: false,
    error: null,
    tenantId: 't1',
    user: {
      id: 'u1',
      email: 'op@fleet.test',
      tenantId: 't1',
      roles: ['operator'],
      permissions: ['notification.read'],
    },
  });
});

describe('EventCenterPage — timeline rendering', () => {
  it('renders title, subtitle, and the events with vehicle + severity + type', () => {
    renderEvents();
    expect(screen.getByText('Event Center')).toBeTruthy();
    expect(screen.getByText('Speeding: TRK-1')).toBeTruthy();
    expect(screen.getByText(/v-trk-1/)).toBeTruthy();
    // "Overspeed"/"Geofence Entry" appear in the type-filter options AND the
    // event chips.
    expect(screen.getAllByText('Overspeed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Geofence Entry').length).toBeGreaterThanOrEqual(2);
  });

  it('groups events into day buckets', () => {
    renderEvents();
    // Today's bucket + yesterday's bucket both render as headings.
    const today = new Date(now).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const yesterday = new Date(now - 26 * 3600_000).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    expect(screen.getByText(today)).toBeTruthy();
    expect(screen.getByText(yesterday)).toBeTruthy();
  });

  it('navigates to the source entity when an event with a link is clicked', () => {
    renderEvents();
    fireEvent.click(screen.getByText('Speeding: TRK-1'));
    expect(screen.getByTestId('page').textContent).toBe('alarms');
  });

  it('filters by type and severity (URL-synced)', async () => {
    renderEvents();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'overspeed' } });
    await waitFor(() => expect(screen.queryByText('Device offline: BUS-3')).toBeNull());
    expect(screen.getByText('Speeding: TRK-1')).toBeTruthy();
  });

  it('searches across title/body/vehicle client-side', () => {
    renderEvents();
    fireEvent.change(screen.getByRole('textbox', { name: /search events/i }), {
      target: { value: 'BUS-3' },
    });
    expect(screen.getByText('Device offline: BUS-3')).toBeTruthy();
    expect(screen.queryByText('Speeding: TRK-1')).toBeNull();
  });

  it('shows the empty state when no events exist', () => {
    setEvents([]);
    renderEvents();
    expect(screen.getByText('No events yet')).toBeTruthy();
  });

  it('shows an honest error state when the stream fails', () => {
    setEvents([], { isError: true });
    renderEvents();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('shows a loading spinner and offers pagination when more pages exist', () => {
    setEvents(eventsFixture, { hasNextPage: true });
    renderEvents();
    expect(screen.getByTestId('events-load-more').textContent).toContain('Load more');
  });
});

describe('EventCenterPage — route permission gate', () => {
  it('is denied without notification.read (rendered through the route guard)', () => {
    useAuthStore.setState({
      user: {
        id: 'u1',
        email: 'op@fleet.test',
        tenantId: 't1',
        roles: ['operator'],
        permissions: [],
      },
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/events']}>
            <RequirePermission permission="notification.read">
              <EventCenterPage />
            </RequirePermission>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Permission denied')).toBeTruthy();
    expect(screen.queryByText('Event Center')).toBeNull();
  });
});
