/**
 * AlarmList — the TailAdmin table view of the Alarm Center (Phase 6).
 *
 * Renders a list of alarms with the type icon, vehicle, headline, severity,
 * status badge, and relative time. Row click opens the detail drawer
 * (selection → detail pattern, UI_UX §0.6). Newest-first triage flow.
 */
import { useTranslation } from 'react-i18next';

import { AlarmStatusBadge } from '@/components/alarms/AlarmStatusBadge';
import {
  alarmTypeIcon,
  severityBadgeColor,
  severityColor,
} from '@/components/alarms/AlarmTypeIcon';
import { Badge, Skeleton, TBody, TD, TH, THead, Table } from '@/components/tailwind-ui';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { localizeAlarmCode, localizeAlarmMessage } from '@/lib/alarm-copy';
import { explainAlarm } from '@/lib/alarm-explain';
import { formatDate } from '@/lib/format-date';
import type { Alarm } from '@/types/alarm.types';

/** Second-line category — prefer a clear code family over a vague catalog type. */
function alarmCategoryLabel(
  t: (key: string, opts?: { defaultValue?: string }) => string,
  a: Alarm,
): string {
  const code = (a.code ?? '').toUpperCase();
  if (code === 'ENTER_SLEEP' || code === 'EXIT_SLEEP') {
    return t('alarms.type.sleep', { defaultValue: 'خواب دستگاه' });
  }
  if (code === 'DEVICE_REBOOT') {
    return t('alarms.type.device', { defaultValue: 'وضعیت دستگاه' });
  }
  if (code === 'STOP_MOVING' || code === 'START_MOVING') {
    return t('alarms.type.motion', { defaultValue: 'حرکت' });
  }
  if (code.startsWith('INPUT_2')) return t('alarms.type.ignition');
  if (code.startsWith('VIDEO_') || code.startsWith('STORAGE_')) return t('alarms.type.camera');
  // Avoid repeating the same phrase as the title when type is a vague "other".
  if (a.type === 'other' && code) return localizeAlarmCode(t as never, code);
  return t(`alarms.type.${a.type}`);
}

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
  return formatDate(iso, { month: 'short', day: 'numeric' });
}

export function AlarmList({ alarms, loading = false, selectedId, onSelect }: AlarmListProps) {
  const { t } = useTranslation();
  const isPhone = useIsPhone();

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

  // Phones: stacked cards — the 5-column table does not fit.
  if (isPhone) {
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-2">
        {alarms.map((a) => {
          const Icon = alarmTypeIcon(a.type);
          const isSel = a.id === selectedId;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                className={`flex w-full cursor-pointer gap-3 rounded-xl border p-3 text-start transition-colors ${
                  isSel
                    ? 'border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10'
                    : 'border-gray-200 bg-white active:bg-gray-50 dark:border-white/10 dark:bg-white/[0.03]'
                }`}
              >
                <span
                  className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ background: severityColor(a.severity) }}
                >
                  <Icon size={17} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-semibold text-gray-900 dark:text-white">
                      {localizeAlarmMessage(t, a)}
                    </span>
                    <span className="shrink-0 text-[0.7rem] tabular-nums text-gray-500 dark:text-graydark-600">
                      {relative(a.raisedAt, t)}
                    </span>
                  </span>
                  <span className="truncate text-xs font-medium text-gray-700 dark:text-graydark-700">
                    {a.vehicleLabel || t('alarms.list.unknownVehicle')}
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-gray-500 dark:text-graydark-600">
                    {explainAlarm(t, a).what}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <Badge color={severityBadgeColor(a.severity)} className="font-semibold">
                      {t(`alarms.severity.${a.severity}`)}
                    </Badge>
                    <AlarmStatusBadge status={a.status} label={t(`alarms.status.${a.status}`)} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
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
                className={`cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 ${
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
                        {localizeAlarmMessage(t, a)}
                      </p>
                      <p className="truncate text-xs text-gray-500 dark:text-graydark-600">
                        {alarmCategoryLabel(t, a)}
                      </p>
                      <p className="line-clamp-2 max-w-md text-xs leading-5 whitespace-normal text-gray-500 dark:text-graydark-600">
                        {explainAlarm(t, a).what}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <p className="truncate text-sm text-gray-800 dark:text-graydark-800">
                    {a.vehicleLabel || t('alarms.list.unknownVehicle')}
                  </p>
                  {a.driver && (
                    <p className="truncate text-xs text-gray-500 dark:text-graydark-600">
                      {a.driver}
                    </p>
                  )}
                </TD>
                <TD>
                  <Badge color={severityBadgeColor(a.severity)} className="font-semibold">
                    {t(`alarms.severity.${a.severity}`)}
                  </Badge>
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
