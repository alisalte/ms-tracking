import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MapPage } from '@/pages/MapPage';
import type { Fleet } from '@/types/asset.types';
import type { MapVehicle, VehicleDetail, VehiclePresence } from '@/types/fleet.types';

import { i18n } from '@/i18n';

// ── REAL Sprint E fixtures (registry × status × position join shapes) ────────
const fleetA: Fleet = {
  id: 'fleet-a',
  tenantId: 't1',
  name: 'Fleet A',
  code: 'A',
  description: null,
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const fleetB: Fleet = { ...fleetA, id: 'fleet-b', name: 'Fleet B', code: 'B' };

function vehicle(
  id: string,
  label: string,
  presence: VehiclePresence,
  overrides: Partial<MapVehicle> = {},
): MapVehicle {
  return {
    id,
    label,
    state: presence === 'OFFLINE' || presence === 'UNKNOWN' ? 'offline' : 'driving',
    lat: 35.7,
    lng: 51.3,
    heading: 90,
    speed: 42,
    deviceId: `dev-${id}`,
    presence,
    lastSeenAt: presence === 'UNKNOWN' ? undefined : '2026-08-08T10:00:00Z',
    ...overrides,
  };
}

const vehiclesFixture: MapVehicle[] = [
  vehicle('v1', 'TRK-100', 'ONLINE'),
  vehicle('v2', 'TRK-101', 'ONLINE'),
  vehicle('v3', 'VAN-102', 'OFFLINE', { speed: 0 }),
  vehicle('v4', 'BUS-103', 'STALE', { speed: 0, state: 'stopped' }),
  vehicle('v5', 'CAR-104', 'UNKNOWN', { speed: 0, deviceId: undefined }),
];

// Registry join: v1/v2 → Fleet A, v3/v4 → Fleet B, v5 unassigned.
const registryFixture = [
  { id: 'v1', fleetId: 'fleet-a' },
  { id: 'v2', fleetId: 'fleet-a' },
  { id: 'v3', fleetId: 'fleet-b' },
  { id: 'v4', fleetId: 'fleet-b' },
];

const detailFixture: VehicleDetail = {
  ...vehiclesFixture[0],
  odometer: 120000,
  address: 'Enqelab Ave, Tehran',
  ignitionOn: true,
  updatedAt: '2026-08-08T10:00:00Z',
  events: [],
};

// ── Mock the API layer (MapPage is a consumer; WS stays a no-op in jsdom) ────
const mockUseMapVehicles = vi.fn();
const mockUseVehicleDetail = vi.fn();
vi.mock('@/api/fleet.api', () => ({
  useMapVehicles: () => mockUseMapVehicles(),
  useVehicleDetail: (id: string | null) => mockUseVehicleDetail(id),
}));
const mockUseFleets = vi.fn();
const mockUseVehicles = vi.fn();
vi.mock('@/api/asset.api', () => ({
  useFleets: () => mockUseFleets(),
  useVehicles: () => mockUseVehicles(),
}));

// ── Mock supercluster: return every point as its own (un-clustered) feature so
// the device list + map both see the full fleet. getClusters returns the points
// within the requested bbox so map filtering still works.
vi.mock('supercluster', () => {
  type Point = { geometry: { coordinates: [number, number] } };
  return {
    default: class {
      private points: Point[] = [];
      load(points: Point[]) {
        this.points = points;
        return this;
      }
      getClusters(bbox: [number, number, number, number]) {
        return this.points.filter((p) => {
          const [lng, lat] = p.geometry.coordinates;
          return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
        });
      }
      getClusterExpansionZoom() {
        return 16;
      }
    },
  };
});

// ── Mock maplibre-gl: jsdom has no WebGL. Stub the methods FleetMap uses.
vi.mock('maplibre-gl', () => {
  const handlers: Record<string, Array<() => void>> = {};
  const StubMap = class {
    on(ev: string, cb: () => void) {
      const list = handlers[ev] ?? [];
      list.push(cb);
      handlers[ev] = list;
    }
    off(ev: string, cb: () => void) {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== cb);
    }
    once(_ev: string, cb: (...a: never[]) => void) {
      // behave as loaded: fire immediately
      cb();
    }
    loaded() {
      return true;
    }
    getZoom() {
      return 18;
    }
    getBounds() {
      // A wide bbox around the fleet so all mock points are "in view".
      return {
        getWest: () => 50,
        getSouth: () => 34,
        getEast: () => 52,
        getNorth: () => 37,
      };
    }
    flyTo() {}
    easeTo() {}
    remove() {}
    // Sprint F: track-overlay source/layer APIs.
    getSource() {
      return null;
    }
    addSource() {}
    addLayer() {}
    fitBounds() {}
    getCanvas() {
      return document.createElement('canvas');
    }
  };
  const Marker = class {
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
  const Popup = class {
    setHTML() {
      return this;
    }
  };
  return { Map: StubMap, Marker, Popup };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderMap() {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, { initialEntries: ['/map'] }, createElement(MapPage)),
      ),
    ),
  );
}

describe('MapPage (Live Tracking)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    mockUseMapVehicles.mockReturnValue({
      data: vehiclesFixture,
      isLoading: false,
      isError: false,
    });
    mockUseVehicleDetail.mockImplementation((id: string | null) => ({
      // The drawer queries only when open (vehicleId != null).
      data: id ? detailFixture : undefined,
      isLoading: false,
    }));
    mockUseFleets.mockReturnValue({ data: [fleetA, fleetB], isLoading: false });
    mockUseVehicles.mockReturnValue({ data: registryFixture, isLoading: false });
  });

  it('renders the page title and toolbar fleet count', async () => {
    renderMap();

    expect(await screen.findByText('Live Tracking')).toBeInTheDocument();
    await waitFor(() => {
      // Toolbar: "{{shown}} of {{total}} vehicles" with all 5 visible.
      expect(screen.getByText(`5 of ${vehiclesFixture.length} vehicles`)).toBeInTheDocument();
    });
  });

  it('renders the device list with last-seen (§19), "never" when unbound', async () => {
    renderMap();
    await waitFor(() => {
      for (const v of vehiclesFixture) {
        expect(screen.getByText(v.label)).toBeInTheDocument();
      }
    });
    // v5 has no status record → honest "never" (never fabricated).
    expect(screen.getByText(/never/)).toBeInTheDocument();
    // The connected vehicles carry the backend lastSeenAt.
    expect(screen.getAllByText(/Last seen:/).length).toBe(vehiclesFixture.length);
  });

  it('renders the presence filter chips with counts (§18/§20)', async () => {
    renderMap();
    await waitFor(() => expect(screen.getByText('TRK-100')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Online · 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Offline · 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stale · 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unknown · 1' })).toBeInTheDocument();
  });

  it('filters the list by search query', async () => {
    renderMap();
    await waitFor(() => expect(screen.getByText('TRK-100')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('Search vehicle / driver / id…');
    fireEvent.change(input, { target: { value: 'TRK-100' } });

    await waitFor(() => {
      // The typed label is still present…
      expect(screen.getByText('TRK-100')).toBeInTheDocument();
      // …and the count dropped to 1 of total.
      expect(screen.getByText(`1 of ${vehiclesFixture.length}`)).toBeInTheDocument();
    });
  });

  it('filters the list by a presence chip', async () => {
    renderMap();
    await waitFor(() => expect(screen.getByText('TRK-100')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Offline · 1' }));

    await waitFor(() => {
      expect(screen.getByText(`1 of ${vehiclesFixture.length}`)).toBeInTheDocument();
    });
    // The offline vehicle remains visible; online ones are filtered out.
    expect(screen.getByText('VAN-102')).toBeInTheDocument();
    expect(screen.queryByText('TRK-100')).not.toBeInTheDocument();
  });

  it('filters the list by fleet (§20)', async () => {
    renderMap();
    await waitFor(() => expect(screen.getByText('TRK-100')).toBeInTheDocument());

    // The fleet selector is a native <select> (combobox) — change by value.
    // (Phase 5: the panel moved from MUI Select to a native select.)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fleet-a' } });

    await waitFor(() => {
      expect(screen.getByText(`2 of ${vehiclesFixture.length}`)).toBeInTheDocument();
    });
    expect(screen.getByText('TRK-100')).toBeInTheDocument();
    expect(screen.getByText('TRK-101')).toBeInTheDocument();
    expect(screen.queryByText('VAN-102')).not.toBeInTheDocument();
  });

  it('opens the device popup drawer when a device is selected', async () => {
    renderMap();
    await waitFor(() => expect(screen.getByText('TRK-100')).toBeInTheDocument());

    fireEvent.click(screen.getByText('TRK-100'));

    // The drawer renders the vehicle label as its header (h6).
    const drawer = screen.getByRole('presentation', { hidden: false });
    await waitFor(() => {
      expect(within(drawer).getByText('TRK-100')).toBeInTheDocument();
    });
  });

  it('shows the WS connection chip state (§2.2)', async () => {
    renderMap();
    await waitFor(() => expect(screen.getByText('TRK-100')).toBeInTheDocument());

    // No tenant / no WS server in tests → honest "Disconnected" chip.
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});
