import { useTranslation } from 'react-i18next';

/**
 * Live freshness indicator (UI_UX_Design.md §0.6): a pulsing dot + "Live"
 * label inside a frosted-glass pill, signaling data is real-time (<10s fresh).
 */
export function LiveBadge() {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success-500/30 bg-success-500/10 px-2.5 py-1 backdrop-blur-sm">
      <span className="fv-live-dot inline-block size-[7px] rounded-full bg-success-500" />
      <span className="text-[0.6875rem] font-bold text-success-600 dark:text-success-400">
        {t('dashboard.live')}
      </span>
    </span>
  );
}
