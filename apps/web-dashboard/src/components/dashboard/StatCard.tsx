import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

interface StatCardProps {
  /** i18n key for the card label (e.g. "dashboard.stats.active"). */
  titleKey: string;
  /** Headline value. */
  value: number;
  /** 7-point sparkline series (oldest → newest). */
  sparkline: number[];
  /** Accent color token for the value + sparkline gradient (hex). */
  accent?: string;
  /** Signed delta vs the previous period — rendered as an arrow + colored chip. */
  delta?: number;
  /** Optional secondary line under the value (e.g. "2 CRIT" or "59%"). */
  meta?: ReactNode;
  /** Drilldown handler — clicking the card navigates (UI_UX_Design.md §1.5). */
  onClick?: () => void;
  /** While the underlying data is loading, render a skeleton. */
  loading?: boolean;
}

/**
 * StatCard — reusable KPI tile (UI_UX_Design.md §0.5, §1.4).
 *
 * Top row of the Fleet Dashboard: an uppercase label, a big value, a
 * delta-vs-yesterday chip, a 7-point sparkline, and an optional secondary line.
 * The whole tile is clickable to drill into the Map filtered to that status.
 *
 * Tailwind surface; Recharts sparkline preserved. Color reserved for meaning
 * (§0.1) — the delta chip turns green/red by direction, the accent tints the
 * value + sparkline.
 */
export function StatCard({
  titleKey,
  value,
  sparkline,
  accent = '#465FFB',
  delta,
  meta,
  onClick,
  loading = false,
}: StatCardProps) {
  const { t } = useTranslation();
  const data = sparkline.map((v, i) => ({ i, v }));
  // A stable id so each card gets its own gradient stop.
  const gradId = `statcard-grad-${titleKey.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <div
      className={[
        'relative h-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm',
        'dark:border-white/5 dark:bg-graydark-200',
        onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="flex h-full w-full flex-col gap-3 p-4 text-start disabled:cursor-default"
        aria-label={t(titleKey)}
      >
<<<<<<< HEAD
        <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-graydark-600">
          {t(titleKey)}
        </span>

        {loading ? (
          <div className="h-9 w-3/5 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
        ) : (
          <span
            className="text-[1.6rem] font-bold leading-tight tabular-nums"
            style={{ color: accent }}
          >
            {value}
          </span>
        )}
=======
        <Stack direction="column" gap={0.75} sx={{ height: '100%' }}>
          <Typography variant="overline" sx={{ lineHeight: 1.6667, color: 'text.secondary' }}>
            {t(titleKey)}
          </Typography>
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e

        {/* Secondary line: delta chip and/or meta */}
        <div className="flex min-h-5 items-center gap-2">
          {loading ? (
            <div className="h-4 w-14 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
          ) : (
            <>
              {delta !== undefined && <DeltaChip delta={delta} />}
              {meta}
            </>
          )}
        </div>

        {/* Sparkline pinned to the bottom */}
        {!loading && (
          <div className="mt-auto h-[30px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={accent}
                  strokeWidth={1.75}
                  fill={`url(#${gradId})`}
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </button>
    </div>
  );
}

/** Direction-aware delta chip: ▲ green for up, ▼ red for down, — neutral. */
function DeltaChip({ delta }: { delta: number }) {
  const { t } = useTranslation();
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500 dark:text-graydark-600">
        <Minus size={13} />
        <span className="tabular-nums">{t('dashboard.noChange')}</span>
      </span>
    );
  }
  const up = delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  // For fleet metrics, "more active" is context-dependent; here we simply
  // encode direction (green up / red down) and let the label carry meaning.
  const color = up ? '#12B76A' : '#F04438';
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={13} style={{ color }} />
      <span className="text-xs font-bold tabular-nums" style={{ color }}>
        {up ? '+' : ''}
        {delta}
      </span>
    </span>
  );
}
