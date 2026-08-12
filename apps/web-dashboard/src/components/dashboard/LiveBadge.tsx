import { useTranslation } from 'react-i18next';

/**
 * Live freshness indicator (UI_UX_Design.md §0.6): a pulsing dot + "Live"
 * label, signaling data is real-time (<10s fresh).
 *
 * Tailwind version — the pulse keyframe lives in global.css (`fv-pulse`); the
 * dot reuses `.fv-live-dot` from tailwind.css for a single source of truth.
 */
export function LiveBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="fv-live-dot" />
      <span className="text-xs font-semibold text-success-600 dark:text-success-400">
        {t('dashboard.live')}
      </span>
    </span>
  );
}
