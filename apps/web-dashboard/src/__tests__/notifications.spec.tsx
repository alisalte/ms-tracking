/**
 * Sprint H — Notification Center UI tests.
 *
 * Covers: the bell (unread badge, mark-all-read, view-all link), the
 * Notification Center page (filter bar + history list), and the realtime
 * hook's incremental cache update (prepend + unread count bump — Sprint H
 * §54: no full reload). API modules are mocked — no backend required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/api/query-keys';
import { useAuthStore } from '@/auth/auth.store';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { i18n } from '@/i18n';
import { NotificationCenterPage } from '@/pages/NotificationCenterPage';
import type { Notification } from '@/types/notification.types';

// ── API mocks ──────────────────────────────────────────────────────────────

const markAllAsRead = vi.fn().mockResolvedValue(undefined);
const markAsRead = vi.fn().mockResolvedValue(undefined);

vi.mock('@/api/notification.api', () => ({
  useUnreadCount: () => ({ data: { total: 3, critical: 1, high: 1 } }),
  useNotifications: () => ({
    data: [
      {
        id: 'n1',
        title: 'Speeding: TRK-1',
        body: 'Vehicle TRK-1 exceeded the speed limit',
        severity: 'high',
        priority: 'high',
        category: 'alarm',
        eventType: 'overspeed',
        read: false,
        createdAt: new Date().toISOString(),
        link: '/alarms?id=1',
      },
      {
        id: 'n2',
        title: 'Device offline: TRK-2',
        body: 'Device went offline',
        severity: 'normal',
        priority: 'normal',
        category: 'alarm',
        eventType: 'device_offline',
        read: true,
        createdAt: new Date().toISOString(),
      },
    ],
    isLoading: false,
  }),
  useNotificationsPage: () => ({
    items: [
      {
        id: 'n1',
        title: 'Speeding: TRK-1',
        body: 'exceeded',
        severity: 'high',
        priority: 'high',
        category: 'alarm',
        eventType: 'overspeed',
        read: false,
        createdAt: new Date().toISOString(),
      },
    ],
    hasNextPage: false,
    fetchNextPage: () => {},
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
  useNotificationDetail: () => ({ data: null, isLoading: false }),
  useChannelHealth: () => ({
    data: [
      { channel: 'in_app', provider: 'postgres', status: 'CONFIGURED' },
      { channel: 'websocket', provider: 'socketio', status: 'CONFIGURED' },
      { channel: 'email', provider: 'smtp', status: 'DISABLED' },
      { channel: 'sms', provider: 'none', status: 'DISABLED' },
      { channel: 'push', provider: 'none', status: 'DISABLED' },
    ],
  }),
  useNotificationPreferences: () => ({
    data: [
      {
        category: 'alarm',
        minSeverity: 'normal',
        channels: ['in_app', 'websocket'],
        enabled: true,
      },
    ],
  }),
  useMarkAsRead: () => ({ mutate: markAsRead, isPending: false }),
  useMarkAllAsRead: () => ({ mutate: markAllAsRead, isPending: false }),
  useUpdatePreferences: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The bell + center page mount the realtime hook — stub the WS layer.
vi.mock('@/hooks/useRealtimeSocket', () => ({
  useRealtimeSocket: () => ({ state: 'disconnected', subscribe: () => () => {}, emit: () => {} }),
}));

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderBell() {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, {}, createElement(NotificationBell)),
      ),
    ),
  );
}

function renderCenter() {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          MemoryRouter,
          { initialEntries: ['/notifications'] },
          createElement(NotificationCenterPage),
        ),
      ),
    ),
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  markAllAsRead.mockClear();
  markAsRead.mockClear();
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'admin@test.local',
      fullName: 'Admin',
      roles: ['tenant-admin'],
      permissions: ['*'],
    } as never,
    tenantId: '11111111-1111-1111-1111-111111111111',
    isAuthenticated: true,
  });
});

describe('NotificationBell', () => {
  it('renders the unread badge from the real unread count', async () => {
    renderBell();
    const bellButton = screen.getByRole('button', { name: 'notifications' });
    expect(bellButton).toBeDefined();
    // The badge carries the numeric unread count (3).
    expect(document.querySelector('.MuiBadge-badge')?.textContent).toContain('3');
  });

  it('opens the dropdown, lists notifications, and marks all read', async () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'notifications' }));
    expect(await screen.findByText('Speeding: TRK-1')).toBeDefined();
    expect(screen.getByText('Device offline: TRK-2')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }));
    await waitFor(() => expect(markAllAsRead).toHaveBeenCalled());
  });

  it('links to the Notification Center via "view all"', async () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'notifications' }));
    const viewAll = await screen.findByRole('button', { name: /view all notifications/i });
    expect(viewAll).toBeDefined();
  });

  it('marks a notification read when clicked', async () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'notifications' }));
    const item = await screen.findByText('Speeding: TRK-1');
    fireEvent.click(item);
    await waitFor(() => expect(markAsRead).toHaveBeenCalledWith('n1'));
  });
});

describe('NotificationCenterPage', () => {
  it('renders the filter bar and history list', async () => {
    renderCenter();
    expect(await screen.findByText('Speeding: TRK-1')).toBeDefined();
    // Filter controls exist (type/severity/unread-only).
    expect(screen.getByLabelText(/type/i)).toBeDefined();
    expect(screen.getByLabelText(/severity/i)).toBeDefined();
    expect(screen.getByText(/unread only/i)).toBeDefined();
  });

  it('shows the preferences tab with unavailable channels disabled', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('tab', { name: /preferences/i }));
    // Available channels render as togglable switches.
    expect(await screen.findByText('In-App')).toBeDefined();
    expect(screen.getByText('Realtime')).toBeDefined();
    // Unavailable channels (SMS/push — provider not configured) are shown but
    // disabled (Sprint H §40).
    const smsSwitch = screen.getByText('SMS').closest('label')?.querySelector('input');
    expect(smsSwitch).toBeTruthy();
    expect((smsSwitch as HTMLInputElement).disabled).toBe(true);
  });
});

describe('useNotificationRealtime — incremental cache updates', () => {
  it('prepends new notifications + bumps unread count without refetching', async () => {
    const { applyIncomingNotification } = await import('@/hooks/useNotificationRealtime');
    const client = makeClient();
    const existing: Notification[] = [
      {
        id: 'old-1',
        title: 'Old',
        body: '',
        severity: 'normal',
        priority: 'normal',
        category: 'alarm',
        eventType: 'overspeed',
        read: true,
        createdAt: new Date().toISOString(),
      },
    ];
    client.setQueryData(queryKeys.notifications.list(), existing);
    client.setQueryData(queryKeys.notifications.unreadCount(), { total: 1, critical: 0, high: 0 });

    act(() => {
      applyIncomingNotification(client, {
        id: 'new-1',
        title: 'Speeding: TRK-9',
        body: 'fast',
        severity: 'critical',
        category: 'alarm',
        eventType: 'overspeed',
        createdAt: new Date().toISOString(),
      });
    });

    const list = client.getQueryData<Notification[]>(queryKeys.notifications.list());
    expect(list?.[0]?.id).toBe('new-1'); // prepended
    expect(list).toHaveLength(2);
    const count = client.getQueryData<{ total: number; critical: number }>(
      queryKeys.notifications.unreadCount(),
    );
    expect(count?.total).toBe(2); // 1 + 1, no refetch
    expect(count?.critical).toBe(1);

    // Duplicate delivery of the same notification id does not double-insert.
    act(() => {
      applyIncomingNotification(client, {
        id: 'new-1',
        title: 'Speeding: TRK-9',
        body: 'fast',
        severity: 'critical',
        category: 'alarm',
        eventType: 'overspeed',
        createdAt: new Date().toISOString(),
      });
    });
    expect(client.getQueryData<Notification[]>(queryKeys.notifications.list())).toHaveLength(2);
  });
});
