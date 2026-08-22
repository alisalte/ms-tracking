/**
 * CommandCenterPage — device configuration over TCP (`/commands`).
 *
 * Full downstream-command flow (Meitrack MDVR GPRS Protocol V2.0):
 *   select device (meitrack protocol) → browse the command catalog by
 *   category → parameterized dialog (or direct dispatch) → POST
 *   /devices/:id/commands → async gateway write + device D82 ack →
 *   history table polls the status transitions live.
 *
 * Backend: fleet-management-service device-commands API (06 §11.3) → Kafka
 * command.request → device-gateway CommandDispatcher → socket write.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDevices } from '@/api/asset.api';
import { useCommandCatalog, useCommandHistory, useSendDeviceCommand } from '@/api/command.api';
import { PermissionGate } from '@/auth/permissions';
import { PERMISSIONS } from '@/auth/permissions';
import { CommandCatalogPanel } from '@/components/commands/CommandCatalogPanel';
import { CommandHistoryTable } from '@/components/commands/CommandHistoryTable';
import { CommandParamDialog } from '@/components/commands/CommandParamDialog';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { Card, Select } from '@/components/tailwind-ui';
import type { Device } from '@/types/asset.types';
import type { CommandDef, CommandStatus } from '@/types/command.types';

const STATUS_FILTERS: CommandStatus[] = ['QUEUED', 'SENT', 'ACKED', 'FAILED', 'EXPIRED'];

export function CommandCenterPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CommandStatus | ''>('');
  const [configuring, setConfiguring] = useState<CommandDef | null>(null);
  const [confirming, setConfirming] = useState<CommandDef | null>(null);

  const devicesQuery = useDevices();
  const catalogQuery = useCommandCatalog();
  const historyQuery = useCommandHistory(deviceId, statusFilter || undefined);
  const sendMutation = useSendDeviceCommand(deviceId);

  // Only meitrack devices speak the MDVR command set (backend rejects others).
  const meitrackDevices = useMemo(
    () => (devicesQuery.data ?? []).filter((d) => d.protocol === 'meitrack'),
    [devicesQuery.data],
  );
  const selectedDevice: Device | null = meitrackDevices.find((d) => d.id === deviceId) ?? null;

  const dispatch = async (command: CommandDef, params: Record<string, string | number>) => {
    await sendMutation.mutateAsync({ commandCode: command.code, params });
  };

  // Native-select replacement for the old Autocomplete: while devices load (or
  // none are Meitrack) the placeholder slot carries the same messaging.
  const deviceOptions = devicesQuery.isLoading
    ? [{ value: '', label: t('common.loading', { defaultValue: 'Loading…' }) }]
    : devicesQuery.data && meitrackDevices.length === 0
      ? [
          {
            value: '',
            label: t('commands.noMeitrackDevices', {
              defaultValue: 'No Meitrack devices registered',
            }),
          },
        ]
      : [
          { value: '', label: t('commands.selectDevice', { defaultValue: 'Device (IMEI)' }) },
          ...meitrackDevices.map((d) => ({
            value: d.id,
            label: `${d.imei}${d.model ? ` · ${d.model}` : ''}`,
          })),
        ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header — device picker (IMEI · model) is the flow's entry point. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t('commands.title', { defaultValue: 'Command Center' })}
          </h1>
          <p className="text-sm text-gray-500 dark:text-graydark-600">
            {t('commands.subtitle', {
              defaultValue:
                'Configure devices over TCP — tracking, geo-fences, alerts, outputs, media and system commands (Meitrack MDVR).',
            })}
          </p>
        </div>
        <Select
          value={deviceId ?? ''}
          onChange={(e) => setDeviceId(e.target.value || null)}
          wrapperClassName="w-72 max-w-full"
          disabled={devicesQuery.isLoading}
          aria-label={t('commands.selectDevice', { defaultValue: 'Device (IMEI)' })}
          options={deviceOptions}
        />
      </div>

      {selectedDevice && (
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
            {selectedDevice.imei}
          </span>
        </Card>
      )}

      <Card flush className="p-3">
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
            catalog={catalogQuery.data ?? []}
            loading={catalogQuery.isLoading}
            disabled={!selectedDevice}
            onConfigure={(cmd) => setConfiguring(cmd)}
            onDispatch={(cmd) => setConfirming(cmd)}
          />
        </PermissionGate>
      </Card>

      {selectedDevice && (
        <Card flush className="p-3">
          <CommandHistoryTable rows={historyQuery.data ?? []} loading={historyQuery.isLoading} />
        </Card>
      )}

      <CommandParamDialog
        command={configuring}
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
        message={t('commands.confirm.message', {
          defaultValue:
            'Send command {{code}} to device {{imei}}? This acts on the physical device immediately.',
          code: confirming?.code ?? '',
          imei: selectedDevice?.imei ?? '',
        })}
        confirmLabelKey="commands.form.send"
        loading={sendMutation.isPending}
        onConfirm={async () => {
          const cmd = confirming;
          setConfirming(null);
          if (!cmd) return;
          try {
            await dispatch(cmd, {});
            toast.success(
              t('commands.sent', { defaultValue: 'Command {{code}} queued', code: cmd.code }),
            );
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
