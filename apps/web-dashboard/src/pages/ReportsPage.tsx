/**
 * ReportsPage — the Reports & Analytics surface (`/reports`).
 *
 * Four sections — Overview (KPIs + charts), Reports (catalog + generate),
 * Jobs/Exports (history + download), Dashboards (saved layouts) — selected via
 * a section toggle. The active section syncs to the URL (`?section=overview`)
 * for shareable deep links. Generating a report from the Reports section
 * auto-switches to Jobs so the operator sees the new job's lifecycle.
 */
import { BarChart3, FileText, LayoutDashboard, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { DashboardsSection } from '@/components/reports/DashboardsSection';
import { ReportDefinitionsSection } from '@/components/reports/ReportDefinitionsSection';
import { ReportJobsSection } from '@/components/reports/ReportJobsSection';
import { ReportsOverview } from '@/components/reports/ReportsOverview';
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material';

export type ReportSection = 'overview' | 'reports' | 'jobs' | 'dashboards';

const SECTIONS: { key: ReportSection; label: string }[] = [
  { key: 'overview', label: 'overview' },
  { key: 'reports', label: 'reports' },
  { key: 'jobs', label: 'jobs' },
  { key: 'dashboards', label: 'dashboards' },
];

function readSection(v: string | null): ReportSection {
  return (SECTIONS.map((s) => s.key) as readonly string[]).includes(v ?? '')
    ? (v as ReportSection)
    : 'overview';
}

export function ReportsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const section = readSection(params.get('section'));

  const setSection = (next: ReportSection) => {
    const p = new URLSearchParams(params);
    p.set('section', next);
    setParams(p, { replace: true });
  };

  return (
    <Stack sx={{ height: '100%' }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" gap={1} sx={{ pb: 1.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">{t('reports.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('reports.subtitle')}
          </Typography>
        </Box>
      </Stack>

      {/* Section tabs */}
      <Tabs
        value={section}
        onChange={(_, v) => setSection(v as ReportSection)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          icon={<LayoutDashboard size={16} />}
          iconPosition="start"
          value="overview"
          label={t('reports.sections.overview')}
        />
        <Tab
          icon={<FileText size={16} />}
          iconPosition="start"
          value="reports"
          label={t('reports.sections.reports')}
        />
        <Tab
          icon={<ListChecks size={16} />}
          iconPosition="start"
          value="jobs"
          label={t('reports.sections.jobs')}
        />
        <Tab
          icon={<BarChart3 size={16} />}
          iconPosition="start"
          value="dashboards"
          label={t('reports.sections.dashboards')}
        />
      </Tabs>

      {/* Active section */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pt: 2 }}>
        {section === 'overview' && <ReportsOverview />}
        {section === 'reports' && (
          <ReportDefinitionsSection onGenerated={() => setSection('jobs')} />
        )}
        {section === 'jobs' && <ReportJobsSection />}
        {section === 'dashboards' && <DashboardsSection />}
      </Box>
    </Stack>
  );
}
