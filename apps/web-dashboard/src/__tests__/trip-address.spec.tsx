/**
 * TripAddress — trip start/end/stop fixes render as a reverse-geocoded
 * address, falling back to the coordinate label when no geocoder answers.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TripAddress } from '@/components/trips/TripAddress';

const apiGetRaw = vi.fn();

vi.mock('@/api/client', () => ({
  apiGetRaw: (...a: unknown[]) => apiGetRaw(...a),
  apiPostRaw: vi.fn(),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('TripAddress', () => {
  beforeEach(() => {
    apiGetRaw.mockReset();
  });

  it('shows the reverse-geocoded address of the fix', async () => {
    apiGetRaw.mockResolvedValue({
      latitude: 35.7,
      longitude: 51.4,
      formatted: 'Valiasr St, Tehran',
      components: {},
      provider: 'nominatim',
    });
    renderWithClient(<TripAddress point={{ lat: 35.7, lng: 51.4 }} fallback="35.7000, 51.4000" />);
    expect(await screen.findByText('Valiasr St, Tehran')).toBeTruthy();
    expect(apiGetRaw).toHaveBeenCalledWith('/location/reverse', { lat: 35.7, lng: 51.4 });
  });

  it('keeps the coordinate fallback when geocoding fails', async () => {
    apiGetRaw.mockImplementation(() => Promise.reject(new Error('503')));
    renderWithClient(<TripAddress point={{ lat: 35.7, lng: 51.4 }} fallback="35.7000, 51.4000" />);
    await vi.waitFor(() => expect(apiGetRaw).toHaveBeenCalled());
    expect(screen.getByText('35.7000, 51.4000')).toBeTruthy();
  });

  it('does not geocode without a fix', () => {
    renderWithClient(<TripAddress fallback="—" />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(apiGetRaw).not.toHaveBeenCalled();
  });
});
