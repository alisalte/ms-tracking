import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import type { FleetAlert, FleetStats, MapVehicle } from '@/types/fleet.types';

import { i18n } from '@/i18n';

// ── REAL Sprint E shapes (fleet.types.ts) — no deltas/sparklines to fake. ────
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
    occurredAt: '2026-08-07T14:31:00Z',
  },
  {
    id: 'a2',
    type: 'geofence',
    severity: 'warning',
    vehicleLabel: 'Truck-19',
    detail: 'Exited Depot-N',
    occurredAt: '2026-08-07T13:52:00Z',
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
  },
  {
    id: 'mv2',
    label: 'VAN-101',
    state: 'offline',
    lat: 35.71,
    lng: 51.33,
    heading: 0,
    speed: 0,
    deviceId: 'dev-2',
    presence: 'OFFLINE',
    lastSeenAt: '2026-08-07T08:00:00Z',
  },
];

// ── Mock the API layer: the grid is a pure consumer of these hooks. ─────────
const mockUseFleetStats = vi.fn();
const mockUseActiveAlarms = vi.fn();
const mockUseMapVehicles = vi.fn();
vi.mock('@/api/fleet.api', () => ({
  useFleetStats: () => mockUseFleetStats(),
  useActiveAlarms: () => mockUseActiveAlarms(),
  useMapVehicles: () => mockUseMapVehicles(),
}));

// maplibre-gl needs WebGL which jsdom cannot provide — stub it out so the
// FleetMapPreview widget mounts without crashing.
vi.mock('maplibre-gl', () => {
  return {
    Map: class {
      on() {}
      once() {}
      loaded() {
        return true;
      }
      addControl() {}
      remove() {}
      getCanvas() {
        return document.createElement('canvas');
      }
    },
    Marker: class {
      setLngLat() {
        return this;
      }
      setPopup() {
        return this;
      }
      addTo() {
        return this;
      }
      remove() {}
    },
    Popup: class {
      setHTML() {
        return this;
      }
    },
  };
});

// echarts renders to canvas — stub the widget so jsdom doesn't choke.
vi.mock('@/components/dashboard/EChart', () => ({
  EChart: () => createElement('div', { 'data-testid': 'echart-stub' }),
}));

/**
 * Build a fresh QueryClient per test so caches don't leak between cases.
 * `retry: false` so a rejected query never muddies the assertions.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

/** Render the grid wrapped in the providers it needs (router + i18n + query). */
function renderDashboard() {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          MemoryRouter,
          { initialEntries: ['/dashboard'] },
          createElement(DashboardGrid),
        ),
      ),
    ),
  );
}

describe('DashboardGrid', () => {
  beforeEach(async () => {
    // Ensure a deterministic language for the assertions.
    await i18n.changeLanguage('en');
    mockUseFleetStats.mockReturnValue({ data: statsFixture, isLoading: false });
    mockUseActiveAlarms.mockReturnValue({
      data: alertsFixture,
      isLoading: false,
      isError: false,
    });
    mockUseMapVehicles.mockReturnValue({ data: mapVehiclesFixture, isLoading: false });
  });

  it('renders the header (title, subtitle, live badge, export)', async () => {
    renderDashboard();

    expect(await screen.findByText('Fleet Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Live operational overview')).toBeInTheDocument();
    // "Live" appears on the header badge and on the real-time widgets.
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('renders the §21 stat-card values (real FleetStats shape) + registry extras', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('312')).toBeInTheDocument(); // totalVehicles
      expect(screen.getByText('184')).toBeInTheDocument(); // online
      expect(screen.getByText('87')).toBeInTheDocument(); // offline
      expect(screen.getByText('23')).toBeInTheDocument(); // stale
      expect(screen.getByText('18')).toBeInTheDocument(); // unknown
    });
    // Secondary registry cards from the same /summary payload.
    expect(screen.getByText('Total Vehicles')).toBeInTheDocument();
    expect(screen.getAllByText('Online').length).toBeGreaterThan(0); // stat card + map legend
    expect(screen.getAllByText('Stale').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getByText('Fleets')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument(); // totalFleets
    expect(screen.getByText('Devices')).toBeInTheDocument();
    expect(screen.getByText('298')).toBeInTheDocument(); // totalDevices
  });

  it('renders the remaining widget titles (activity/utilization/weather removed)', async () => {
    renderDashboard();
    const titles = ['Active Alerts', 'Alert Types', 'Fleet Map'];
    for (const title of titles) {
      await waitFor(() => {
        expect(screen.getAllByText(title).length).toBeGreaterThan(0);
      });
    }
    // Backend-less widgets were removed — their titles must NOT render.
    expect(screen.queryByText('Fleet Activity (24h)')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet Utilization')).not.toBeInTheDocument();
    expect(screen.queryByText('Weather')).not.toBeInTheDocument();
    expect(screen.queryByText('Vehicles Needing Attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Top Vehicles by Distance')).not.toBeInTheDocument();
  });

  it('renders alert rows from the real active-alarms feed', async () => {
    renderDashboard();
    await waitFor(() => {
      // Rows render "type · vehicleLabel" — match the vehicle within the row.
      expect(screen.getByText(/Truck-42/)).toBeInTheDocument();
      expect(screen.getByText(/Truck-19/)).toBeInTheDocument();
    });
  });

  it('shows the map-preview presence legend (§18)', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Active Alerts')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Stale').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Online').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);
  });

  it('shows stat skeletons while the stats query loads', () => {
    mockUseFleetStats.mockReturnValue({ data: undefined, isLoading: true });
    renderDashboard();
    expect(mockUseFleetStats).toHaveBeenCalled();
    // No values rendered while loading.
    expect(screen.queryByText('312')).not.toBeInTheDocument();
  });

  it('shows an error state with retry when the stats query fails', async () => {
    mockUseFleetStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('summary unreachable'),
      refetch: vi.fn(),
    });
    renderDashboard();
    expect(await screen.findByText('Retry')).toBeInTheDocument();
    expect(screen.queryByText('312')).not.toBeInTheDocument();
  });

  it('shows an honest error state when the alarm service is unreachable (§22)', async () => {
    mockUseActiveAlarms.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('notification-service unreachable'),
      refetch: vi.fn(),
    });
    renderDashboard();
    // Both alert widgets fall back to the error state — no fabricated rows.
    expect((await screen.findAllByText('Retry')).length).toBe(2);
    expect(screen.queryByText(/Truck-42/)).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no active alarms', async () => {
    mockUseActiveAlarms.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText('No active alerts — fleet is quiet.').length).toBe(2);
    });
  });
});
