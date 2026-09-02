import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { i18n } from '@/i18n';
import { AlarmRulesPage } from '@/pages/AlarmRulesPage';
import type { User } from '@/types/auth.types';
import type { AlarmRule } from '@/types/rule.types';

const rules: AlarmRule[] = [
  {
    id: 'rule-1',
    tenantId: 'tenant-1',
    name: 'City overspeed 80',
    type: 'overspeed',
    severity: 'HIGH',
    enabled: true,
    entityType: 'vehicle',
    entityId: null,
    conditions: { thresholdKmh: 80 },
    cooldownSec: 300,
    dedupWindowSec: 600,
    repeatPolicy: 'COOLDOWN',
    version: 1,
  },
];

vi.mock('@/api/rule.api', () => {
  const ok = (data: unknown) => ({
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(() => Promise.resolve({})),
    isPending: false,
    reset: vi.fn(),
  });
  return {
    useAlarmRules: () => ok(rules),
    useAlarmRuleDetail: () => ok(undefined),
    useCreateAlarmRule: mutation,
    useUpdateAlarmRule: mutation,
    useEnableAlarmRule: mutation,
    useDisableAlarmRule: mutation,
    useDeleteAlarmRule: mutation,
  };
});

vi.mock('@/api/asset.api', () => ({
  useVehicles: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/api/geofence.api', () => ({
  useGeofences: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));

function setUser(permissions: readonly string[]) {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      email: 'op@example.com',
      tenantId: 'tenant-1',
      roles: ['operator'],
      permissions,
    } as User,
  });
}

function renderRules() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        ToastProvider,
        null,
        createElement(
          I18nextProvider,
          { i18n },
          createElement(MemoryRouter, { initialEntries: ['/rules'] }, createElement(AlarmRulesPage)),
        ),
      ),
    ),
  );
}

describe('AlarmRulesPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    setUser(['*']);
  });

  it('lists existing rules and opens the create form', async () => {
    renderRules();
    expect(await screen.findByText('Alert rules')).toBeInTheDocument();
    expect(screen.getByText('City overspeed 80')).toBeInTheDocument();
    expect(screen.getByText('80 km/h')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    });
  });
});
