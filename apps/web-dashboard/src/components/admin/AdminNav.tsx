/**
 * AdminNav — the left settings navigation (UI_UX §5.2 IA, §5.5 two-column shell).
 *
 * Renders the full 12-item Admin Panel IA. Every section is wired to a real
 * backend (or an honest empty/unavailable state when that domain has no
 * service yet). The active section is highlighted.
 */
import {
  Bell,
  Building2,
  CreditCard,
  KeyRound,
  Layers,
  Lock,
  MapPin,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AdminSection } from '@/types/admin.types';

/** Nav item definition — section key + icon + whether it's functional this sprint. */
interface NavItem {
  key: AdminSection;
  icon: typeof Users;
  enabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'organization', icon: Building2, enabled: true },
  { key: 'users', icon: Users, enabled: true },
  { key: 'roles', icon: Lock, enabled: true },
  { key: 'permissions', icon: ShieldCheck, enabled: true },
  { key: 'fleets', icon: Truck, enabled: true },
  { key: 'devices', icon: Layers, enabled: true },
  { key: 'geofences', icon: MapPin, enabled: true },
  { key: 'policies', icon: ShieldCheck, enabled: true },
  { key: 'notifications', icon: Bell, enabled: true },
  { key: 'integrations', icon: Plug, enabled: true },
  { key: 'apikeys', icon: KeyRound, enabled: true },
  { key: 'billing', icon: CreditCard, enabled: true },
  { key: 'audit', icon: ScrollText, enabled: true },
  { key: 'settings', icon: Settings, enabled: true },
];

interface AdminNavProps {
  section: AdminSection;
  onSelect: (s: AdminSection) => void;
  /**
   * `vertical` = the desktop sidebar column; `horizontal` = the mobile
   * scrollable strip rendered above the section content.
   */
  orientation?: 'vertical' | 'horizontal';
}

export function AdminNav({ section, onSelect, orientation = 'vertical' }: AdminNavProps) {
  const { t } = useTranslation();
  const horizontal = orientation === 'horizontal';
  return (
    <nav
      className={
        horizontal
          ? 'fv-scroll flex flex-row gap-1.5 overflow-x-auto pb-1'
          : 'flex flex-col gap-0.5'
      }
      aria-label={t('admin.title')}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = section === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => item.enabled && onSelect(item.key)}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'flex min-h-10 items-center gap-2.5 rounded-lg text-start text-sm transition-colors',
              horizontal ? 'shrink-0 px-3' : 'w-full px-3',
              isActive
                ? 'bg-brand-500 font-semibold text-white hover:bg-brand-600'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-graydark-700 dark:hover:bg-white/5 dark:hover:text-white',
              item.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
            ].join(' ')}
          >
            <span className="flex w-4.5 shrink-0 justify-center [&_svg]:size-[18px]">
              <item.icon />
            </span>
            <span className="min-w-0 flex-1 truncate whitespace-nowrap">
              {t(`admin.nav.${item.key}`)}
            </span>
            {!item.enabled && !horizontal && (
              <span className="shrink-0 text-[0.6rem] text-gray-400 dark:text-graydark-600">
                {t('admin.upcoming')}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
