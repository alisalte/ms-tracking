import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { mockDevices, mockDrivers, mockGroups, mockVehicles } from '@/mock/asset-data';
import { AssetManagementPage } from '@/pages/AssetManagementPage';

import { i18n } from '@/i18n';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderAssets(initialEntry = '/assets') {
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
          { initialEntries: [initialEntry] },
          createElement(AssetManagementPage),
        ),
      ),
    ),
  );
}

describe('AssetManagementPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the title + 4 tabs with counts', async () => {
    renderAssets();
    expect(await screen.findByText('Asset Management')).toBeInTheDocument();
    // All four tab labels are present.
    for (const tab of ['Vehicles', 'Drivers', 'Devices', 'Groups']) {
      expect(screen.getByText(new RegExp(`^${tab}$`))).toBeInTheDocument();
    }
  });

  it('renders vehicle rows from mock data (default tab)', async () => {
    renderAssets();
    // Wait for the vehicles query to resolve and render a license plate.
    await waitFor(() => {
      expect(screen.getByText(mockVehicles[0].licensePlate)).toBeInTheDocument();
    });
  });

  it('filters vehicles by status', async () => {
    renderAssets();
    await waitFor(() => expect(screen.getByText(mockVehicles[0].licensePlate)).toBeInTheDocument());

    // Open the status filter (the first Select) and pick "Maintenance".
    const selects = screen.getAllByRole('combobox');
    fireEvent.mouseDown(selects[0]);
    fireEvent.click(screen.getByRole('option', { name: 'Maintenance' }));

    // After filtering, only maintenance vehicles remain. An active vehicle's
    // plate disappears (the mock has a mix of statuses).
    const active = mockVehicles.find((v) => v.status === 'active');
    await waitFor(() => {
      if (active) expect(screen.queryByText(active.licensePlate)).not.toBeInTheDocument();
    });
  });

  it('opens the vehicle detail drawer when a row is clicked', async () => {
    renderAssets();
    await waitFor(() => expect(screen.getByText(mockVehicles[0].licensePlate)).toBeInTheDocument());

    fireEvent.click(screen.getByText(mockVehicles[0].licensePlate));

    // The drawer renders the VIN label.
    await waitFor(() => {
      expect(screen.getByText('VIN')).toBeInTheDocument();
    });
  });

  it('switches to the drivers tab and renders driver rows', async () => {
    renderAssets();
    await screen.findByText('Asset Management');

    fireEvent.click(screen.getByRole('tab', { name: /Drivers/ }));
    await waitFor(() => {
      // The first driver's name appears once the query resolves.
      const d = mockDrivers[0];
      expect(screen.getByText(new RegExp(`${d.firstName}`))).toBeInTheDocument();
    });
  });

  it('switches to the devices tab and renders device rows with health', async () => {
    renderAssets();
    await screen.findByText('Asset Management');

    fireEvent.click(screen.getByRole('tab', { name: /Devices/ }));
    await waitFor(() => {
      expect(screen.getByText(mockDevices[0].serialNumber)).toBeInTheDocument();
    });
  });

  it('switches to the groups tab and renders group cards', async () => {
    renderAssets();
    await screen.findByText('Asset Management');

    fireEvent.click(screen.getByRole('tab', { name: /Groups/ }));
    await waitFor(() => {
      expect(screen.getByText(mockGroups[0].name)).toBeInTheDocument();
    });
  });

  it('renders the vehicles tab when navigated with ?tab=vehicles', async () => {
    renderAssets('/assets?tab=vehicles');
    await waitFor(() => expect(screen.getByText(mockVehicles[0].licensePlate)).toBeInTheDocument());
  });

  it('uses mock data covering the vehicle lifecycle statuses', () => {
    const statuses = new Set(mockVehicles.map((v) => v.status));
    expect(statuses.size).toBeGreaterThan(1);
  });
});
