import type { ReactNode } from 'react';

/**
 * Meter — labeled horizontal progress meter (TailAdmin "linear scale" idiom).
 *
 * Extracted from the two verbatim copies in FleetHealthPanel and
 * AlarmStatusChart. Semantic tone colors, dark-mode aware, RTL-safe (the bar
 * grows from the inline-start edge via logical inset). Exposes proper
 * `role="progressbar"` semantics with `aria-valuenow/min/max`.
 */
export type MeterTone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface MeterProps {
  /** Visible label (already translated). */
  label: ReactNode;
  /** Current value; clamped into [0, max]. */
  value: number;
  /** Maximum (default 100). */
  max?: number;
  tone?: MeterTone;
  /** Unit suffix appended to the numeric readout (e.g. "km"). */
  unit?: string;
  /** Render the numeric readout (value/max) at the row end (default true). */
  showValue?: boolean;
  /** Render `value / max` instead of the bare value (count-style meters). */
  showMax?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const TONE_BAR: Record<MeterTone, string> = {
  brand: 'bg-brand-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
};

const TONE_TEXT: Record<MeterTone, string> = {
  brand: 'text-brand-600 dark:text-brand-300',
  success: 'text-success-600 dark:text-success-400',
  warning: 'text-warning-600 dark:text-warning-400',
  danger: 'text-danger-600 dark:text-danger-400',
  info: 'text-info-600 dark:text-info-400',
};

export function Meter({
  label,
  value,
  max = 100,
  tone = 'brand',
  unit,
  showValue = true,
  showMax = false,
  size = 'md',
  className = '',
}: MeterProps) {
  const safeMax = max <= 0 ? 1 : max;
  const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  const pct = (clamped / safeMax) * 100;

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium text-gray-600 dark:text-graydark-700">{label}</span>
        {showValue && (
          <span
            className={`shrink-0 font-semibold tabular-nums ${TONE_TEXT[tone]}`}
            aria-hidden="true"
          >
            {clamped.toLocaleString()}
            {showMax && (
              <span className="ms-1 font-normal text-gray-400 dark:text-graydark-600">
                / {safeMax.toLocaleString()}
              </span>
            )}
            {unit && !showMax ? <span className="ms-0.5 opacity-70">{unit}</span> : null}
          </span>
        )}
      </div>
      <div
        tabIndex={0}
        role="progressbar"
        aria-label={typeof label === 'string' ? label : undefined}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeMax)}
        className={`w-full overflow-hidden rounded-full bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:bg-white/10 ${
          size === 'sm' ? 'h-1.5' : 'h-2'
        }`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${TONE_BAR[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
