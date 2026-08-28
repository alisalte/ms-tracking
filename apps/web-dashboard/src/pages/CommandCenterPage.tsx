/**
 * CommandCenterPage — device configuration over TCP (`/commands`).
 *
 * Full downstream-command flow (Meitrack MDVR GPRS Protocol V2.0):
 *   select one or many devices (meitrack protocol) → browse the command
 *   catalog by category → parameterized dialog (or direct dispatch) →
 *   POST /devices/:id/commands or POST /device-commands/bulk → async
 *   gateway write + device D82 ack → history table polls the status
 *   transitions live (single-device selection).
 *
 * Backend: fleet-management-service device-commands API (06 §11.3) → Kafka
 * command.request → device-gateway CommandDispatcher → socket write.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useDevices } from '@/api/asset.api';
import { useCommandCatalog, useCommandHistory, useIssueCommands } from '@/api/command.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { CommandCatalogPanel } from '@/components/commands/CommandCatalogPanel';
import { CommandDevicePicker } from '@/components/commands/CommandDevicePicker';
import { CommandHistoryTable } from '@/components/commands/CommandHistoryTable';
import { CommandParamDialog } from '@/components/commands/CommandParamDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { Card, PageHeader, Select } from '@/components/tailwind-ui';
import type { Device } from '@/types/asset.types';
import type { CommandDef, CommandStatus } from '@/types/command.types';

const STATUS_FILTERS: CommandStatus[] = ['QUEUED', 'SENT', 'ACKED', 'FAILED', 'EXPIRED'];

export function CommandCenterPage() {
  const { t } = useTranslation();
  const toast = useToast();

  // Deep link: /commands?device=<id> (device-popup "message") preselects the
  // device. Derived from react-router search params (not a one-shot
  // window.location read) so in-SPA navigation to a new ?device= stays live.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkedId = searchParams.get('device');
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    deepLinkedId ? [deepLinkedId] : [],
  );
  const [statusFilter, setStatusFilter] = useState<CommandStatus | ''>('');
  const [configuring, setConfiguring] = useState<CommandDef | null>(null);
  const [confirming, setConfirming] = useState<CommandDef | null>(null);

  const {
    data: devices,
    isLoading: devicesLoading,
    isError: devicesIsError,
    error: devicesError,
    refetch: refetchDevices,
  } = useDevices();
  const {
    data: catalog,
    isLoading: catalogLoading,
    isError: catalogIsError,
    error: catalogError,
    refetch: refetchCatalog,
  } = useCommandCatalog();

  const historyDeviceId = selectedIds.length === 1 ? (selectedIds[0] ?? null) : null;
  const {
    data: history,
    isLoading: historyLoading,
    isError: historyIsError,
    error: historyError,
    refetch: refetchHistory,
  } = useCommandHistory(historyDeviceId, statusFilter || undefined);
  const sendMutation = useIssueCommands();

  // Only meitrack devices speak the MDVR command set (backend rejects others).
  const meitrackDevices = useMemo(
    () => (devices ?? []).filter((d) => d.protocol === 'meitrack'),
    [devices],
  );
  const selectedDevices: Device[] = useMemo(
    () => meitrackDevices.filter((d) => selectedIds.includes(d.id)),
    [meitrackDevices, selectedIds],
  );
  const selectedCount = selectedIds.length;

  useEffect(() => {
    if (deepLinkedId) setSelectedIds([deepLinkedId]);
  }, [deepLinkedId]);

  const selectDevices = (next: string[]) => {
    setSelectedIds(next);
    const params = new URLSearchParams(searchParams);
    if (next.length === 1 && next[0]) params.set('device', next[0]);
    else params.delete('device');
    setSearchParams(params, { replace: true });
  };

  const dispatch = async (command: CommandDef, params: Record<string, string | number>) => {
    const result = await sendMutation.mutateAsync({
      deviceIds: selectedIds,
      commandCode: command.code,
      params,
    });
    if (result.failed.length > 0) {
      toast.error(
        t('commands.sentPartial', {
          defaultValue: 'Command {{code}} queued on {{queued}} devices; {{failed}} failed',
          code: command.code,
          queued: result.queued.length,
          failed: result.failed.length,
        }),
      );
    }
    if (result.queued.length === 0) {
      throw new Error(
        result.failed[0]?.error ?? t('commands.sentNone', { defaultValue: 'No devices queued.' }),
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('commands.title', { defaultValue: 'Command Center' })}
        description={t('commands.subtitle', {
          defaultValue:
            'Configure one device or apply the same setting to many — tracking, geo-fences, alerts, outputs, media and system commands (Meitrack MDVR).',
        })}
      />

      {devicesIsError && (
        <Card flush className="p-3">
          <ErrorState error={devicesError} onRetry={() => void refetchDevices()} />
        </Card>
      )}

      <CommandDevicePicker
        devices={meitrackDevices}
        selectedIds={selectedIds}
        onChange={selectDevices}
        loading={devicesLoading}
        disabled={devicesIsError}
      />

      {historyDeviceId && selectedDevices[0] && (
        <Card flush className="flex flex-wrap items-center gap-3 p-3">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
            {t('commands.history.title', { defaultValue: 'Command history' })}
          </h2>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CommandStatus | '')}
            wrapperClassName="w-40"
            aria-label={t('commands.history.filterStatus', { defaultValue: 'Status' })}
            options={[
              { value: '', label: t('common.all', { defaultValue: 'All' }) },
              ...STATUS_FILTERS.map((s) => ({
                value: s,
                label: t(`commands.status.${s}`, { defaultValue: s }),
              })),
            ]}
          />
          <span className="flex-1 text-xs text-gray-500 dark:text-graydark-600">
            {selectedDevices[0].imei}
          </span>
        </Card>
      )}

      {selectedCount > 1 && (
        <p className="text-xs text-gray-500 dark:text-graydark-600">
          {t('commands.history.bulkHint', {
            defaultValue:
              'Command history is shown when a single device is selected. {{count}} devices will receive the next command.',
            count: selectedCount,
          })}
        </p>
      )}

      <Card flush className="p-3">
        {catalogIsError ? (
          <ErrorState error={catalogError} onRetry={() => void refetchCatalog()} />
        ) : (
          <PermissionGate
            requires={PERMISSIONS.commandSend}
            fallback={
              <p className="p-4 text-sm text-gray-500 dark:text-graydark-600">
                {t('commands.noSendPermission', {
                  defaultValue: 'You lack permission to send commands (read-only).',
                })}
              </p>
            }
          >
            <CommandCatalogPanel
              catalog={catalog ?? []}
              loading={catalogLoading}
              disabled={selectedCount === 0}
              onConfigure={(cmd) => setConfiguring(cmd)}
              onDispatch={(cmd) => setConfirming(cmd)}
            />
          </PermissionGate>
        )}
      </Card>

      {historyDeviceId && (
        <Card flush className="p-3">
          {historyIsError ? (
            <ErrorState error={historyError} onRetry={() => void refetchHistory()} />
          ) : (
            <CommandHistoryTable rows={history ?? []} loading={historyLoading} />
          )}
        </Card>
      )}

      <CommandParamDialog
        command={configuring}
        deviceCount={selectedCount}
        onSubmit={(params) => {
          if (!configuring) return Promise.resolve();
          return dispatch(configuring, params);
        }}
        onClose={() => setConfiguring(null)}
      />

      <ConfirmDialog
        open={Boolean(confirming)}
        title={t('commands.confirm.title', {
          defaultValue: 'Send {{code}}?',
          code: confirming?.code ?? '',
        })}
        message={
          selectedCount > 1
            ? t('commands.confirm.messageBulk', {
                defaultValue:
                  'Send command {{code}} to {{count}} devices? This acts on each physical device immediately.',
                code: confirming?.code ?? '',
                count: selectedCount,
              })
            : t('commands.confirm.message', {
                defaultValue:
                  'Send command {{code}} to device {{imei}}? This acts on the physical device immediately.',
                code: confirming?.code ?? '',
                imei: selectedDevices[0]?.imei ?? '',
              })
        }
        confirmLabelKey="commands.form.send"
        loading={sendMutation.isPending}
        onConfirm={async () => {
          const cmd = confirming;
          setConfirming(null);
          if (!cmd) return;
          try {
            await dispatch(cmd, {});
            if (selectedCount > 1) {
              toast.success(
                t('commands.sentBulk', {
                  defaultValue: 'Command {{code}} queued on {{count}} devices',
                  code: cmd.code,
                  count: selectedCount,
                }),
              );
            } else {
              toast.success(
                t('commands.sent', { defaultValue: 'Command {{code}} queued', code: cmd.code }),
              );
            }
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
