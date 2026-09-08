/**
 * DeviceParameterAlarmPanel — Event settings table (vendor Parameter → Alarm).
 * Phase 1C + 2B: Refresh uses shared probe runner; snapshots via parameter-state.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandHistory, useIssueCommands } from '@/api/command.api';
import { AlarmLinkSettDrawer } from '@/components/commands/AlarmLinkSettDrawer';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, TBody, TD, TH, THead, Table } from '@/components/tailwind-ui';
import {
  ALARM_PARAMETER_EVENTS,
  type AlarmLinkSett,
  type AlarmParameterEventDef,
  alarmReadbackCommands,
  loadAllCachedSummaries,
  loadCachedLinkSett,
  loadSettMap,
  mergeB99AuthIntoSettMap,
  mergeCb8IntoSettMap,
  mergeHistoryIntoSettMap,
  parseB99AuthReply,
  parseCb8Reply,
  saveCachedLinkSett,
  saveSettMap,
  sendableAlarmLinkCommands,
} from '@/lib/device-parameter-alarm';
import {
  PARAMETER_SOURCE_DEFAULTS,
  type ParameterSnapshotSource,
  parameterSourceI18nKey,
  resolveParameterSource,
  runParameterProbes,
} from '@/lib/device-parameter-state';

interface DeviceParameterAlarmPanelProps {
  /** Target device ids (one or many of same type). */
  deviceIds: string[];
  disabled?: boolean;
}

export function DeviceParameterAlarmPanel({
  deviceIds,
  disabled = false,
}: DeviceParameterAlarmPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const sendMutation = useIssueCommands();
  const cacheDeviceId = deviceIds[0] ?? '';
  const singleDevice = deviceIds.length === 1;

  const { data: history, refetch: refetchHistory } = useCommandHistory(
    singleDevice ? cacheDeviceId : null,
  );

  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const summaries = useMemo(() => {
    void tick;
    if (!cacheDeviceId) return new Map();
    return loadAllCachedSummaries(cacheDeviceId);
  }, [cacheDeviceId, tick]);

  const [editing, setEditing] = useState<AlarmParameterEventDef | null>(null);
  const [draft, setDraft] = useState<AlarmLinkSett | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const openLink = (ev: AlarmParameterEventDef) => {
    if (!cacheDeviceId) return;
    setEditing(ev);
    setDraft(loadCachedLinkSett(cacheDeviceId, ev));
  };

  const sourceLabel = (source: ParameterSnapshotSource | string) => {
    const normalized: ParameterSnapshotSource =
      source === 'readback' || source === 'history' || source === 'set' || source === 'default'
        ? source
        : 'default';
    const key = parameterSourceI18nKey(normalized);
    return t(`commands.parameter.${key}`, {
      defaultValue: PARAMETER_SOURCE_DEFAULTS[normalized],
    });
  };

  const refresh = useCallback(async () => {
    if (!cacheDeviceId || disabled) return;

    if (!singleDevice) {
      setTick((n) => n + 1);
      toast.info(
        t('commands.parameter.refreshCacheOnly', {
          defaultValue:
            'Multi-device mode: showing local snapshot only. Open one device to read from hardware.',
        }),
      );
      return;
    }

    setRefreshing(true);
    try {
      const map = loadSettMap(cacheDeviceId);
      const hist = (await refetchHistory()).data ?? history ?? [];
      const fromHistory = mergeHistoryIntoSettMap(map, hist);

      const { gotLive } = await runParameterProbes({
        deviceId: cacheDeviceId,
        probes: alarmReadbackCommands(),
        issue: (payload) => sendMutation.mutateAsync(payload),
        onProgress: (step, total, label) => {
          setProgress(
            t('commands.parameter.refreshProgress', {
              defaultValue: 'Reading {{step}}/{{total}}: {{label}}',
              step,
              total,
              label,
            }),
          );
        },
        onAcked: (cmd, done) => {
          if (cmd.commandCode === 'B99') {
            const auth = parseB99AuthReply(done.responseText);
            if (auth) {
              mergeB99AuthIntoSettMap(map, auth);
              return true;
            }
          } else if (cmd.commandCode === 'CB8') {
            const entries = parseCb8Reply(done.responseText);
            if (entries.length > 0) {
              mergeCb8IntoSettMap(map, entries);
              return true;
            }
          }
          return false;
        },
      });

      const source = resolveParameterSource({ gotLive, fromHistory });
      saveSettMap(cacheDeviceId, map, source);
      setTick((n) => n + 1);
      await refetchHistory();

      if (gotLive) {
        toast.success(
          t('commands.parameter.refreshedDevice', {
            defaultValue: 'Merged device readback into the event table.',
          }),
        );
      } else if (fromHistory) {
        toast.success(
          t('commands.parameter.refreshedHistory', {
            defaultValue: 'No live readback; merged last ACKED command history.',
          }),
        );
      } else {
        toast.info(
          t('commands.parameter.refreshedCache', {
            defaultValue:
              'Device did not return readable B99/CB8 data; showing last local snapshot.',
          }),
        );
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setProgress(null);
      setRefreshing(false);
    }
  }, [cacheDeviceId, disabled, history, refetchHistory, sendMutation, singleDevice, t, toast]);

  const apply = async (sett: AlarmLinkSett) => {
    if (deviceIds.length === 0) return;
    const cmds = sendableAlarmLinkCommands(sett);
    if (cmds.length === 0) {
      toast.error(
        t('commands.parameter.nothingToSend', {
          defaultValue: 'Nothing to send — enable GPRS, a phone, recording, or outputs 1–2.',
        }),
      );
      return;
    }
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
        saveCachedLinkSett(id, sett, 'set');
      }
      setTick((n) => n + 1);
      setEditing(null);
      setDraft(null);
      toast.success(
        t('commands.parameter.applied', {
          defaultValue: 'Alarm link settings queued on the device.',
        }),
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="device-parameter-alarm">
      <Alert variant="info">
        {t('commands.parameter.intro', {
          defaultValue:
            'On-device Alarm Parameter (Meitrack). Mirrors the vendor app Event settings / Link Sett flow.',
        })}
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.parameter.eventSettings', { defaultValue: 'Event settings' })}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={disabled || !cacheDeviceId || refreshing}
          loading={refreshing}
          data-testid="device-parameter-refresh"
        >
          {t('commands.parameter.refresh', { defaultValue: 'Refresh' })}
        </Button>
        {progress && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">{progress}</span>
        )}
      </div>

      {disabled || deviceIds.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-graydark-600">
          {t('commands.selectProtocolFirst', {
            defaultValue: 'Choose a protocol to enable Parameter settings.',
          })}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
          <Table>
            <THead>
              <tr>
                <TH>{t('commands.parameter.colEvent', { defaultValue: 'Event' })}</TH>
                <TH>{t('commands.parameter.colHead', { defaultValue: 'Alarm head' })}</TH>
                <TH>
                  {t('commands.parameter.colDelay', { defaultValue: 'Delay recording time (S)' })}
                </TH>
                <TH>{t('commands.parameter.colSource', { defaultValue: 'Source' })}</TH>
                <TH align="end">{t('commands.parameter.colOp', { defaultValue: 'Operation' })}</TH>
              </tr>
            </THead>
            <TBody>
              {ALARM_PARAMETER_EVENTS.map((ev) => {
                const sum = summaries.get(ev.code);
                return (
                  <tr key={ev.code}>
                    <TD>
                      {t(`commands.parameter.events.${ev.labelKey}`, {
                        defaultValue: ev.defaultAlarmHead,
                      })}
                    </TD>
                    <TD>{sum?.alarmHead ?? ev.defaultAlarmHead}</TD>
                    <TD>{sum?.delayRecordingSec ?? 10}</TD>
                    <TD>
                      <span className="text-xs text-gray-500 dark:text-graydark-600">
                        {sourceLabel(sum?.source ?? 'default')}
                      </span>
                    </TD>
                    <TD align="end">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openLink(ev)}
                        data-testid={`alarm-link-sett-${ev.code}`}
                      >
                        {t('commands.parameter.linkSettShort', { defaultValue: 'Link Sett…' })}
                      </Button>
                    </TD>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      <AlarmLinkSettDrawer
        open={editing !== null}
        event={editing}
        initial={draft}
        submitting={sendMutation.isPending}
        onClose={() => {
          setEditing(null);
          setDraft(null);
        }}
        onApply={(s) => void apply(s)}
      />
    </div>
  );
}
