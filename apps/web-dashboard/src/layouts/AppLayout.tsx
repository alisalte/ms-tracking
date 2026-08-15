import { useState } from 'react';
import { Outlet } from 'react-router';

import { useSilentRefresh } from '@/auth/useSilentRefresh';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';

/** Content-area padding exposed for full-bleed pages (Tailwind value, px). */
export const PAGE_PADDING = 20;

/**
 * AppLayout — the authenticated TailAdmin application shell.
 *
 * Composition (TailAdmin two-pane layout):
 * - `Sidebar` (dark graydark, permanent 270/72 + mobile off-canvas)
 * - `Topbar` (sticky 64px header: search + notifications + theme + user)
 * - content area (`<main>`) — a scroll column; the active page renders inside.
 *
 * `<main>` carries the standard page padding. Full-bleed pages (Map, Video
 * Wall) render their own internal chrome within this padded area, same as the
 * previous MUI shell. State (mobile drawer open + desktop collapse) lives here
 * so the Topbar's hamburger and the Sidebar's collapse toggle stay in sync.
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
        <Topbar onMobileMenu={() => setMobileOpen(true)} />

        <main
          id="fv-main-content"
          className="relative flex-1 min-h-0 overflow-auto bg-gray-50 dark:bg-graydark-200"
          style={{ padding: PAGE_PADDING }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
