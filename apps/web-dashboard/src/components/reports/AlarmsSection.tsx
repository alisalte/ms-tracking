/**
 * AlarmsSection — the alarm report (Sprint J §12/§13): summary chips by
 * severity/status, severity filter, per-vehicle/type breakdown table with a
 * View Alarm link into the existing alarms page (§39), CSV export. Alarm
 * counts come from the alarm engine's records only (§63).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { exportReportCsv, useAlarmReport, type ReportRange } from '@/api/report.api';
import { getApiErrorMessage } from '@/api/errors';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable, StatusBadge, type Column } from '@/components/ui';
import { Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Bell, Download } from 'lucide-react';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export function AlarmsSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [severity, setSeverity] = useState('');
  const [exporting, setExporting] = useState(false);
  const q = useAlarmReport(range, severity ? { severity } : {});

  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label ?? '—' },
    { id: 'type', headerKey: 'reports.cols.alarmType', render: (r) => r.type },
    {
      id: 'severity',
      headerKey: 'reports.cols.severity',
      render: (r) => (
        <StatusBadge
          label={r.severity}
          tone={
            r.severity === 'CRITICAL' || r.severity === 'HIGH'
              ? 'danger'
              : r.severity === 'MEDIUM'
                ? 'warning'
                : 'neutral'
          }
        />
      ),
    },
    { id: 'total', headerKey: 'reports.cols.total', render: (r) => String(r.total) },
    { id: 'open', headerKey: 'reports.cols.open', render: (r) => String(r.open) },
    { id: 'ack', headerKey: 'reports.cols.acknowledged', render: (r) => String(r.acknowledged) },
    { id: 'resolved', headerKey: 'reports.cols.resolved', render: (r) => String(r.resolved) },
    {
      id: 'actions',
      header: '',
      render: () => (
        <Button
          size="small"
          startIcon={<Bell size={13} />}
          component="a"
          href="/alarms"
          onClick={(e) => {
            e.preventDefault();
            window.location.href = '/alarms';
          }}
          data-testid="report-alarm-view"
        >
          {t('reports.viewAlarm')}
        </Button>
      ),
    },
  ];

  const doExport = async () => {
    setExporting(true);
    try {
      await exportReportCsv('alarms', range, severity ? { severity } : {});
      toast.success(t('reports.export.done'));
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('errors.generic'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack gap={1}>
      <Stack direction="row" gap={0.5} flexWrap="wrap" alignItems="center">
        <Chip size="small" label={`${t('reports.kpi.alarms')}: ${q.data?.summary.total ?? 0}`} />
        <Chip size="small" color="error" label={`${t('reports.kpi.open')}: ${q.data?.summary.open ?? 0}`} />
        {SEVERITIES.map((s) => (
          <Chip
            key={s}
            size="small"
            variant="outlined"
            label={`${s}: ${(q.data?.summary as unknown as Record<string, number>)?.[s.toLowerCase()] ?? 0}`}
          />
        ))}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
        <TextField
          size="small"
          select
          label={t('reports.filters.severity')}
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          sx={{ minWidth: 160 }}
          slotProps={{ htmlInput: { 'aria-label': t('reports.filters.severity') } }}
          data-testid="report-severity-filter"
        >
          <MenuItem value="">{t('reports.filters.allSeverities')}</MenuItem>
          {SEVERITIES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <Button
          size="small"
          startIcon={<Download size={14} />}
          onClick={doExport}
          disabled={exporting || q.isLoading}
          data-testid="report-export-alarms"
        >
          {exporting ? t('reports.export.exporting') : t('reports.export.csv')}
        </Button>
      </Stack>
      {q.isLoading ? (
        <Typography color="text.secondary">{t('common.loading')}</Typography>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey={(r) => `${r.vehicleId ?? 'none'}-${r.type}-${r.severity}`}
          emptyKey="reports.empty"
          dense
        />
      )}
    </Stack>
  );
}
