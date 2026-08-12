/**
 * AlarmCenterPage — the operator triage surface for live alarms (`/alarms`).
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
import { PageHeader } from '@/components/ui';
import type { AlarmFilters, AlarmSeverity, AlarmStatus, AlarmType } from '@/types/alarm.types';
import {
  Box,
  Chip,
  IconButton,
  InputBase,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material';

type ViewMode = 'list' | 'timeline' | 'map';

const TYPES: Array<AlarmType | 'all'> = [
  'all',
  'sos',
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
      <Stack sx={{ height: '100%' }}>
        <PageHeader title={t('alarms.title')} subtitle={t('alarms.subtitle')} />
        <ErrorState error={error} onRetry={() => refetch()} />
      </Stack>
    );
  }

  return (
    <Stack sx={{ height: '100%' }}>
      {/* Header: title + live stats */}
      <PageHeader
        compact
        title={t('alarms.title')}
        subtitle={t('alarms.subtitle')}
        live={<AlarmLiveIndicator />}
        actions={
          <>
            <StatChip label={t('alarms.stats.active')} value={stats.active} color="primary" />
            <StatChip label={t('alarms.stats.unacked')} value={stats.unacked} color="warning" />
            <StatChip label={t('alarms.stats.escalated')} value={stats.escalated} color="error" />
          </>
        }
      />

      {/* Filter bar */}
      <Stack direction="row" alignItems="center" gap={1} sx={{ pb: 1.5, flexWrap: 'wrap' }}>
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
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.5,
            borderRadius: 1,
            backgroundColor: 'action.hover',
            minWidth: 200,
          }}
        >
          <InputBase
            placeholder={t('alarms.filters.search')}
            value={filters.query}
            onChange={(e) => setFilter('query', e.target.value)}
            sx={{ flex: 1, fontSize: '0.85rem' }}
            inputProps={{ 'aria-label': 'alarm search' }}
          />
          {filters.query && (
            <IconButton
              size="small"
              onClick={() => setFilter('query', '')}
              aria-label="clear search"
            >
              <span style={{ fontSize: 14 }}>×</span>
            </IconButton>
          )}
        </Box>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          value={view}
          exclusive
          size="small"
          onChange={(_, v) => v && setView(v as ViewMode)}
        >
          <ToggleButton value="list">
            <Tooltip title={t('alarms.views.list')} placement="top">
              <LayoutList size={16} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="timeline">
            <Tooltip title={t('alarms.views.timeline')} placement="top">
              <Activity size={16} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="map">
            <Tooltip title={t('alarms.views.map')} placement="top">
              <MapIcon size={16} />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {/* Active view */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
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
      </Box>

      {/* Detail drawer */}
      <AlarmDetailDrawer alarmId={selectedId} onClose={() => setSelectedId(null)} />
    </Stack>
  );
}

/** A headline stat chip in the header. */
function StatChip({
  label,
  value,
  color,
}: { label: string; value: number; color: 'primary' | 'warning' | 'error' }) {
  return (
    <Chip
      label={`${value} ${label}`}
      color={color}
      variant="outlined"
      sx={{ height: 28, fontWeight: 600 }}
    />
  );
}

/** A labeled filter dropdown. */
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
    <Select
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      sx={{ height: 32, minWidth: 130, fontSize: '0.8rem' }}
      renderValue={() => `${label}: ${translate(value)}`}
    >
      {options.map((o) => (
        <MenuItem key={o} value={o}>
          {translate(o)}
        </MenuItem>
      ))}
    </Select>
  );
}
