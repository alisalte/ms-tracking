/**
 * Phase 2 — TailAdmin application shell tests.
 *
 * Covers: AppLayout composition (sidebar + header + main), permission-aware
 * navigation rendering/filtering, active-item state, navigation, the mobile
 * off-canvas drawer, desktop collapse, the breadcrumb trail, branding, and the
 * user menu (identity + logout). Auth/API modules are mocked — no backend.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { i18n } from '@/i18n';
import { AppLayout } from '@/layouts/AppLayout';

// The header mounts the real bell (react-query + WS); stub it — its behavior
// has its own spec (notifications.spec.tsx). Keep an accessible button so the
// e2e contract (header > button "notifications") stays represented.
vi.mock('@/components/shell/NotificationBell', () => ({
  NotificationBell: () => (
    <button type="button" aria-label="notifications">
      bell
    </button>
  ),
}));

// AppLayout mounts the silent-refresh scheduler; stub it (own concerns).
vi.mock('@/auth/useSilentRefresh', () => ({ useSilentRefresh: () => {} }));

// The store's logout POSTs /auth/logout — stub the API module (namespace
// import in auth.store: login, getMe, refreshToken, logout).
vi.mock('@/api/auth.api', () => ({
  login: vi.fn().mockResolvedValue({}),
  getMe: vi.fn().mockResolvedValue({}),
  refreshToken: vi.fn().mockResolvedValue({}),
  logout: vi.fn().mockResolvedValue(undefined),
}));

function setUser(permissions: readonly string[]) {
  useAuthStore.setState({
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    isAuthenticated: true,
    isLoading: false,
    error: null,
    tenantId: 'tenant-1',
    user: {
      id: 'u1',
      email: 'op@fleet.test',
      tenantId: 'tenant-1',
      roles: ['operator'],
      permissions,
    },
  });
}

function renderShellAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<div data-testid="page">dashboard-page</div>} />
            <Route path="/alarms" element={<div data-testid="page">alarms-page</div>} />
            <Route path="/map" element={<div data-testid="page">map-page</div>} />
            <Route path="/account/profile" element={<div data-testid="page">profile-page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    tenantId: null,
    user: null,
  });
});

describe('AppLayout — TailAdmin shell', () => {
  it('renders sidebar + header + main content area with the brand', () => {
    setUser([]);
    renderShellAt('/dashboard');

    // Wordmark — rendered by both the desktop rail and the (always-mounted,
    // visually hidden until opened) mobile off-canvas drawer.
    expect(screen.getAllByText('FleetVision').length).toBeGreaterThan(0);
    expect(screen.getByRole('banner')).toBeTruthy(); // <header>
    const main = document.getElementById('fv-main-content');
    expect(main).toBeTruthy();
    expect(screen.getByTestId('page').textContent).toBe('dashboard-page');
  });

  it('filters navigation by permissions (ungated items only)', () => {
    setUser([]); // no permissions at all
    renderShellAt('/dashboard');
    const nav = screen.getByRole('navigation', { name: 'Navigation' });

    // Always-visible items survive…
    expect(nav.textContent).toContain('Dashboard');
    expect(nav.textContent).toContain('Alarms');
    expect(nav.textContent).toContain('Video');
    // …permission-gated ones are hidden…
    expect(nav.textContent).not.toContain('Map');
    expect(nav.textContent).not.toContain('Trips');
    expect(nav.textContent).not.toContain('Notifications');
    expect(nav.textContent).not.toContain('Geofences');
    expect(nav.textContent).not.toContain('Reports');
  });

  it("shows every gated item for the '*' tenant-admin wildcard", () => {
    setUser(['*']);
    renderShellAt('/dashboard');
    const nav = screen.getByRole('navigation', { name: 'Navigation' });
    expect(nav.textContent).toContain('Map');
    expect(nav.textContent).toContain('Trips');
    expect(nav.textContent).toContain('Notifications');
    expect(nav.textContent).toContain('Geofences');
    expect(nav.textContent).toContain('Reports');
    expect(nav.textContent).toContain('Assets');
    expect(nav.textContent).toContain('Commands');
  });

  it('marks the active nav item and navigates on click', () => {
    setUser(['tracking.read']);
    renderShellAt('/dashboard');

    const activeBefore = document.querySelector('[aria-current="page"]');
    expect(activeBefore?.textContent).toContain('Dashboard');

    fireEvent.click(screen.getByRole('button', { name: 'Alarms' }));
    expect(screen.getByTestId('page').textContent).toBe('alarms-page');
    expect(document.querySelector('[aria-current="page"]')?.textContent).toContain('Alarms');
  });

  it('opens/closes the mobile off-canvas drawer from the hamburger', () => {
    setUser([]);
    renderShellAt('/dashboard');

    // Drawer closed initially — no dialog in the DOM.
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(drawer.textContent).toContain('FleetVision');

    // Backdrop press closes it.
    fireEvent.click(drawer.previousElementSibling as HTMLElement); // backdrop div
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('closes the mobile drawer after navigating', () => {
    setUser([]);
    renderShellAt('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Alarms' }));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
    expect(screen.getByTestId('page').textContent).toBe('alarms-page');
  });

  it('collapses the desktop rail (labels hidden, state flagged)', () => {
    setUser([]);
    renderShellAt('/dashboard');
    const nav = screen.getByRole('navigation', { name: 'Navigation' });
    expect(nav.getAttribute('data-collapsed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(nav.getAttribute('data-collapsed')).toBe('true');
    expect(nav.textContent).not.toContain('Dashboard'); // labels unmount
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeTruthy();
  });

  it('derives the breadcrumb from the nav model (group / item)', () => {
    setUser([]);
    renderShellAt('/dashboard');
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumb.textContent).toContain('Main');
    expect(crumb.textContent).toContain('Dashboard');
  });

  it('user menu shows identity + tenant, links to profile, signs out', async () => {
    setUser([]);
    renderShellAt('/dashboard');

    fireEvent.click(screen.getByRole('button', { name: 'user menu' }));
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('op@fleet.test');
    expect(menu.textContent).toContain('tenant-1');

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Profile' }));
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('profile-page'));

    // Sign out → store cleared (navigation target /login isn't routed in this
    // harness; assert the state transition + API call instead).
    fireEvent.click(screen.getByRole('button', { name: 'user menu' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Sign Out' }));
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
