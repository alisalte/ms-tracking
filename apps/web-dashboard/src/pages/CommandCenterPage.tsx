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
import { Autocomplete, Card, MenuItem, Stack, TextField, Typography } from '@mui/material';
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
import { PageHeader } from '@/components/ui';
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

  return (
    <Stack spacing={2}>
      <PageHeader
        compact
        title={t('commands.title', { defaultValue: 'Command Center' })}
        subtitle={t('commands.subtitle', {
          defaultValue:
            'Configure devices over TCP — tracking, geo-fences, alerts, outputs, media and system commands (Meitrack MDVR).',
        })}
        actions={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 280 }}>
            <Autocomplete
              size="small"
              sx={{ minWidth: 280 }}
              options={meitrackDevices}
              value={selectedDevice}
              onChange={(_, v) => setDeviceId(v?.id ?? null)}
              getOptionLabel={(d) => `${d.imei}${d.model ? ` · ${d.model}` : ''}`}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('commands.selectDevice', { defaultValue: 'Device (IMEI)' })}
                />
              )}
              renderOption={(props, d) => {
                const { key, ...rest } = props;
                return (
                  <li key={key} {...rest}>
                    <Stack>
                      <Typography variant="body2">{d.imei}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[d.model, d.serialNumber].filter(Boolean).join(' · ') ||
                          t('commands.noModel', { defaultValue: 'No model' })}
                      </Typography>
                    </Stack>
                  </li>
                );
              }}
              loading={devicesQuery.isLoading}
              noOptionsText={
                devicesQuery.data && meitrackDevices.length === 0
                  ? t('commands.noMeitrackDevices', {
                      defaultValue: 'No Meitrack devices registered',
                    })
                  : t('common.noData')
              }
            />
          </Stack>
        }
      />

      {selectedDevice && (
        <Card sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle2">
              {t('commands.history.title', { defaultValue: 'Command history' })}
            </Typography>
            <TextField
              select
              size="small"
              label={t('commands.history.filterStatus', { defaultValue: 'Status' })}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CommandStatus | '')}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{t('common.all', { defaultValue: 'All' })}</MenuItem>
              {STATUS_FILTERS.map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`commands.status.${s}`, { defaultValue: s })}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              {selectedDevice.imei}
              {selectedDevice.vehicleId ? '' : ''}
            </Typography>
          </Stack>
        </Card>
      )}

      <Card sx={{ p: 1.5 }}>
        <PermissionGate
          requires={PERMISSIONS.commandSend}
          fallback={
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {t('commands.noSendPermission', {
                defaultValue: 'You lack permission to send commands (read-only).',
              })}
            </Typography>
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
        <Card sx={{ p: 1.5 }}>
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
    </Stack>
  );
}
