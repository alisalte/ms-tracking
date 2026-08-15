/**
 * Sprint F frontend map tests (§28-13/14/15/16/17): LIVE/HISTORY mode,
 * history-track rendering, route-planner rendering + provider failure.
 *
 * Reuses the maplibre/supercluster stub pattern from map.spec.tsx; the API
 * layer (@/api/map.api + @/api/fleet.api + @/api/asset.api) is mocked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { MapPage } from '@/pages/MapPage';

// ── API mocks ────────────────────────────────────────────────────────────────

const trackPoints = [
  {
    vehicleId: 'v1',
    latitude: 35.7,
    longitude: 51.4,
    speedKph: 30,
    headingDeg: 90,
    capturedAt: '2026-08-15T08:00:00Z',
  },
  {
    vehicleId: 'v1',
    latitude: 35.71,
    longitude: 51.41,
    speedKph: 32,
    headingDeg: 90,
    capturedAt: '2026-08-15T08:01:00Z',
  },
  {
    vehicleId: 'v1',
    latitude: 35.9,
    longitude: 51.6,
    speedKph: 30,
    headingDeg: 90,
    capturedAt: '2026-08-15T08:40:00Z',
  },
];

const useVehicleTrack = vi.fn();
const fetchRoute = vi.fn();
const fetchGeocode = vi.fn();

vi.mock('@/api/map.api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/api/map.api')>();
  return {
    ...orig,
    useVehicleTrack: (...a: unknown[]) => useVehicleTrack(...(a as never[])),
    fetchRoute: (...a: unknown[]) => fetchRoute(...a),
    fetchGeocode: (...a: unknown[]) => fetchGeocode(...(a as never[])),
  };
});

vi.mock('@/api/fleet.api', () => ({
  useMapVehicles: () => ({
    data: [
      {
        id: 'v1',
        label: 'Truck-1',
        state: 'driving',
        lat: 35.7,
        lng: 51.4,
        heading: 90,
        speed: 40,
        updatedAt: '2026-08-15T08:00:00Z',
        deviceId: 'd1',
        presence: 'ONLINE',
      },
    ],
    isLoading: false,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
  useVehicleDetail: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/api/asset.api', () => ({
  useFleets: () => ({ data: [] }),
  useVehicles: () => ({ data: [] }),
}));

vi.mock('@/hooks/useLiveTracking', () => ({
  useLiveTracking: () => ({
    positions: new Map(),
    statuses: new Map(),
    connectionState: 'connected',
  }),
  mergeLivePositions: (v: unknown[]) => v,
}));

// ── maplibre stub (records track source/layer registration) ─────────────────

const addedSources: string[] = [];
const addedLayers: string[] = [];

vi.mock('maplibre-gl', () => {
  const StubMap = class {
    on() {}
    off() {}
    once(_ev: string, cb: (...a: never[]) => void) {
      cb();
    }
    loaded() {
      return true;
    }
    getZoom() {
      return 18;
    }
    getBounds() {
      return { getWest: () => 50, getSouth: () => 34, getEast: () => 52, getNorth: () => 37 };
    }
    flyTo() {}
    fitBounds() {}
    remove() {}
    getSource() {
      return null;
    }
    addSource(_id: string) {
      addedSources.push(_id);
    }
    addLayer(l: { id: string }) {
      addedLayers.push(l.id);
    }
    getCanvas() {
      return document.createElement('canvas');
    }
  };
  const StubMarker = class {
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
  };
  const StubPopup = class {
    setHTML() {
      return this;
    }
  };
  return {
    Map: StubMap,
    Marker: StubMarker,
    Popup: StubPopup,
    LngLatBounds: class {
      extend() {
        return this;
      }
    },
  };
});

vi.mock('@/lib/map-cluster', () => ({
  cluster: (vehicles: Array<{ id: string; lat: number; lng: number }>) =>
    vehicles.map((v) => ({ kind: 'point', vehicle: v, lng: v.lng, lat: v.lat })),
  expandZoom: () => 15,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, null, createElement(MapPage)),
      ),
    ),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  addedSources.length = 0;
  addedLayers.length = 0;
  await i18n.changeLanguage('en');
  useVehicleTrack.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: () => {},
  });
});

describe('MapPage LIVE/HISTORY modes (Sprint F §20)', () => {
  it('starts in LIVE mode with the live badge path (no track fetch)', () => {
    renderPage();
    expect(useVehicleTrack.mock.calls[0]?.[3]).toBe(false); // enabled=false
  });

  it('history mode without a selection prompts to select a vehicle', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'History mode' }));
    expect(await screen.findByText('Select a vehicle to load its track')).toBeInTheDocument();
    // The re-render in history mode re-invokes the hook with enabled=true.
    const lastCall = useVehicleTrack.mock.calls[useVehicleTrack.mock.calls.length - 1];
    expect(lastCall?.[3]).toBe(true);
  });

  it('fetches the track for the selected vehicle and renders the polyline (gap-split)', async () => {
    useVehicleTrack.mockReturnValue({
      data: trackPoints,
      isLoading: false,
      isError: false,
      refetch: () => {},
    });
    renderPage();
    // Enter history mode FIRST, then select the vehicle (the drawer modal
    // overlays the toolbar, so the order matters for interaction).
    fireEvent.click(screen.getByRole('button', { name: 'History mode' }));
    fireEvent.click(screen.getByText('Truck-1'));

    await waitFor(() => {
      expect(addedSources).toContain('history-track');
      expect(addedLayers).toContain('history-track-line');
    });
    // 3 points with a >10min gap → 2 segments rendered.
    expect(screen.getByText('3 points')).toBeInTheDocument();
  });

  it('shows an honest error chip when the track query fails (no fake data)', async () => {
    useVehicleTrack.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: () => {},
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'History mode' }));
    fireEvent.click(screen.getByText('Truck-1'));
    expect(await screen.findByText('Track failed — click to retry')).toBeInTheDocument();
  });

  it('shows the loading chip while the track loads', async () => {
    useVehicleTrack.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: () => {},
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'History mode' }));
    fireEvent.click(screen.getByText('Truck-1'));
    expect(await screen.findByText('Loading track…')).toBeInTheDocument();
  });
});

describe('RoutePlannerDialog (Sprint F §12)', () => {
  it('computes a real route and hands the geometry to the map', async () => {
    const geometry = [
      { lat: 35.7, lng: 51.4 },
      { lat: 35.75, lng: 51.45 },
    ];
    fetchRoute.mockResolvedValueOnce({
      distanceKm: 8.2,
      durationSec: 600,
      geometry,
      mode: 'static',
      provider: 'osrm',
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Route planner' }));

    const dialog = await screen.findByRole('dialog');
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: '35.7, 51.4' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '35.75, 51.45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute route' }));

    await waitFor(() => {
      expect(fetchRoute).toHaveBeenCalledWith([
        { lat: 35.7, lng: 51.4 },
        { lat: 35.75, lng: 51.45 },
      ]);
    });
    await waitFor(() => {
      expect(screen.getByText(/8\.2 km/)).toBeInTheDocument();
    });
  });

  it('surfaces a provider failure as an error — never a fake route (§24)', async () => {
    fetchRoute.mockRejectedValueOnce(
      Object.assign(new Error('No configured map provider serves'), { status: 503 }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Route planner' }));

    const dialog = await screen.findByRole('dialog');
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: '35.7, 51.4' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '35.75, 51.45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute route' }));

    await waitFor(() => {
      expect(screen.getByText(/No configured map provider serves/)).toBeInTheDocument();
    });
  });

  it('geocodes free-text inputs before routing', async () => {
    fetchGeocode.mockResolvedValueOnce([
      {
        latitude: 35.6892,
        longitude: 51.389,
        formatted: 'Tehran',
        components: {},
        provider: 'nominatim',
      },
    ]);
    fetchGeocode.mockResolvedValueOnce([
      {
        latitude: 35.7,
        longitude: 51.4,
        formatted: 'Vanak',
        components: {},
        provider: 'nominatim',
      },
    ]);
    fetchRoute.mockResolvedValueOnce({
      distanceKm: 5,
      durationSec: 300,
      geometry: [],
      mode: 'static',
      provider: 'osrm',
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Route planner' }));

    const dialog = await screen.findByRole('dialog');
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'Tehran' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'Vanak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute route' }));

    await waitFor(() => {
      expect(fetchRoute).toHaveBeenCalledWith([
        { lat: 35.6892, lng: 51.389 },
        { lat: 35.7, lng: 51.4 },
      ]);
    });
  });
});
