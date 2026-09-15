import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DriverCalibrationPanel } from '@/components/video/DriverCalibrationPanel';
import { i18n } from '@/i18n';
import type { CameraChannel } from '@/types/video.types';

/** One failed CD1 row, swapped per test. */
const historyRow = vi.hoisted(() => ({
  current: { commandCode: 'CD1', status: 'FAILED', error: 'DEVICE_ERROR:FFFE' } as {
    commandCode: string;
    status: string;
    error: string | null;
  },
}));

vi.mock('@/api/command.api', () => ({
  useCommandHistory: () => ({ data: [historyRow.current], isLoading: false }),
}));

vi.mock('@/components/video/useStreamSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/video/useStreamSession')>();
  return {
    ...actual,
    useStreamSession: () => ({
      session: null,
      hlsUrl: null,
      mode: 'idle',
      onPlayerReady: () => {},
    }),
  };
});

const channel = {
  id: 'ch-mdvr-1',
  label: 'MD300 Sim · CH2',
  facing: 'driver',
  sourceType: 'site',
  sourceId: 'src-1',
  sourceLabel: 'MD300 Sim',
  codec: 'H264',
  online: true,
  recordingActive: false,
  aiEnabled: false,
  cabinCam: true,
  consentGiven: true,
  protocol: 'MEITRACK_MDVR',
  deviceId: 'device-1',
  logicalChannel: 2,
  imei: '867191086416152',
} as unknown as CameraChannel;

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(DriverCalibrationPanel, { channels: [channel], initialDeviceId: 'device-1' }),
      ),
    ),
  );
}

describe('DriverCalibrationPanel failure copy', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    historyRow.current = { commandCode: 'CD1', status: 'FAILED', error: 'DEVICE_ERROR:FFFE' };
  });

  it('explains an FFFE refusal instead of printing the raw code alone', async () => {
    renderPanel();
    const message = await screen.findByTestId('calibrate-error-message');
    expect(message.textContent).toMatch(/received the command and refused it/i);
    // The raw code still ships with it so support can trace the reply.
    expect(screen.getByTestId('calibrate-error-code').textContent).toMatch(/FFFE/);
    // FFFE on CD1 points the operator at the local app.
    expect(screen.getByText(/MT Manager\+/i)).toBeTruthy();
  });

  it('distinguishes a command that never reached the device', async () => {
    historyRow.current = { commandCode: 'CD1', status: 'FAILED', error: 'TTL_EXPIRED' };
    renderPanel();
    const message = await screen.findByTestId('calibrate-error-message');
    expect(message.textContent).toMatch(/never answered/i);
    expect(screen.queryByText(/MT Manager\+/i)).toBeNull();
  });

  it('renders the Persian copy when the UI is Farsi', async () => {
    await i18n.changeLanguage('fa');
    renderPanel();
    const message = await screen.findByTestId('calibrate-error-message');
    expect(message.textContent).toMatch(/رد کرد/);
    expect(message.textContent).not.toMatch(/FFFE/);
  });
});
