import { Bell, LayoutDashboard, Map as MapIcon, Menu, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { PERMISSIONS } from '@/auth/permissions';
import { isNavItemActive } from '@/components/shell/nav.config';
import { useAuth } from '@/hooks/useAuth';

interface Tab {
  key: string;
  path: string;
  icon: LucideIcon;
  labelKey: string;
  permission?: string;
}

/** The four daily destinations; everything else lives behind "More". */
const TABS: readonly Tab[] = [
  { key: 'home', path: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.home' },
  {
    key: 'map',
    path: '/map',
    icon: MapIcon,
    labelKey: 'nav.map',
    permission: PERMISSIONS.trackingRead,
  },
  { key: 'video', path: '/video', icon: Video, labelKey: 'nav.video' },
  { key: 'alarms', path: '/alarms', icon: Bell, labelKey: 'nav.alarms' },
];

/**
 * MobileTabBar — thumb-reachable bottom navigation for phones and tablets
 * (< lg). Sits under the content column (not `fixed`), so full-bleed pages
 * (Map, Video Wall) automatically end above it. "More" opens the full sidebar
 * drawer. Respects the iOS home-indicator safe area.
 */
export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const allowed = (p?: string) => !p || perms.includes('*') || perms.includes(p);

  const item = (
    key: string,
    label: string,
    Icon: LucideIcon,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-none bg-transparent px-1 pt-2 pb-1.5 text-[0.68rem] font-semibold transition-colors ${
        active
          ? 'text-brand-600 dark:text-brand-300'
          : 'text-gray-500 active:text-gray-800 dark:text-graydark-600 dark:active:text-white'
      }`}
    >
      {active && (
        <span aria-hidden className="absolute top-0 h-[3px] w-8 rounded-b-full bg-brand-500" />
      )}
      <Icon size={21} aria-hidden strokeWidth={active ? 2.3 : 1.9} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );

  return (
    <nav
      aria-label={t('common.navigation')}
      className="flex shrink-0 items-stretch border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(16,24,40,0.06)] backdrop-blur-xl lg:hidden dark:border-white/10 dark:bg-graydark-200/95"
    >
      {TABS.filter((tab) => allowed(tab.permission)).map((tab) =>
        item(tab.key, t(tab.labelKey), tab.icon, isNavItemActive(tab.path, location), () =>
          navigate(tab.path),
        ),
      )}
      {item('more', t('nav.more'), Menu, false, onMore)}
    </nav>
  );
}
