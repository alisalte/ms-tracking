import { LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { NAV_GROUPS, filterNavByPermissions } from '@/components/shell/nav.config';
import { Dropdown, DropdownItem } from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';

/**
 * AppsMenu — header launcher for permission-filtered existing routes.
 *
 * Does not invent destinations; it reuses the same nav model as the sidebar.
 */
export function AppsMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const groups = filterNavByPermissions(NAV_GROUPS, user?.permissions ?? []);
  const items = groups.flatMap((g) => g.items);

  return (
    <Dropdown
      aria-label={t('common.applications')}
      trigger={<LayoutGrid size={18} />}
      triggerClassName="hidden size-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:inline-flex dark:text-graydark-600 dark:hover:bg-white/5 dark:hover:text-white"
    >
      <DropdownItem header>{t('common.applications')}</DropdownItem>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <DropdownItem
            key={item.key}
            icon={<Icon size={16} />}
            onClick={() => navigate(item.path)}
          >
            {t(`nav.${item.key}`)}
          </DropdownItem>
        );
      })}
    </Dropdown>
  );
}
