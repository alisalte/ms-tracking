import { useState } from 'react';

import { useSilentRefresh } from '@/auth/useSilentRefresh';
import { Header } from '@/components/layout/Header';
import { MainContent } from '@/components/layout/MainContent';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { useMediaQuery } from '@/hooks/useMediaQuery';

// Re-exported for backwards compatibility (full-bleed pages reference it).
export { PAGE_PADDING } from '@/components/layout/MainContent';

/**
 * AppLayout — the authenticated TailAdmin application shell.
 *
 * Composition (TailAdmin layout):
 * - `Sidebar` (dark graydark rail: permanent 270/64px desktop + off-canvas
 *   mobile), permission-aware via `nav.config`.
 * - `Header` (sticky 64px: breadcrumb + search + notifications + theme +
 *   language + user).
 * - `MainContent` (`<main>`) — the scroll column; the active page renders via
 *   the layout `<Outlet/>` inside the standard `PAGE_PADDING`. Full-bleed
 *   pages (Map, Video Wall) cover exactly this area with `inset:0`.
 * - `MobileTabBar` (< lg) — bottom navigation under the content column; its
 *   "More" button opens the sidebar drawer.
 *
 * Shell state (mobile drawer open + desktop collapse) lives here so the
 * header's hamburger and the sidebar's collapse toggle stay in sync.
 *
 * Sprint E §5: `useSilentRefresh` is mounted exactly once here — it proactively
 * rotates the access token ~60s before expiry for every authenticated screen.
 */
export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop collapse persists across sessions (operator preference).
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('fv:sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapse = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('fv:sidebar-collapsed', c ? '0' : '1');
      } catch {
        /* storage unavailable — state still works for the session */
      }
      return !c;
    });
  };

  useSilentRefresh();
  // Below `lg` the sidebar is an off-canvas drawer, so a bottom tab bar
  // carries the everyday destinations.
  const compactShell = useMediaQuery('(max-width: 1023.98px)');

  return (
    <div className="relative flex h-dvh overflow-hidden bg-[#f3f5f8] text-gray-900 dark:bg-[#101722] dark:text-graydark-900">
      <Sidebar
        mobileOpen={mobileOpen}
        collapsed={collapsed}
        onMobileClose={() => setMobileOpen(false)}
        onToggleCollapse={toggleCollapse}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMobileMenu={() => setMobileOpen(true)} />
        <MainContent />
        {compactShell && <MobileTabBar onMore={() => setMobileOpen(true)} />}
      </div>
    </div>
  );
}
