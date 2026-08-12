import { ChevronLeft, ChevronRight, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { Tooltip } from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';
import { isRTL } from '@/i18n/config';
import { NAV_GROUPS, filterNavByPermissions } from './nav.config';

/** Expanded sidebar width (TailAdmin default = 270px). */
export const SIDEBAR_WIDTH = 270;
/** Collapsed (mini) sidebar width (icon-only). */
export const SIDEBAR_COLLAPSED_WIDTH = 72;

interface SidebarProps {
  /** Desktop: collapsed state. Mobile: open state. */
  mobileOpen: boolean;
  collapsed: boolean;
  onMobileClose: () => void;
  onToggleCollapse: () => void;
}

/**
 * Sidebar — the TailAdmin dark navigation drawer.
 *
 * Stays dark (`#1A222C` graydark) in BOTH light and dark modes — the
 * recognizable TailAdmin silhouette. Grouped nav with section labels, an
 * indigo active pill, hover surfaces, and icon-only collapse mode.
 *
 * Behavior:
 * - Desktop (≥lg): permanent drawer, 270px expanded / 72px collapsed (icons).
 * - Mobile (<lg): temporary off-canvas drawer (overlay), full 270px.
 *
 * Preserves the legacy export surface (`SIDEBAR_WIDTH`,
 * `SIDEBAR_COLLAPSED_WIDTH`, props) so AppLayout and the router are untouched.
 */
export function Sidebar({ mobileOpen, collapsed, onMobileClose, onToggleCollapse }: SidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const groups = filterNavByPermissions(NAV_GROUPS, user?.permissions ?? []);
  const currentPath = location.pathname;
  const rtl = isRTL(typeof document !== 'undefined' ? document.documentElement.lang : 'en');

  const handleNavigate = (path: string) => {
    navigate(path);
    onMobileClose();
  };

  const content = (
    <div className="flex h-full flex-col text-white" style={{ backgroundColor: '#1A222C' }}>
      {/* ── Brand + collapse toggle ── */}
      <div
        className={`flex h-16 shrink-0 items-center border-b border-white/5 ${
          collapsed ? 'justify-center px-0' : 'justify-between ps-6 pe-4'
        }`}
      >
        {collapsed ? (
          <div
            className="flex size-9 items-center justify-center rounded-lg"
            style={{ background: 'linear-gradient(135deg, #465FFB 0%, #6366F1 100%)' }}
          >
            <Truck size={18} color="#fff" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => handleNavigate('/dashboard')}
            className="flex items-center gap-2.5 rounded-md py-1 fv-focus-ring"
            aria-label="FleetVision home"
          >
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'linear-gradient(135deg, #465FFB 0%, #6366F1 100%)' }}
            >
              <Truck size={18} color="#fff" />
            </div>
            <span className="text-lg font-bold tracking-tight text-white">FleetVision</span>
          </button>
        )}

        {/* Collapse toggle (desktop only) */}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t('common.expandNav') : t('common.collapseNav')}
          className="hidden lg:inline-flex size-7 items-center justify-center rounded-md text-graydark-600 hover:bg-white/5 hover:text-white transition-colors fv-focus-ring"
        >
          {/* Chevron points in the "collapse" direction, mirrored in RTL. */}
          {(() => {
            if (rtl) return collapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />;
            return collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />;
          })()}
        </button>
      </div>

      {/* ── Navigation groups ── */}
      <nav className="fv-scroll flex-1 overflow-y-auto overflow-x-hidden py-4">
        {groups.map((group, gi) => (
          <div key={group.groupKey ?? `g-${gi}`} className="mb-2">
            {group.groupKey && !collapsed && (
              <div className={`px-6 pt-3 pb-2 ${gi === 0 ? '' : 'mt-1'}`}>
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-graydark-500">
                  {t(`navGroups.${group.groupKey}`)}
                </span>
              </div>
            )}
            <div className={`flex flex-col gap-0.5 ${collapsed ? 'px-3' : 'px-4'}`}>
              {group.items.map((item) => {
                const isActive =
                  currentPath === item.path ||
                  (item.path !== '/dashboard' && currentPath.startsWith(item.path));
                const Icon = item.icon;
                const label = t(`nav.${item.key}`);

                const link = (
                  <button
                    key={item.key}
                    type="button"
                    data-active={isActive ? 'true' : 'false'}
                    onClick={() => handleNavigate(item.path)}
                    aria-current={isActive ? 'page' : undefined}
                    title={collapsed ? label : undefined}
                    className="fv-sidebar-link fv-focus-ring"
                    style={collapsed ? { justifyContent: 'center' } : undefined}
                  >
                    <Icon
                      size={20}
                      className="shrink-0"
                      color={isActive ? '#fff' : 'currentColor'}
                    />
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

      {/* ── Footer version strip ── */}
      {!collapsed && (
        <div className="shrink-0 border-t border-white/5 px-6 py-3">
          <span className="text-xs text-graydark-500">FleetVision v0.1</span>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* ── Mobile off-canvas drawer ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onMobileClose}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onMobileClose();
            }}
            role="button"
            tabIndex={-1}
            aria-label="Close menu"
          />
          {/* Panel — slides in from the inline-start edge (RTL-aware via dir). */}
          <div
            className="absolute inset-y-0 start-0 w-[270px] shadow-2xl"
            style={{ animation: 'fv-fade-in 0.2s ease' }}
          >
            {content}
          </div>
        </div>
      )}

      {/* ── Desktop permanent drawer ── */}
      <aside
        className="hidden lg:block shrink-0 transition-[width] duration-200"
        style={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
      >
        {content}
      </aside>
    </>
  );
}
