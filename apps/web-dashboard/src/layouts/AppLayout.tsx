import { useState } from 'react';

import { useSilentRefresh } from '@/auth/useSilentRefresh';
import { Header } from '@/components/layout/Header';
import { MainContent } from '@/components/layout/MainContent';
import { Sidebar } from '@/components/layout/Sidebar';

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
 *
 * Shell state (mobile drawer open + desktop collapse) lives here so the
 * header's hamburger and the sidebar's collapse toggle stay in sync.
 *
 * Sprint E §5: `useSilentRefresh` is mounted exactly once here — it proactively
 * rotates the access token ~60s before expiry for every authenticated screen.
 */
export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useSilentRefresh();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-graydark-200">
      <Sidebar
        mobileOpen={mobileOpen}
        collapsed={collapsed}
        onMobileClose={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMobileMenu={() => setMobileOpen(true)} />
        <MainContent />
      </div>
    </div>
  );
}
