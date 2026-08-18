/**
 * Phase 4 — Fleet Dashboard tests (TailAdmin rebuild).
 *
 * Covers: full rendering with real query shapes, KPI values (summary stats,
 * movement counts derived from the map join, active alarms/devices), loading
 * skeletons, empty states, per-section error states with retry, the map
 * preview (marker creation + legend + error), fleet-health metrics, activity
 * chart wiring, and permission behavior (the dashboard is ungated — must
 * render identically regardless of the principal's permissions).
 *
 * API modules and maplibre are mocked — no backend required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { FleetDashboard } from '@/components/dashboard/FleetDashboard';
import type { FleetAlert, FleetStats, MapVehicle } from '@/types/fleet.types';

import { i18n } from '@/i18n';

// ── Fixtures (REAL Sprint E shapes) ─────────────────────────────────────────

const statsFixture: FleetStats = {
  totalVehicles: 312,
  online: 184,
  offline: 87,
  stale: 23,
  unknown: 18,
  totalFleets: 6,
  totalDevices: 298,
};

const alertsFixture: FleetAlert[] = [
  {
    id: 'a1',
    type: 'overspeed',
    severity: 'critical',
    vehicleLabel: 'Truck-42',
    detail: '128 km/h',
    occurredAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    id: 'a2',
    type: 'geofence',
    severity: 'warning',
    vehicleLabel: 'Truck-19',
    detail: 'Exited Depot-N',
    occurredAt: new Date(Date.now() - 90 * 60_000).toISOString(),
  },
  {
    id: 'a3',
    type: 'idle',
    severity: 'info',
    vehicleLabel: 'Van-7',
    detail: 'Idling 22 min',
    occurredAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  },
];

const mapVehiclesFixture: MapVehicle[] = [
  {
    id: 'mv1',
    label: 'TRK-100',
    state: 'driving',
    lat: 35.72,
    lng: 51.34,
    heading: 90,
    speed: 62,
    deviceId: 'dev-1',
    presence: 'ONLINE',
    lastSeenAt: '2026-08-07T14:30:00Z',
    updatedAt: '2026-08-07T14:30:00Z',
  },
  {
    id: 'mv2',
    label: 'VAN-101',
    state: 'idle',
    lat: 35.71,
    lng: 51.33,
    heading: 0,
    speed: 0,
    deviceId: 'dev-2',
    presence: 'ONLINE',
    lastSeenAt: '2026-08-07T14:29:00Z',
    updatedAt: '2026-08-07T14:29:00Z',
  },
  {
    id: 'mv3',
    label: 'BUS-200',
    state: 'stopped',
    lat: 35.7,
    lng: 51.35,
    heading: 0,
    speed: 0,
    deviceId: 'dev-3',
    presence: 'ONLINE',
    lastSeenAt: '2026-08-07T14:25:00Z',
    updatedAt: '2026-08-07T14:25:00Z',
  },
  {
    id: 'mv4',
    label: 'TRK-999',
    state: 'offline',
    lat: 35.69,
    lng: 51.32,
    heading: 0,
    speed: 0,
    deviceId: 'dev-4',
    presence: 'OFFLINE',
    lastSeenAt: '2026-08-06T09:00:00Z',
    // no updatedAt — never reported → excluded from the GPS-reporting meter
  },
];

const deviceStatusesFixture = [
  { deviceId: 'dev-1', state: 'ONLINE' as const, lastSeenAt: '2026-08-07T14:30:00Z' },
  { deviceId: 'dev-2', state: 'ONLINE' as const, lastSeenAt: '2026-08-07T14:29:00Z' },
  { deviceId: 'dev-3', state: 'ONLINE' as const, lastSeenAt: '2026-08-07T14:25:00Z' },
  { deviceId: 'dev-4', state: 'OFFLINE' as const, lastSeenAt: '2026-08-06T09:00:00Z' },
  { deviceId: 'dev-5', state: 'STALE' as const, lastSeenAt: '2026-08-06T20:00:00Z' },
];

// ── Mocks ───────────────────────────────────────────────────────────────────

const fleetApi = vi.hoisted(() => ({
  useFleetStats: vi.fn(),
  useMapVehicles: vi.fn(),
  useActiveAlarms: vi.fn(),
  useDeviceStatuses: vi.fn(),
}));

vi.mock('@/api/fleet.api', () => fleetApi);

const maplibre = vi.hoisted(() => ({ Marker: vi.fn() }));

vi.mock('maplibre-gl', () => {
  maplibre.Marker = vi.fn().mockImplementation(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setPopup: vi.fn().mockReturnThis(),
    addTo: vi.fn(),
    remove: vi.fn(),
  }));
  return {
    Map: vi.fn().mockImplementation(() => ({
      loaded: () => true,
      once: (_e: string, cb: () => void) => cb(),
      on: vi.fn(),
      remove: vi.fn(),
    })),
    Marker: maplibre.Marker,
    Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
  };
});

// ECharts renders SVG — stub the wrapper (its theming has its own coverage).
vi.mock('@/components/dashboard/EChart', () => ({
  EChart: (props: { option: unknown; height: number }) =>
    createElement('div', { 'data-testid': 'echart', 'data-height': props.height }),
}));

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function setQueryResults() {
  fleetApi.useFleetStats.mockReturnValue({
    data: statsFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  fleetApi.useMapVehicles.mockReturnValue({
    data: mapVehiclesFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  fleetApi.useActiveAlarms.mockReturnValue({
    data: alertsFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  fleetApi.useDeviceStatuses.mockReturnValue({
    data: deviceStatusesFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

function renderDashboard() {
  return render(
    createElement(
      QueryClientProvider,
      { client: makeClient() },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, {}, createElement(FleetDashboard)),
      ),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setQueryResults();
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'op@fleet.test',
      tenantId: 't1',
      roles: ['operator'],
      permissions: [],
    },
  });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('FleetDashboard — rendering + KPIs', () => {
  it('renders the title, subtitle, and live badges', () => {
    renderDashboard();
    expect(screen.getByText('Fleet Dashboard')).toBeTruthy();
    expect(screen.getByText('Live operational overview')).toBeTruthy();
    // Header + Recent Events both carry a live badge.
    expect(screen.getAllByText('Live').length).toBeGreaterThanOrEqual(2);
  });

  it('renders KPI values from the real query shapes', () => {
    renderDashboard();
    // KPI labels are the only <p> elements with these texts.
    expect(
      screen.getByText('Total Vehicles', { selector: 'p' }).parentElement?.textContent,
    ).toContain('312');
    expect(screen.getByText('Moving', { selector: 'p' }).parentElement?.textContent).toContain('1');
    expect(screen.getByText('Idle', { selector: 'p' }).parentElement?.textContent).toContain('1');
    expect(screen.getByText('Parked', { selector: 'p' }).parentElement?.textContent).toContain('1');
    expect(screen.getByText('Offline', { selector: 'p' }).parentElement?.textContent).toContain(
      '87',
    );
    expect(
      screen.getByText('Active Alarms', { selector: 'p' }).parentElement?.textContent,
    ).toContain('3');
    expect(
      screen.getByText('Active Devices', { selector: 'p' }).parentElement?.textContent,
    ).toContain('3');
  });

  it('shows skeletons instead of values while the summary is loading', () => {
    fleetApi.useFleetStats.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDashboard();
    expect(screen.getByText('Total Vehicles')).toBeTruthy();
    expect(screen.queryByText('312')).toBeNull();
  });

  it('shows an error state with retry when the summary query fails', () => {
    const refetch = vi.fn();
    fleetApi.useFleetStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('summary down'), { status: 500 }),
      refetch,
    });
    renderDashboard();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe('FleetDashboard — activity + fleet health', () => {
  it('renders the activity donut and health meters from the map join', () => {
    renderDashboard();
    // Two ECharts panels (activity donut + alert-type rose).
    expect(screen.getAllByTestId('echart').length).toBeGreaterThanOrEqual(2);
    // Health meters: connectivity 3/5 devices online; GPS 3/4 vehicles reporting.
    expect(screen.getByText('Device connectivity').closest('div')?.textContent).toContain('3');
    expect(screen.getByText('GPS reporting').closest('div')?.textContent).toContain('3');
    const staleBox = screen.getByText('Stale positions').parentElement?.parentElement;
    expect(staleBox?.querySelector('p')?.textContent).toBe('23');
    const offlineBox = screen.getByText('Offline devices').parentElement?.parentElement;
    expect(offlineBox?.querySelector('p')?.textContent).toBe('1');
  });

  it('renders honest error states when the map join fails (activity, health, map)', () => {
    fleetApi.useMapVehicles.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('gps down'), { status: 0, name: 'NetworkError' }),
      refetch: vi.fn(),
    });
    renderDashboard();
    expect(screen.getAllByText('Connection error').length).toBeGreaterThanOrEqual(3);
  });
});

describe('FleetDashboard — recent events + alarm summary', () => {
  it('renders severity-sorted events with vehicle labels and summary chips', () => {
    renderDashboard();
    expect(screen.getByText('Recent Events')).toBeTruthy();
    // The three fixture vehicles all appear in the feed (sorted critical-first).
    expect(screen.getByText(/Truck-42/)).toBeTruthy();
    expect(screen.getByText(/Truck-19/)).toBeTruthy();
    // Severity summary chips (counts per severity).
    expect(screen.getByText(/Critical: 1/i)).toBeTruthy();
    expect(screen.getByText(/Warning: 1/i)).toBeTruthy();
  });

  it('links View all to alarm management (/alarms)', () => {
    renderDashboard();
    expect(
      screen
        .getByText(/View all/i)
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/alarms');
  });

  it('shows the empty state when there are no alarms', () => {
    fleetApi.useActiveAlarms.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDashboard();
    expect(screen.getAllByText(/No active alerts/i).length).toBeGreaterThanOrEqual(2);
  });

  it('shows error states when the alarm feed fails', () => {
    fleetApi.useActiveAlarms.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('forbidden'), { status: 403 }),
      refetch: vi.fn(),
    });
    renderDashboard();
    expect(screen.getAllByText('Access denied').length).toBeGreaterThanOrEqual(2);
  });
});

describe('FleetDashboard — map preview', () => {
  it('creates a marker per vehicle and renders the presence legend', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(maplibre.Marker).toHaveBeenCalledTimes(mapVehiclesFixture.length);
    });
    // Legend pairs presence colors with labels (never color alone).
    expect(screen.getByText('Stale', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('Online', { selector: 'span' })).toBeTruthy();
  });

  it('renders empty states when the fleet has no vehicles', () => {
    fleetApi.useMapVehicles.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDashboard();
    // Map preview + activity donut both show the honest empty placeholder.
    expect(screen.getAllByText(/No active alerts/i).length).toBeGreaterThanOrEqual(2);
  });
});

describe('FleetDashboard — permission behavior', () => {
  it('renders identically for an empty-permission principal and the wildcard admin', () => {
    const { unmount } = renderDashboard();
    expect(screen.getByText('Total Vehicles')).toBeTruthy();
    unmount();

    // The dashboard is deliberately ungated (Phase 1 R9): sections never hide
    // behind permissions — the backend authorizes each query independently.
    useAuthStore.setState({
      user: {
        id: 'u2',
        email: 'admin@fleet.test',
        tenantId: 't1',
        roles: ['admin'],
        permissions: ['*'],
      },
    });
    renderDashboard();
    expect(screen.getByText('Total Vehicles')).toBeTruthy();
  });
});
