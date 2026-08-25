/**
 * Phase 4 — Fleet Dashboard tests (TailAdmin rebuild).
 *
 * Covers: full rendering with real query shapes, KPI values (summary stats,
 * movement counts derived from the map join, active alarms/devices), loading
 * skeletons, empty states, per-section error states with retry, the map
 * preview (marker creation + legend + error), fleet-health metrics, activity
 * chart wiring, the report.read-gated reporting widgets (period KPIs, trend
 * charts, distance leaderboard, alarm lifecycle), and the always-mounted map
 * preview (empty fleet → chip overlay, never a body replacement).
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

/**
 * KpiTile v3: the label <p> and the value live in separate rows of the SAME
 * card — walk up to the card element (rounded-2xl) for text assertions.
 */
function tileCardText(labelEl: HTMLElement): string {
  const card = labelEl.closest('.rounded-2xl');
  return (card ?? labelEl.parentElement)?.textContent ?? '';
}

vi.mock('@/api/fleet.api', () => fleetApi);

// ── Reporting fixtures (reporting-service wire shapes, Sprint J) ────────────
const overviewFixture = {
  totalVehicles: 4,
  vehiclesWithTelemetry: 3,
  noTelemetryVehicles: 1,
  movingVehicles: 1,
  idleVehicles: 1,
  parkedVehicles: 1,
  totalDistanceKm: 2450.7,
  totalTrips: 82,
  totalAlarms: 12,
  openAlarms: 5,
  geofenceEvents: 9,
  avgUtilizationPct: 62.4,
  movingDurationSec: 48_000,
  idleDurationSec: 12_600,
  parkingDurationSec: 86_400,
  avgSpeedKmh: 52.3,
  maxSpeedKmh: 118,
  speedingEventCount: 4,
  discardedTrips: 2,
  from: '2026-08-17T00:00:00Z',
  to: '2026-08-23T00:00:00Z',
  dataAsOf: '2026-08-23T10:00:00Z',
  freshness: 'AGGREGATED' as const,
};

const trendFixture = {
  points: [
    {
      day: '2026-08-22',
      distanceKm: 120.5,
      trips: 9,
      alarms: 3,
      alarmSpeeding: 2,
      alarmGeofence: 1,
      alarmOffline: 0,
      alarmOther: 0,
    },
    {
      day: '2026-08-23',
      distanceKm: 98.2,
      trips: 7,
      alarms: 1,
      alarmSpeeding: 0,
      alarmGeofence: 0,
      alarmOffline: 1,
      alarmOther: 0,
    },
  ],
  from: '2026-08-17T00:00:00Z',
  to: '2026-08-23T00:00:00Z',
  dataAsOf: '2026-08-23T10:00:00Z',
  freshness: 'AGGREGATED' as const,
};

const distanceFixture = {
  items: [
    {
      vehicleId: 'mv1',
      label: 'TRK-100',
      distanceKm: 980.4,
      trips: 30,
      avgTripKm: 32.7,
      maxTripKm: 95.1,
      discardedTrips: 0,
    },
    {
      vehicleId: 'mv2',
      label: 'VAN-101',
      distanceKm: 640.1,
      trips: 22,
      avgTripKm: 29.1,
      maxTripKm: 61.0,
      discardedTrips: 1,
    },
    {
      vehicleId: 'mv3',
      label: 'BUS-200',
      distanceKm: 830.2,
      trips: 30,
      avgTripKm: 27.7,
      maxTripKm: 88.3,
      discardedTrips: 0,
    },
  ],
  total: 3,
};

const alarmReportFixture = {
  items: [],
  total: 12,
  summary: {
    total: 12,
    open: 5,
    acknowledged: 2,
    resolved: 5,
    critical: 2,
    high: 3,
    medium: 4,
    low: 2,
    info: 1,
  },
};

const reportApi = vi.hoisted(() => ({
  useFleetOverview: vi.fn(),
  useTrend: vi.fn(),
  useDistance: vi.fn(),
  useAlarmReport: vi.fn(),
  useSpeed: vi.fn(),
  useTrips: vi.fn(),
}));

vi.mock('@/api/report.api', () => reportApi);

const assetApi = vi.hoisted(() => ({
  useFleets: vi.fn(),
  useVehicles: vi.fn(),
}));

vi.mock('@/api/asset.api', () => assetApi);

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
      addControl: vi.fn(),
      getLayer: () => undefined,
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      remove: vi.fn(),
    })),
    Marker: maplibre.Marker,
    NavigationControl: class {},
    Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
  };
});

// ApexCharts mounts a canvas — stub the wrapper (theming covered separately).
vi.mock('@/components/dashboard/ApexChart', () => ({
  ApexChart: (props: { height: number }) =>
    createElement('div', { 'data-testid': 'apex-chart', 'data-height': props.height }),
}));

// Legacy ECharts stub kept for Reports / SpeedGraph consumers outside the dashboard.
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
  reportApi.useFleetOverview.mockReturnValue({
    data: overviewFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  reportApi.useTrend.mockReturnValue({
    data: trendFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  reportApi.useDistance.mockReturnValue({
    data: distanceFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  reportApi.useAlarmReport.mockReturnValue({
    data: alarmReportFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  reportApi.useSpeed.mockReturnValue({
    data: { items: [], total: 0 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  reportApi.useTrips.mockReturnValue({
    data: { items: [], nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  assetApi.useFleets.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  assetApi.useVehicles.mockReturnValue({
    data: [],
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
    expect(tileCardText(screen.getByText('Total Vehicles', { selector: 'p' }))).toContain('312');
    expect(tileCardText(screen.getByText('Moving', { selector: 'p' }))).toContain('1');
    expect(tileCardText(screen.getByText('Idle', { selector: 'p' }))).toContain('1');
    expect(tileCardText(screen.getByText('Parked', { selector: 'p' }))).toContain('1');
    expect(tileCardText(screen.getByText('Offline', { selector: 'p' }))).toContain('87');
    expect(tileCardText(screen.getByText('Active Alarms', { selector: 'p' }))).toContain('3');
    expect(tileCardText(screen.getByText('Active Devices', { selector: 'p' }))).toContain('3');
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
    expect(screen.getAllByTestId('apex-chart').length).toBeGreaterThanOrEqual(2);
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
    // Activity + health panels surface the honest error state…
    expect(screen.getAllByText('Connection error').length).toBeGreaterThanOrEqual(2);
    // …and the preview map — deliberately kept mounted — overlays its own
    // retry affordance instead of being replaced by an error body.
    expect(screen.getByTestId('map-preview-error')).toBeTruthy();
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

  it('keeps the map preview mounted with an empty chip when the fleet has no vehicles', () => {
    fleetApi.useMapVehicles.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDashboard();
    // Activity donut keeps its honest empty placeholder…
    expect(screen.getAllByText(/No active alerts/i).length).toBeGreaterThanOrEqual(1);
    // …while the preview map stays MOUNTED with a light chip overlay
    // (never replaced by a body-level empty state).
    expect(screen.getByTestId('map-preview-empty')).toBeTruthy();
    expect(screen.getByText('No vehicles yet')).toBeTruthy();
  });
});

describe('FleetDashboard — report widgets (report.read)', () => {
  it('hides the reporting widgets for principals without report.read', () => {
    renderDashboard();
    expect(screen.queryByText('Distance & trips trend')).toBeNull();
    expect(screen.queryByText('Daily alarms by type')).toBeNull();
    expect(screen.queryByText('Top vehicles by distance')).toBeNull();
    expect(screen.queryByText('Alarm status & severity')).toBeNull();
    // The ungated live dashboard is unaffected.
    expect(screen.getByText('Total Vehicles')).toBeTruthy();
  });

  it('renders period KPIs, trends, leaderboard and alarm lifecycle for holders', () => {
    useAuthStore.setState({
      user: {
        id: 'u3',
        email: 'analyst@fleet.test',
        tenantId: 't1',
        roles: ['analyst'],
        permissions: ['report.read'],
      },
    });
    renderDashboard();

    // Period KPI tiles (7-day aggregates from the reporting service).
    expect(tileCardText(screen.getByText('Distance (last 7 days)', { selector: 'p' }))).toContain(
      '2,451',
    );
    expect(tileCardText(screen.getByText('Trips (last 7 days)', { selector: 'p' }))).toContain(
      '82',
    );
    expect(tileCardText(screen.getByText('Avg utilization', { selector: 'p' }))).toContain('62%');
    expect(tileCardText(screen.getByText('Geofence events', { selector: 'p' }))).toContain('9');

    // Chart cards: two trend cards, leaderboard, alarm lifecycle.
    expect(screen.getByText('Distance & trips trend')).toBeTruthy();
    expect(screen.getByText('Daily alarms by type')).toBeTruthy();
    expect(screen.getByText('Top vehicles by distance')).toBeTruthy();
    expect(screen.getByText('Alarm status & severity')).toBeTruthy();
    // ApexChart stubs: activity + duration + alert-type + 2 trends + leaderboard + lifecycle (+ more).
    expect(screen.getAllByTestId('apex-chart').length).toBeGreaterThanOrEqual(6);
  });
});

describe('FleetDashboard — permission behavior', () => {
  it('renders the live dashboard for an empty-permission principal and the wildcard admin', () => {
    const { unmount } = renderDashboard();
    expect(screen.getByText('Total Vehicles')).toBeTruthy();
    unmount();

    // The LIVE sections stay ungated (Phase 1 R9): they never hide behind
    // permissions — the backend authorizes each query independently. The
    // reporting widgets are the one exception: gated on report.read (see the
    // dedicated describe above), which the wildcard satisfies.
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
    expect(screen.getByText('Distance & trips trend')).toBeTruthy();
  });
});
