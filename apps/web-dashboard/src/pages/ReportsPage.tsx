/**
 * ReportsPage — TailAdmin Reporting & Fleet Analytics (`/reports`) — Sprint J,
 * Phase 8 port.
 *
 * REAL data only (reporting-service). Sections synced to `?section=`.
 * Every number is a documented backend KPI; the page formats and displays only.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { ReportRange } from '@/api/report.api';
import { ActivitySection } from '@/components/reports/ActivitySection';
import { AlarmsSection } from '@/components/reports/AlarmsSection';
import { AnalyticsSection } from '@/components/reports/AnalyticsSection';
import { CommandsReportSection } from '@/components/reports/CommandsReportSection';
import { DevicesSection } from '@/components/reports/DevicesSection';
import { DistanceSection } from '@/components/reports/DistanceSection';
import { DriversSection } from '@/components/reports/DriversSection';
import { GeofencesSection } from '@/components/reports/GeofencesSection';
import { OdometerSection } from '@/components/reports/OdometerSection';
import { OperationSection } from '@/components/reports/OperationSection';
import { ReportRangePicker } from '@/components/reports/ReportRangePicker';
import { ReportsOverviewSection } from '@/components/reports/ReportsOverviewSection';
import { SchedulesSection } from '@/components/reports/SchedulesSection';
import { SpeedSection } from '@/components/reports/SpeedSection';
import { StopsSection } from '@/components/reports/StopsSection';
import { TripsSection } from '@/components/reports/TripsSection';
import { VehiclesSection } from '@/components/reports/VehiclesSection';
import { PageHeader, Tabs } from '@/components/tailwind-ui';
import { REPORT_SECTIONS, type ReportSection, isReportSection } from '@/lib/report-sections';

export function ReportsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('section');
  const section: ReportSection = isReportSection(raw) ? raw : 'overview';
  const [range, setRange] = useState<ReportRange>({ preset: '7d' });

  const setSection = (s: ReportSection) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('section', s);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('reports.title')} description={t('reports.subtitle')} />
      {section !== 'schedules' && <ReportRangePicker range={range} onChange={setRange} />}

      <Tabs
        aria-label={t('reports.title')}
        value={section}
        onChange={setSection}
        tabs={REPORT_SECTIONS.map((s) => ({
          value: s,
          label: t(`reports.sections.${s}`),
          testid: `report-section-${s}`,
        }))}
      />

      {section === 'overview' && <ReportsOverviewSection range={range} />}
      {section === 'analytics' && <AnalyticsSection range={range} />}
      {section === 'vehicles' && <VehiclesSection range={range} />}
      {section === 'drivers' && <DriversSection range={range} />}
      {section === 'devices' && <DevicesSection />}
      {section === 'distance' && <DistanceSection range={range} />}
      {section === 'speed' && <SpeedSection range={range} />}
      {section === 'stops' && <StopsSection range={range} />}
      {section === 'operation' && <OperationSection range={range} />}
      {section === 'odometer' && <OdometerSection range={range} />}
      {section === 'trips' && <TripsSection range={range} />}
      {section === 'alarms' && <AlarmsSection range={range} />}
      {section === 'geofences' && <GeofencesSection range={range} />}
      {section === 'commands' && <CommandsReportSection range={range} />}
      {section === 'activity' && <ActivitySection range={range} />}
      {section === 'schedules' && <SchedulesSection />}
    </div>
  );
}
