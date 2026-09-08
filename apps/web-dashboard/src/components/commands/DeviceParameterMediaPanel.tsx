/**
 * DeviceParameterMediaPanel — Parameter → Media (BB8 volume + B64 FTP photo).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandHistory, useIssueCommands } from '@/api/command.api';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Input, Select } from '@/components/tailwind-ui';
import {
  type FtpPhotoMode,
  type MediaParameterSett,
  composeMediaCommands,
  defaultMediaSett,
  loadMediaSnapshot,
  mediaReadbackCommands,
  mergeHistoryIntoMediaSett,
  mergeReplyIntoMediaSett,
  saveCachedMediaSett,
  validateMediaSett,
} from '@/lib/device-parameter-media';
import {
  PARAMETER_SOURCE_DEFAULTS,
  type ParameterSnapshotSource,
  parameterSourceI18nKey,
  resolveParameterSource,
  runParameterProbes,
} from '@/lib/device-parameter-state';

interface DeviceParameterMediaPanelProps {
  deviceIds: string[];
  disabled?: boolean;
}

export function DeviceParameterMediaPanel({
  deviceIds,
  disabled = false,
}: DeviceParameterMediaPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const sendMutation = useIssueCommands();
  const cacheDeviceId = deviceIds[0] ?? '';
  const singleDevice = deviceIds.length === 1;

  const { data: history, refetch: refetchHistory } = useCommandHistory(
    singleDevice ? cacheDeviceId : null,
  );

  const [sett, setSett] = useState<MediaParameterSett>(defaultMediaSett);
  const [source, setSource] = useState<ParameterSnapshotSource>('default');
  const [progress, setProgress] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!cacheDeviceId) {
      setSett(defaultMediaSett());
      setSource('default');
      return;
    }
    const snap = loadMediaSnapshot(cacheDeviceId);
    setSett(snap.sett);
    setSource(snap.source);
  }, [cacheDeviceId]);

  const patch = (partial: Partial<MediaParameterSett>) => {
    setSett((prev) => ({ ...prev, ...partial }));
  };

  const refresh = useCallback(async () => {
    if (!cacheDeviceId || disabled) return;

    if (!singleDevice) {
      const snap = loadMediaSnapshot(cacheDeviceId);
      setSett(snap.sett);
      setSource(snap.source);
      toast.info(
        t('commands.parameter.media.refreshCacheOnly', {
          defaultValue:
            'Multi-device mode: showing local snapshot only. Open one device to read from hardware.',
        }),
      );
      return;
    }

    setRefreshing(true);
    try {
      let next = { ...sett };
      const hist = (await refetchHistory()).data ?? history ?? [];
      const fromHist = mergeHistoryIntoMediaSett(next, hist);
      next = fromHist.sett;

      const { gotLive } = await runParameterProbes({
        deviceId: cacheDeviceId,
        probes: mediaReadbackCommands(),
        issue: (payload) => sendMutation.mutateAsync(payload),
        onProgress: (_step, _total, label) => setProgress(label),
        onAcked: (probe, done) => {
          const merged = mergeReplyIntoMediaSett(next, probe.commandCode, done.responseText);
          next = merged.sett;
          return merged.changed;
        },
      });

      await refetchHistory();
      const hist2 = (await refetchHistory()).data ?? [];
      const again = mergeHistoryIntoMediaSett(next, hist2);
      next = again.sett;

      const src = resolveParameterSource({
        gotLive: gotLive || again.changed,
        fromHistory: fromHist.changed,
        fallback: 'set',
      });
      saveCachedMediaSett(cacheDeviceId, next, src);
      setSett(next);
      setSource(src);

      if (gotLive || again.changed) {
        toast.success(
          t('commands.parameter.media.refreshedDevice', {
            defaultValue: 'Merged BB8 / B64 readback into Media settings.',
          }),
        );
      } else {
        toast.info(
          t('commands.parameter.media.refreshedCache', {
            defaultValue: 'No new media fields from device; showing local snapshot.',
          }),
        );
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setProgress(null);
      setRefreshing(false);
    }
  }, [
    cacheDeviceId,
    disabled,
    history,
    refetchHistory,
    sendMutation,
    sett,
    singleDevice,
    t,
    toast,
  ]);

  const apply = async () => {
    if (deviceIds.length === 0) return;
    const err = validateMediaSett(sett);
    if (err === 'speakerVolume') {
      toast.error(
        t('commands.parameter.media.volumeInvalid', {
          defaultValue: 'Speaker volume must be between 0 and 100.',
        }),
      );
      return;
    }
    if (err === 'ftpHost') {
      toast.error(
        t('commands.parameter.media.ftpHostRequired', {
          defaultValue: 'FTP host is required when upload mode is on.',
        }),
      );
      return;
    }
    if (err === 'ftpPort') {
      toast.error(
        t('commands.parameter.media.ftpPortInvalid', {
          defaultValue: 'FTP port must be between 1 and 65535.',
        }),
      );
      return;
    }

    const cmds = composeMediaCommands(sett);
    try {
      for (const [i, cmd] of cmds.entries()) {
        setProgress(`${i + 1}/${cmds.length} ${cmd.label}`);
        const result = await sendMutation.mutateAsync({
          deviceIds,
          commandCode: cmd.commandCode,
          params: cmd.params,
        });
        if (result.queued.length === 0) {
          throw new Error(result.failed[0]?.error ?? 'Command failed');
        }
      }
      for (const id of deviceIds) {
        saveCachedMediaSett(id, sett, 'set');
      }
      setSource('set');
      toast.success(
        t('commands.parameter.media.applied', {
          defaultValue: 'Media settings queued on the device.',
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const sourceLabel = t(`commands.parameter.${parameterSourceI18nKey(source)}`, {
    defaultValue: PARAMETER_SOURCE_DEFAULTS[source],
  });

  if (disabled || deviceIds.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-graydark-600">
        {t('commands.selectProtocolFirst', {
          defaultValue: 'Choose a protocol to enable Parameter settings.',
        })}
      </p>
    );
  }

  const ftpFieldsDisabled = sett.ftpMode !== '1';

  return (
    <div className="flex flex-col gap-4" data-testid="device-parameter-media">
      <Alert variant="info">
        {t('commands.parameter.media.intro', {
          defaultValue:
            'On-device Media Parameter — speaker volume (BB8) and FTP photo upload (B64). Event-linked channel recording stays under Alarm.',
        })}
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.parameter.media.title', { defaultValue: 'Media settings' })}
        </h2>
        <span className="text-xs text-gray-500 dark:text-graydark-600">{sourceLabel}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={refreshing}
          loading={refreshing}
          data-testid="device-parameter-media-refresh"
        >
          {t('commands.parameter.refresh', { defaultValue: 'Refresh' })}
        </Button>
        {progress && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">{progress}</span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label={t('commands.parameter.media.volume', { defaultValue: 'Speaker volume (%)' })}
          type="number"
          min={0}
          max={100}
          value={String(sett.speakerVolume)}
          onChange={(e) => patch({ speakerVolume: Number(e.target.value) || 0 })}
          data-testid="device-parameter-media-volume"
        />
        <Select
          label={t('commands.parameter.media.ftpMode', { defaultValue: 'FTP photo upload' })}
          value={sett.ftpMode}
          onChange={(e) => patch({ ftpMode: e.target.value as FtpPhotoMode })}
          options={[
            {
              value: '0',
              label: t('commands.parameter.media.ftpOff', { defaultValue: 'Off' }),
            },
            {
              value: '1',
              label: t('commands.parameter.media.ftpUpload', { defaultValue: 'Upload' }),
            },
            {
              value: '2',
              label: t('commands.parameter.media.ftpClear', { defaultValue: 'Clear params' }),
            },
          ]}
          data-testid="device-parameter-media-ftp-mode"
        />
        <Input
          label={t('commands.parameter.media.ftpHost', { defaultValue: 'FTP host' })}
          value={sett.ftpHost}
          onChange={(e) => patch({ ftpHost: e.target.value })}
          disabled={ftpFieldsDisabled}
          maxLength={50}
        />
        <Input
          label={t('commands.parameter.media.ftpPort', { defaultValue: 'FTP port' })}
          type="number"
          min={1}
          max={65535}
          value={sett.ftpPort}
          onChange={(e) => patch({ ftpPort: e.target.value })}
          disabled={ftpFieldsDisabled}
        />
        <Input
          label={t('commands.parameter.media.ftpUser', { defaultValue: 'FTP username' })}
          value={sett.ftpUsername}
          onChange={(e) => patch({ ftpUsername: e.target.value })}
          disabled={ftpFieldsDisabled}
          maxLength={50}
        />
        <Input
          label={t('commands.parameter.media.ftpPassword', { defaultValue: 'FTP password' })}
          type="password"
          value={sett.ftpPassword}
          onChange={(e) => patch({ ftpPassword: e.target.value })}
          disabled={ftpFieldsDisabled}
          maxLength={50}
          autoComplete="new-password"
        />
        <Input
          wrapperClassName="md:col-span-2"
          label={t('commands.parameter.media.ftpPath', { defaultValue: 'FTP path' })}
          value={sett.ftpPath}
          onChange={(e) => patch({ ftpPath: e.target.value })}
          disabled={ftpFieldsDisabled}
          maxLength={100}
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void apply()}
          loading={sendMutation.isPending && !refreshing}
          data-testid="device-parameter-media-apply"
        >
          {t('commands.parameter.setting', { defaultValue: 'Setting' })}
        </Button>
      </div>
    </div>
  );
}
