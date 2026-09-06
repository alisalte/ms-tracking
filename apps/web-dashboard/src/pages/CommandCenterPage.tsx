/**
 * CommandCenterPage — device configuration over TCP (`/commands`).
 *
 * Two entry points:
 *   - Menu: pick a device *type* (T622, MD522S, …). The catalog is filtered
 *     to that class and the command goes to every ACTIVE unit of the type.
 *     No IMEI checklist.
 *   - Device: `/commands?device=<id>` from the unit itself. Catalog + history
 *     are only for that device.
 *
 * History in menu mode groups a bulk send as “sent to N devices”; expanding
 * a row lists each IMEI and its reply.
 */
import { useMemo, useState } from 'react';
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
import { Card, PageHeader, Select, Tabs } from '@/components/tailwind-ui';
import { commandClassFromModel, filterCatalogForClass } from '@/lib/command-capability';
import type { Device } from '@/types/asset.types';
import type { CommandDef, CommandStatus } from '@/types/command.types';

const STATUS_FILTERS: CommandStatus[] = ['QUEUED', 'SENT', 'ACKED', 'FAILED', 'EXPIRED'];
const PAGE_TABS = ['catalog', 'history'] as const;
type PageTab = (typeof PAGE_TABS)[number];

function readPageTab(value: string | null): PageTab {
  return value === 'history' ? 'history' : 'catalog';
}

export function CommandCenterPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const lockedId = searchParams.get('device');
  const typeFilter = searchParams.get('type') ?? '';
  const pageTab = readPageTab(searchParams.get('tab'));
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

  const meitrackDevices = useMemo(
    () => (devices ?? []).filter((d) => d.protocol === 'meitrack'),
    [devices],
  );
  const lockedDevice: Device | null = useMemo(
    () => meitrackDevices.find((d) => d.id === lockedId) ?? null,
    [meitrackDevices, lockedId],
  );

  const selectedIds = useMemo(() => {
    if (lockedDevice) return [lockedDevice.id];
    if (!typeFilter) return [];
    return meitrackDevices
      .filter((d) => d.model === typeFilter && d.status === 'ACTIVE')
      .map((d) => d.id);
  }, [lockedDevice, typeFilter, meitrackDevices]);

  const selectedDevices: Device[] = useMemo(
    () => meitrackDevices.filter((d) => selectedIds.includes(d.id)),
    [meitrackDevices, selectedIds],
  );
  const selectedCount = selectedIds.length;
  const deviceClass = commandClassFromModel(lockedDevice?.model ?? (typeFilter || null));
  const visibleCatalog = useMemo(
    () => filterCatalogForClass(catalog ?? [], lockedDevice || typeFilter ? deviceClass : null),
    [catalog, lockedDevice, typeFilter, deviceClass],
  );

  const historyDeviceId = lockedDevice?.id ?? null;
  const {
    data: history,
    isLoading: historyLoading,
    isError: historyIsError,
    error: historyError,
    refetch: refetchHistory,
  } = useCommandHistory(historyDeviceId, statusFilter || undefined, {
    tenant: !lockedId,
  });
  const sendMutation = useIssueCommands();

  const historyRows = useMemo(() => {
    const rows = history ?? [];
    if (lockedDevice || !typeFilter) return rows;
    const typeIds = new Set(meitrackDevices.filter((d) => d.model === typeFilter).map((d) => d.id));
    return rows.filter((r) => typeIds.has(r.deviceId));
  }, [history, lockedDevice, typeFilter, meitrackDevices]);

  const deviceLabel = useMemo(() => {
    const byId = new Map(meitrackDevices.map((d) => [d.id, d.imei] as const));
    return (id: string) => byId.get(id) ?? id;
  }, [meitrackDevices]);

  const setTypeFilter = (model: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete('device');
    if (model) params.set('type', model);
    else params.delete('type');
    setSearchParams(params, { replace: true });
  };

  const clearLockedDevice = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('device');
    if (lockedDevice?.model) params.set('type', lockedDevice.model);
    setSearchParams(params, { replace: true });
  };

  const setPageTab = (next: PageTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'catalog') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const dispatch = async (
    command: CommandDef,
    params: Record<string, string | number>,
    commandCode = command.code,
  ) => {
    const result = await sendMutation.mutateAsync({
      deviceIds: selectedIds,
      commandCode,
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
        description={
          lockedDevice
            ? t('commands.subtitleDevice', {
                defaultValue: 'Settings for this device only.',
              })
            : t('commands.subtitleType', {
                defaultValue:
                  'Pick a device type to apply the same setting to every unit of that type.',
              })
        }
      />

      {devicesIsError && (
        <Card flush className="p-3">
          <ErrorState error={devicesError} onRetry={() => void refetchDevices()} />
        </Card>
      )}

      <CommandDevicePicker
        devices={meitrackDevices}
        lockedDevice={lockedDevice}
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        onClearDevice={clearLockedDevice}
        loading={devicesLoading}
        disabled={devicesIsError}
      />

      <Tabs
        aria-label={t('commands.title', { defaultValue: 'Command Center' })}
        value={pageTab}
        onChange={setPageTab}
        tabs={[
          {
            value: 'catalog',
            label: t('commands.tabs.catalog', { defaultValue: 'Commands' }),
            testid: 'commands-tab-catalog',
          },
          {
            value: 'history',
            label: t('commands.tabs.history', { defaultValue: 'History' }),
            testid: 'commands-tab-history',
          },
        ]}
      />

      {pageTab === 'catalog' && (
        <Card flush className="p-3" id="panel-catalog" role="tabpanel">
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
                catalog={visibleCatalog}
                loading={catalogLoading}
                disabled={selectedCount === 0}
                disabledHintKey={
                  lockedId ? 'commands.selectDeviceFirst' : 'commands.selectTypeFirst'
                }
                onConfigure={(cmd) => setConfiguring(cmd)}
                onDispatch={(cmd) => setConfirming(cmd)}
              />
            </PermissionGate>
          )}
        </Card>
      )}

      {pageTab === 'history' && (
        <div id="panel-history" role="tabpanel" className="flex flex-col gap-3">
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
            {lockedDevice && (
              <span className="flex-1 text-xs text-gray-500 dark:text-graydark-600">
                {lockedDevice.imei}
              </span>
            )}
          </Card>
          <Card flush className="p-3">
            {historyIsError ? (
              <ErrorState error={historyError} onRetry={() => void refetchHistory()} />
            ) : (
              <CommandHistoryTable
                rows={historyRows}
                loading={historyLoading}
                grouped={!lockedDevice}
                deviceLabel={deviceLabel}
              />
            )}
          </Card>
        </div>
      )}

      <CommandParamDialog
        command={configuring}
        deviceCount={selectedCount}
        onSubmit={(params) => {
          if (!configuring) return Promise.resolve();
          const isRead = Object.keys(params).length === 0 && configuring.readbackCommand;
          return dispatch(
            configuring,
            params,
            isRead ? configuring.readbackCommand : configuring.code,
          );
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
