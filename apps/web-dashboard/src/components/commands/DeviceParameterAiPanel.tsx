/**
 * DeviceParameterAiPanel — Parameter → AI / C90 (DMS volume + behavior toggles).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandHistory, useIssueCommands } from '@/api/command.api';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Checkbox, Select } from '@/components/tailwind-ui';
import {
  type AiParameterSett,
  type DmsAlertVolume,
  type OnOffFlag,
  aiReadbackCommands,
  composeAiCommands,
  composeDmsCalibrationCommand,
  defaultAiSett,
  loadAiSnapshot,
  mergeHistoryIntoAiSett,
  mergeReplyIntoAiSett,
  saveCachedAiSett,
  validateAiSett,
} from '@/lib/device-parameter-ai';
import {
  PARAMETER_SOURCE_DEFAULTS,
  type ParameterSnapshotSource,
  parameterSourceI18nKey,
  resolveParameterSource,
  runParameterProbes,
} from '@/lib/device-parameter-state';

interface DeviceParameterAiPanelProps {
  deviceIds: string[];
  disabled?: boolean;
}

export function DeviceParameterAiPanel({
  deviceIds,
  disabled = false,
}: DeviceParameterAiPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const sendMutation = useIssueCommands();
  const cacheDeviceId = deviceIds[0] ?? '';
  const singleDevice = deviceIds.length === 1;

  const { data: history, refetch: refetchHistory } = useCommandHistory(
    singleDevice ? cacheDeviceId : null,
  );

  const [sett, setSett] = useState<AiParameterSett>(defaultAiSett);
  const [source, setSource] = useState<ParameterSnapshotSource>('default');
  const [progress, setProgress] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    if (!cacheDeviceId) {
      setSett(defaultAiSett());
      setSource('default');
      return;
    }
    const snap = loadAiSnapshot(cacheDeviceId);
    setSett(snap.sett);
    setSource(snap.source);
  }, [cacheDeviceId]);

  const patch = (partial: Partial<AiParameterSett>) => {
    setSett((prev) => ({ ...prev, ...partial }));
  };

  const setFlag = (
    key: keyof Pick<AiParameterSett, 'absence' | 'distraction' | 'smoking' | 'phoneCall'>,
    on: boolean,
  ) => {
    patch({ [key]: (on ? '1' : '0') as OnOffFlag });
  };

  const refresh = useCallback(async () => {
    if (!cacheDeviceId || disabled) return;

    if (!singleDevice) {
      const snap = loadAiSnapshot(cacheDeviceId);
      setSett(snap.sett);
      setSource(snap.source);
      toast.info(
        t('commands.parameter.ai.refreshCacheOnly', {
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
      const fromHist = mergeHistoryIntoAiSett(next, hist);
      next = fromHist.sett;

      const { gotLive } = await runParameterProbes({
        deviceId: cacheDeviceId,
        probes: aiReadbackCommands(),
        issue: (payload) => sendMutation.mutateAsync(payload),
        onProgress: (_step, _total, label) => setProgress(label),
        onAcked: (_probe, done) => {
          const merged = mergeReplyIntoAiSett(next, done.responseText);
          next = merged.sett;
          return merged.changed;
        },
      });

      await refetchHistory();
      const hist2 = (await refetchHistory()).data ?? [];
      const again = mergeHistoryIntoAiSett(next, hist2);
      next = again.sett;

      const src = resolveParameterSource({
        gotLive: gotLive || again.changed,
        fromHistory: fromHist.changed,
        fallback: 'set',
      });
      saveCachedAiSett(cacheDeviceId, next, src);
      setSett(next);
      setSource(src);

      if (gotLive || again.changed) {
        toast.success(
          t('commands.parameter.ai.refreshedDevice', {
            defaultValue: 'Merged C90 readback into AI / DMS settings.',
          }),
        );
      } else {
        toast.info(
          t('commands.parameter.ai.refreshedCache', {
            defaultValue: 'No new AI fields from device; showing local snapshot.',
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
    if (validateAiSett(sett)) {
      toast.error(
        t('commands.parameter.ai.invalid', {
          defaultValue: 'DMS settings are incomplete or invalid.',
        }),
      );
      return;
    }

    const cmds = composeAiCommands(sett);
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
        saveCachedAiSett(id, sett, 'set');
      }
      setSource('set');
      toast.success(
        t('commands.parameter.ai.applied', {
          defaultValue: 'AI / DMS settings queued on the device.',
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const startCalibration = async () => {
    if (deviceIds.length === 0) return;
    const cmd = composeDmsCalibrationCommand();
    setCalibrating(true);
    try {
      setProgress(cmd.label);
      const result = await sendMutation.mutateAsync({
        deviceIds,
        commandCode: cmd.commandCode,
        params: cmd.params,
      });
      if (result.queued.length === 0) {
        throw new Error(result.failed[0]?.error ?? 'Command failed');
      }
      toast.success(
        t('commands.parameter.ai.calibrationQueued', {
          defaultValue:
            'DMS calibration started. Driver should sit centered and look forward until the unit finishes.',
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
      setCalibrating(false);
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
    <div className="flex flex-col gap-4" data-testid="device-parameter-ai">
      <Alert variant="info">
        {t('commands.parameter.ai.intro', {
          defaultValue:
            'On-device AI / DMS Parameter (C90) — alert volume and absence, distraction, smoking, and phone-call toggles. Does not set photo/clip capture duration.',
        })}
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.parameter.ai.title', { defaultValue: 'AI / DMS settings' })}
        </h2>
        <span className="text-xs text-gray-500 dark:text-graydark-600">{sourceLabel}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={refreshing || calibrating}
          loading={refreshing}
          data-testid="device-parameter-ai-refresh"
        >
          {t('commands.parameter.refresh', { defaultValue: 'Refresh' })}
        </Button>
        {progress && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">{progress}</span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label={t('commands.parameter.ai.volume', { defaultValue: 'Alert volume' })}
          value={sett.volume}
          onChange={(e) => patch({ volume: e.target.value as DmsAlertVolume })}
          options={[
            {
              value: '0',
              label: t('commands.parameter.ai.volumeSilent', { defaultValue: 'Silent' }),
            },
            {
              value: '1',
              label: t('commands.parameter.ai.volumeMedium', { defaultValue: 'Medium' }),
            },
            {
              value: '2',
              label: t('commands.parameter.ai.volumeHigh', { defaultValue: 'High' }),
            },
            {
              value: '225',
              label: t('commands.parameter.ai.volumeDip', { defaultValue: 'DIP switch' }),
            },
          ]}
          data-testid="device-parameter-ai-volume"
        />
        <div className="flex flex-col gap-3 md:col-span-1">
          <span className="text-sm font-medium text-gray-700 dark:text-graydark-800">
            {t('commands.parameter.ai.behaviors', { defaultValue: 'Behavior alerts' })}
          </span>
          <Checkbox
            checked={sett.absence === '1'}
            onChange={(e) => setFlag('absence', e.target.checked)}
            label={t('commands.parameter.ai.absence', { defaultValue: 'Absence' })}
            data-testid="device-parameter-ai-absence"
          />
          <Checkbox
            checked={sett.distraction === '1'}
            onChange={(e) => setFlag('distraction', e.target.checked)}
            label={t('commands.parameter.ai.distraction', { defaultValue: 'Distraction' })}
          />
          <Checkbox
            checked={sett.smoking === '1'}
            onChange={(e) => setFlag('smoking', e.target.checked)}
            label={t('commands.parameter.ai.smoking', { defaultValue: 'Smoking' })}
          />
          <Checkbox
            checked={sett.phoneCall === '1'}
            onChange={(e) => setFlag('phoneCall', e.target.checked)}
            label={t('commands.parameter.ai.phoneCall', { defaultValue: 'Phone call' })}
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void startCalibration()}
          disabled={refreshing || calibrating}
          loading={calibrating}
          data-testid="device-parameter-ai-calibrate"
        >
          {t('commands.parameter.ai.calibrate', { defaultValue: 'Start DMS calibration' })}
        </Button>
        <Button
          type="button"
          onClick={() => void apply()}
          loading={sendMutation.isPending && !refreshing && !calibrating}
          data-testid="device-parameter-ai-apply"
        >
          {t('commands.parameter.setting', { defaultValue: 'Setting' })}
        </Button>
      </div>
    </div>
  );
}
