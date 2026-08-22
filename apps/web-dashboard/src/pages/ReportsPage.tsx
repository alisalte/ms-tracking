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
import { PageHeader } from '@/components/tailwind-ui';

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

      {/* Section tabs */}
      <div
        role="tablist"
        aria-label={t('reports.title')}
        className="fv-scroll flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-white/5"
      >
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={section === s}
            onClick={() => setSection(s)}
            data-testid={`report-section-${s}`}
            className={`cursor-pointer whitespace-nowrap rounded-lg border-none px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              section === s
                ? 'bg-white text-gray-900 shadow-sm dark:bg-graydark-300 dark:text-white'
                : 'bg-transparent text-gray-500 hover:text-gray-800 dark:text-graydark-600 dark:hover:text-white'
            }`}
          >
            {t(`reports.sections.${s}`)}
          </button>
        ))}
      </div>

      {section === 'overview' && <ReportsOverviewSection range={range} />}
      {section === 'vehicles' && <VehiclesSection range={range} />}
      {section === 'trips' && <TripsSection range={range} />}
      {section === 'alarms' && <AlarmsSection range={range} />}
      {section === 'geofences' && <GeofencesSection range={range} />}
      {section === 'activity' && <ActivitySection range={range} />}
    </div>
  );
}
