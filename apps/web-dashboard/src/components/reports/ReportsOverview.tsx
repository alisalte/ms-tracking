/**
 * ReportsOverview — the default "Fleet Overview" dashboard view.
 *
 * Renders the headline KPI scorecard row + the four chart widgets in a grid
 * (Analytics-Reporting.md §3.1 Dashboard composed of widgets). This is what
 * the Reports page shows by default and what the "Fleet Overview" saved
 * dashboard resolves to.
 */
import { useChartSeries } from '@/api/report.api';
import { useKpis } from '@/api/report.api';
import { KpiRow } from '@/components/reports/KpiRow';
import { ReportChart } from '@/components/reports/ReportChart';
import { Box } from '@mui/material';

export function ReportsOverview() {
  const kpis = useKpis();
  const charts = useChartSeries();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <KpiRow kpis={kpis.data ?? []} loading={kpis.isLoading} />

      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' }, gap: 2 }}
      >
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 8' } }}>
          <ReportChart series={charts.data?.[0] ?? FALLBACK_SERIES} loading={charts.isLoading} />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <ReportChart series={charts.data?.[1] ?? FALLBACK_SERIES} loading={charts.isLoading} />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 6' } }}>
          <ReportChart series={charts.data?.[2] ?? FALLBACK_SERIES} loading={charts.isLoading} />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 6' } }}>
          <ReportChart series={charts.data?.[3] ?? FALLBACK_SERIES} loading={charts.isLoading} />
        </Box>
      </Box>
    </Box>
  );
}

/** Fallback so the chart shells render with a title before data loads. */
const FALLBACK_SERIES = {
  id: 'fallback',
  kind: 'line' as const,
  titleKey: 'reports.charts.loading',
  data: [],
};
