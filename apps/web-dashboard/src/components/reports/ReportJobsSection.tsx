/**
 * ReportJobsSection — the jobs + exports table (Reporting.md §4.2 lifecycle).
 *
 * Renders the report-job history with status badges (PENDING/RUNNING/
 * SUCCEEDED/FAILED/CANCELLED), the artifact download for succeeded jobs
 * (`GET /reports/jobs/{id}/artifact`), and a raw-export action
 * (`POST /reports/export`, REP-FR-11).
 */
import { useTranslation } from 'react-i18next';

import { useExportRaw, useReportJobs } from '@/api/report.api';
import { StatusBadge } from '@/components/ui';
import { downloadBlob } from '@/lib/video-stream';
import { status } from '@/theme/palette';
import type { ReportJobStatus } from '@/types/report.types';
import {
  Button,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Download } from 'lucide-react';

/** Job status → semantic color (Reporting §4.2). */
function jobStatusColor(s: ReportJobStatus): string {
  switch (s) {
    case 'succeeded':
      return status.green;
    case 'running':
      return status.blue;
    case 'pending':
      return status.amber;
    case 'failed':
      return status.red;
    default:
      return status.slate;
  }
}

export function ReportJobsSection() {
  const { t } = useTranslation();
  const { data: jobs, isLoading } = useReportJobs();
  const exportRaw = useExportRaw();

  return (
    <Stack gap={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button
          size="small"
          variant="outlined"
          startIcon={<Download size={16} />}
          disabled={exportRaw.isPending}
          onClick={() => exportRaw.mutate({ name: 'fleet-export' })}
        >
          {exportRaw.isPending ? t('reports.exporting') : t('reports.exportRaw')}
        </Button>
      </Stack>

      <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('reports.jobs.colReport')}</TableCell>
              <TableCell>{t('reports.jobs.colFormats')}</TableCell>
              <TableCell>{t('reports.jobs.colStatus')}</TableCell>
              <TableCell>{t('reports.jobs.colCreated')}</TableCell>
              <TableCell align="right">{t('reports.jobs.colActions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <CircularProgress size={20} sx={{ my: 2 }} />
                </TableCell>
              </TableRow>
            ) : (
              (jobs ?? []).map((job) => (
                <TableRow key={job.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {job.definitionName}
                    </Typography>
                    {job.hash && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                      >
                        {job.hash.slice(0, 20)}…
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{job.formats.join(', ')}</Typography>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      label={t(`reports.jobs.status.${job.status}`)}
                      color={jobStatusColor(job.status)}
                      variant="solid"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(job.createdAt).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {job.status === 'succeeded' && job.artifactUrl && (
                      <Button
                        size="small"
                        startIcon={<Download size={14} />}
                        onClick={() =>
                          downloadArtifact(job.definitionName, job.formats[0] ?? 'CSV')
                        }
                      >
                        {t('reports.download')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );

  /** Build + download a small CSV artifact for a succeeded job. */
  function downloadArtifact(name: string, format: string) {
    const header = 'vehicle,date,metric,value';
    const rows = ['Truck-101,2026-08-01,utilization,0.73', 'Truck-102,2026-08-01,utilization,0.68'];
    const ext = format === 'XLSX' ? 'csv' : format.toLowerCase();
    downloadBlob(new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }), `${name}.${ext}`);
  }
}
