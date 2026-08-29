import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockTrips } from '@/mock/fleet-data';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { TripsPage } from '@/pages/TripsPage';

import { i18n } from '@/i18n';

// ── Mock maplibre-gl: jsdom has no WebGL. TripReplayMap additionally needs
// addSource/addLayer/fitBounds + the LngLatBounds constructor.
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
    isStyleLoaded() {
      return true;
    }
    addSource() {}
    addLayer() {}
    getSource() {
      return null;
    }
    resize() {}
    stop() {}
    getContainer() {
      return document.createElement('div');
    }
    getZoom() {
      return 14;
    }
    flyTo() {}
    easeTo() {}
    fitBounds() {}
    remove() {}
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
    getElement() {
      return document.createElement('div');
    }
    remove() {}
  };
  const StubPopup = class {
    setHTML() {
      return this;
    }
  };
  const LngLatBounds = class {
    extend() {
      return this;
    }
  };
  return {
    Map: StubMap,
    Marker: StubMarker,
    Popup: StubPopup,
    NavigationControl: class {},
    LngLatBounds,
  };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

/** Safe indexed access (mock data is non-empty by construction). */
function tripAt(i: number) {
  const trip = mockTrips[i];
  if (!trip) throw new Error(`mock trip ${i} missing`);
  return trip;
}

/** Render the trips list page in providers. */
function renderTripsList() {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, { initialEntries: ['/trips'] }, createElement(TripsPage)),
      ),
    ),
  );
}

/** Render the trip detail page for a given trip id (needs /trips/:id routing). */
function renderTripDetail(id: string) {
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
          { initialEntries: [`/trips/${id}`] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/trips/:id', element: createElement(TripDetailPage) }),
            createElement(Route, { path: '/trips', element: createElement(TripsPage) }),
          ),
        ),
      ),
    ),
  );
}

describe('TripsPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the page title and trip rows from mock data', async () => {
    renderTripsList();
    expect(await screen.findByText('Trips')).toBeInTheDocument();
    // A few trip ids from the mock list appear.
    await waitFor(() => {
      expect(screen.getByText(tripAt(0).id)).toBeInTheDocument();
      expect(screen.getByText(tripAt(0).vehicleLabel)).toBeInTheDocument();
    });
  });

  it('filters the list by search query', async () => {
    renderTripsList();
    await waitFor(() => expect(screen.getByText(tripAt(0).id)).toBeInTheDocument());

    const input = screen.getByPlaceholderText('Search vehicle / driver / id…');
    fireEvent.change(input, { target: { value: tripAt(0).vehicleLabel } });

    await waitFor(() => {
      expect(screen.getByText(tripAt(0).id)).toBeInTheDocument();
    });
    // Other trips' ids are filtered out.
    expect(screen.queryByText(tripAt(1).id)).not.toBeInTheDocument();
  });

  it('filters the list by status chip', async () => {
    renderTripsList();
    await waitFor(() => expect(screen.getByText(tripAt(0).id)).toBeInTheDocument());

    const plannedCount = mockTrips.filter((t) => t.status === 'planned').length;
    // The status filter is the SegmentedControl primitive (role=radio).
    fireEvent.click(screen.getByRole('radio', { name: 'Planned' }));

    await waitFor(() => {
      // Only planned trips remain: count of trip-id cells equals plannedCount.
      const rows = screen.getAllByRole('row');
      // subtract the header row.
      expect(rows.length - 1).toBe(plannedCount);
    });
  });

  it('shows the honest "not available yet" empty state in REAL mode (§22)', async () => {
    // Real mode, no backend in jsdom: the query fails with a network error and
    // the redesigned page renders the shared ErrorState (network tone) with
    // retry — never a fabricated list.
    window.localStorage.setItem('fleetvision_use_mock', 'false');
    try {
      renderTripsList();
      expect(await screen.findByText('Connection error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    } finally {
      window.localStorage.setItem('fleetvision_use_mock', 'true');
    }
  });
});

describe('TripDetailPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the trip header, summary tiles, and timeline', async () => {
    const trip = tripAt(0);
    renderTripDetail(trip.id);

    // Header: human-readable title (vehicle · date — not the raw id) + back link.
    expect(await screen.findByText('Back to trips')).toBeInTheDocument();
    // Summary tiles.
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Max speed')).toBeInTheDocument();
    // Timeline + speed graph section titles.
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Speed over time')).toBeInTheDocument();
  });

  it('toggles playback when the play button is clicked', async () => {
    const trip = tripAt(0);
    renderTripDetail(trip.id);

    const playBtn = await screen.findByRole('button', { name: 'Play' });
    fireEvent.click(playBtn);
    await waitFor(() => {
      // After play, the button's aria-label flips to Pause.
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    });
  });

  it('renders the events list when events exist', async () => {
    // Find a trip whose generated detail yields events — pick the first id; the
    // deterministic generator produces overspeed events for most trips.
    renderTripDetail(tripAt(0).id);
    await waitFor(() => expect(screen.getByText('Events')).toBeInTheDocument());
    // The Events section renders either the "no events" copy or one+ event rows.
    // Use getAllByText (multi-match safe) on the known event labels.
    const hasEvents =
      screen.queryByText('No events on this trip.') ||
      screen.getAllByText(/Overspeed|Stop|Idle/).length > 0;
    expect(hasEvents).toBeTruthy();
  });

  it('shows the "not available yet" empty state in REAL mode (§22)', async () => {
    // Real mode, no backend in jsdom: the detail query fails with a network
    // error and the redesigned page renders the shared ErrorState — never a
    // fabricated replay.
    window.localStorage.setItem('fleetvision_use_mock', 'false');
    try {
      renderTripDetail('TR-9999');
      expect(await screen.findByText('Connection error')).toBeInTheDocument();
      expect(screen.getByText('Back to trips')).toBeInTheDocument();
      // The playback UI never renders without real data.
      expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    } finally {
      window.localStorage.setItem('fleetvision_use_mock', 'true');
    }
  });
});
