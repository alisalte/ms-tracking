/**
 * DeviceParameterTrackingPanel — Parameter → Tracking+ (A13 / A14 / A16).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandHistory, useIssueCommands } from '@/api/command.api';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Input, Select } from '@/components/tailwind-ui';
import {
  PARAMETER_SOURCE_DEFAULTS,
  type ParameterSnapshotSource,
  parameterSourceI18nKey,
  resolveParameterSource,
  runParameterProbes,
} from '@/lib/device-parameter-state';
import {
  type OnOffFlag,
  type TrackingParameterSett,
  composeTrackingCommands,
  defaultTrackingSett,
  loadTrackingSnapshot,
  mergeDb4ReplyIntoTrackingSett,
  mergeHistoryIntoTrackingSett,
  saveCachedTrackingSett,
  trackingReadbackCommands,
  validateTrackingSett,
} from '@/lib/device-parameter-tracking';

interface DeviceParameterTrackingPanelProps {
  deviceIds: string[];
  disabled?: boolean;
}

export function DeviceParameterTrackingPanel({
  deviceIds,
  disabled = false,
}: DeviceParameterTrackingPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const sendMutation = useIssueCommands();
  const cacheDeviceId = deviceIds[0] ?? '';
  const singleDevice = deviceIds.length === 1;

  const { data: history, refetch: refetchHistory } = useCommandHistory(
    singleDevice ? cacheDeviceId : null,
  );

  const [sett, setSett] = useState<TrackingParameterSett>(defaultTrackingSett);
  const [source, setSource] = useState<ParameterSnapshotSource>('default');
  const [progress, setProgress] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!cacheDeviceId) {
      setSett(defaultTrackingSett());
      setSource('default');
      return;
    }
    const snap = loadTrackingSnapshot(cacheDeviceId);
    setSett(snap.sett);
    setSource(snap.source);
  }, [cacheDeviceId]);

  const patch = (partial: Partial<TrackingParameterSett>) => {
    setSett((prev) => ({ ...prev, ...partial }));
  };

  const refresh = useCallback(async () => {
    if (!cacheDeviceId || disabled) return;

    if (!singleDevice) {
      const snap = loadTrackingSnapshot(cacheDeviceId);
      setSett(snap.sett);
      setSource(snap.source);
      toast.info(
        t('commands.parameter.tracking.refreshCacheOnly', {
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
      const fromHist = mergeHistoryIntoTrackingSett(next, hist);
      next = fromHist.sett;

      const { gotLive } = await runParameterProbes({
        deviceId: cacheDeviceId,
        probes: trackingReadbackCommands(),
        issue: (payload) => sendMutation.mutateAsync(payload),
        onProgress: (_step, _total, label) => setProgress(label),
        onAcked: (_probe, done) => {
          const merged = mergeDb4ReplyIntoTrackingSett(next, done.responseText);
          next = merged.sett;
          return merged.changed;
        },
      });

      await refetchHistory();
      const hist2 = (await refetchHistory()).data ?? [];
      const again = mergeHistoryIntoTrackingSett(next, hist2);
      next = again.sett;

      const src = resolveParameterSource({
        gotLive: gotLive || again.changed,
        fromHistory: fromHist.changed,
        fallback: 'set',
      });
      saveCachedTrackingSett(cacheDeviceId, next, src);
      setSett(next);
      setSource(src);

      if (gotLive || again.changed) {
        toast.success(
          t('commands.parameter.tracking.refreshedDevice', {
            defaultValue: 'Merged DB4 / history into Tracking settings.',
          }),
        );
      } else {
        toast.info(
          t('commands.parameter.tracking.refreshedCache', {
            defaultValue: 'No new tracking fields from device; showing local snapshot.',
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
    const err = validateTrackingSett(sett);
    if (err === 'cornerAngle') {
      toast.error(
        t('commands.parameter.tracking.angleInvalid', {
          defaultValue: 'Corner angle must be between 0 and 359.',
        }),
      );
      return;
    }
    if (err === 'distanceMeters') {
      toast.error(
        t('commands.parameter.tracking.distanceInvalid', {
          defaultValue: 'Distance must be between 0 and 65535 meters.',
        }),
      );
      return;
    }
    if (err) {
      toast.error(
        t('commands.parameter.tracking.invalid', {
          defaultValue: 'Tracking settings are incomplete or invalid.',
        }),
      );
      return;
    }

    const cmds = composeTrackingCommands(sett);
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
        saveCachedTrackingSett(id, sett, 'set');
      }
      setSource('set');
      toast.success(
        t('commands.parameter.tracking.applied', {
          defaultValue: 'Tracking settings queued on the device.',
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

  return (
    <div className="flex flex-col gap-4" data-testid="device-parameter-tracking">
      <Alert variant="info">
        {t('commands.parameter.tracking.intro', {
          defaultValue:
            'On-device Tracking Parameter — cornering (A13), distance (A14), and parking-schedule enable (A16). Time intervals A12/A15 stay under Network.',
        })}
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.parameter.tracking.title', { defaultValue: 'Tracking settings' })}
        </h2>
        <span className="text-xs text-gray-500 dark:text-graydark-600">{sourceLabel}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={refreshing}
          loading={refreshing}
          data-testid="device-parameter-tracking-refresh"
        >
          {t('commands.parameter.refresh', { defaultValue: 'Refresh' })}
        </Button>
        {progress && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">{progress}</span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label={t('commands.parameter.tracking.angle', {
            defaultValue: 'Cornering angle (°)',
          })}
          type="number"
          min={0}
          max={359}
          value={String(sett.cornerAngle)}
          onChange={(e) => patch({ cornerAngle: Number(e.target.value) || 0 })}
          hint={t('commands.parameter.tracking.angleHint', {
            defaultValue: '0 disables. Report when heading changes by more than this angle.',
          })}
          data-testid="device-parameter-tracking-angle"
        />
        <Input
          label={t('commands.parameter.tracking.distance', {
            defaultValue: 'Distance (m)',
          })}
          type="number"
          min={0}
          max={65535}
          value={String(sett.distanceMeters)}
          onChange={(e) => patch({ distanceMeters: Number(e.target.value) || 0 })}
          hint={t('commands.parameter.tracking.distanceHint', {
            defaultValue: '0 disables. 300 m recommended.',
          })}
        />
        <Select
          label={t('commands.parameter.tracking.parkingEnable', {
            defaultValue: 'Parking scheduled tracking',
          })}
          value={sett.parkingTrackingEnabled}
          onChange={(e) => patch({ parkingTrackingEnabled: e.target.value as OnOffFlag })}
          options={[
            {
              value: '1',
              label: t('commands.parameter.tracking.enabled', { defaultValue: 'Enabled' }),
            },
            {
              value: '0',
              label: t('commands.parameter.tracking.disabled', { defaultValue: 'Disabled' }),
            },
          ]}
          hint={t('commands.parameter.tracking.parkingHint', {
            defaultValue: 'When enabled, device uses A15 while engine is off (A12 while on).',
          })}
          data-testid="device-parameter-tracking-parking"
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void apply()}
          loading={sendMutation.isPending && !refreshing}
          data-testid="device-parameter-tracking-apply"
        >
          {t('commands.parameter.setting', { defaultValue: 'Setting' })}
        </Button>
      </div>
    </div>
  );
}
