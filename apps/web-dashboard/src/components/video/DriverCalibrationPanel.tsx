/**
 * DriverCalibrationPanel — DMS pose calibration from the video hub.
 *
 * Meitrack's MT Manager+ app does this over local Wi-Fi (AI preview with a
 * green face box). Here the operator watches the live driver camera (AB2 →
 * HLS) and sends GPRS `CD1,1` (Start DMS Calibration). The device's local
 * overlay is not on this remote stream — the dashed frame is a seating guide.
 */
import { useQueryClient } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiPost } from '@/api/client';
import { useCommandHistory } from '@/api/command.api';
import { queryKeys } from '@/api/query-keys';
import { Alert, Badge, Button, Spinner } from '@/components/tailwind-ui';
import { HLSLivePlayer } from '@/components/video/HLSLivePlayer';
import { isMdvrChannel, useStreamSession } from '@/components/video/useStreamSession';
import { mdvrDevicesFromChannels, pickDmsChannel } from '@/lib/dms-channel';
import type { CommandStatus, DeviceCommandRecord } from '@/types/command.types';
import type { CameraChannel } from '@/types/video.types';

const STATUS_COLOR: Record<CommandStatus, 'warning' | 'info' | 'success' | 'danger' | 'gray'> = {
  QUEUED: 'warning',
  SENT: 'info',
  ACKED: 'success',
  FAILED: 'danger',
  EXPIRED: 'gray',
};

interface DriverCalibrationPanelProps {
  channels: CameraChannel[];
  initialDeviceId?: string | null;
}

export function DriverCalibrationPanel({ channels, initialDeviceId }: DriverCalibrationPanelProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const devices = useMemo(() => mdvrDevicesFromChannels(channels), [channels]);
  const [deviceId, setDeviceId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [issued, setIssued] = useState<DeviceCommandRecord | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = useCommandHistory(deviceId || null);

  useEffect(() => {
    if (deviceId) return;
    if (initialDeviceId && devices.some((d) => d.deviceId === initialDeviceId)) {
      setDeviceId(initialDeviceId);
      return;
    }
    const first = devices[0];
    if (first) setDeviceId(first.deviceId);
  }, [devices, deviceId, initialDeviceId]);

  useEffect(() => {
    const mine = channels.filter((c) => isMdvrChannel(c) && c.deviceId === deviceId);
    if (mine.some((c) => c.id === channelId)) return;
    setChannelId(pickDmsChannel(channels, deviceId)?.id ?? '');
  }, [channels, deviceId, channelId]);

  const deviceChannels = useMemo(
    () =>
      channels
        .filter((c) => isMdvrChannel(c) && c.deviceId === deviceId)
        .slice()
        .sort((a, b) => (a.logicalChannel ?? 99) - (b.logicalChannel ?? 99)),
    [channels, deviceId],
  );
  const channel = deviceChannels.find((c) => c.id === channelId) ?? null;
  const liveChannel = channel?.online && channel.consentGiven ? channel : null;

  const { session, hlsUrl, mode, onPlayerReady } = useStreamSession(liveChannel);
  const connecting = mode === 'mdvr' && (!hlsUrl || session?.state === 'connecting');

  const latestCd1 =
    history.data?.find((r) => r.commandCode === 'CD1') ??
    (issued?.deviceId === deviceId ? issued : null);

  const startCalibration = async () => {
    if (!deviceId || sending) return;
    setSending(true);
    setError(null);
    try {
      const rec = await apiPost<
        { commandCode: string; params: Record<string, string> },
        DeviceCommandRecord
      >(`/devices/${deviceId}/commands`, {
        commandCode: 'CD1',
        params: { action: '1' },
      });
      setIssued(rec);
      void qc.invalidateQueries({ queryKey: queryKeys.commands.all });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  if (devices.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6">
        <ScanLine size={40} className="text-gray-400" aria-hidden />
        <p className="text-sm text-gray-600 dark:text-graydark-700">{t('video.calibrate.empty')}</p>
        <p className="max-w-md text-center text-xs text-gray-400 dark:text-graydark-600">
          {t('video.calibrate.emptyHelp')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 md:p-3">
      <Alert variant="info" title={t('video.calibrate.title')}>
        {t('video.calibrate.instructions')}
      </Alert>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            setIssued(null);
            setError(null);
          }}
          aria-label={t('video.calibrate.device')}
          className="h-9 max-w-64 min-w-44 cursor-pointer rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
              {d.imei ? ` · ${d.imei}` : ''}
            </option>
          ))}
        </select>
        {deviceChannels.length > 1 && (
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            aria-label={t('video.calibrate.camera')}
            className="h-9 max-w-56 min-w-36 cursor-pointer rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
          >
            {deviceChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          onClick={() => void startCalibration()}
          loading={sending}
          disabled={!deviceId}
          data-testid="calibrate-start"
        >
          {t('video.calibrate.start')}
        </Button>
        {latestCd1 && (
          <Badge color={STATUS_COLOR[latestCd1.status]} dot>
            {t(`commands.status.${latestCd1.status}`, { defaultValue: latestCd1.status })}
          </Badge>
        )}
      </div>

      {error && (
        <Alert variant="danger" title={t('video.calibrate.failedTitle')}>
          {error}
        </Alert>
      )}
      {latestCd1?.status === 'ACKED' && (
        <Alert variant="success" title={t('video.calibrate.ackedTitle')}>
          {t('video.calibrate.ackedBody')}
        </Alert>
      )}
      {(latestCd1?.status === 'QUEUED' || latestCd1?.status === 'SENT') && (
        <p className="text-xs text-gray-500 dark:text-graydark-600">
          {t('video.calibrate.waiting')}
        </p>
      )}
      {latestCd1?.status === 'FAILED' && (
        <Alert variant="danger" title={t('video.calibrate.failedTitle')}>
          {latestCd1.error ?? t('video.calibrate.failedBody')}
        </Alert>
      )}

      <div
        data-testid="calibrate-video-area"
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-black dark:border-white/10"
      >
        {mode === 'mdvr' && (
          <HLSLivePlayer hlsUrl={hlsUrl} muted onReady={onPlayerReady} objectFit="contain" />
        )}
        {connecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Spinner size="lg" label={t('video.tile.waitingDevice')} />
          </div>
        )}
        {!liveChannel && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-sm text-gray-400">{t('video.calibrate.noPreview')}</p>
          </div>
        )}
        {liveChannel && (
          <div
            className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-dashed border-emerald-400/80"
            aria-hidden
          />
        )}
        {channel && (
          <span className="absolute bottom-2 start-2 rounded bg-black/60 px-2 py-0.5 text-xs text-gray-200">
            {channel.label}
          </span>
        )}
      </div>
    </div>
  );
}
