/**
 * CommandHistoryTable — the device's command history with live status badges
 * (QUEUED → SENT → ACKED/FAILED/EXPIRED). Polling is owned by the
 * useCommandHistory hook; this component is presentational.
 */
import { Tooltip, Typography } from '@mui/material';

import { StatusBadge } from '@/components/ui';
import { type Column, DataTable } from '@/components/ui';
import type { CommandStatus, DeviceCommandRecord } from '@/types/command.types';
import { COMMAND_STATUS_TONE } from '@/types/command.types';
import { useTranslation } from 'react-i18next';

interface CommandHistoryTableProps {
  rows: DeviceCommandRecord[];
  loading?: boolean;
}

export function CommandHistoryTable({ rows, loading }: CommandHistoryTableProps) {
  const { t } = useTranslation();

  const columns: Array<Column<DeviceCommandRecord>> = [
    {
      id: 'issuedAt',
      headerKey: 'commands.history.time',
      width: 150,
      nowrap: true,
      render: (r) => new Date(r.issuedAt).toLocaleString(),
    },
    {
      id: 'code',
      headerKey: 'commands.history.command',
      width: 90,
      render: (r) => (
        <Typography component="code" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
          {r.commandCode}
        </Typography>
      ),
    },
    {
      id: 'payload',
      headerKey: 'commands.history.payload',
      render: (r) => (
        <Tooltip title={r.payloadHex ? `hex: ${r.payloadHex.slice(0, 120)}…` : ''}>
          <Typography
            variant="body2"
            sx={{
              fontFamily: 'monospace',
              fontSize: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 260,
            }}
          >
            {r.payloadText ?? (r.payloadHex ? `${r.payloadHex.slice(0, 24)}…` : '—')}
          </Typography>
        </Tooltip>
      ),
    },
    {
      id: 'status',
      headerKey: 'commands.history.status',
      width: 110,
      render: (r) => (
        <StatusBadge
          label={t(`commands.status.${r.status}`, { defaultValue: r.status })}
          color={COMMAND_STATUS_TONE[r.status as CommandStatus] ?? undefined}
          variant="soft"
          size="small"
        />
      ),
    },
    {
      id: 'response',
      headerKey: 'commands.history.response',
      render: (r) => (
        <Typography
          variant="body2"
          sx={{
            fontFamily: 'monospace',
            fontSize: 12,
            color: r.error ? 'error.main' : 'text.primary',
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {r.responseText ?? r.error ?? '—'}
        </Typography>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      loading={loading}
      maxHeight="calc(100vh - 420px)"
      emptyKey="commands.history.empty"
    />
  );
}
