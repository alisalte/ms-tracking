import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HaulAnalysisReport } from '@/api/operations.api';
import { HaulAnalysisSection } from '@/components/operations/HaulAnalysisSection';
import { i18n } from '@/i18n';
import { analysisSheets, minutesOf } from '@/lib/operations-export';

// ApexCharts mounts a canvas — stub the wrapper (charts are covered by the reports tests).
vi.mock('@/components/dashboard/ApexChart', () => ({
  ApexChart: () => <div data-testid="apex-chart" />,
}));

const seen = vi.hoisted(() => ({
  targets: [] as unknown[],
  geofence: [] as Array<{ id: string; payload: unknown }>,
  created: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
}));

const zeroWaste = { loadSec: 0, travelSec: 0, unloadSec: 0, returnSec: 0, totalSec: 0 };
const budget = {
  originSec: 7200,
  destinationSec: 3600,
  movingSec: 5400,
  idleOutsideSec: 1800,
  parkedSec: 0,
  noDataSec: 0,
};

const report: HaulAnalysisReport = {
  route: {
    id: 'route-1',
    name: 'Pit to dump',
    shiftStartHour: 6,
    shiftDurationHours: 12,
    shiftCount: 2,
    timeZone: 'Asia/Tehran',
  },
  from: '2026-06-01T00:00:00Z',
  to: '2026-06-02T00:00:00Z',
  truncated: false,
  services: 12,
  distanceKm: 40,
  stopMinSec: 600,
  references: {
    load: {
      samples: 12,
      referenceSec: 300,
      medianSec: 420,
      p75Sec: 600,
      maxSec: 1500,
      source: 'FLEET',
    },
    travel: {
      samples: 12,
      referenceSec: 600,
      medianSec: 660,
      p75Sec: 720,
      maxSec: 900,
      source: 'FLEET',
    },
    unload: {
      samples: 12,
      referenceSec: 180,
      medianSec: 240,
      p75Sec: 300,
      maxSec: 600,
      source: 'CONFIGURED',
    },
    return: {
      samples: 10,
      referenceSec: 500,
      medianSec: 540,
      p75Sec: 600,
      maxSec: 800,
      source: 'FLEET',
    },
  },
  cycleMedianSec: 1800,
  waste: { loadSec: 5400, travelSec: 1200, unloadSec: 600, returnSec: 300, totalSec: 7500 },
  wasteShare: 0.18,
  lostServices: 4.2,
  timeBudget: budget,
  stopCount: 1,
  stopSec: 900,
  withoutDriver: 2,
  controlLimits: { loadSec: 600, unloadSec: 300, stopSec: 600 },
  byVehicle: [
    {
      vehicleId: 'v1',
      vehicleName: 'Truck 1',
      services: 12,
      avgCycleSec: 1800,
      avgLoadSec: 420,
      avgUnloadSec: 240,
      waste: { loadSec: 5400, travelSec: 1200, unloadSec: 600, returnSec: 300, totalSec: 7500 },
      timeBudget: budget,
      stopCount: 1,
    },
  ],
  byDriver: [
    {
      driverId: 'd1',
      driverName: 'Ali Day',
      vehicleNames: ['Truck 1'],
      services: 10,
      avgLoadSec: 540,
      avgTravelSec: 650,
      avgUnloadSec: 240,
      avgReturnSec: 540,
      waste: { loadSec: 5400, travelSec: 1000, unloadSec: 500, returnSec: 200, totalSec: 7100 },
      wastePerServiceSec: 710,
      stopCount: 1,
      stopSec: 900,
    },
  ],
  byShift: [
    {
      shift: '2026-06-01#1',
      shiftDate: '2026-06-01',
      shiftNo: 1,
      services: 12,
      trucks: 1,
      avgCycleSec: 1800,
      waste: zeroWaste,
    },
  ],
  byShovel: [
    {
      shovelId: 's1',
      shovelLabel: 'Shovel A',
      loads: 12,
      avgLoadSec: 420,
      truckQueueSec: 1200,
      shovelIdleSec: 300,
    },
  ],
  cycles: [
    {
      vehicleId: 'v1',
      vehicleName: 'Truck 1',
      driverName: 'Ali Day',
      shovelLabel: 'Shovel A',
      shift: '2026-06-01#1',
      shiftDate: '2026-06-01',
      shiftNo: 1,
      originEnteredAt: '2026-06-01T03:00:00Z',
      destinationEnteredAt: '2026-06-01T03:15:00Z',
      destinationLeftAt: '2026-06-01T03:20:00Z',
      loadSec: 600,
      travelSec: 300,
      unloadSec: 300,
      returnSec: null,
      cycleSec: null,
      wasteSec: 300,
      wasteLoadSec: 300,
      wasteTravelSec: 0,
      wasteUnloadSec: 0,
      wasteReturnSec: 0,
    },
  ],
  stops: [
    {
      vehicleId: 'v1',
      vehicleName: 'Truck 1',
      driverName: 'Ali Day',
      startedAt: '2026-06-01T04:00:00Z',
      endedAt: '2026-06-01T04:15:00Z',
      durationSec: 900,
      lat: 35.03,
      lng: 51.03,
      engineOn: true,
      phase: 'LOADED',
    },
  ],
  openHauls: [
    {
      vehicleId: 'v1',
      vehicleName: 'Truck 1',
      phase: 'LOADING',
      since: '2026-06-01T05:00:00Z',
      elapsedSec: 1500,
      overdue: true,
    },
  ],
  findings: [
    {
      code: 'DRIVER_SLOW_LOAD',
      subject: 'Ali Day',
      subjectId: 'd1',
      subjectLabel: 'Ali Day',
      value: 540,
      reference: 420,
    },
    {
      code: 'NO_DRIVER',
      subject: null,
      subjectId: null,
      subjectLabel: null,
      value: 2,
      reference: 12,
    },
  ],
  unbound: [],
};

vi.mock('@/api/operations.api', () => ({
  useHaulAnalysis: (routeId: string | null, _range: unknown, targets: unknown) => {
    seen.targets.push(targets);
    return { data: routeId ? report : undefined, isError: false };
  },
  useHaulRoutes: () => ({
    data: [
      {
        id: 'route-1',
        name: 'Pit to dump',
        originGeofenceId: 'g-o',
        destinationGeofenceId: 'g-d',
        shiftStartHour: 6,
        shiftDurationHours: 12,
        shiftCount: 2,
        status: 'ACTIVE',
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/api/geofence.api', () => ({
  useGeofences: () => ({
    data: [
      { id: 'g-o', name: 'Pit', status: 'ACTIVE', alertOn: ['ENTER'], dwellSec: null },
      { id: 'g-d', name: 'Dump', status: 'ACTIVE', alertOn: ['DWELL'], dwellSec: 300 },
    ],
    isLoading: false,
  }),
  useUpdateGeofence: () => ({
    mutateAsync: async (arg: { id: string; payload: unknown }) => {
      seen.geofence.push(arg);
    },
  }),
}));

vi.mock('@/api/rule.api', () => ({
  useAlarmRules: () => ({
    data: [
      {
        id: 'old',
        name: 'Unloading limit · Pit to dump · Truck 1 #haul:route-1:unload',
        type: 'geofence_dwell',
        enabled: true,
        entityId: 'v1',
        conditions: { geofenceId: 'g-d', dwellSec: 300 },
      },
    ],
  }),
  useCreateAlarmRule: () => ({
    mutateAsync: async (payload: Record<string, unknown>) => {
      seen.created.push(payload);
    },
  }),
  useUpdateAlarmRule: () => ({ mutateAsync: vi.fn() }),
  useEnableAlarmRule: () => ({ mutateAsync: vi.fn() }),
  useDeleteAlarmRule: () => ({
    mutateAsync: async (id: string) => {
      seen.deleted.push(id);
    },
  }),
}));

function renderSection(onExport = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <HaulAnalysisSection
        routeId="route-1"
        range={{ preset: 'today' }}
        exporting={false}
        onExport={onExport}
      />
    </I18nextProvider>,
  );
  return onExport;
}

function openView(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

describe('haul analysis section', () => {
  beforeEach(() => {
    seen.targets.length = 0;
    seen.geofence.length = 0;
    seen.created.length = 0;
    seen.deleted.length = 0;
  });

  it('shows the service count, the wasted time and the lost services', () => {
    renderSection();
    expect(screen.getByTestId('kpi-services').textContent).toBe('12');
    // 7500 s = 2.08 h
    expect(screen.getByTestId('kpi-waste').textContent).toMatch(/^2\.08/);
    expect(screen.getByTestId('kpi-lost').textContent).toBe('4.2');
    expect(screen.getByTestId('analysis-phases').querySelectorAll('tbody tr')).toHaveLength(4);
    expect(screen.getByTestId('analysis-budget').querySelectorAll('tbody tr')).toHaveLength(6);
  });

  it('words each finding in minutes and lists the driver and the stop', () => {
    renderSection();
    const findings = screen.getByTestId('analysis-findings').textContent ?? '';
    expect(findings).toMatch(/Ali Day/);
    expect(findings).toMatch(/9 min/);
    expect(findings).toMatch(/7 min/);
    expect(findings).toMatch(/2 of 12 services/);
    expect(screen.getByTestId('analysis-open').textContent).toMatch(/slower than 75%/);
    openView('Drivers');
    expect(screen.getByTestId('analysis-drivers').querySelectorAll('tbody tr')).toHaveLength(1);
    openView('Long stops');
    expect(screen.getByTestId('analysis-stops').querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('turns the control limits into alert advice', () => {
    renderSection();
    openView('Targets and alerts');
    const control = screen.getByTestId('analysis-control').textContent ?? '';
    expect(control).toMatch(/longer than 10 min/);
    expect(control).toMatch(/longer than 5 min/);
  });

  it('sends typed targets only after Apply and hands the report to the export', () => {
    const onExport = renderSection();
    expect(seen.targets.at(-1)).toEqual({});
    fireEvent.change(screen.getByTestId('analysis-targetLoadMin'), { target: { value: '8' } });
    expect(seen.targets.at(-1)).toEqual({});
    fireEvent.click(screen.getByTestId('analysis-apply'));
    expect(seen.targets.at(-1)).toEqual({ targetLoadMin: '8' });

    fireEvent.click(screen.getByTestId('export-analysis'));
    expect(onExport).toHaveBeenCalledWith(report);
  });
});

describe('live over-limit alerts', () => {
  beforeEach(() => {
    seen.geofence.length = 0;
    seen.created.length = 0;
    seen.deleted.length = 0;
  });

  it('suggests the p75 limits and shows what is already on', () => {
    renderSection();
    openView('Targets and alerts');
    expect((screen.getByTestId('alert-limit-load') as HTMLInputElement).value).toBe('10');
    // The unloading alert is already on at 5 min, so that wins over the 5 min p75 suggestion.
    expect((screen.getByTestId('alert-limit-unload') as HTMLInputElement).value).toBe('5');
    expect(screen.getByTestId('alerts-status').textContent).toMatch(
      /on, over 5 min; 1 of 1 trucks/,
    );
  });

  it('applies the limits: geofence dwell first, then one rule per truck', async () => {
    renderSection();
    openView('Targets and alerts');
    fireEvent.click(screen.getByTestId('alerts-apply'));
    await waitFor(() => expect(screen.getByTestId('alerts-message').textContent).toMatch(/Done/));
    expect(seen.geofence).toEqual([
      { id: 'g-o', payload: { alertOn: ['ENTER', 'DWELL'], dwellSec: 600 } },
    ]);
    expect(seen.created).toHaveLength(1);
    expect(seen.created[0]).toMatchObject({
      type: 'geofence_dwell',
      entityId: 'v1',
      conditions: { geofenceId: 'g-o', dwellSec: 600 },
    });
    expect(seen.deleted).toEqual([]);
  });

  it('turns the alerts off by deleting only the rules it manages', async () => {
    renderSection();
    openView('Targets and alerts');
    fireEvent.click(screen.getByTestId('alerts-off'));
    await waitFor(() => expect(seen.deleted).toEqual(['old']));
  });
});

describe('analysis workbook', () => {
  it('has numeric cells in minutes for every sheet', () => {
    const t = ((key: string) => key) as never;
    const sheets = analysisSheets(report, t, 'en');
    expect(sheets.map((s) => s.name)).toHaveLength(7);
    const drivers = sheets[1];
    expect(drivers?.rows[1]?.[3]).toBe(9); // 540 s
    expect(minutesOf(null)).toBeNull();
    const cycles = sheets[6];
    expect(cycles?.rows[1]?.[11]).toBeNull(); // last service of a truck has no return
  });
});
