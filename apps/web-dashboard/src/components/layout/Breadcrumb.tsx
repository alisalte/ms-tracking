import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { NAV_GROUPS } from '@/components/shell/nav.config';

/**
 * Breadcrumb — header trail derived from the nav model (Tailwind).
 *
 * Maps the current pathname onto the permission-independent nav config
 * (longest prefix wins) and renders `Group / Item`. Deep links that don't match
 * a nav entry (e.g. `/account/profile`) render nothing — those pages carry
 * their own headers. The chevron mirrors in RTL via `rtl:rotate-180`.
 */
export function Breadcrumb() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  let match: { groupKey: string | null; itemKey: string } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const active =
        pathname === item.path || (item.path !== '/dashboard' && pathname.startsWith(item.path));
      if (active && (!match || item.path.length > 0)) {
        match = { groupKey: group.groupKey, itemKey: item.key };
      }
    }
  }
  if (!match) return null;

  // Single-item groups (Assets/Video/Maintenance) duplicate their group label
  // — render the label once instead of "Assets > Assets".
  const itemLabel = t(`nav.${match.itemKey}`);
  const groupLabel = match.groupKey ? t(`navGroups.${match.groupKey}`) : null;
  const showGroup = groupLabel !== null && groupLabel !== itemLabel;

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 sm:flex">
      {showGroup && (
        <>
          <span className="text-sm text-gray-400 dark:text-graydark-600">{groupLabel}</span>
          <ChevronRight
            size={14}
            aria-hidden
            className="shrink-0 text-gray-300 rtl:rotate-180 dark:text-graydark-500"
          />
        </>
      )}
      <span className="truncate text-sm font-semibold text-gray-700 dark:text-graydark-800">
        {itemLabel}
      </span>
    </nav>
  );
}
