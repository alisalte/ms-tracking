import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { mockAlerts, mockAttention, mockFleetStats } from '@/mock/fleet-data';

import { i18n } from '@/i18n';

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
  });

  it('renders the header (title, subtitle, live badge, export)', async () => {
    renderDashboard();

    expect(await screen.findByText('Fleet Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Live operational overview')).toBeInTheDocument();
    // "Live" appears on the header badge and on the real-time widgets.
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('renders all five stat-card values from mock fleet stats', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(String(mockFleetStats.totalActive))).toBeInTheDocument();
      expect(screen.getByText(String(mockFleetStats.driving))).toBeInTheDocument();
      expect(screen.getByText(String(mockFleetStats.idle))).toBeInTheDocument();
      expect(screen.getByText(String(mockFleetStats.offline))).toBeInTheDocument();
      expect(screen.getByText(String(mockFleetStats.alerts))).toBeInTheDocument();
    });
  });

  it('renders the critical-alerts chip from the stats', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/2 CRIT/i)).toBeInTheDocument();
    });
  });

  it('renders every widget title', async () => {
    renderDashboard();
    const titles = [
      'Fleet Activity (24h)',
      'Active Alerts',
      'Vehicles Needing Attention',
      'Fleet Utilization',
      'Weather',
      'Fleet Map',
    ];
    for (const title of titles) {
      // Widget titles may render more than once (e.g. nav); assert at least one.
      await waitFor(() => {
        expect(screen.getAllByText(title).length).toBeGreaterThan(0);
      });
    }
  });

  it('renders alert rows from mock alerts', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(mockAlerts[0].vehicleLabel)).toBeInTheDocument();
    });
  });

  it('renders attention rows from mock attention', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(mockAttention[0].vehicleLabel)).toBeInTheDocument();
    });
  });
});
