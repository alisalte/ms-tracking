/**
 * DashboardsSection — saved analytics dashboards (Analytics-Reporting.md §3.1).
 *
 * Lists the tenant's saved dashboards as cards (name, description, widget
 * count, share count). Selecting one renders its widget layout (KPI row +
 * the charts referenced by widget metricIds). The "Fleet Overview" dashboard
 * is the default.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChartSeries, useDashboards, useKpis } from '@/api/report.api';
import { KpiRow } from '@/components/reports/KpiRow';
import { ReportChart } from '@/components/reports/ReportChart';
import { shouldUseMock } from '@/lib/mock-gate';
import { mockChartSeriesById } from '@/mock/report-data';
import type { Dashboard } from '@/types/report.types';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';

export function DashboardsSection() {
  const { t } = useTranslation();
  const { data: dashboards, isLoading } = useDashboards();
  const kpis = useKpis();
  const charts = useChartSeries();
  const [selectedId, setSelectedId] = useState<string | null>('dash-overview');

  const selected = (dashboards ?? []).find((d) => d.id === selectedId) ?? null;

  return (
    <Stack gap={2}>
      {/* Saved dashboard list */}
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}
      >
        {(isLoading ? [] : (dashboards ?? [])).map((d) => (
          <Card
            key={d.id}
            variant="outlined"
            sx={{
              borderColor: d.id === selectedId ? 'primary.main' : 'divider',
              borderWidth: d.id === selectedId ? 2 : 1,
            }}
          >
            <CardActionArea onClick={() => setSelectedId(d.id)}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }} noWrap>
                  {d.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40, mt: 0.5 }}>
                  {d.description}
                </Typography>
                <Stack direction="row" gap={1} sx={{ mt: 1 }}>
                  <Chip
                    size="small"
                    label={`${d.widgets.length} ${t('reports.dashboards.widgets')}`}
                    sx={{ height: 18, fontSize: '0.6rem' }}
                  />
                  <Chip
                    size="small"
                    label={`${d.sharedWithCount} ${t('reports.dashboards.shared')}`}
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.6rem' }}
                  />
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>

      {/* Selected dashboard rendering */}
      {selected ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="h6">{selected.name}</Typography>
          <DashboardWidgets
            dashboard={selected}
            kpisLoading={kpis.isLoading}
            chartsLoading={charts.isLoading}
            kpis={kpis.data ?? []}
          />
        </Box>
      ) : (
        !isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            {isLoading ? (
              <Skeleton variant="rounded" height={200} />
            ) : (
              <Typography color="text.secondary">{t('reports.dashboards.selectPrompt')}</Typography>
            )}
          </Box>
        )
      )}
    </Stack>
  );
}

/** Render a dashboard's widget layout (KPI row + referenced charts). */
function DashboardWidgets({
  dashboard,
  kpis,
  kpisLoading,
  chartsLoading,
}: {
  dashboard: Dashboard;
  kpis: import('@/types/report.types').Kpi[];
  kpisLoading: boolean;
  chartsLoading: boolean;
}) {
  const hasKpi = dashboard.widgets.some((w) => w.type === 'kpi');
  const chartWidgets = dashboard.widgets.filter((w) => w.type === 'chart' && w.metricId);
  return (
    <>
      {hasKpi && <KpiRow kpis={kpis} loading={kpisLoading} />}
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' }, gap: 2 }}
      >
        {chartWidgets.map((w) => {
          // Chart series have no reporting backend yet — the fixture resolver
          // runs ONLY in explicit mock mode; real mode keeps the skeleton
          // (honest "no data" instead of fabricated series — Sprint E §31).
          const series = shouldUseMock() ? mockChartSeriesById(w.metricId ?? '') : undefined;
          return (
            <Box key={w.id} sx={{ gridColumn: { xs: '1', lg: `span ${Math.min(w.span, 12)}` } }}>
              {series ? (
                <ReportChart series={series} loading={chartsLoading} />
              ) : (
                <Skeleton variant="rounded" height={280} />
              )}
            </Box>
          );
        })}
      </Box>
    </>
  );
}
