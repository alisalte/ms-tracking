import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import type { HaulCycleReport, HaulCycleRow } from '@/api/operations.api';
import { ServicesTab } from '@/components/operations/ServicesTab';
import { i18n } from '@/i18n';

const mapSeen = vi.hoisted(() => ({
  props: [] as Array<{ points: Array<{ no: number }>; zones: unknown; selectedNo: number | null }>,
}));

vi.mock('@/components/dashboard/ApexChart', () => ({
  ApexChart: () => <div data-testid="apex-chart" />,
}));

// MapLibre needs WebGL: record what the map is asked to draw instead.
vi.mock('@/components/operations/ServicePointsMap', () => ({
  LOAD_COLOR: '#0f0',
  DUMP_COLOR: '#f00',
  ServicePointsMap: (props: {
    points: Array<{ no: number }>;
    zones: unknown;
    selectedNo: number | null;
    onSelect: (no: number) => void;
  }) => {
    mapSeen.props.push(props);
    return (
      <div data-testid="service-points-map">
        {props.points.map((p) => (
          <button
            key={p.no}
            type="button"
            data-testid={`pin-${p.no}`}
            onClick={() => props.onSelect(p.no)}
          >
            {p.no}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock('@/api/geofence.api', () => ({
  useGeofences: () => ({
    data: [
      { id: 'geo-pit', name: 'Pit', status: 'ACTIVE' },
      { id: 'geo-dump', name: 'Dump', status: 'ACTIVE' },
    ],
  }),
}));

const cycle = (vehicleId: string, minute: number, shiftNo: number): HaulCycleRow => {
  const at = new Date(Date.UTC(2026, 10, 11, 4, minute)).toISOString();
  return {
    vehicleId,
    vehicleName: `Truck ${vehicleId}`,
    shovelId: null,
    shovelLabel: null,
    driverId: 'drv-1',
    driverName: 'Ali',
    driverSource: 'ROSTER',
    originEnteredAt: at,
    originLeftAt: at,
    destinationEnteredAt: at,
    loadDwellSec: 120,
    travelSec: 60,
    durationSec: 180,
    distanceKm: 0.4,
    loadPoint: { lat: 35.005 + minute / 1e5, lng: 51.005 },
    dumpPoint: { lat: 35.055, lng: 51.055 + minute / 1e5 },
    shift: shiftNo > 0 ? `2026-11-11#${shiftNo}` : 'off-shift',
    shiftDate: shiftNo > 0 ? '2026-11-11' : null,
    shiftNo,
  };
};

const cycles = [cycle('708', 0, 1), cycle('708', 20, 1), cycle('708', 40, 0), cycle('701', 10, 1)];

const report: HaulCycleReport = {
  route: {
    id: 'route-1',
    name: 'Day shift',
    originGeofenceId: 'geo-pit',
    destinationGeofenceId: 'geo-dump',
    shiftStartHour: 7,
    shiftStartMinute: 0,
    shiftDurationHours: 12,
    shiftDurationMinutes: 0,
    shiftCount: 1,
    timeZone: 'Asia/Tehran',
  },
  from: '2026-11-11T03:30:00Z',
  to: '2026-11-12T03:30:00Z',
  truncated: false,
  services: cycles.length,
  distanceKm: 1.6,
  cycles,
  byVehicle: [
    { vehicleId: '708', vehicleName: 'Truck 708', services: 3, distanceKm: 1.2, durationSec: 540 },
    { vehicleId: '701', vehicleName: 'Truck 701', services: 1, distanceKm: 0.4, durationSec: 180 },
  ],
  byDriverShift: [],
  byShift: [],
  byShovel: [],
  openHauls: [],
  unbound: [],
};

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <ServicesTab data={report} loading={false} exporting={false} onExport={() => undefined} />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('radio', { name: /machine/i }));
}

describe('services behind a count', () => {
  it('opens the services of one truck in one shift with where they loaded and dumped', () => {
    mapSeen.props.length = 0;
    renderTab();
    fireEvent.click(screen.getByTestId('vehicle-708-shift-1'));
    const details = screen.getByTestId('service-details');
    expect(
      within(details).getByTestId('service-details-list').querySelectorAll('tbody tr'),
    ).toHaveLength(2);
    const last = mapSeen.props.at(-1);
    expect(last?.points.map((p) => p.no)).toEqual([1, 2]);
    expect(last?.points[0]).toMatchObject({
      load: { lat: 35.005, lng: 51.005 },
      dump: { lat: 35.055, lng: 51.055 },
    });
    // The route's origin and destination are drawn with the pins.
    expect(last?.zones).toMatchObject({
      origin: { id: 'geo-pit' },
      destination: { id: 'geo-dump' },
    });
  });

  it('opens the off-shift services and the total of a truck separately', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('vehicle-708-shift-0'));
    expect(screen.getByTestId('service-details-list').querySelectorAll('tbody tr')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('vehicle-708-total'));
    expect(screen.getByTestId('service-details-list').querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('highlights the same service on the map and in the list', () => {
    mapSeen.props.length = 0;
    renderTab();
    fireEvent.click(screen.getByTestId('vehicle-708-total'));
    fireEvent.click(screen.getByTestId('service-row-2'));
    expect(mapSeen.props.at(-1)?.selectedNo).toBe(2);
    fireEvent.click(screen.getByTestId('pin-3'));
    expect(mapSeen.props.at(-1)?.selectedNo).toBe(3);
  });

  it('keeps a zero count as plain text', () => {
    renderTab();
    expect(screen.queryByTestId('vehicle-701-shift-0')).toBeNull();
  });
});
