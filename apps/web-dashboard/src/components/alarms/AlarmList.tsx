/**
 * AlarmList — the TailAdmin table view of the Alarm Center (Phase 6).
 *
 * Renders a list of alarms with the type icon, vehicle, headline, severity,
 * status badge, and relative time. Row click opens the detail drawer
 * (selection → detail pattern, UI_UX §0.6). Newest-first triage flow.
 */
import { useTranslation } from 'react-i18next';

import { AlarmStatusBadge } from '@/components/alarms/AlarmStatusBadge';
import { alarmTypeIcon, severityColor } from '@/components/alarms/AlarmTypeIcon';
import { Skeleton, TBody, TD, TH, THead, Table } from '@/components/tailwind-ui';
import type { Alarm } from '@/types/alarm.types';

interface AlarmListProps {
  /** The (already-filtered) alarms to render. */
  alarms: Alarm[];
  /** Loading state — render skeleton rows. */
  loading?: boolean;
  /** Currently selected alarm id (row highlight). */
  selectedId?: string | null;
  /** Open the detail drawer for an alarm. */
  onSelect: (id: string) => void;
}

/** Locale-aware relative time for the list (e.g. "12m ago"). */
function relative(iso: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return t('dashboard.relative.justNow');
  if (min < 60) return t('dashboard.relative.minutes', { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('dashboard.relative.hours', { count: hr });
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function AlarmList({ alarms, loading = false, selectedId, onSelect }: AlarmListProps) {
  const { t } = useTranslation();

  if (loading) {
    const skelKeys = ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e', 'sk-f', 'sk-g', 'sk-h'];
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

  return (
    <div className="fv-scroll max-h-[calc(100vh-220px)] overflow-auto">
      <Table>
        <THead>
          <tr>
            <TH>{t('alarms.list.colType')}</TH>
            <TH>{t('alarms.list.colVehicle')}</TH>
            <TH>{t('alarms.list.colSeverity')}</TH>
            <TH>{t('alarms.list.colStatus')}</TH>
            <TH align="end">{t('alarms.list.colTime')}</TH>
          </tr>
        </THead>
        <TBody>
          {alarms.map((a) => {
            const Icon = alarmTypeIcon(a.type);
            const isSel = a.id === selectedId;
            return (
              <tr
                key={a.id}
                tabIndex={0}
                onClick={() => onSelect(a.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(a.id);
                }}
                className={`cursor-pointer transition-colors ${
                  isSel
                    ? 'bg-brand-50 dark:bg-brand-500/10'
                    : 'hover:bg-gray-50 dark:hover:bg-white/5'
                }`}
              >
                <TD>
                  <div className="flex items-center gap-2.5">
                    <span className="flex shrink-0" style={{ color: severityColor(a.severity) }}>
                      <Icon size={16} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800 dark:text-graydark-800">
                        {a.message}
                      </p>
                      <p className="truncate text-xs text-gray-500 dark:text-graydark-600">
                        {t(`alarms.type.${a.type}`)}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <p className="truncate text-sm text-gray-800 dark:text-graydark-800">
                    {a.vehicleLabel}
                  </p>
                  {a.driver && (
                    <p className="truncate text-xs text-gray-500 dark:text-graydark-600">
                      {a.driver}
                    </p>
                  )}
                </TD>
                <TD>
                  <span
                    className="inline-flex h-5 items-center rounded-full px-2 text-[0.7rem] font-semibold text-white"
                    style={{ backgroundColor: severityColor(a.severity) }}
                  >
                    {t(`alarms.severity.${a.severity}`)}
                  </span>
                </TD>
                <TD>
                  <AlarmStatusBadge status={a.status} label={t(`alarms.status.${a.status}`)} />
                </TD>
                <TD align="end">
                  <span className="whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-graydark-600">
                    {relative(a.raisedAt, t)}
                  </span>
                </TD>
              </tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
