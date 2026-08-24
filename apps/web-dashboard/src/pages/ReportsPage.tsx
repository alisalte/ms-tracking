/**
 * ReportsPage — TailAdmin Reporting & Fleet Analytics (`/reports`) — Sprint J,
 * Phase 8 port.
 *
 * REAL data only (reporting-service). Sections (§33): Overview, Vehicles,
 * Trips, Alarms, Geofences, Activity — synced to `?section=`. Every number is
 * a documented backend KPI; the page formats and displays only (§66).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { ReportRange } from '@/api/report.api';
import { ActivitySection } from '@/components/reports/ActivitySection';
import { AlarmsSection } from '@/components/reports/AlarmsSection';
import { GeofencesSection } from '@/components/reports/GeofencesSection';
import { ReportRangePicker } from '@/components/reports/ReportRangePicker';
import { ReportsOverviewSection } from '@/components/reports/ReportsOverviewSection';
import { TripsSection } from '@/components/reports/TripsSection';
import { VehiclesSection } from '@/components/reports/VehiclesSection';
import { PageHeader, Tabs } from '@/components/tailwind-ui';

const SECTIONS = ['overview', 'vehicles', 'trips', 'alarms', 'geofences', 'activity'] as const;
type Section = (typeof SECTIONS)[number];

function isSection(v: string | null): v is Section {
  return v !== null && (SECTIONS as readonly string[]).includes(v);
}

export function ReportsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('section');
  const section: Section = isSection(raw) ? raw : 'overview';
  const [range, setRange] = useState<ReportRange>({ preset: '7d' });

  const setSection = (s: Section) => {
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
      <ReportRangePicker range={range} onChange={setRange} />

      {/* Section tabs (URL-synced via ?section=) */}
      <Tabs
        aria-label={t('reports.title')}
        value={section}
        onChange={setSection}
        tabs={SECTIONS.map((s) => ({
          value: s,
          label: t(`reports.sections.${s}`),
          testid: `report-section-${s}`,
        }))}
      />

      {section === 'overview' && <ReportsOverviewSection range={range} />}
      {section === 'vehicles' && <VehiclesSection range={range} />}
      {section === 'trips' && <TripsSection range={range} />}
      {section === 'alarms' && <AlarmsSection range={range} />}
      {section === 'geofences' && <GeofencesSection range={range} />}
      {section === 'activity' && <ActivitySection range={range} />}
    </div>
  );
}
