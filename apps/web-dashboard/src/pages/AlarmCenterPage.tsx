/**
 * AlarmCenterPage — the TailAdmin operator triage surface for live alarms
 * (`/alarms`, Phase 6 port).
 *
 * Three views over the same filtered alarm set — list (per-alarm), timeline
 * (chronological), map (spatial) — plus a right slide-over detail drawer
 * (12_Alarm_Engine.md §5.4 linked artifacts + §5.3 operator actions). The
 * shared filter state (type/severity/status/vehicle) drives all three views;
 * the active view + filters sync to the URL for shareable deep links.
 */
import { Activity, LayoutList, Map as MapIcon, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useAlarms } from '@/api/alarm.api';
import { AlarmDetailDrawer } from '@/components/alarms/AlarmDetailDrawer';
import { AlarmList } from '@/components/alarms/AlarmList';
import { AlarmLiveIndicator } from '@/components/alarms/AlarmLiveIndicator';
import { AlarmMap } from '@/components/alarms/AlarmMap';
import { AlarmTimeline } from '@/components/alarms/AlarmTimeline';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader, Tooltip } from '@/components/tailwind-ui';
import type { AlarmFilters, AlarmSeverity, AlarmStatus, AlarmType } from '@/types/alarm.types';

type ViewMode = 'list' | 'timeline' | 'map';

const TYPES: Array<AlarmType | 'all'> = [
  'all',
  'sos',
  'dms',
  'overspeed',
  'geofence',
  'offline',
  'fuel-theft',
  'temperature',
  'collision',
  'camera',
];
const SEVERITIES: Array<AlarmSeverity | 'all'> = ['all', 'critical', 'major', 'minor', 'info'];
const STATUSES: Array<AlarmStatus | 'all'> = ['all', 'raised', 'acked', 'escalated', 'resolved'];

export function AlarmCenterPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: alarms, isLoading, isError, error, refetch } = useAlarms();

  const view = (params.get('view') as ViewMode) ?? 'list';
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Read filter state from the URL (shareable deep links).
  const filters: AlarmFilters = useMemo(
    () => ({
      type: (params.get('type') as AlarmType | 'all') ?? 'all',
      severity: (params.get('severity') as AlarmSeverity | 'all') ?? 'all',
      status: (params.get('status') as AlarmStatus | 'all') ?? 'all',
      query: params.get('q') ?? '',
    }),
    [params],
  );

  // Apply the shared filters across all three views.
  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return (alarms ?? []).filter((a) => {
      if (filters.type !== 'all' && a.type !== filters.type) return false;
      if (filters.severity !== 'all' && a.severity !== filters.severity) return false;
      if (filters.status !== 'all' && a.status !== filters.status) return false;
      if (!q) return true;
      return (
        a.vehicleLabel.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.driver?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [alarms, filters]);

  // Headline stats (active / unacked / escalated).
  const stats = useMemo(() => {
    const all = alarms ?? [];
    return {
      active: all.filter((a) => a.status !== 'resolved').length,
      unacked: all.filter((a) => a.status === 'raised').length,
      escalated: all.filter((a) => a.status === 'escalated').length,
    };
  }, [alarms]);

  // Update one URL filter at a time.
  const setFilter = (key: keyof AlarmFilters, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all' || value === '') next.delete(key === 'query' ? 'q' : key);
    else next.set(key === 'query' ? 'q' : key, value);
    setParams(next, { replace: true });
  };
  const setView = (v: ViewMode) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  };

  if (isError) {
    return (
      <div className="flex h-full flex-col gap-4">
        <Header t={t} stats={stats} />
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header t={t} stats={stats} />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <FilterSelect
          label={t('alarms.filters.type')}
          value={filters.type}
          options={TYPES}
          translate={(v) => (v === 'all' ? t('alarms.filters.all') : t(`alarms.type.${v}`))}
          onChange={(v) => setFilter('type', v)}
        />
        <FilterSelect
          label={t('alarms.filters.severity')}
          value={filters.severity}
          options={SEVERITIES}
          translate={(v) => (v === 'all' ? t('alarms.filters.all') : t(`alarms.severity.${v}`))}
          onChange={(v) => setFilter('severity', v)}
        />
        <FilterSelect
          label={t('alarms.filters.status')}
          value={filters.status}
          options={STATUSES}
          translate={(v) => (v === 'all' ? t('alarms.filters.all') : t(`alarms.status.${v}`))}
          onChange={(v) => setFilter('status', v)}
        />
        <div className="flex h-8 min-w-52 items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 dark:bg-white/5">
          <Search size={14} aria-hidden className="shrink-0 text-gray-400 dark:text-graydark-600" />
          <input
            placeholder={t('alarms.filters.search')}
            value={filters.query}
            onChange={(e) => setFilter('query', e.target.value)}
            aria-label="alarm search"
            className="h-full w-full min-w-0 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-graydark-800 dark:placeholder:text-graydark-600"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => setFilter('query', '')}
              aria-label="clear search"
              className="flex shrink-0 cursor-pointer border-none bg-transparent p-0 text-gray-400 hover:text-gray-600 dark:hover:text-graydark-700"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1" />
        {/* View switcher */}
        <div
          // biome-ignore lint/a11y/useSemanticElements: no native <group> element exists; the ARIA role is the correct pattern
          role="group"
          aria-label={t('alarms.views.list')}
          className="flex items-center overflow-hidden rounded-lg border border-gray-300 dark:border-white/10"
        >
          {(
            [
              { v: 'list', icon: <LayoutList size={15} />, label: t('alarms.views.list') },
              { v: 'timeline', icon: <Activity size={15} />, label: t('alarms.views.timeline') },
              { v: 'map', icon: <MapIcon size={15} />, label: t('alarms.views.map') },
            ] as const
          ).map(({ v, icon, label }) => (
            <Tooltip key={v} label={label}>
              <button
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                aria-label={label}
                className={`inline-flex size-8 cursor-pointer items-center justify-center border-none transition-colors ${
                  view === v
                    ? 'bg-brand-500 text-white'
                    : 'bg-transparent text-gray-500 hover:bg-gray-100 dark:text-graydark-600 dark:hover:bg-white/5'
                }`}
              >
                {icon}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Active view */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-gray-200 dark:border-white/5">
        {view === 'list' && (
          <AlarmList
            alarms={filtered}
            loading={isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
        {view === 'timeline' && (
          <AlarmTimeline
            alarms={filtered}
            loading={isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
        {view === 'map' && (
          <AlarmMap alarms={filtered} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>

      {/* Detail drawer */}
      <AlarmDetailDrawer alarmId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/** Page header: title + subtitle + live indicator + headline stats. */
function Header({
  t,
  stats,
}: {
  t: (k: string) => string;
  stats: { active: number; unacked: number; escalated: number };
}) {
  return (
    <div className="mb-4">
      <PageHeader
        title={t('alarms.title')}
        description={t('alarms.subtitle')}
        actions={<AlarmLiveIndicator />}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <StatChip label={t('alarms.stats.active')} value={stats.active} tone="brand" />
        <StatChip label={t('alarms.stats.unacked')} value={stats.unacked} tone="warning" />
        <StatChip label={t('alarms.stats.escalated')} value={stats.escalated} tone="danger" />
      </div>
    </div>
  );
}

/** A headline stat chip in the header. */
function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'brand' | 'warning' | 'danger';
}) {
  const tones = {
    brand:
      'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300',
    warning:
      'border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-400',
    danger:
      'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-400',
  } as const;
  return (
    <span
      className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold ${tones[tone]}`}
    >
      {value} {label}
    </span>
  );
}

/** A labeled filter dropdown (native select — combobox + option roles). */
function FilterSelect<T extends string>({
  label,
  value,
  options,
  translate,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  translate: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={label}
      className="h-8 cursor-pointer rounded-lg border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {translate(o)}
        </option>
      ))}
    </select>
  );
}
