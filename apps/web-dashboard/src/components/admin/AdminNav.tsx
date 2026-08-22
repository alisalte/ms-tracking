/**
 * AdminNav — the left settings navigation (UI_UX §5.2 IA, §5.5 two-column shell).
 *
 * Renders the full 12-item Admin Panel IA. The keyword sections (users, roles,
 * permissions, settings, audit) are functional; the rest render an "upcoming"
 * placeholder so the IA reads complete. The active section is highlighted.
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
  { key: 'organization', icon: Building2, enabled: false },
  { key: 'users', icon: Users, enabled: true },
  { key: 'roles', icon: Lock, enabled: true },
  { key: 'permissions', icon: ShieldCheck, enabled: true },
  { key: 'fleets', icon: Truck, enabled: false },
  { key: 'devices', icon: Layers, enabled: false },
  { key: 'geofences', icon: MapPin, enabled: false },
  { key: 'policies', icon: ShieldCheck, enabled: false },
  { key: 'notifications', icon: Bell, enabled: false },
  { key: 'integrations', icon: Plug, enabled: false },
  { key: 'apikeys', icon: KeyRound, enabled: false },
  { key: 'billing', icon: CreditCard, enabled: false },
  { key: 'audit', icon: ScrollText, enabled: true },
  { key: 'settings', icon: Settings, enabled: true },
];

interface AdminNavProps {
  section: AdminSection;
  onSelect: (s: AdminSection) => void;
}

export function AdminNav({ section, onSelect }: AdminNavProps) {
  const { t } = useTranslation();
  return (
    <nav className="flex flex-col gap-0.5" aria-label={t('admin.title')}>
      {NAV_ITEMS.map((item) => {
        const isActive = section === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => item.enabled && onSelect(item.key)}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-start text-sm transition-colors',
              isActive
                ? 'bg-brand-500 font-semibold text-white hover:bg-brand-600'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-graydark-700 dark:hover:bg-white/5 dark:hover:text-white',
              item.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
            ].join(' ')}
          >
            <span className="flex w-4.5 shrink-0 justify-center [&_svg]:size-[18px]">
              <item.icon />
            </span>
            <span className="min-w-0 flex-1 truncate">{t(`admin.nav.${item.key}`)}</span>
            {!item.enabled && (
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
