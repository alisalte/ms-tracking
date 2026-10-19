import { Info, ListChecks, Siren } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AlarmExplanation, UrgencyLevel } from '@/lib/alarm-explain';

const URGENCY_TONE: Record<UrgencyLevel, string> = {
  critical:
    'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-500/25 dark:bg-danger-500/10 dark:text-danger-300',
  major:
    'border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-500/25 dark:bg-warning-500/10 dark:text-warning-300',
  minor:
    'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300',
  info: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-graydark-700',
};

/**
 * AlarmExplainBox — "what happened / what should I do" in everyday words,
 * shown at the top of the alarm and notification detail views so an operator
 * does not have to decode device codes.
 */
export function AlarmExplainBox({
  explanation,
  urgency,
  urgencyLevel,
}: {
  explanation: AlarmExplanation;
  /** Already-translated urgency sentence. */
  urgency: string;
  /** Picks the urgency tone. */
  urgencyLevel: UrgencyLevel;
}) {
  const { t } = useTranslation();
  const tone = URGENCY_TONE[urgencyLevel];
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div
        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${tone}`}
      >
        <Siren size={16} aria-hidden className="shrink-0" />
        <span>{urgency}</span>
      </div>
      <div className="flex gap-2.5">
        <Info size={17} aria-hidden className="mt-0.5 shrink-0 text-brand-500" />
        <div>
          <p className="text-xs font-bold text-gray-500 dark:text-graydark-600">
            {t('alarms.explain.whatTitle')}
          </p>
          <p className="mt-0.5 text-sm leading-6 text-gray-800 dark:text-graydark-800">
            {explanation.what}
          </p>
        </div>
      </div>
      <div className="flex gap-2.5">
        <ListChecks size={17} aria-hidden className="mt-0.5 shrink-0 text-success-600" />
        <div>
          <p className="text-xs font-bold text-gray-500 dark:text-graydark-600">
            {t('alarms.explain.actionTitle')}
          </p>
          <p className="mt-0.5 text-sm leading-6 text-gray-800 dark:text-graydark-800">
            {explanation.action}
          </p>
        </div>
      </div>
    </div>
  );
}
