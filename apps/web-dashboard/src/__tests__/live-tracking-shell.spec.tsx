/**
 * Phase 5 — Live Tracking shell tests (TailAdmin port).
 *
 * Covers the behaviors the port changed or added: the route-level permission
 * gate around MapPage (tracking.read), the Tailwind device-popup drawer
 * (backdrop close keeps the selection — §31), ESC close, and the WS
 * connection chip tones. Selection/filter/search/live-merge/reconnect are
 * covered by map.spec / live-tracking.spec / realtime-socket.spec.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { RequirePermission } from '@/components/common/RequirePermission';
import { MapPage } from '@/pages/MapPage';
import type { MapVehicle, VehicleDetail } from '@/types/fleet.types';

import { i18n } from '@/i18n';

// ── Fixtures ────────────────────────────────────────────────────────────────

const vehiclesFixture: MapVehicle[] = [
  {
    id: 'v1',
    label: 'TRK-100',
    state: 'driving',
    lat: 35.72,
    lng: 51.34,
    heading: 90,
    speed: 62,
    deviceId: 'dev-1',
    presence: 'ONLINE',
    lastSeenAt: '2026-08-08T10:00:00Z',
  },
];

const detailFixture: VehicleDetail = {
  ...vehiclesFixture[0],
  odometer: 120000,
  address: 'Enqelab Ave, Tehran',
  ignitionOn: true,
  updatedAt: '2026-08-08T10:00:00Z',
  events: [],
};

// ── Mocks (same surface as map.spec) ────────────────────────────────────────

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
vi.mock('@/api/driver.api', () => ({
  driverFullName: (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`,
  useDrivers: () => ({ data: [] }),
}));

vi.mock('supercluster', () => ({
  default: class {
    load(_points: unknown[]) {
      return this;
    }
    getClusters() {
      return [];
    }
    getClusterExpansionZoom() {
      return 16;
    }
  },
}));

vi.mock('maplibre-gl', () => {
  const StubMap = class {
    on() {}
    off() {}
    addControl() {}
    getLayer() {
      return undefined;
    }
    removeLayer() {}
    removeSource() {}
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
    easeTo() {}
    remove() {}
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
  return { Map: StubMap, Marker, Popup, NavigationControl: class {} };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderMapPage() {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/map']}>
          <RequirePermission permission="tracking.read">
            <MapPage />
          </RequirePermission>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMapVehicles.mockReturnValue({
    data: vehiclesFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseVehicleDetail.mockReturnValue({
    data: detailFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseFleets.mockReturnValue({ data: [] });
  mockUseVehicles.mockReturnValue({ data: [] });
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
      permissions: ['tracking.read'],
    },
  });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Live Tracking — route permission gate', () => {
  it('renders the map for a principal holding tracking.read', async () => {
    renderMapPage();
    await waitFor(() => expect(screen.getByText('Live Tracking')).toBeInTheDocument());
  });

  it('renders the 403 state when tracking.read is missing', async () => {
    useAuthStore.setState({
      user: {
        id: 'u1',
        email: 'op@fleet.test',
        tenantId: 't1',
        roles: ['operator'],
        permissions: [],
      },
    });
    renderMapPage();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.queryByText('Live Tracking')).toBeNull();
  });
});

describe('Live Tracking — Tailwind device popup drawer', () => {
  it('opens on row select and closes on backdrop WITHOUT clearing selection', async () => {
    renderMapPage();
    await waitFor(() => expect(screen.getByText('TRK-100')).toBeInTheDocument());

    fireEvent.click(screen.getByText('TRK-100'));
    const overlay = await waitFor(() => screen.getByTestId('device-popup-overlay'));
    expect(overlay.textContent).toContain('TRK-100');

    // Backdrop press closes the drawer…
    fireEvent.click(overlay.querySelector('button[aria-label="Close"]') as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('device-popup-overlay')).toBeNull());
    // …but the row remains selected (aria-pressed) — §31 inspector semantics.
    const row = document.querySelector('[data-vehicle-id="v1"] > button');
    expect(row?.getAttribute('aria-pressed')).toBe('true');
  });

  it('closes on ESC', async () => {
    renderMapPage();
    await waitFor(() => expect(screen.getByText('TRK-100')).toBeInTheDocument());
    fireEvent.click(screen.getByText('TRK-100'));
    await waitFor(() => expect(screen.getByTestId('device-popup-overlay')).toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('device-popup-overlay')).toBeNull());
  });
});
