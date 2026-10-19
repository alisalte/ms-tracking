import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { OperationsPage } from '@/pages/OperationsPage';

vi.mock('@/api/operations.api', () => ({
  useDeviceActivity: () => ({
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
  }),
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
  useCreateHaulRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateHaulRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveHaulRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetHaulMembers: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/api/driver.api', () => ({
  useDrivers: () => ({
    data: [
      { id: 'drv-1', firstName: 'Ali', lastName: 'Day', status: 'ACTIVE' },
      { id: 'drv-2', firstName: 'Reza', lastName: 'Night', status: 'ACTIVE' },
    ],
  }),
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
    data: [{ id: 'dev-1', imei: '490154203237518', status: 'ACTIVE', vehicleId: 'veh-1' }],
  }),
}));

describe('operations page', () => {
  it('shows a silent device and the haul form', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <OperationsPage />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('operations-page')).toBeInTheDocument();
    expect(screen.getByText('490154203237518')).toBeInTheDocument();
    expect(screen.getByTestId('activity-totals').textContent).toMatch(/12\.5/);
    expect(screen.getByTestId('haul-route-form')).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Pit' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'Dump' }).length).toBeGreaterThan(0);
    // Two 12 h shifts by default: day and night.
    expect(screen.getByTestId('shift-plan').textContent).toMatch(/06:00–18:00.*18:00–06:00/);
  });

  it('shows a driver per shift for each truck and a per-shift summary', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <OperationsPage />
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByTestId('haul-route-select'), { target: { value: 'route-1' } });
    expect(screen.getByTestId('haul-route-settings')).toBeInTheDocument();
    expect((screen.getByTestId('roster-dev-1-1') as HTMLSelectElement).value).toBe('drv-1');
    expect((screen.getByTestId('roster-dev-1-2') as HTMLSelectElement).value).toBe('drv-2');
    expect(screen.getByTestId('haul-by-shift').querySelectorAll('tbody tr')).toHaveLength(2);
  });
});
