import { render, screen } from '@testing-library/react';
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
  useHaulRoutes: () => ({ data: [], isLoading: false }),
  useHaulMembers: () => ({ data: [] }),
  useHaulCycles: () => ({ data: undefined, isFetching: false }),
  useCreateHaulRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetHaulMembers: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useDevices: () => ({ data: [] }),
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
  });
});
