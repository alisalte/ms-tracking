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
import { Activity, LayoutList, Map as MapIcon } from 'lucide-react';
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
import { Badge, PageHeader, SegmentedControl, Select, Toolbar } from '@/components/tailwind-ui';
import { ALARM_CATALOG_TYPES, localizeAlarmMessage } from '@/lib/alarm-copy';
import type { AlarmFilters, AlarmSeverity, AlarmStatus, AlarmType } from '@/types/alarm.types';

type ViewMode = 'list' | 'timeline' | 'map';

const TYPES: Array<AlarmType | 'all'> = ['all', ...ALARM_CATALOG_TYPES];
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
      const message = localizeAlarmMessage(t, a).toLowerCase();
      return (
        a.vehicleLabel.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        message.includes(q) ||
        a.message.toLowerCase().includes(q) ||
        (a.driver?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [alarms, filters, t]);

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
      <Toolbar
        className="mb-3"
        search
        searchValue={filters.query}
        onSearchChange={(q) => setFilter('query', q)}
        searchPlaceholder={t('alarms.filters.search')}
        left={
          <>
            <Select
              value={filters.type}
              onChange={(e) => setFilter('type', e.target.value)}
              wrapperClassName="w-40"
              aria-label={t('alarms.filters.type')}
              options={TYPES.map((v) => ({
                value: v,
                label: v === 'all' ? t('alarms.filters.all') : t(`alarms.type.${v}`),
              }))}
            />
            <Select
              value={filters.severity}
              onChange={(e) => setFilter('severity', e.target.value)}
              wrapperClassName="w-36"
              aria-label={t('alarms.filters.severity')}
              options={SEVERITIES.map((v) => ({
                value: v,
                label: v === 'all' ? t('alarms.filters.all') : t(`alarms.severity.${v}`),
              }))}
            />
            <Select
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              wrapperClassName="w-36"
              aria-label={t('alarms.filters.status')}
              options={STATUSES.map((v) => ({
                value: v,
                label: v === 'all' ? t('alarms.filters.all') : t(`alarms.status.${v}`),
              }))}
            />
          </>
        }
        right={
          <SegmentedControl
            size="sm"
            options={[
              { value: 'list', label: t('alarms.views.list'), icon: <LayoutList size={15} /> },
              {
                value: 'timeline',
                label: t('alarms.views.timeline'),
                icon: <Activity size={15} />,
              },
              { value: 'map', label: t('alarms.views.map'), icon: <MapIcon size={15} /> },
            ]}
            value={view}
            onChange={setView}
            aria-label={t('alarms.views.label')}
          />
        }
      />

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
        <Badge color="brand">
          {stats.active} {t('alarms.stats.active')}
        </Badge>
        <Badge color="warning">
          {stats.unacked} {t('alarms.stats.unacked')}
        </Badge>
        <Badge color="danger">
          {stats.escalated} {t('alarms.stats.escalated')}
        </Badge>
      </div>
    </div>
  );
}
