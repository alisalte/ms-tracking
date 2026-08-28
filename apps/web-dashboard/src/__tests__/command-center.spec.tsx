/**
 * Command Center — bulk device selection.
 *
 * Operators with many MDVR units must apply the same setting (interval, APN,
 * …) without picking devices one-by-one. These tests cover the picker and
 * that the catalog stays disabled until at least one device is selected.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { CommandDevicePicker } from '@/components/commands/CommandDevicePicker';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { i18n } from '@/i18n';
import { mockCommandCatalog } from '@/mock/command-data';
import { CommandCenterPage } from '@/pages/CommandCenterPage';
import type { Device } from '@/types/asset.types';

function device(id: string, imei: string, status: Device['status'] = 'ACTIVE'): Device {
  return {
    id,
    tenantId: 't1',
    imei,
    serialNumber: null,
    manufacturer: 'Meitrack',
    model: 'MD522S',
    protocol: 'meitrack',
    status,
    vehicleId: null,
    lastSeenAt: null,
    connectedAt: null,
    disconnectedAt: null,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const DEVICES = [
  device('11111111-1111-1111-1111-111111111111', '866854036516451'),
  device('22222222-2222-2222-2222-222222222222', '866854036516452'),
  device('33333333-3333-3333-3333-333333333333', '866854036516453', 'SUSPENDED'),
];

const issueMutate = vi.fn();

vi.mock('@/api/asset.api', () => ({
  useDevices: () => ({
    data: DEVICES,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/api/command.api', () => ({
  useCommandCatalog: () => ({
    data: mockCommandCatalog(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCommandHistory: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useIssueCommands: () => ({
    mutateAsync: issueMutate,
    isPending: false,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/commands']}>{children}</MemoryRouter>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  issueMutate.mockReset();
  issueMutate.mockResolvedValue({ queued: [{ id: 'c1' }], failed: [] });
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'op@fleet.test',
      tenantId: 't1',
      roles: ['fleet-admin'],
      permissions: ['telemetry.command.read', 'telemetry.command.send'],
    },
  });
});

describe('CommandDevicePicker', () => {
  it('selects every ACTIVE device and skips suspended ones', () => {
    const onChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <CommandDevicePicker devices={DEVICES} selectedIds={[]} onChange={onChange} />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /select all/i }));
    expect(onChange).toHaveBeenCalledWith([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
  });
});

describe('CommandCenterPage bulk send', () => {
  it('keeps the catalog disabled until a device is selected', () => {
    render(<CommandCenterPage />, { wrapper });
    expect(screen.getByText(/select one or more devices/i)).toBeInTheDocument();
    const a10 = screen.getByRole('button', { name: /A10/i });
    expect(a10).toBeDisabled();
  });

  it('enables the catalog for many selected devices and hides per-device history', () => {
    render(<CommandCenterPage />, { wrapper });
    const picker = screen.getByTestId('command-device-picker');
    fireEvent.click(within(picker).getByRole('button', { name: /select all/i }));

    expect(screen.queryByText(/select one or more devices/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A10/i })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: /command history/i })).not.toBeInTheDocument();
    expect(screen.getByText(/2 devices will receive/i)).toBeInTheDocument();
  });
});
