import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { OperationsPage } from '@/pages/OperationsPage';

const rangeSeen = vi.hoisted(() => ({ activity: [] as unknown[], periods: [] as unknown[][] }));
const downloads = vi.hoisted(() => ({ calls: [] as Array<{ blob: Blob; name: string }> }));

// ApexCharts mounts a canvas — stub the wrapper (charts are covered by the reports tests).
vi.mock('@/components/dashboard/ApexChart', () => ({
  ApexChart: () => <div data-testid="apex-chart" />,
}));

vi.mock('@/lib/video-stream', () => ({
  downloadBlob: (blob: Blob, name: string) => downloads.calls.push({ blob, name }),
}));

vi.mock('@/api/operations.api', () => ({
  useHaulPeriods: (...args: unknown[]) => {
    rangeSeen.periods.push(args);
    return {
      data: args[0]
        ? {
            route: {
              id: 'route-1',
              name: 'Pit to dump',
              shiftStartHour: 6,
              shiftDurationHours: 8,
              shiftCount: 3,
              timeZone: 'Asia/Tehran',
            },
            from: '2026-06-01T00:00:00Z',
            to: '2026-06-03T00:00:00Z',
            granularity: args[2],
            calendar: args[3],
            truncated: false,
            services: 5,
            distanceKm: 15,
            periods: [
              {
                key: '2026-06-01',
                from: '2026-06-01',
                to: '2026-06-01',
                services: 5,
                distanceKm: 15,
                durationSec: 7200,
                loadDwellSec: 1800,
                trucks: 1,
                drivers: 2,
                withoutDriver: 1,
              },
              {
                key: '2026-06-02',
                from: '2026-06-02',
                to: '2026-06-02',
                services: 0,
                distanceKm: 0,
                durationSec: 0,
                loadDwellSec: 0,
                trucks: 0,
                drivers: 0,
                withoutDriver: 0,
              },
            ],
            details: [
              {
                period: '2026-06-01',
                vehicleId: 'veh-1',
                vehicleName: 'Truck 1',
                shiftNo: 1,
                driverId: 'drv-1',
                driverName: 'Ali Day',
                services: 5,
                distanceKm: 15,
                durationSec: 7200,
                loadDwellSec: 1800,
              },
            ],
          }
        : undefined,
      isError: false,
    };
  },
  useDeviceActivity: (range: unknown) => {
    rangeSeen.activity.push(range);
    return {
      data: {
        from: '2026-06-01T00:00:00Z',
        to: '2026-06-02T00:00:00Z',
        totalDistanceKm: 12.5,
        silentCount: 1,
        reportingCount: 0,
        devices: [
          {
            deviceId: 'dev-1',
            imei: '490154203237518',
            protocol: 'meitrack',
            status: 'ACTIVE',
            vehicleId: null,
            vehicleName: null,
            vehicleCode: null,
            plate: null,
            startedAt: null,
            fixes: 0,
            lastFixAt: null,
            offlineSec: null,
            distanceKm: 0,
            silent: true,
          },
        ],
      },
      isLoading: false,
      isError: false,
    };
  },
  useHaulRoutes: () => ({
    data: [
      {
        id: 'route-1',
        name: 'Pit to dump',
        originGeofenceId: 'geo-1',
        destinationGeofenceId: 'geo-2',
        shiftStartHour: 6,
        shiftDurationHours: 12,
        shiftCount: 2,
        status: 'ACTIVE',
      },
    ],
    isLoading: false,
  }),
  useHaulMembers: (routeId: string | null) => ({
    data: routeId
      ? [
          {
            id: 'm-1',
            deviceId: 'dev-1',
            role: 'TRUCK',
            imei: '490154203237518',
            shiftDrivers: ['drv-1', 'drv-2'],
          },
        ]
      : [],
  }),
  useHaulCycles: (routeId: string | null) => ({
    data: routeId
      ? {
          route: {
            id: 'route-1',
            name: 'Pit to dump',
            shiftStartHour: 6,
            shiftDurationHours: 12,
            shiftCount: 2,
            timeZone: 'Asia/Tehran',
          },
          from: '2026-06-01T02:30:00Z',
          to: '2026-06-02T02:30:00Z',
          truncated: false,
          services: 3,
          distanceKm: 9,
          cycles: [],
          byVehicle: [],
          byDriverShift: [],
          byShift: [
            {
              shift: '2026-06-01#1',
              shiftDate: '2026-06-01',
              shiftNo: 1,
              services: 1,
              distanceKm: 3,
              durationSec: 1800,
              loadDwellSec: 600,
              trucks: 1,
              drivers: 1,
              withoutDriver: 0,
            },
            {
              shift: '2026-06-01#2',
              shiftDate: '2026-06-01',
              shiftNo: 2,
              services: 2,
              distanceKm: 6,
              durationSec: 3600,
              loadDwellSec: 1200,
              trucks: 1,
              drivers: 1,
              withoutDriver: 0,
            },
          ],
          byShovel: [],
          openHauls: [],
          unbound: [],
        }
      : undefined,
    isFetching: false,
  }),
  useHaulAnalysis: () => ({ data: undefined, isError: false }),
  useCreateHaulRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateHaulRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveHaulRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetHaulMembers: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/api/driver.api', () => ({
  useDrivers: () => ({
    data: [
      {
        id: 'drv-1',
        firstName: 'Ali',
        lastName: 'Day',
        status: 'ACTIVE',
        assignedVehicleId: 'veh-1',
        assignedShift: 1,
      },
      {
        id: 'drv-2',
        firstName: 'Reza',
        lastName: 'Night',
        status: 'ACTIVE',
        assignedVehicleId: 'veh-1',
        assignedShift: 2,
      },
      {
        id: 'drv-3',
        firstName: 'Sam',
        lastName: 'Third',
        status: 'ACTIVE',
        assignedVehicleId: 'veh-1',
        assignedShift: 3,
      },
    ],
  }),
  driverFullName: (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`,
}));

vi.mock('@/api/geofence.api', () => ({
  useGeofences: () => ({
    data: [
      { id: 'geo-1', name: 'Pit', status: 'ACTIVE' },
      { id: 'geo-2', name: 'Dump', status: 'ACTIVE' },
    ],
  }),
}));

vi.mock('@/api/asset.api', () => ({
  useDevices: () => ({
    data: [
      { id: 'dev-1', imei: '490154203237518', status: 'ACTIVE', vehicleId: 'veh-1' },
      { id: 'dev-2', imei: '490154203237519', status: 'ACTIVE', vehicleId: 'veh-2' },
    ],
  }),
  useVehicles: () => ({
    data: [
      { id: 'veh-1', name: 'Truck 1', machineType: 'TRUCK' },
      { id: 'veh-2', name: 'Loader', machineType: null },
    ],
  }),
}));

function renderPage() {
  render(
    <I18nextProvider i18n={i18n}>
      <OperationsPage />
    </I18nextProvider>,
  );
}

/** Pick the route in the toolbar, then open another tab (the choice is kept). */
function openRouteTab(tab: 'services' | 'periods' | 'analysis' | 'routes') {
  fireEvent.click(screen.getByTestId('ops-tab-services'));
  fireEvent.change(screen.getByTestId('haul-route-select'), { target: { value: 'route-1' } });
  fireEvent.click(screen.getByTestId(`ops-tab-${tab}`));
}

describe('operations page', () => {
  beforeEach(() => {
    rangeSeen.activity.length = 0;
    rangeSeen.periods.length = 0;
    downloads.calls.length = 0;
  });

  it('opens on the device activity tab with charts and the silent device', () => {
    renderPage();
    expect(screen.getByTestId('operations-page')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Device activity/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('490154203237518')).toBeInTheDocument();
    expect(screen.getByTestId('activity-totals').textContent).toMatch(/12\.5/);
    expect(screen.getAllByTestId('apex-chart').length).toBeGreaterThan(0);
    // The reports of other tabs are not stacked underneath.
    expect(screen.queryByTestId('haul-route-form')).toBeNull();
    expect(screen.queryByTestId('haul-periods')).toBeNull();
  });

  it('keeps the haul setup form on its own tab', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ops-tab-routes'));
    expect(screen.getByTestId('haul-route-form')).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Pit' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'Dump' }).length).toBeGreaterThan(0);
    // Two 12 h shifts by default: day and night.
    expect(screen.getByTestId('shift-plan').textContent).toMatch(/06:00–18:00.*18:00–06:00/);
  });

  it('asks for a route on the route tabs until one is chosen', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ops-tab-services'));
    expect(screen.getByText('Choose a haul service')).toBeInTheDocument();
    expect(screen.queryByTestId('haul-results')).toBeNull();
    fireEvent.change(screen.getByTestId('haul-route-select'), { target: { value: 'route-1' } });
    expect(screen.getByTestId('haul-results')).toBeInTheDocument();
  });

  it('shows a driver per shift for each truck and a per-shift summary', () => {
    renderPage();
    openRouteTab('services');
    expect(screen.getByTestId('haul-by-shift').querySelectorAll('tbody tr')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('ops-tab-routes'));
    expect(screen.getByTestId('haul-route-settings')).toBeInTheDocument();
    expect((screen.getByTestId('roster-dev-1-1') as HTMLSelectElement).value).toBe('drv-1');
    expect((screen.getByTestId('roster-dev-1-2') as HTMLSelectElement).value).toBe('drv-2');
  });

  it('takes the machine type from the vehicle instead of asking for it on the route', () => {
    renderPage();
    openRouteTab('routes');
    // dev-1 sits on a truck: a plain checkbox, no role dropdown.
    const typed = screen.getByTestId('member-dev-1') as HTMLInputElement;
    expect(typed.type).toBe('checkbox');
    expect(typed.checked).toBe(true);
    expect(screen.queryByRole('combobox', { name: '490154203237518' })).toBeNull();
    // dev-2 has no machine type on its vehicle: the manual role picker stays as the fallback.
    expect(screen.getByRole('combobox', { name: '490154203237519' })).toBeInTheDocument();
    // The driver assigned to the vehicle for each shift is offered as the default.
    const shift2 = screen.getByTestId('roster-dev-1-2') as HTMLSelectElement;
    expect(within(shift2).getAllByRole('option')[0]?.textContent).toMatch(/Reza Night/);
  });

  it('lets the range be custom and exports the activity to Excel', () => {
    renderPage();
    expect(rangeSeen.activity.at(-1)).toEqual({ preset: 'today' });
    fireEvent.click(screen.getByTestId('report-range-custom'));
    const last = rangeSeen.activity.at(-1) as { from?: string; to?: string; preset?: string };
    expect(last.preset).toBeUndefined();
    expect(last.from).toBeTruthy();
    expect(last.to).toBeTruthy();

    fireEvent.click(screen.getByTestId('export-activity'));
    expect(downloads.calls).toHaveLength(1);
    expect(downloads.calls[0]?.name).toMatch(/\.xlsx$/);
    expect(downloads.calls[0]?.blob.type).toMatch(/spreadsheetml/);
  });

  it('shows the daily, weekly and monthly period report and exports it', () => {
    renderPage();
    openRouteTab('periods');
    const table = screen.getByTestId('haul-period-table');
    // A quiet day is listed as zero rather than dropped.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getAllByTestId('apex-chart').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: 'By machine and driver' }));
    expect(screen.getByTestId('haul-period-details').querySelectorAll('tbody tr')).toHaveLength(1);

    fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));
    expect(rangeSeen.periods.at(-1)?.[2]).toBe('weekly');
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
    expect(rangeSeen.periods.at(-1)?.[2]).toBe('monthly');
    expect(rangeSeen.periods.at(-1)?.[3]).toBe('jalali');

    fireEvent.click(screen.getByTestId('export-periods'));
    expect(downloads.calls).toHaveLength(1);
    expect(downloads.calls[0]?.name).toMatch(/Pit-to-dump-monthly-.*\.xlsx$/);
  });
});
