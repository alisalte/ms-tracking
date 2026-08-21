import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { AssetManagementPage } from '@/pages/AssetManagementPage';
import type { Device, Fleet, Vehicle } from '@/types/asset.types';
import type { User } from '@/types/auth.types';

import { i18n } from '@/i18n';

/**
 * Sprint E — the Asset hub runs against the REAL fleet-management contracts
 * (fleets / vehicles / devices). The api module is mocked wholesale with
 * fixtures shaped EXACTLY like the backend records (uppercase lifecycle
 * enums, imei/protocol device registry, vehicleId binding).
 */
const fx = vi.hoisted(() => {
  const TS = '2026-01-01T00:00:00Z';
  const fleets: Fleet[] = [
    {
      id: 'fleet-1',
      tenantId: 'tenant-1',
      name: 'North Fleet',
      code: 'NORTH',
      description: 'Northern operations',
      status: 'ACTIVE',
      version: 1,
      createdAt: TS,
      updatedAt: TS,
    },
    {
      id: 'fleet-2',
      tenantId: 'tenant-1',
      name: 'South Fleet',
      code: 'SOUTH',
      description: null,
      status: 'ARCHIVED',
      version: 1,
      createdAt: TS,
      updatedAt: TS,
    },
  ];
  const vehicles: Vehicle[] = [
    {
      id: 'veh-1',
      tenantId: 'tenant-1',
      fleetId: 'fleet-1',
      name: 'Truck One',
      code: 'V001',
      plate: 'ABC-123',
      vin: 'WP0ZZZ99ZTS392124',
      status: 'ACTIVE',
      version: 1,
      createdAt: TS,
      updatedAt: TS,
    },
    {
      id: 'veh-2',
      tenantId: 'tenant-1',
      fleetId: 'fleet-1',
      name: 'Truck Two',
      code: 'V002',
      plate: null,
      vin: null,
      status: 'ARCHIVED',
      version: 1,
      createdAt: TS,
      updatedAt: TS,
    },
    {
      id: 'veh-3',
      tenantId: 'tenant-1',
      fleetId: 'fleet-2',
      name: 'Van Three',
      code: 'V003',
      plate: 'XYZ-789',
      vin: null,
      status: 'ACTIVE',
      version: 1,
      createdAt: TS,
      updatedAt: TS,
    },
  ];
  const devices: Device[] = [
    {
      id: 'dev-1',
      tenantId: 'tenant-1',
      // 15-digit, Luhn-valid (the backend validates both).
      imei: '490154203237518',
      serialNumber: 'SN-1001',
      manufacturer: 'Teltonika',
      model: 'FMB920',
      protocol: 'gt06',
      status: 'ACTIVE',
      vehicleId: 'veh-1',
      lastSeenAt: new Date().toISOString(),
      connectedAt: null,
      disconnectedAt: null,
      version: 1,
      createdAt: TS,
      updatedAt: TS,
    },
    {
      id: 'dev-2',
      tenantId: 'tenant-1',
      imei: '490154203237526',
      serialNumber: 'SN-1002',
      manufacturer: 'Huabao',
      model: 'HB-T808',
      protocol: 'jt808',
      status: 'UNPAIRED',
      vehicleId: null,
      lastSeenAt: null,
      connectedAt: null,
      disconnectedAt: null,
      version: 1,
      createdAt: TS,
      updatedAt: TS,
    },
  ];
  return { fleets, vehicles, devices };
});

vi.mock('@/api/asset.api', () => {
  const ok = (data: unknown) => ({
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(() => Promise.resolve({})),
    isPending: false,
    reset: vi.fn(),
  });
  return {
    useFleets: () => ok(fx.fleets),
    useFleetDetail: (id: string | null) => ok(id ? fx.fleets.find((f) => f.id === id) : undefined),
    useVehicles: () => ok(fx.vehicles),
    useVehicleDetail: (id: string | null) =>
      ok(id ? fx.vehicles.find((v) => v.id === id) : undefined),
    useDevices: () => ok(fx.devices),
    useDeviceDetail: (id: string | null) =>
      ok(id ? fx.devices.find((d) => d.id === id) : undefined),
    useVehicleDevices: (vehicleId: string | null) =>
      ok(
        (vehicleId ? fx.devices.filter((d) => d.vehicleId === vehicleId) : []).map((d) => ({
          deviceId: d.id,
          imei: d.imei,
          manufacturer: d.manufacturer,
          model: d.model,
          protocol: d.protocol,
          deviceStatus: d.status,
          role: 'TRACKER',
          isPrimary: true,
          boundAt: d.createdAt,
        })),
      ),
    useCreateFleet: mutation,
    useUpdateFleet: mutation,
    useArchiveFleet: mutation,
    useCreateVehicle: mutation,
    useUpdateVehicle: mutation,
    useArchiveVehicle: mutation,
    useDeleteVehicle: mutation,
    useCreateDevice: mutation,
    useUpdateDevice: mutation,
    useDecommissionDevice: mutation,
    useDeleteDevice: mutation,
    useBindDeviceToVehicle: mutation,
    useUnbindDeviceFromVehicle: mutation,
  };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function setUser(permissions: readonly string[]) {
  const user = {
    id: 'user-1',
    email: 'op@example.com',
    tenantId: 'tenant-1',
    roles: ['operator'],
    permissions,
  } as User;
  useAuthStore.setState({ user });
}

function renderAssets(initialEntry = '/assets') {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        ToastProvider,
        null,
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
    ),
  );
}

describe('AssetManagementPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    // Full wildcard permissions so the permission-gated CRUD actions render.
    setUser(['*']);
  });

  it('renders the title + 3 real-registry tabs (no drivers/groups)', async () => {
    renderAssets();
    expect(await screen.findByText('Asset Management')).toBeInTheDocument();
    for (const tab of ['Fleets', 'Vehicles', 'Devices']) {
      expect(screen.getByRole('tab', { name: new RegExp(`^${tab}`) })).toBeInTheDocument();
    }
    // The mock-era domains are gone entirely.
    expect(screen.queryByRole('tab', { name: /Drivers/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Groups/ })).not.toBeInTheDocument();
  });

  it('renders vehicle rows with the real fields (default tab)', async () => {
    renderAssets();
    // Vehicle identity is name/code (not make/model) + resolved fleet name
    // (both fleet-1 vehicles render "North Fleet" in the fleet column).
    await waitFor(() => {
      expect(screen.getByText('Truck One')).toBeInTheDocument();
      expect(screen.getByText('V001')).toBeInTheDocument();
      expect(screen.getAllByText('North Fleet').length).toBeGreaterThan(0);
      expect(screen.getByText('WP0ZZZ99ZTS392124')).toBeInTheDocument();
    });
    // The archived vehicle shows its lifecycle badge (the native status
    // filter also renders an <option>Archived</option> — match the badge).
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(1);
  });

  it('filters vehicles by lifecycle status', async () => {
    renderAssets();
    await waitFor(() => expect(screen.getByText('Truck One')).toBeInTheDocument());

    // The status filter is the second combobox (fleet filter is first) — a
    // native select, so drive it with a change event.
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'ARCHIVED' } });

    await waitFor(() => {
      expect(screen.queryByText('Truck One')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Truck Two')).toBeInTheDocument();
  });

  it('opens the vehicle detail drawer with its bound devices', async () => {
    renderAssets();
    await waitFor(() => expect(screen.getByText('Truck One')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Truck One'));

    // The drawer opens (row + drawer both show the vehicle name) and the
    // DEVICES section lists the bound device's IMEI.
    await waitFor(() => {
      expect(screen.getAllByText('Truck One').length).toBeGreaterThan(1);
      expect(screen.getByText('490154203237518')).toBeInTheDocument();
    });
  });

  it('switches to the devices tab and renders the registry columns', async () => {
    renderAssets();
    await screen.findByText('Asset Management');

    fireEvent.click(screen.getByRole('tab', { name: /^Devices/ }));
    await waitFor(() => {
      expect(screen.getByText('490154203237518')).toBeInTheDocument();
      expect(screen.getByText('490154203237526')).toBeInTheDocument();
    });
    // Protocol badge + lifecycle status (the protocol filter select also
    // renders these labels as <option>s — expect more than one occurrence).
    expect(screen.getAllByText('GT06').length).toBeGreaterThan(1);
    expect(screen.getAllByText('JT/T 808').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Unpaired').length).toBeGreaterThan(1);
    // Never-seen unbound device → relative "never"; bound one shows a vehicle.
    expect(screen.getByText('never')).toBeInTheDocument();
    expect(screen.getByText('Truck One')).toBeInTheDocument();
  });

  it('switches to the fleets tab and renders fleet rows', async () => {
    renderAssets();
    await screen.findByText('Asset Management');

    fireEvent.click(screen.getByRole('tab', { name: /^Fleets/ }));
    await waitFor(() => {
      expect(screen.getByText('North Fleet')).toBeInTheDocument();
      expect(screen.getByText('NORTH')).toBeInTheDocument();
    });
    expect(screen.getByText('South Fleet')).toBeInTheDocument();
  });

  it('renders the devices tab when navigated with ?tab=devices', async () => {
    renderAssets('/assets?tab=devices');
    await waitFor(() => {
      expect(screen.getByText('490154203237518')).toBeInTheDocument();
    });
  });

  it('confirms archiving with archive wording (soft delete)', async () => {
    renderAssets();
    await waitFor(() => expect(screen.getByText('Truck One')).toBeInTheDocument());

    // The row's inline archive action (icon button, tooltip-gated by
    // vehicle.write which the wildcard permission grants).
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0]);

    // The confirm dialog uses ARCHIVE semantics, not "delete".
    await waitFor(() => {
      expect(screen.getByText('Archive Truck One?')).toBeInTheDocument();
    });
  });

  it('hides the add/write actions without the write permission', async () => {
    setUser(['fleet.read']);
    renderAssets();
    await waitFor(() => expect(screen.getByText('Truck One')).toBeInTheDocument());

    // vehicle.write missing → no "+ Add Vehicles" on the vehicles tab.
    expect(screen.queryByText('Add Vehicles')).not.toBeInTheDocument();

    // Granting the permission re-renders the gated action.
    setUser(['*']);
    await waitFor(() => {
      expect(screen.getByText('Add Vehicles')).toBeInTheDocument();
    });
  });
});
