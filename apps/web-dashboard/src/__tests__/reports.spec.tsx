/**
 * Sprint J — Reports UI tests.
 *
 * Covers the REAL reporting-service integration (no mock analytics):
 *   1. wire hooks hit the right /reports endpoints with the documented
 *      params (preset XOR custom from/to, filters — §16/§20)
 *   2. CSV export goes through the authenticated blob client (§31)
 *   3. Overview KPI cards render backend numbers — null utilization is '—',
 *      never a fabricated 0 (§60)
 *   4. Range picker: presets + custom validation (from < to — §16)
 *   5. Trips table: rows render, View-on-Map deep-links the EXISTING map
 *      route with the trip window (§38), CSV export button works
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FleetOverviewResponse,
  exportReportCsv,
  useFleetOverview,
  useTrips,
} from '@/api/report.api';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { ReportRangePicker } from '@/components/reports/ReportRangePicker';
import { ReportsOverviewSection } from '@/components/reports/ReportsOverviewSection';
import { TripsSection } from '@/components/reports/TripsSection';
import { i18n } from '@/i18n';

// ── API mocks (client + blob download + chart stub) ─────────────────────────

const apiGetRaw = vi.fn();
const apiGetBlob = vi.fn();
const downloadBlob = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: { interceptors: { request: { use: () => {} }, response: { use: () => {} } } },
  apiGetRaw: (...a: unknown[]) => apiGetRaw(...a),
  apiGetBlob: (...a: unknown[]) => apiGetBlob(...a),
}));
vi.mock('@/lib/video-stream', () => ({
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}));
vi.mock('@/components/dashboard/EChart', () => ({
  EChart: () => createElement('div', { 'data-testid': 'echart-stub' }),
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>{children}</ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('fleetvision_use_mock', 'false');
});

// ── 1/2. Wire hooks + CSV export ────────────────────────────────────────────

describe('report wire hooks (real /reports endpoints)', () => {
  it('fetches fleet-overview with the preset param', async () => {
    apiGetRaw.mockResolvedValueOnce({ totalVehicles: 0 });
    const { result } = renderHook(() => useFleetOverview({ preset: '7d' }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual({ totalVehicles: 0 }));
    expect(apiGetRaw).toHaveBeenCalledWith('/reports/fleet-overview', { preset: '7d' });
  });

  it('sends custom from/to + vehicle filter, never both preset and range', async () => {
    apiGetRaw.mockResolvedValue({ items: [] });
    const range = { from: '2026-08-01T00:00:00Z', to: '2026-08-15T00:00:00Z' };
    const { result } = renderHook(() => useTrips(range, { vehicleId: 'v-1' }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual({ items: [] }));
    expect(apiGetRaw).toHaveBeenCalledWith('/reports/trips', {
      from: range.from,
      to: range.to,
      vehicleId: 'v-1',
      limit: 50,
    });
    const call = apiGetRaw.mock.calls[0];
    expect(call[1]).not.toHaveProperty('preset');
  });

  it('CSV export downloads the authenticated blob with the filters (§31)', async () => {
    apiGetBlob.mockResolvedValueOnce(new Blob(['csv'], { type: 'text/csv' }));
    await exportReportCsv('trips', { preset: '30d' }, { vehicleId: 'v-2' });
    expect(apiGetBlob).toHaveBeenCalledWith('/reports/export/trips', {
      preset: '30d',
      vehicleId: 'v-2',
    });
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const filename = downloadBlob.mock.calls[0][1] as string;
    expect(filename).toMatch(/^trips-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

// ── 3. Overview KPI cards ───────────────────────────────────────────────────

const overview: FleetOverviewResponse = {
  totalVehicles: 12,
  vehiclesWithTelemetry: 8,
  noTelemetryVehicles: 4,
  movingVehicles: 3,
  idleVehicles: 2,
  parkedVehicles: 3,
  totalDistanceKm: 1450.6,
  totalTrips: 26,
  totalAlarms: 7,
  openAlarms: 2,
  geofenceEvents: 15,
  avgUtilizationPct: null,
  from: '2026-08-09T00:00:00Z',
  to: '2026-08-16T00:00:00Z',
  dataAsOf: '2026-08-16T14:00:00Z',
  freshness: 'AGGREGATED',
};

describe('ReportsOverviewSection (backend KPIs only)', () => {
  it('renders the real numbers on the KPI cards', async () => {
    apiGetRaw.mockImplementation(async (url: string) =>
      url === '/reports/fleet-overview'
        ? overview
        : {
            points: [
              {
                day: '2026-08-10',
                distanceKm: 10,
                trips: 2,
                alarms: 0,
                alarmSpeeding: 0,
                alarmGeofence: 0,
                alarmOffline: 0,
                alarmOther: 0,
              },
            ],
            freshness: 'AGGREGATED' as const,
          },
    );
    render(<ReportsOverviewSection range={{ preset: '7d' }} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getAllByTestId('report-kpi')).toHaveLength(11));
    // Backend values surface verbatim.
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getByText('1.5k km')).toBeInTheDocument();
    // Freshness is labeled honestly (§44).
    expect(screen.getByTestId('report-freshness')).toHaveTextContent(/aggregated/i);
    // Charts rendered (stubbed EChart).
    expect(screen.getAllByTestId('echart-stub').length).toBeGreaterThanOrEqual(2);
  });

  it('null utilization renders "—" + no-telemetry note — never a fabricated 0 (§60)', async () => {
    apiGetRaw.mockImplementation(async (url: string) =>
      url === '/reports/fleet-overview' ? overview : { points: [] },
    );
    render(<ReportsOverviewSection range={{ preset: '7d' }} />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getAllByTestId('report-kpi').length).toBeGreaterThan(0));
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/no telemetry in range/i)).toBeInTheDocument();
  });

  it('surfaces the honest error state when the backend is unreachable', async () => {
    apiGetRaw.mockRejectedValue(new Error('network down'));
    render(<ReportsOverviewSection range={{ preset: '7d' }} />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    expect(screen.queryAllByTestId('report-kpi')).toHaveLength(0);
  });
});

// ── 4. Range picker ─────────────────────────────────────────────────────────

describe('ReportRangePicker (§16 time ranges)', () => {
  it('switches presets via chips', async () => {
    const onChange = vi.fn();
    render(<ReportRangePicker range={{ preset: '7d' }} onChange={onChange} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.click(screen.getByRole('button', { name: /yesterday/i }));
    expect(onChange).toHaveBeenCalledWith({ preset: 'yesterday' });
  });

  it('applies a custom range as UTC ISO and rejects from >= to', async () => {
    const onChange = vi.fn();
    const range = { from: new Date().toISOString(), to: new Date().toISOString() };
    render(<ReportRangePicker range={range} onChange={onChange} />, { wrapper: makeWrapper() });

    // Invalid (from === to): apply does nothing — the last valid range stays.
    fireEvent.change(screen.getByLabelText(/from/i, { selector: 'input' }), {
      target: { value: '2026-08-15T10:00' },
    });
    fireEvent.change(screen.getByLabelText(/to/i, { selector: 'input' }), {
      target: { value: '2026-08-15T10:00' },
    });
    fireEvent.click(screen.getByTestId('report-range-apply'));
    expect(onChange).not.toHaveBeenCalled();

    // Valid: converted to ISO before sending.
    fireEvent.change(screen.getByLabelText(/to/i, { selector: 'input' }), {
      target: { value: '2026-08-16T10:00' },
    });
    fireEvent.click(screen.getByTestId('report-range-apply'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const applied = onChange.mock.calls[0][0] as { from: string; to: string };
    expect(new Date(applied.from).toISOString()).toBe(applied.from);
    expect(new Date(applied.from).getTime()).toBeLessThan(new Date(applied.to).getTime());
  });
});

// ── 5. Trips section ────────────────────────────────────────────────────────

const tripRow = {
  id: 't-1',
  vehicleId: 'v-7',
  label: '11-B-22',
  startedAt: '2026-08-15T08:00:00Z',
  endedAt: '2026-08-15T09:30:00Z',
  durationSec: 5400,
  distanceKm: 92.4,
  avgSpeedKph: 61.6,
  maxSpeedKph: 98,
  startLat: 35.7,
  startLng: 51.4,
  endLat: 35.75,
  endLng: 51.45,
  idleSec: 600,
  parkingSec: 0,
};

describe('TripsSection (§9 + §38 view-on-map)', () => {
  it('renders backend rows with the View-on-Map deep link to the EXISTING map route', async () => {
    apiGetRaw.mockResolvedValue({ items: [tripRow], nextCursor: null });
    render(<TripsSection range={{ preset: '7d' }} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText('11-B-22')).toBeInTheDocument());
    expect(screen.getByText('92.4 km')).toBeInTheDocument();
    expect(screen.getByText('61.6 km/h')).toBeInTheDocument();

    const viewMap = screen.getByTestId('report-trip-view-map');
    expect(viewMap).toHaveAttribute(
      'href',
      '/map?vehicle=v-7&from=2026-08-15T08%3A00%3A00Z&to=2026-08-15T09%3A30%3A00Z',
    );
  });

  it('exports CSV through the blob client with the active filter', async () => {
    apiGetRaw.mockResolvedValue({ items: [tripRow], nextCursor: null });
    apiGetBlob.mockResolvedValue(new Blob(['csv'], { type: 'text/csv' }));
    render(<TripsSection range={{ preset: '7d' }} />, { wrapper: makeWrapper() });

    const exportBtn = await screen.findByTestId('report-export-trips');
    await waitFor(() => expect(exportBtn).toBeEnabled());
    fireEvent.click(exportBtn);
    await waitFor(() =>
      expect(apiGetBlob).toHaveBeenCalledWith('/reports/export/trips', { preset: '7d' }),
    );
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });
});
