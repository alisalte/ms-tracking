import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMapVehicles } from '@/mock/fleet-data';
import { MapPage } from '@/pages/MapPage';

import { i18n } from '@/i18n';

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
  });

  it('renders the page title and toolbar fleet count', async () => {
    renderMap();

    expect(await screen.findByText('Live Tracking')).toBeInTheDocument();
    await waitFor(() => {
      // Toolbar: "{{shown}} of {{total}} vehicles" with all 40 visible.
      expect(
        screen.getByText(`${mockMapVehicles.length} of ${mockMapVehicles.length} vehicles`),
      ).toBeInTheDocument();
    });
  });

  it('renders the device list from mock fleet data', async () => {
    renderMap();
    await waitFor(() => {
      // The list shows every vehicle label from the mock fleet.
      for (const v of mockMapVehicles.slice(0, 5)) {
        expect(screen.getByText(v.label)).toBeInTheDocument();
      }
    });
  });

  it('filters the list by search query', async () => {
    renderMap();
    await waitFor(() => expect(screen.getByText(mockMapVehicles[0].label)).toBeInTheDocument());

    const input = screen.getByPlaceholderText('Search vehicle / driver / id…');
    fireEvent.change(input, { target: { value: mockMapVehicles[0].label } });

    await waitFor(() => {
      // The typed label is still present…
      expect(screen.getByText(mockMapVehicles[0].label)).toBeInTheDocument();
      // …and the count dropped to 1 of total.
      expect(screen.getByText(`1 of ${mockMapVehicles.length}`)).toBeInTheDocument();
    });
  });

  it('filters the list by a status chip', async () => {
    renderMap();
    await waitFor(() =>
      expect(screen.getAllByText(mockMapVehicles[0].label).length).toBeGreaterThan(0),
    );

    // Count the offline vehicles in mock data for the expected badge.
    const offlineCount = mockMapVehicles.filter((v) => v.state === 'offline').length;
    // Click the Offline chip (label "Offline · N").
    const offlineChip = screen.getByRole('button', {
      name: new RegExp(`Offline · ${offlineCount}`),
    });
    fireEvent.click(offlineChip);

    await waitFor(() => {
      expect(screen.getByText(`${offlineCount} of ${mockMapVehicles.length}`)).toBeInTheDocument();
    });
  });

  it('opens the device popup drawer when a device is selected', async () => {
    renderMap();
    const first = mockMapVehicles[0];
    await waitFor(() => expect(screen.getByText(first.label)).toBeInTheDocument());

    fireEvent.click(screen.getByText(first.label));

    // The drawer renders the vehicle label as its header (h6).
    const drawer = screen.getByRole('presentation', { hidden: false });
    await waitFor(() => {
      expect(within(drawer).getByText(first.label)).toBeInTheDocument();
    });
  });
});
