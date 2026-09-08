/**
 * CommandCenterPage — on-device Parameter + command history (`/commands`).
 *
 * Two entry points:
 *   - Menu: pick a *protocol* (meitrack, jt808, …). Parameter applies to every
 *     ACTIVE unit of that protocol (Meitrack Parameter UI only).
 *   - Device: `/commands?device=<id>` from the unit itself.
 *
 * Raw command catalog is hidden — use Parameter sections instead.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useDevices } from '@/api/asset.api';
import { useCommandHistory } from '@/api/command.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { CommandDevicePicker } from '@/components/commands/CommandDevicePicker';
import { CommandHistoryTable } from '@/components/commands/CommandHistoryTable';
import {
  DeviceParameterPanel,
  type ParameterSection,
  readParameterSection,
} from '@/components/commands/DeviceParameterPanel';
import { ErrorState } from '@/components/common/ErrorState';
import { Alert, Card, PageHeader, Select, Tabs } from '@/components/tailwind-ui';
import type { Device } from '@/types/asset.types';
import type { CommandStatus } from '@/types/command.types';

const STATUS_FILTERS: CommandStatus[] = ['QUEUED', 'SENT', 'ACKED', 'FAILED', 'EXPIRED'];
const PAGE_TABS = ['parameter', 'history'] as const;
type PageTab = (typeof PAGE_TABS)[number];

function readPageTab(value: string | null): PageTab {
  if (value === 'history') return 'history';
  return 'parameter';
}

export function CommandCenterPage() {
  const { t } = useTranslation();

  const [searchParams, setSearchParams] = useSearchParams();
  const lockedId = searchParams.get('device');
  const protocolFilter = searchParams.get('protocol') ?? '';
  const pageTab = readPageTab(searchParams.get('tab'));
  const parameterSection = readParameterSection(searchParams.get('section'));
  const [statusFilter, setStatusFilter] = useState<CommandStatus | ''>('');

  const {
    data: devices,
    isLoading: devicesLoading,
    isError: devicesIsError,
    error: devicesError,
    refetch: refetchDevices,
  } = useDevices();

  const allDevices = devices ?? [];
  const lockedDevice: Device | null = useMemo(
    () => allDevices.find((d) => d.id === lockedId) ?? null,
    [allDevices, lockedId],
  );

  const selectedIds = useMemo(() => {
    if (lockedDevice) return [lockedDevice.id];
    if (!protocolFilter) return [];
    return allDevices
      .filter((d) => d.protocol === protocolFilter && d.status === 'ACTIVE')
      .map((d) => d.id);
  }, [lockedDevice, protocolFilter, allDevices]);

  const selectedCount = selectedIds.length;
  const parameterSupported = lockedDevice?.protocol === 'meitrack' || protocolFilter === 'meitrack';

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

  const historyRows = useMemo(() => {
    const rows = history ?? [];
    if (lockedDevice || !protocolFilter) return rows;
    const ids = new Set(allDevices.filter((d) => d.protocol === protocolFilter).map((d) => d.id));
    return rows.filter((r) => ids.has(r.deviceId));
  }, [history, lockedDevice, protocolFilter, allDevices]);

  const deviceLabel = useMemo(() => {
    const byId = new Map(allDevices.map((d) => [d.id, d.imei] as const));
    return (id: string) => byId.get(id) ?? id;
  }, [allDevices]);

  const setProtocolFilter = (protocol: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete('device');
    params.delete('type');
    if (protocol) params.set('protocol', protocol);
    else params.delete('protocol');
    if (!params.get('tab') || params.get('tab') === 'catalog') {
      params.delete('tab');
    }
    setSearchParams(params, { replace: true });
  };

  const clearLockedDevice = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('device');
    if (lockedDevice?.protocol) params.set('protocol', lockedDevice.protocol);
    setSearchParams(params, { replace: true });
  };

  const setPageTab = (next: PageTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'parameter') {
      params.delete('tab');
    } else {
      params.set('tab', next);
      params.delete('section');
    }
    setSearchParams(params, { replace: true });
  };

  const setParameterSection = (next: ParameterSection) => {
    const params = new URLSearchParams(searchParams);
    params.delete('tab');
    if (next === 'alarm') params.delete('section');
    else params.set('section', next);
    setSearchParams(params, { replace: true });
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
            : t('commands.subtitleProtocol', {
                defaultValue:
                  'Pick a protocol to apply Parameter settings to every active device on that protocol.',
              })
        }
      />

      {devicesIsError && (
        <Card flush className="p-3">
          <ErrorState error={devicesError} onRetry={() => void refetchDevices()} />
        </Card>
      )}

      <CommandDevicePicker
        devices={allDevices}
        lockedDevice={lockedDevice}
        protocolFilter={protocolFilter}
        onProtocolChange={setProtocolFilter}
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
            value: 'parameter',
            label: t('commands.tabs.parameter', { defaultValue: 'Parameter' }),
            testid: 'commands-tab-parameter',
          },
          {
            value: 'history',
            label: t('commands.tabs.history', { defaultValue: 'History' }),
            testid: 'commands-tab-history',
          },
        ]}
      />

      {pageTab === 'parameter' && (
        <Card flush className="p-3" id="panel-parameter" role="tabpanel">
          {!parameterSupported && selectedCount > 0 ? (
            <Alert variant="info">
              {t('commands.parameter.meitrackOnly', {
                defaultValue:
                  'On-device Parameter is available for Meitrack devices. Choose the Meitrack protocol (or open a Meitrack unit).',
              })}
            </Alert>
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
              <DeviceParameterPanel
                deviceIds={selectedIds}
                disabled={selectedCount === 0 || !parameterSupported}
                section={parameterSection}
                onSectionChange={setParameterSection}
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
    </div>
  );
}
