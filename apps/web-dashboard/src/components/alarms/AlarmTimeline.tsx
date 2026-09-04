/**
 * AlarmTimeline — the TailAdmin chronological view of the Alarm Center (Phase 6).
 *
 * Buckets alarms by hour over the last 24h and lays them out as severity-
 * colored event blocks. Each block is clickable → opens the detail drawer.
 * This is the operator's "what happened and when" triage view, complementing
 * the list (per-alarm) and the map (spatial).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton, Tooltip } from '@/components/tailwind-ui';
import { localizeAlarmMessage } from '@/lib/alarm-copy';
import type { Alarm, AlarmSeverity } from '@/types/alarm.types';

interface AlarmTimelineProps {
  alarms: Alarm[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

/**
 * Severity → semantic pill classes (mirrors the Badge tonal palette): filled
 * when selected, tonal outline at rest. Static Tailwind classes so the
 * dark-mode pairs are picked up by the compiler.
 */
const PILL_TONES: Record<AlarmSeverity, { rest: string; selected: string }> = {
  critical: {
    rest: 'border-danger-200 bg-danger-50 text-danger-700 hover:border-danger-400 dark:border-danger-500/30 dark:bg-danger-500/10 dark:text-danger-400',
    selected: 'border-danger-500 bg-danger-500 text-white',
  },
  major: {
    rest: 'border-warning-200 bg-warning-50 text-warning-700 hover:border-warning-400 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400',
    selected: 'border-warning-500 bg-warning-500 text-white',
  },
  minor: {
    rest: 'border-info-200 bg-info-50 text-info-700 hover:border-info-400 dark:border-info-500/30 dark:bg-info-500/10 dark:text-info-400',
    selected: 'border-info-500 bg-info-500 text-white',
  },
  info: {
    rest: 'border-gray-200 bg-gray-100 text-gray-600 hover:border-gray-400 dark:border-white/10 dark:bg-white/5 dark:text-graydark-700',
    selected: 'border-gray-400 bg-gray-500 text-white dark:border-white/25 dark:bg-white/25',
  },
};

/** Bucket alarms into the 24 hours of the day they were raised. */
function bucketByHour(alarms: Alarm[]): Map<number, Alarm[]> {
  const map = new Map<number, Alarm[]>();
  for (let h = 0; h < 24; h++) map.set(h, []);
  for (const a of alarms) {
    const h = new Date(a.raisedAt).getHours();
    map.get(h)?.push(a);
  }
  return map;
}

export function AlarmTimeline({
  alarms,
  loading = false,
  selectedId,
  onSelect,
}: AlarmTimelineProps) {
  const { t } = useTranslation();
  const buckets = useMemo(() => bucketByHour(alarms), [alarms]);

  if (loading) {
    const skelKeys = ['tsk-a', 'tsk-b', 'tsk-c', 'tsk-d', 'tsk-e', 'tsk-f', 'tsk-g', 'tsk-h'];
    return (
      <div className="flex flex-col gap-2 p-4" aria-hidden>
        {skelKeys.map((k) => (
          <Skeleton key={k} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (alarms.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <span className="text-sm text-gray-500 dark:text-graydark-600">{t('alarms.empty')}</span>
      </div>
    );
  }

  // Render newest hour first (23 → 0).
  const hours = Array.from({ length: 24 }, (_, i) => 23 - i);

  return (
    <div className="fv-scroll max-h-[calc(100vh-220px)] overflow-y-auto p-4">
      <div className="flex flex-col gap-2">
        {hours.map((h) => {
          const bucket = buckets.get(h) ?? [];
          if (bucket.length === 0) return null;
          return (
            <div key={h} className="flex min-h-8 items-start gap-3">
              <span className="w-11 shrink-0 pt-1 font-mono text-xs text-gray-400 dark:text-graydark-600">
                {String(h).padStart(2, '0')}:00
              </span>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {bucket.map((a) => {
                  const isSel = a.id === selectedId;
                  return (
                    <Tooltip key={a.id} label={`${a.vehicleLabel} · ${localizeAlarmMessage(t, a)}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(a.id)}
                        className={`h-6 max-w-50 cursor-pointer truncate rounded-full border px-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                          isSel ? PILL_TONES[a.severity].selected : PILL_TONES[a.severity].rest
                        }`}
                      >
                        {localizeAlarmMessage(t, a)}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
