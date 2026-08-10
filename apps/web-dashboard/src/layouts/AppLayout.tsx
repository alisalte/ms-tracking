import { Box, Stack } from '@mui/material';
import { useState } from 'react';
import { Outlet } from 'react-router';

import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';

/** Limitless content-area padding exposed for full-bleed pages. */
export const PAGE_PADDING = 16;

/**
 * AppLayout — the authenticated Limitless Layout 1 shell.
 *
 * Composition (UI_UX_Design.md §0.4, restyled to Limitless L1):
 * - `Sidebar` (dark slate, permanent 270/64 + mobile off-canvas)
 * - `Topbar` (light 50px navbar: search + notifications + theme + user)
 * - content area (`<main>`) — a flex column; the active page renders inside it.
 *
 * `<main>` is a flex column so that child pages fill the full available width
 * and height. Pages that want a padded "card" layout wrap themselves in a
 * `<Box sx={{ p: PAGE_PADDING }}>`; full-bleed pages (Map, Video Wall) omit the
 * padding and fill the space.
 */
export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Stack
      direction="row"
      sx={{
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'background.default',
      }}
    >
      <Sidebar
        mobileOpen={mobileOpen}
        collapsed={collapsed}
        onMobileClose={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />

      <Stack sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <Topbar onMobileMenu={() => setMobileOpen(true)} />

        <Box
          component="main"
          id="fv-main-content"
          sx={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            backgroundColor: 'background.default',
            p: PAGE_PADDING,
          }}
        >
          <Outlet />
        </Box>
      </Stack>
    </Stack>
  );
}
