/**
 * Command Center — type-scoped catalog (menu) and single-device mode.
 *
 * Menu: no IMEI checklist; picking a model targets every ACTIVE unit of that
 * type and hides commands the class cannot run. Device deep-link locks the
 * page to that unit. History groups a bulk send as “sent to N devices”.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { CommandDevicePicker } from '@/components/commands/CommandDevicePicker';
import { CommandHistoryTable } from '@/components/commands/CommandHistoryTable';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { i18n } from '@/i18n';
import { mockCommandCatalog, mockCommandHistory } from '@/mock/command-data';
import { CommandCenterPage } from '@/pages/CommandCenterPage';
import type { Device } from '@/types/asset.types';
import type { DeviceCommandRecord } from '@/types/command.types';

function device(
  id: string,
  imei: string,
  status: Device['status'] = 'ACTIVE',
  model = 'MD522S',
): Device {
  return {
    id,
    tenantId: 't1',
    imei,
    serialNumber: null,
    manufacturer: 'Meitrack',
    model,
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

const MIXED_TYPE_DEVICES = [
  device('11111111-1111-1111-1111-111111111111', '866854036516451', 'ACTIVE', 'MD522S'),
  device('22222222-2222-2222-2222-222222222222', '866854036516452', 'ACTIVE', 'T622'),
  device('33333333-3333-3333-3333-333333333333', '866854036516453', 'ACTIVE', 'T622'),
];

const issueMutate = vi.fn();

vi.mock('@/api/asset.api', () => ({
  useDevices: () => ({
    data: MIXED_TYPE_DEVICES,
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
  useCommandHistory: (
    deviceId: string | null,
    _status?: string,
    options?: { tenant?: boolean },
  ) => ({
    data: mockCommandHistory(options?.tenant ? null : deviceId),
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

function wrapperFor(path: string) {
  return function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <ToastProvider>
            <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
          </ToastProvider>
        </I18nextProvider>
      </QueryClientProvider>
    );
  };
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
  it('lists device types without an IMEI checklist', () => {
    const onTypeChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <CommandDevicePicker
          devices={MIXED_TYPE_DEVICES}
          typeFilter=""
          onTypeChange={onTypeChange}
        />
      </I18nextProvider>,
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/device type/i), { target: { value: 'T622' } });
    expect(onTypeChange).toHaveBeenCalledWith('T622');
  });

  it('locks to a single device without a type list', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CommandDevicePicker
          devices={MIXED_TYPE_DEVICES}
          lockedDevice={MIXED_TYPE_DEVICES[1]}
          typeFilter=""
          onTypeChange={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText('866854036516452')).toBeInTheDocument();
    expect(screen.queryByLabelText(/device type/i)).not.toBeInTheDocument();
    expect(screen.getByText(/tracker settings/i)).toBeInTheDocument();
  });
});

describe('CommandCenterPage', () => {
  it('keeps the catalog disabled until a device type is chosen', () => {
    render(<CommandCenterPage />, { wrapper: wrapperFor('/commands') });
    expect(screen.getByText(/choose a device type to enable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /A10/i })).not.toBeInTheDocument();
  });

  it('enables tracker commands for T622 and hides MDVR media', () => {
    render(<CommandCenterPage />, { wrapper: wrapperFor('/commands') });
    fireEvent.change(screen.getByLabelText(/device type/i), { target: { value: 'T622' } });

    expect(screen.queryByText(/choose a device type to enable/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A10/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /AB2/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('command-category-media')).not.toBeInTheDocument();
  });

  it('shows media commands for an MDVR type', () => {
    render(<CommandCenterPage />, { wrapper: wrapperFor('/commands') });
    fireEvent.change(screen.getByLabelText(/device type/i), { target: { value: 'MD522S' } });

    fireEvent.click(screen.getByTestId('command-category-media'));
    expect(screen.getByRole('button', { name: /AB2/i })).toBeEnabled();
  });

  it('opens a single device from the query string without a type picker', () => {
    render(<CommandCenterPage />, {
      wrapper: wrapperFor('/commands?device=22222222-2222-2222-2222-222222222222'),
    });

    expect(screen.getByText('866854036516452')).toBeInTheDocument();
    expect(screen.queryByLabelText(/device type/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A10/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /AB2/i })).not.toBeInTheDocument();
  });

  it('shows one command category at a time', () => {
    render(<CommandCenterPage />, { wrapper: wrapperFor('/commands?type=T622') });
    expect(screen.getByTestId('command-category-tracking')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: /A10/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /B05/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('command-category-geofence'));
    expect(screen.getByRole('button', { name: /B05/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /A10/i })).not.toBeInTheDocument();
  });

  it('groups bulk history as sent-to-N and expands replies on click', () => {
    render(<CommandCenterPage />, { wrapper: wrapperFor('/commands?tab=history') });

    expect(screen.getByRole('heading', { name: /command history/i })).toBeInTheDocument();
    expect(screen.getByText(/sent to 10 devices/i)).toBeInTheDocument();
    expect(screen.queryByTestId('command-history-reply')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/sent to 10 devices/i));
    const replies = screen.getAllByTestId('command-history-reply');
    expect(replies).toHaveLength(10);
    expect(screen.getAllByText('A12,OK').length).toBeGreaterThan(0);
    expect(screen.getByText('DEVICE_OFFLINE')).toBeInTheDocument();
  });
});

describe('CommandHistoryTable grouped', () => {
  it('does not expand a single-device row', () => {
    const rows: DeviceCommandRecord[] = mockCommandHistory(
      '11111111-1111-1111-1111-111111111111',
    ).slice(0, 1);
    render(
      <I18nextProvider i18n={i18n}>
        <CommandHistoryTable rows={rows} grouped deviceLabel={() => '866854036516451'} />
      </I18nextProvider>,
    );
    expect(screen.getByText('866854036516451')).toBeInTheDocument();
    expect(screen.queryByText(/sent to/i)).not.toBeInTheDocument();
  });
});
