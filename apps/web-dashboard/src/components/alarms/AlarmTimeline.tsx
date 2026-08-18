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

import { severityColor } from '@/components/alarms/AlarmTypeIcon';
import { Skeleton, Tooltip } from '@/components/tailwind-ui';
import type { Alarm } from '@/types/alarm.types';

interface AlarmTimelineProps {
  alarms: Alarm[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

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
                  const color = severityColor(a.severity);
                  return (
                    <Tooltip key={a.id} label={`${a.vehicleLabel} · ${a.message}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(a.id)}
                        className={`h-6 max-w-50 cursor-pointer truncate rounded-full border px-2.5 text-xs font-semibold transition-colors ${
                          isSel ? 'text-white' : ''
                        }`}
                        style={
                          isSel
                            ? { backgroundColor: color, borderColor: color }
                            : { color, borderColor: color, backgroundColor: 'transparent' }
                        }
                      >
                        {a.message}
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
