import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { Brand } from '@/components/branding/Brand';
import { NAV_GROUPS, filterNavByPermissions } from '@/components/shell/nav.config';
import { Tooltip } from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';
import { isRTL } from '@/i18n/config';

/** Expanded sidebar width (TailAdmin default = 270px). */
export const SIDEBAR_WIDTH = 270;
/** Collapsed (mini) sidebar width — icon-only rail. */
export const SIDEBAR_COLLAPSED_WIDTH = 64;

interface SidebarProps {
  /** Desktop: collapsed state. Mobile: off-canvas open state. */
  mobileOpen: boolean;
  collapsed: boolean;
  onMobileClose: () => void;
  onToggleCollapse: () => void;
}

/**
 * Sidebar — the TailAdmin dark navigation rail (Tailwind).
 *
 * The signature TailAdmin silhouette: a constant-dark sidebar in both color
 * modes, grouped nav with uppercase section labels, pill links with an active
 * brand state. The permission-aware item list comes from `nav.config` —
 * items/groups hidden unless the signed-in principal holds the required
 * permission strings (same filter the previous MUI sidebar used).
 *
 * Responsive behavior:
 * - Desktop (≥lg): permanent rail, 270px expanded / 64px icon-only collapsed.
 * - Mobile (<lg): off-canvas dialog with backdrop, closed on navigation,
 *   backdrop press, or ESC.
 *
 * RTL: logical utilities (`start-*`, `ps-*`) + a direction-aware collapse
 * chevron, so the rail mirrors cleanly for `fa`.
 */
export function Sidebar({ mobileOpen, collapsed, onMobileClose, onToggleCollapse }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const rtl = isRTL(i18n.language);

  const groups = filterNavByPermissions(NAV_GROUPS, user?.permissions ?? []);
  const currentPath = location.pathname;

  const handleNavigate = (path: string) => {
    navigate(path);
    onMobileClose();
  };

  const isActive = (path: string) =>
    currentPath === path || (path !== '/dashboard' && currentPath.startsWith(path));

  // Shared inner content between the desktop rail and the mobile drawer.
  const content = (
    <div className="flex h-full flex-col bg-graydark-200 text-graydark-700 dark:bg-[#141b24]">
      {/* Brand + collapse toggle */}
      <div
        className={`flex h-16 shrink-0 items-center border-b border-white/5 ${
          collapsed ? 'justify-center' : 'justify-between ps-5 pe-3'
        }`}
      >
        {collapsed ? (
          <Tooltip label="FleetVision" side="right">
            <Brand size="sm" showWordmark={false} />
          </Tooltip>
        ) : (
          <Brand size="sm" />
        )}

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t('common.expandNav') : t('common.collapseNav')}
          className="hidden size-8 items-center justify-center rounded-lg text-graydark-600 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:inline-flex"
        >
          {rtl ? (
            collapsed ? (
              <ChevronLeft size={18} />
            ) : (
              <ChevronRight size={18} />
            )
          ) : collapsed ? (
            <ChevronRight size={18} />
          ) : (
            <ChevronLeft size={18} />
          )}
        </button>
      </div>

      {/* Navigation groups */}
      <nav
        aria-label={t('common.navigation')}
        data-collapsed={collapsed}
        className="fv-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3"
      >
        {groups.map((group, gi) => (
          <div key={group.groupKey ?? `g-${gi}`} className="mb-1.5">
            {group.groupKey && !collapsed && (
              <p
                className={`px-6 pt-3 pb-1.5 text-[0.65rem] font-semibold tracking-[0.08em] text-graydark-500 uppercase ${
                  gi === 0 ? '' : 'mt-2 border-t border-white/5 pt-4'
                }`}
              >
                {t(`navGroups.${group.groupKey}`)}
              </p>
            )}
            <div
              className={
                collapsed ? 'flex flex-col items-center gap-1 px-2' : 'flex flex-col gap-0.5 px-3'
              }
            >
              {group.items.map((item) => {
                const active = isActive(item.path);
                const Icon = item.icon;
                const label = t(`nav.${item.key}`);
                const link = (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => handleNavigate(item.path)}
                    aria-current={active ? 'page' : undefined}
                    data-active={active}
                    className={`fv-sidebar-link fv-focus-ring ${collapsed ? 'justify-center px-0' : ''}`}
                  >
                    <Icon size={18} className="shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </button>
                );
                return collapsed ? (
                  <Tooltip key={item.key} label={label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer version strip */}
      {!collapsed && (
        <div className="shrink-0 border-t border-white/5 px-5 py-3 text-xs text-graydark-500">
          FleetVision v0.1
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile off-canvas drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('common.closeMenu')}
            className="absolute inset-0 cursor-default bg-gray-900/60"
            onClick={onMobileClose}
          />
          <div
            // biome-ignore lint/a11y/useSemanticElements: native <dialog> has no controlled-open React API; ARIA dialog is the standard off-canvas pattern
            role="dialog"
            aria-modal="true"
            aria-label={t('common.navigation')}
            className="absolute inset-y-0 start-0 w-[270px] shadow-2xl"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onMobileClose();
            }}
          >
            {content}
          </div>
        </div>
      )}

      {/* Desktop permanent rail */}
      <aside
        className="hidden shrink-0 border-e border-white/5 transition-[width] duration-200 lg:block"
        style={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
      >
        {content}
      </aside>
    </>
  );
}
