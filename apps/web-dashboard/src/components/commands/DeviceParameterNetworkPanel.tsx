/**
 * DeviceParameterNetworkPanel — Parameter → Network (A21/A23/A11/A12/A15).
 * Phase 2B: Refresh uses shared probe runner + snapshot source helpers.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandHistory, useIssueCommands } from '@/api/command.api';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Input, Select } from '@/components/tailwind-ui';
import {
  type GprsMode,
  type NetworkParameterSett,
  composeNetworkCommands,
  defaultNetworkSett,
  loadNetworkSnapshot,
  mergeDb4ReplyIntoNetworkSett,
  mergeHistoryIntoNetworkSett,
  networkReadbackCommands,
  saveCachedNetworkSett,
  validateNetworkSett,
} from '@/lib/device-parameter-network';
import {
  PARAMETER_SOURCE_DEFAULTS,
  type ParameterSnapshotSource,
  parameterSourceI18nKey,
  resolveParameterSource,
  runParameterProbes,
} from '@/lib/device-parameter-state';

interface DeviceParameterNetworkPanelProps {
  deviceIds: string[];
  disabled?: boolean;
}

export function DeviceParameterNetworkPanel({
  deviceIds,
  disabled = false,
}: DeviceParameterNetworkPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const sendMutation = useIssueCommands();
  const cacheDeviceId = deviceIds[0] ?? '';
  const singleDevice = deviceIds.length === 1;

  const { data: history, refetch: refetchHistory } = useCommandHistory(
    singleDevice ? cacheDeviceId : null,
  );

  const [sett, setSett] = useState<NetworkParameterSett>(defaultNetworkSett);
  const [source, setSource] = useState<ParameterSnapshotSource>('default');
  const [progress, setProgress] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!cacheDeviceId) {
      setSett(defaultNetworkSett());
      setSource('default');
      return;
    }
    const snap = loadNetworkSnapshot(cacheDeviceId);
    setSett(snap.sett);
    setSource(snap.source);
  }, [cacheDeviceId]);

  const patch = (partial: Partial<NetworkParameterSett>) => {
    setSett((prev) => ({ ...prev, ...partial }));
  };

  const refresh = useCallback(async () => {
    if (!cacheDeviceId || disabled) return;

    if (!singleDevice) {
      const snap = loadNetworkSnapshot(cacheDeviceId);
      setSett(snap.sett);
      setSource(snap.source);
      toast.info(
        t('commands.parameter.network.refreshCacheOnly', {
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
      const fromHist = mergeHistoryIntoNetworkSett(next, hist);
      next = fromHist.sett;

      const { gotLive } = await runParameterProbes({
        deviceId: cacheDeviceId,
        probes: networkReadbackCommands(),
        issue: (payload) => sendMutation.mutateAsync(payload),
        onProgress: (_step, _total, label) => setProgress(label),
        onAcked: (_probe, done) => {
          const merged = mergeDb4ReplyIntoNetworkSett(next, done.responseText);
          next = merged.sett;
          return merged.changed;
        },
      });

      await refetchHistory();
      const hist2 = (await refetchHistory()).data ?? [];
      const again = mergeHistoryIntoNetworkSett(next, hist2);
      next = again.sett;

      const src = resolveParameterSource({
        gotLive: gotLive || again.changed,
        fromHistory: fromHist.changed,
        fallback: 'set',
      });
      saveCachedNetworkSett(cacheDeviceId, next, src);
      setSett(next);
      setSource(src);

      if (gotLive || again.changed) {
        toast.success(
          t('commands.parameter.network.refreshedDevice', {
            defaultValue: 'Merged DB4 / history into Network settings.',
          }),
        );
      } else {
        toast.info(
          t('commands.parameter.network.refreshedCache', {
            defaultValue: 'No new network fields from device; showing local snapshot.',
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
    const err = validateNetworkSett(sett);
    if (err === 'host') {
      toast.error(
        t('commands.parameter.network.hostRequired', {
          defaultValue: 'Primary server host is required.',
        }),
      );
      return;
    }
    if (err === 'port' || err === 'backupPort') {
      toast.error(
        t('commands.parameter.network.portInvalid', {
          defaultValue: 'Port must be between 1 and 65535.',
        }),
      );
      return;
    }

    const cmds = composeNetworkCommands(sett);
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
        saveCachedNetworkSett(id, sett, 'set');
      }
      setSource('set');
      toast.success(
        t('commands.parameter.network.applied', {
          defaultValue: 'Network settings queued on the device.',
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
    <div className="flex flex-col gap-4" data-testid="device-parameter-network">
      <Alert variant="info">
        {t('commands.parameter.network.intro', {
          defaultValue:
            'On-device Network Parameter — primary/backup GPRS server, APN, heartbeat and tracking intervals (A21/A23/A11/A12/A15).',
        })}
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.parameter.network.title', { defaultValue: 'Network settings' })}
        </h2>
        <span className="text-xs text-gray-500 dark:text-graydark-600">{sourceLabel}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={refreshing}
          loading={refreshing}
          data-testid="device-parameter-network-refresh"
        >
          {t('commands.parameter.refresh', { defaultValue: 'Refresh' })}
        </Button>
        {progress && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">{progress}</span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label={t('commands.parameter.network.mode', { defaultValue: 'Connection mode' })}
          value={sett.mode}
          onChange={(e) => patch({ mode: e.target.value as GprsMode })}
          options={[
            {
              value: '0',
              label: t('commands.parameter.network.modeOff', { defaultValue: 'Disabled' }),
            },
            { value: '1', label: 'TCP' },
            { value: '2', label: 'UDP' },
          ]}
        />
        <Input
          label={t('commands.parameter.network.host', { defaultValue: 'Primary IP / domain' })}
          value={sett.host}
          onChange={(e) => patch({ host: e.target.value })}
          maxLength={32}
        />
        <Input
          label={t('commands.parameter.network.port', { defaultValue: 'Primary port' })}
          type="number"
          min={1}
          max={65535}
          value={sett.port}
          onChange={(e) => patch({ port: e.target.value })}
        />
        <Input
          label="APN"
          value={sett.apn}
          onChange={(e) => patch({ apn: e.target.value })}
          maxLength={32}
        />
        <Input
          label={t('commands.parameter.network.apnUser', { defaultValue: 'APN user' })}
          value={sett.apnUser}
          onChange={(e) => patch({ apnUser: e.target.value })}
          maxLength={32}
        />
        <Input
          label={t('commands.parameter.network.apnPassword', { defaultValue: 'APN password' })}
          type="password"
          value={sett.apnPassword}
          onChange={(e) => patch({ apnPassword: e.target.value })}
          maxLength={32}
          autoComplete="new-password"
        />
        <Input
          label={t('commands.parameter.network.backupHost', { defaultValue: 'Backup IP / domain' })}
          value={sett.backupHost}
          onChange={(e) => patch({ backupHost: e.target.value })}
          maxLength={32}
        />
        <Input
          label={t('commands.parameter.network.backupPort', { defaultValue: 'Backup port' })}
          type="number"
          min={1}
          max={65535}
          value={sett.backupPort}
          onChange={(e) => patch({ backupPort: e.target.value })}
        />
        <Input
          label={t('commands.parameter.network.heartbeat', {
            defaultValue: 'Heartbeat (min)',
          })}
          type="number"
          min={0}
          max={65535}
          value={String(sett.heartbeatMinutes)}
          onChange={(e) => patch({ heartbeatMinutes: Number(e.target.value) || 0 })}
        />
        <Input
          label={t('commands.parameter.network.tracking', {
            defaultValue: 'Tracking interval (×10s)',
          })}
          type="number"
          min={0}
          max={65535}
          value={String(sett.trackingInterval)}
          onChange={(e) => patch({ trackingInterval: Number(e.target.value) || 0 })}
          hint={t('commands.parameter.network.trackingHint', {
            defaultValue: '6 = 60 seconds (recommended).',
          })}
        />
        <Input
          label={t('commands.parameter.network.parking', {
            defaultValue: 'Parking interval (×10s)',
          })}
          type="number"
          min={0}
          max={65535}
          value={String(sett.parkingInterval)}
          onChange={(e) => patch({ parkingInterval: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void apply()}
          loading={sendMutation.isPending && !refreshing}
          data-testid="device-parameter-network-apply"
        >
          {t('commands.parameter.setting', { defaultValue: 'Setting' })}
        </Button>
      </div>
    </div>
  );
}
