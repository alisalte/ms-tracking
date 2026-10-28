/**
 * RangeSummary — the start and end of the period a report covers, with the
 * date and the time apart. Shown above every report so the window in force is
 * never implicit; the date follows the UI calendar (Shamsi in Persian).
 */
import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReportRange } from '@/api/report.api';
import { formatClock, formatDateNumeric } from '@/lib/format-date';
import { reportRangeBounds } from '@/lib/report-format';

function Stamp({ label, value }: { label: string; value: Date }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-gray-500 dark:text-graydark-600">{label}</span>
      <span className="font-semibold tabular-nums text-gray-800 dark:text-white">
        {formatDateNumeric(value)}
      </span>
      <span className="tabular-nums text-gray-600 dark:text-graydark-700">
        {formatClock(value)}
      </span>
    </span>
  );
}

export function RangeSummary({
  range,
  from,
  to,
}: {
  range: ReportRange;
  /** The window the server actually used, when the report returned it. */
  from?: string | null;
  to?: string | null;
}) {
  const { t } = useTranslation();
  const bounds = reportRangeBounds(range);
  const start = from ? new Date(from) : bounds.from;
  const end = to ? new Date(to) : bounds.to;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return (
    <p
      data-testid="report-range-summary"
      className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs"
    >
      <CalendarRange size={14} aria-hidden className="text-gray-400" />
      <Stamp label={t('reports.range.startLabel')} value={start} />
      <Stamp label={t('reports.range.endLabel')} value={end} />
    </p>
  );
}
