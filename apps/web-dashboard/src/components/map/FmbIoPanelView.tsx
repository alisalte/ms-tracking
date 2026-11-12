import { useTranslation } from 'react-i18next';

import { lastSeenLabel } from '@/lib/relative-time';
import type { FmbIoGroup, FmbIoPanel, FmbIoPoint } from '@/types/fleet.types';

/** Display order of the groups; a group without points is not drawn. */
const GROUP_ORDER: readonly FmbIoGroup[] = [
  'din',
  'dout',
  'ain',
  'onewire',
  'serial',
  'can',
  'j1708',
  'kline',
  'other',
];

/** Seconds after which a point is shown as stale (its device time, not receipt). */
const STALE_AFTER_MS = 10 * 60 * 1000;

function isStale(at: string, now: number): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t > STALE_AFTER_MS;
}

function PointValue({ point }: { point: FmbIoPoint }) {
  const { t } = useTranslation();
  if (typeof point.value === 'boolean') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-sm font-medium ${
          point.value
            ? 'text-success-600 dark:text-success-400'
            : 'text-gray-500 dark:text-graydark-600'
        }`}
      >
        <span
          aria-hidden
          className={`size-2 rounded-full ${point.value ? 'bg-success-500' : 'bg-gray-300 dark:bg-white/20'}`}
        />
        {point.value ? t('map.io.on') : t('map.io.off')}
      </span>
    );
  }
  const text = point.value === '' ? '—' : String(point.value);
  return (
    <span className="text-sm font-medium tabular-nums text-gray-800 dark:text-graydark-800">
      {text}
      {point.unit && point.value !== '' ? ` ${point.unit}` : ''}
    </span>
  );
}

/**
 * Live I/O of a Teltonika FMB640: digital inputs/outputs, analog inputs,
 * 1-Wire, serial (RS232/RS485) sensors and CAN. Values are the newest the
 * device reported per element; a value older than 10 minutes is dimmed.
 */
export function FmbIoPanelView({ panel }: { panel: FmbIoPanel }) {
  const { t } = useTranslation();
  const now = Date.now();
  const groups = GROUP_ORDER.filter((g) => (panel.groups[g]?.length ?? 0) > 0);
  if (groups.length === 0) return null;

  return (
    <section className="mb-4" aria-label={t('map.io.title')} data-testid="fmb-io-panel">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-graydark-800">
          {t('map.io.title')}
        </h3>
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {t('map.io.updated', { time: lastSeenLabel(panel.updatedAt, t) })}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-graydark-600">
              {t(`map.io.groups.${g}`)}
            </p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-white/5 dark:border-white/5">
              {(panel.groups[g] ?? []).map((p) => (
                <li
                  key={p.id}
                  className={`flex items-center justify-between gap-3 px-3 py-1.5 ${
                    isStale(p.at, now) ? 'opacity-50' : ''
                  }`}
                  title={new Date(p.at).toLocaleString()}
                >
                  <span className="min-w-0 truncate text-xs text-gray-600 dark:text-graydark-700">
                    {p.key
                      ? t(`map.io.points.${p.key}`, { defaultValue: `AVL ${p.id}` })
                      : t('map.io.unknown', { id: p.id })}
                  </span>
                  <PointValue point={p} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
