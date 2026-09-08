/**
 * DeviceParameterAlertsPanel — Parameter → Alerts+ (B07 / B10 / D79 / C03).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandHistory, useIssueCommands } from '@/api/command.api';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Input, Select } from '@/components/tailwind-ui';
import {
  type AlertsParameterSett,
  type GprsEventMode,
  alertsReadbackCommands,
  composeAlertsCommands,
  defaultAlertsSett,
  loadAlertsSnapshot,
  mergeDb4ReplyIntoAlertsSett,
  mergeHistoryIntoAlertsSett,
  saveCachedAlertsSett,
  validateAlertsSett,
} from '@/lib/device-parameter-alerts';
import {
  PARAMETER_SOURCE_DEFAULTS,
  type ParameterSnapshotSource,
  parameterSourceI18nKey,
  resolveParameterSource,
  runParameterProbes,
} from '@/lib/device-parameter-state';

interface DeviceParameterAlertsPanelProps {
  deviceIds: string[];
  disabled?: boolean;
}

export function DeviceParameterAlertsPanel({
  deviceIds,
  disabled = false,
}: DeviceParameterAlertsPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const sendMutation = useIssueCommands();
  const cacheDeviceId = deviceIds[0] ?? '';
  const singleDevice = deviceIds.length === 1;

  const { data: history, refetch: refetchHistory } = useCommandHistory(
    singleDevice ? cacheDeviceId : null,
  );

  const [sett, setSett] = useState<AlertsParameterSett>(defaultAlertsSett);
  const [source, setSource] = useState<ParameterSnapshotSource>('default');
  const [progress, setProgress] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!cacheDeviceId) {
      setSett(defaultAlertsSett());
      setSource('default');
      return;
    }
    const snap = loadAlertsSnapshot(cacheDeviceId);
    setSett(snap.sett);
    setSource(snap.source);
  }, [cacheDeviceId]);

  const patch = (partial: Partial<AlertsParameterSett>) => {
    setSett((prev) => ({ ...prev, ...partial }));
  };

  const refresh = useCallback(async () => {
    if (!cacheDeviceId || disabled) return;

    if (!singleDevice) {
      const snap = loadAlertsSnapshot(cacheDeviceId);
      setSett(snap.sett);
      setSource(snap.source);
      toast.info(
        t('commands.parameter.alerts.refreshCacheOnly', {
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
      const fromHist = mergeHistoryIntoAlertsSett(next, hist);
      next = fromHist.sett;

      const { gotLive } = await runParameterProbes({
        deviceId: cacheDeviceId,
        probes: alertsReadbackCommands(),
        issue: (payload) => sendMutation.mutateAsync(payload),
        onProgress: (_step, _total, label) => setProgress(label),
        onAcked: (_probe, done) => {
          const merged = mergeDb4ReplyIntoAlertsSett(next, done.responseText);
          next = merged.sett;
          return merged.changed;
        },
      });

      await refetchHistory();
      const hist2 = (await refetchHistory()).data ?? [];
      const again = mergeHistoryIntoAlertsSett(next, hist2);
      next = again.sett;

      const src = resolveParameterSource({
        gotLive: gotLive || again.changed,
        fromHistory: fromHist.changed,
        fallback: 'set',
      });
      saveCachedAlertsSett(cacheDeviceId, next, src);
      setSett(next);
      setSource(src);

      if (gotLive || again.changed) {
        toast.success(
          t('commands.parameter.alerts.refreshedDevice', {
            defaultValue: 'Merged DB4 / history into Alerts settings.',
          }),
        );
      } else {
        toast.info(
          t('commands.parameter.alerts.refreshedCache', {
            defaultValue:
              'No new alert fields from device; showing local snapshot (most alert cmds have no live readback).',
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
    const err = validateAlertsSett(sett);
    if (err === 'speedKmh') {
      toast.error(
        t('commands.parameter.alerts.speedInvalid', {
          defaultValue: 'Speed must be between 0 and 255 km/h.',
        }),
      );
      return;
    }
    if (err === 'towingSeconds' || err === 'towingIdleMinutes') {
      toast.error(
        t('commands.parameter.alerts.towingInvalid', {
          defaultValue: 'Towing times must be between 0 and 255.',
        }),
      );
      return;
    }
    if (err === 'harshAcceleration') {
      toast.error(
        t('commands.parameter.alerts.accelInvalid', {
          defaultValue: 'Harsh acceleration must be between 90 and 1000 mG.',
        }),
      );
      return;
    }
    if (err === 'harshBraking') {
      toast.error(
        t('commands.parameter.alerts.brakeInvalid', {
          defaultValue: 'Harsh braking must be between −1500 and −100 mG.',
        }),
      );
      return;
    }
    if (err) {
      toast.error(
        t('commands.parameter.alerts.invalid', {
          defaultValue: 'Alert settings are incomplete or invalid.',
        }),
      );
      return;
    }

    const cmds = composeAlertsCommands(sett);
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
        saveCachedAlertsSett(id, sett, 'set');
      }
      setSource('set');
      toast.success(
        t('commands.parameter.alerts.applied', {
          defaultValue: 'Alert settings queued on the device.',
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
    <div className="flex flex-col gap-4" data-testid="device-parameter-alerts">
      <Alert variant="info">
        {t('commands.parameter.alerts.intro', {
          defaultValue:
            'On-device Alerts Parameter — speeding (B07), towing (B10), harsh accel/brake (D79), GPRS event mode (C03). DMS behaviors stay under AI / C90. Towing needs deep sleep (A73=2) on device.',
        })}
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.parameter.alerts.title', { defaultValue: 'Alert settings' })}
        </h2>
        <span className="text-xs text-gray-500 dark:text-graydark-600">{sourceLabel}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={refreshing}
          loading={refreshing}
          data-testid="device-parameter-alerts-refresh"
        >
          {t('commands.parameter.refresh', { defaultValue: 'Refresh' })}
        </Button>
        {progress && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">{progress}</span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label={t('commands.parameter.alerts.speed', { defaultValue: 'Speeding (km/h)' })}
          type="number"
          min={0}
          max={255}
          value={String(sett.speedKmh)}
          onChange={(e) => patch({ speedKmh: Number(e.target.value) || 0 })}
          hint={t('commands.parameter.alerts.speedHint', {
            defaultValue: '0 disables. Event 19.',
          })}
          data-testid="device-parameter-alerts-speed"
        />
        <Select
          label={t('commands.parameter.alerts.gprsMode', { defaultValue: 'GPRS event mode' })}
          value={sett.gprsEventMode}
          onChange={(e) => patch({ gprsEventMode: e.target.value as GprsEventMode })}
          options={[
            {
              value: '0',
              label: t('commands.parameter.alerts.gprsAuto', { defaultValue: 'Automatic' }),
            },
            {
              value: '1',
              label: t('commands.parameter.alerts.gprsConfirmed', {
                defaultValue: 'Confirmed (UDP)',
              }),
            },
          ]}
        />
        <Input
          label={t('commands.parameter.alerts.towingSeconds', {
            defaultValue: 'Towing vibration (s)',
          })}
          type="number"
          min={0}
          max={255}
          value={String(sett.towingSeconds)}
          onChange={(e) => patch({ towingSeconds: Number(e.target.value) || 0 })}
          hint={t('commands.parameter.alerts.towingHint', {
            defaultValue: '0 disables. Event 36. Needs A73 deep sleep on device.',
          })}
        />
        <Input
          label={t('commands.parameter.alerts.towingIdle', {
            defaultValue: 'Towing idle (min)',
          })}
          type="number"
          min={0}
          max={255}
          value={String(sett.towingIdleMinutes)}
          onChange={(e) => patch({ towingIdleMinutes: Number(e.target.value) || 0 })}
        />
        <Input
          label={t('commands.parameter.alerts.accel', {
            defaultValue: 'Harsh acceleration (mG)',
          })}
          type="number"
          min={90}
          max={1000}
          value={String(sett.harshAcceleration)}
          onChange={(e) => patch({ harshAcceleration: Number(e.target.value) || 0 })}
        />
        <Input
          label={t('commands.parameter.alerts.brake', {
            defaultValue: 'Harsh braking (mG)',
          })}
          type="number"
          min={-1500}
          max={-100}
          value={String(sett.harshBraking)}
          onChange={(e) => patch({ harshBraking: Number(e.target.value) || 0 })}
          hint={t('commands.parameter.alerts.brakeHint', {
            defaultValue: 'Negative value (e.g. −180).',
          })}
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void apply()}
          loading={sendMutation.isPending && !refreshing}
          data-testid="device-parameter-alerts-apply"
        >
          {t('commands.parameter.setting', { defaultValue: 'Setting' })}
        </Button>
      </div>
    </div>
  );
}
