/**
 * Fleet-wide tabular reports — high speeds, mileage, allowed temperature.
 * Backend rows render as the legacy report lays them out, and the Excel
 * download goes through the authenticated blob client with the filters.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { HighSpeedSection } from '@/components/reports/HighSpeedSection';
import { MileageSection } from '@/components/reports/MileageSection';
import { TemperatureSection } from '@/components/reports/TemperatureSection';
import { i18n } from '@/i18n';

const apiGetRaw = vi.fn();
const apiGetBlob = vi.fn();
const apiGet = vi.fn();
const downloadBlob = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: { interceptors: { request: { use: () => {} }, response: { use: () => {} } } },
  apiGetRaw: (...a: unknown[]) => apiGetRaw(...a),
  apiGetBlob: (...a: unknown[]) => apiGetBlob(...a),
  apiGet: (...a: unknown[]) => apiGet(...a),
}));
vi.mock('@/lib/video-stream', () => ({
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const range = { preset: 'today' as const };

beforeEach(async () => {
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'op@fleet.test',
      tenantId: 't1',
      roles: ['analyst'],
      permissions: ['report.read', 'report.export'],
    },
  });
  vi.clearAllMocks();
  apiGet.mockResolvedValue({ items: [], nextCursor: null });
  apiGetBlob.mockResolvedValue(new Blob(['x']));
  window.localStorage.setItem('fleetvision_use_mock', 'false');
  await i18n.changeLanguage('en');
});

describe('HighSpeedSection', () => {
  it('lists every speeding run with its top speed and exports Excel with the limit', async () => {
    apiGetRaw.mockImplementation(async (url: string) => {
      if (url === '/reports/overspeed') {
        return {
          from: '2026-08-31T20:30:00Z',
          to: '2026-09-01T19:30:00Z',
          limitKmh: 90,
          minDurationSec: 0,
          truncated: false,
          summary: {
            episodeCount: 1,
            vehicleCount: 1,
            maxSpeedKmh: 98,
            totalDurationSec: 248,
            discardedFixCount: 2,
          },
          items: [
            {
              vehicleId: 'v1',
              label: 'T 68-121 izst',
              fleetName: null,
              seq: 1,
              startedAt: '2026-09-01T03:24:50Z',
              endedAt: '2026-09-01T03:28:58Z',
              durationSec: 248,
              maxSpeedKmh: 98,
              avgSpeedKmh: 95,
              fixCount: 20,
              peak: { at: '2026-09-01T03:26:00Z', lat: 35.5, lng: 51.7 },
            },
          ],
        };
      }
      return null;
    });
    render(<HighSpeedSection range={range} />, { wrapper });
    await waitFor(() => expect(screen.getByText('T 68-121 izst')).toBeInTheDocument());
    expect(apiGetRaw).toHaveBeenCalledWith(
      '/reports/overspeed',
      expect.objectContaining({ preset: 'today', limitKmh: 90, minDurationSec: 0 }),
    );
    expect(screen.getByText('4m 8s')).toBeInTheDocument();
    expect(screen.getAllByText('98 km/h').length).toBeGreaterThan(0);
    expect(screen.getByText(/2 GPS fixes with impossible speeds/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Export Excel/ }));
    await waitFor(() =>
      expect(apiGetBlob).toHaveBeenCalledWith(
        '/reports/workbook/overspeed',
        expect.objectContaining({ preset: 'today', limitKmh: 90, lang: 'en' }),
      ),
    );
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
  });
});

describe('MileageSection', () => {
  it('shows fleet subtotals and the grand total', async () => {
    apiGetRaw.mockImplementation(async (url: string) => {
      if (url === '/reports/mileage') {
        return {
          from: '2026-05-21T20:30:00Z',
          to: '2026-06-20T20:30:00Z',
          hideZero: false,
          groups: [
            {
              fleetId: 'f1',
              fleetName: 'North',
              rows: [
                {
                  vehicleId: 'a',
                  label: 'T 15-612',
                  fleetId: 'f1',
                  fleetName: 'North',
                  distanceKm: 1703.56,
                  trips: 30,
                },
              ],
              subtotalKm: 1703.56,
              vehicleCount: 1,
            },
            {
              fleetId: null,
              fleetName: null,
              rows: [
                {
                  vehicleId: 'b',
                  label: 'T 15-222',
                  fleetId: null,
                  fleetName: null,
                  distanceKm: 3251.33,
                  trips: 41,
                },
              ],
              subtotalKm: 3251.33,
              vehicleCount: 1,
            },
          ],
          totalKm: 4954.89,
          vehicleCount: 2,
          hiddenZeroCount: 0,
        };
      }
      return null;
    });
    render(<MileageSection range={range} />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('report-mileage')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('T 15-612')).toBeInTheDocument());
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('No fleet')).toBeInTheDocument();
    expect(screen.getAllByText('Fleet subtotal')).toHaveLength(2);
    const total = screen.getByText('Grand total').closest('tr') as HTMLElement;
    expect(within(total).getByText('4,954.89 km')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Hide vehicles that did not move'));
    await waitFor(() =>
      expect(apiGetRaw).toHaveBeenCalledWith(
        '/reports/mileage',
        expect.objectContaining({ hideZero: true }),
      ),
    );
  });
});

describe('TemperatureSection', () => {
  const response = (items: unknown[], vehiclesWithSensors: number) => ({
    from: '2026-08-31T20:30:00Z',
    to: '2026-09-01T19:30:00Z',
    minC: null,
    maxC: 16,
    minDurationSec: 0,
    truncated: false,
    summary: {
      episodeCount: items.length,
      vehicleCount: items.length,
      vehiclesWithSensors,
      totalDurationSec: 8460,
      highestC: items.length ? 18.2 : null,
      lowestC: items.length ? 16.31 : null,
    },
    sensors: [],
    items,
  });

  it('asks the backend for periods above the legacy 16 °C limit and lists them', async () => {
    apiGetRaw.mockResolvedValue(
      response(
        [
          {
            vehicleId: 'v1',
            label: 'T 15-366 izst',
            fleetName: null,
            sensor: 'temp1',
            seq: 1,
            kind: 'HIGH',
            startedAt: '2026-08-31T20:32:27Z',
            endedAt: '2026-08-31T22:53:27Z',
            durationSec: 8460,
            minC: 16.31,
            maxC: 18.2,
            avgC: 17,
            readings: 140,
            start: { lat: 35.8, lng: 50.9 },
          },
        ],
        1,
      ),
    );
    render(<TemperatureSection range={range} />, { wrapper });
    await waitFor(() => expect(screen.getByText('T 15-366 izst')).toBeInTheDocument());
    expect(apiGetRaw).toHaveBeenCalledWith(
      '/reports/temperature',
      expect.objectContaining({ maxC: 16, minDurationSec: 0 }),
    );
    expect(apiGetRaw.mock.calls[0]?.[1]).not.toHaveProperty('minC');
    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.getByText('Above maximum')).toBeInTheDocument();
    expect(screen.getAllByText('2h 21m 0s').length).toBeGreaterThan(0);
    expect(screen.getByText('16.3 °C')).toBeInTheDocument();
  });

  it('says when no vehicle sent probe data instead of claiming all is fine', async () => {
    apiGetRaw.mockResolvedValue(response([], 0));
    render(<TemperatureSection range={range} />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByText('No vehicle sent temperature probe data in this period.'),
      ).toBeInTheDocument(),
    );
  });
});
