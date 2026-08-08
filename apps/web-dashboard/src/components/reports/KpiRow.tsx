/**
 * KpiRow — the headline KPI scorecard row (Analytics-Reporting.md §3.3).
 *
 * Renders the platform's headline KPIs in a responsive grid of KpiCards.
 */
import { Skeleton } from '@mui/material';

import type { Kpi } from '@/types/report.types';
import { Box } from '@mui/material';
import { KpiCard } from './KpiCard';

interface KpiRowProps {
  kpis: Kpi[];
  loading?: boolean;
}

export function KpiRow({ kpis, loading = false }: KpiRowProps) {
  if (loading) {
    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' },
          gap: 1.5,
        }}
      >
        {['kpisk-a', 'kpisk-b', 'kpisk-c', 'kpisk-d', 'kpisk-e'].map((k) => (
          <Skeleton key={k} variant="rounded" height={120} />
        ))}
      </Box>
    );
  }
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' },
        gap: 1.5,
      }}
    >
      {kpis.map((k) => (
        <KpiCard key={k.id} kpi={k} />
      ))}
    </Box>
  );
}
