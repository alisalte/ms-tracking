/**
 * Command Center — protocol-scoped Parameter + history.
 *
 * Menu: pick a protocol; Parameter applies to every ACTIVE unit of that
 * protocol (Meitrack Parameter UI only). Device deep-link locks to that unit.
 * History groups a bulk send as “sent to N devices”.
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
import { mockCommandHistory } from '@/mock/command-data';
import { CommandCenterPage } from '@/pages/CommandCenterPage';
import type { Device, DeviceProtocol } from '@/types/asset.types';
import type { DeviceCommandRecord } from '@/types/command.types';

function device(
  id: string,
  imei: string,
  status: Device['status'] = 'ACTIVE',
  model = 'MD522S',
  protocol: DeviceProtocol = 'meitrack',
): Device {
  return {
    id,
    tenantId: 't1',
    imei,
    serialNumber: null,
    manufacturer: protocol === 'meitrack' ? 'Meitrack' : 'Other',
    model,
    protocol,
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

const MIXED_DEVICES = [
  device('11111111-1111-1111-1111-111111111111', '866854036516451', 'ACTIVE', 'MD522S', 'meitrack'),
  device('22222222-2222-2222-2222-222222222222', '866854036516452', 'ACTIVE', 'T622', 'meitrack'),
  device('33333333-3333-3333-3333-333333333333', '866854036516453', 'ACTIVE', 'T622', 'meitrack'),
  device('44444444-4444-4444-4444-444444444444', '861234567890001', 'ACTIVE', 'JT808-A', 'jt808'),
];

const issueMutate = vi.fn();

vi.mock('@/api/asset.api', () => ({
  useDevices: () => ({
    data: MIXED_DEVICES,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/api/command.api', () => ({
  useCommandHistory: (
    deviceId: string | null,
    _status?: string,
    options?: { tenant?: boolean },
  ) => ({
    data: mockCommandHistory(options?.tenant ? null : deviceId),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(async () => ({
      data: mockCommandHistory(options?.tenant ? null : deviceId),
    })),
  }),
  useIssueCommands: () => ({
    mutateAsync: issueMutate,
    isPending: false,
  }),
  fetchDeviceCommand: vi.fn(async (id: string) => ({
    id,
    status: 'ACKED',
    responseText: 'B99,2,0,19',
    commandCode: 'B99',
    params: {},
  })),
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
  it('lists protocols without an IMEI checklist', () => {
    const onProtocolChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <CommandDevicePicker
          devices={MIXED_DEVICES}
          protocolFilter=""
          onProtocolChange={onProtocolChange}
        />
      </I18nextProvider>,
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^protocol$/i), { target: { value: 'meitrack' } });
    expect(onProtocolChange).toHaveBeenCalledWith('meitrack');
  });

  it('locks to a single device without a protocol list', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CommandDevicePicker
          devices={MIXED_DEVICES}
          lockedDevice={MIXED_DEVICES[1]}
          protocolFilter=""
          onProtocolChange={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText('866854036516452')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^protocol$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/tracker settings/i)).toBeInTheDocument();
  });
});

describe('CommandCenterPage', () => {
  it('defaults to Parameter and waits for a protocol', () => {
    render(<CommandCenterPage />, { wrapper: wrapperFor('/commands') });
    expect(screen.getByTestId('commands-tab-parameter')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('commands-tab-catalog')).not.toBeInTheDocument();
    expect(screen.getByText(/choose a protocol to enable/i)).toBeInTheDocument();
  });

  it('shows Parameter for Meitrack protocol', () => {
    render(<CommandCenterPage />, { wrapper: wrapperFor('/commands?protocol=meitrack') });

    expect(screen.getByTestId('device-parameter-alarm')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /event settings/i })).toBeInTheDocument();
  });

  it('shows Meitrack-only notice for other protocols', () => {
    render(<CommandCenterPage />, { wrapper: wrapperFor('/commands?protocol=jt808') });
    expect(screen.getByText(/available for meitrack/i)).toBeInTheDocument();
    expect(screen.queryByTestId('device-parameter-alarm')).not.toBeInTheDocument();
  });

  it('opens a single device from the query string without a protocol picker', () => {
    render(<CommandCenterPage />, {
      wrapper: wrapperFor('/commands?device=22222222-2222-2222-2222-222222222222'),
    });

    expect(screen.getByText('866854036516452')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^protocol$/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('device-parameter-alarm')).toBeInTheDocument();
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

  it('opens Parameter alarm table for Meitrack protocol', () => {
    render(<CommandCenterPage />, {
      wrapper: wrapperFor('/commands?protocol=meitrack&tab=parameter'),
    });

    expect(screen.getByTestId('device-parameter-alarm')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /event settings/i })).toBeInTheDocument();
    expect(screen.getByTestId('alarm-link-sett-19')).toBeInTheDocument();
    expect(screen.getByTestId('alarm-link-sett-16')).toBeInTheDocument();
    expect(screen.getByText(/input 8 inactive/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('alarm-link-sett-19'));
    expect(screen.getByTestId('alarm-link-sett-apply')).toBeInTheDocument();
    expect(screen.getByLabelText(/alarm head/i)).toBeInTheDocument();
    expect(screen.getByTestId('alarm-link-unsupported-ftp').querySelector('input')).toBeDisabled();
    expect(
      screen.getByTestId('alarm-link-unsupported-out-3').querySelector('input'),
    ).toBeDisabled();
  });

  it('opens Parameter Network section for Meitrack protocol', () => {
    render(<CommandCenterPage />, {
      wrapper: wrapperFor('/commands?protocol=meitrack&section=network'),
    });

    expect(screen.getByTestId('device-parameter-network')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /network settings/i })).toBeInTheDocument();
    expect(screen.getByTestId('device-parameter-network-apply')).toBeInTheDocument();
    expect(screen.getByLabelText(/primary ip/i)).toBeInTheDocument();
  });

  it('opens Parameter Tracking section for Meitrack protocol', () => {
    render(<CommandCenterPage />, {
      wrapper: wrapperFor('/commands?protocol=meitrack&section=tracking'),
    });

    expect(screen.getByTestId('device-parameter-tracking')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /tracking settings/i })).toBeInTheDocument();
    expect(screen.getByTestId('device-parameter-tracking-apply')).toBeInTheDocument();
    expect(screen.getByLabelText(/cornering angle/i)).toBeInTheDocument();
  });

  it('opens Parameter Alerts section for Meitrack protocol', () => {
    render(<CommandCenterPage />, {
      wrapper: wrapperFor('/commands?protocol=meitrack&section=alerts'),
    });

    expect(screen.getByTestId('device-parameter-alerts')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /alert settings/i })).toBeInTheDocument();
    expect(screen.getByTestId('device-parameter-alerts-apply')).toBeInTheDocument();
    expect(screen.getByLabelText(/speeding/i)).toBeInTheDocument();
  });

  it('opens Parameter Media section for Meitrack protocol', () => {
    render(<CommandCenterPage />, {
      wrapper: wrapperFor('/commands?protocol=meitrack&section=media'),
    });

    expect(screen.getByTestId('device-parameter-media')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /media settings/i })).toBeInTheDocument();
    expect(screen.getByTestId('device-parameter-media-apply')).toBeInTheDocument();
    expect(screen.getByLabelText(/speaker volume/i)).toBeInTheDocument();
  });

  it('opens Parameter AI / C90 section for Meitrack protocol', () => {
    render(<CommandCenterPage />, {
      wrapper: wrapperFor('/commands?protocol=meitrack&section=ai'),
    });

    expect(screen.getByTestId('device-parameter-ai')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /ai \/ dms settings/i })).toBeInTheDocument();
    expect(screen.getByTestId('device-parameter-ai-apply')).toBeInTheDocument();
    expect(screen.getByTestId('device-parameter-ai-calibrate')).toBeInTheDocument();
    expect(screen.getByLabelText(/alert volume/i)).toBeInTheDocument();
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
