import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  assignImeisToFleet,
  clearDevicesFromFleet,
  listInbox,
  listTenantDevices,
} from '@/api/platform-assets';
import { addDaysIso } from '@/lib/license';
import { canManageTenants } from '@/lib/session';
import { LoginPage } from '@/pages/LoginPage';
import { TenantCreatePage } from '@/pages/TenantCreatePage';
import { TenantDetailPage } from '@/pages/TenantDetailPage';
import '@/i18n';

vi.mock('@/api/tenants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/tenants')>();
  return {
    ...actual,
    getTenant: vi.fn(async () => ({
      id: 't1',
      name: 'FleetVision',
      tier: 'STANDARD',
      region: 'IR',
      status: 'ACTIVE',
      license: null,
    })),
    listTenantUsers: vi.fn(async () => []),
    listTenantRoles: vi.fn(async () => [
      {
        id: 'role-viewer',
        name: 'viewer',
        description: '',
        isSystem: true,
        permissions: ['fleet.read'],
        memberCount: 0,
        mfaRequired: false,
      },
    ]),
    listPermissionCatalog: vi.fn(async () => [
      {
        domain: 'fleet',
        labelKey: 'access.domain.fleet',
        permissions: ['fleet.read', 'fleet.write'],
      },
    ]),
    createTenantRole: vi.fn(),
    updateTenantRolePermissions: vi.fn(),
    setTenantUserRole: vi.fn(),
  };
});

vi.mock('@/api/platform-assets', () => ({
  listTenantFleets: vi.fn(async () => [
    {
      id: 'fleet-1',
      name: 'North',
      code: 'NORTH',
      description: null,
      status: 'ACTIVE',
    },
  ]),
  listTenantDevices: vi.fn(async () => [
    {
      id: 'dev-1',
      imei: '490154203237518',
      serialNumber: null,
      manufacturer: null,
      model: null,
      protocol: 'meitrack',
      status: 'ACTIVE',
      vehicleId: null,
      fleetId: null,
      fleetName: null,
      fleetCode: null,
    },
  ]),
  createTenantFleet: vi.fn(),
  assignDeviceToFleet: vi.fn(),
  listInbox: vi.fn(async () => []),
  lookupImei: vi.fn(),
  claimDevice: vi.fn(),
  assignImeisToFleet: vi.fn(async () => ({ fleetId: 'fleet-1', assigned: [], failed: [] })),
  clearDevicesFromFleet: vi.fn(async () => ({ cleared: [], failed: [] })),
}));

vi.mock('@/api/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/billing')>();
  return {
    ...actual,
    listInvoices: vi.fn(async () => []),
  };
});

describe('tenant-admin access gate', () => {
  it('allows wildcard and billing.tenant.manage', () => {
    expect(canManageTenants(['*'])).toBe(true);
    expect(canManageTenants(['billing.tenant.manage'])).toBe(true);
    expect(canManageTenants(['fleet.read'])).toBe(false);
  });
});

describe('login form', () => {
  it('renders organisation, email and password fields', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.getByDisplayValue('FleetVision')).toBeInTheDocument();
  });
});

describe('create tenant form', () => {
  it('requires an organisation name', () => {
    render(
      <MemoryRouter>
        <TenantCreatePage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /ایجاد مستأجر و مدیر|Create tenant/i }));
    const name = screen.getByLabelText(/نام سازمان|Organisation name/i) as HTMLInputElement;
    expect(name.validity.valueMissing).toBe(true);
  });

  it('offers a Trial license plan', () => {
    render(
      <MemoryRouter>
        <TenantCreatePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('option', { name: /آزمایشی|Trial/i })).toBeInTheDocument();
  });

  it('fills a 14-day expiry when Trial is selected', () => {
    render(
      <MemoryRouter>
        <TenantCreatePage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TRIAL' } });
    const expires = screen.getByLabelText(/^(انقضا|Expires)$/) as HTMLInputElement;
    expect(expires.value).toBe(addDaysIso(14));
  });

  it('shows unit prices for rented resources', () => {
    render(
      <MemoryRouter>
        <TenantCreatePage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/مبلغ هر خودرو|Per vehicle/i)).toBeInTheDocument();
    expect(screen.getByText(/جمع قرارداد|Contract total/i)).toBeInTheDocument();
  });
});

describe('tenant detail tabs', () => {
  it('renders visible section tabs and switches to Access', async () => {
    render(
      <MemoryRouter initialEntries={['/tenants/t1']}>
        <Routes>
          <Route path="/tenants/:id" element={<TenantDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('tenant-detail-tabs')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /نمای کلی|Overview/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: /دسترسی|Access/i }));
    expect(screen.getByRole('tab', { name: /دسترسی|Access/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: /ایجاد کاربر|Create user/i })).toBeInTheDocument();
  });

  it('opens fleet registration and device assignment for the tenant', async () => {
    render(
      <MemoryRouter initialEntries={['/tenants/t1']}>
        <Routes>
          <Route path="/tenants/:id" element={<TenantDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: /ناوگان|Fleets/i }));
    expect(await screen.findByTestId('create-fleet-form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ساخت ناوگان|Create fleet/i })).toBeInTheDocument();
    expect(await screen.findByText('490154203237518')).toBeInTheDocument();
    expect(screen.getByTestId('unassigned-imeis')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /تخصیص انتخاب|Assign selected/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'North' })).toBeInTheDocument();
  });

  it('assigns every ticked IMEI that is not on a fleet', async () => {
    vi.mocked(listInbox).mockResolvedValueOnce([
      {
        imei: '356938035643809',
        protocol: 'gt06',
        manufacturer: null,
        model: null,
        seenCount: 2,
        firstSeenAt: '2026-06-01T00:00:00.000Z',
        lastSeenAt: '2026-06-02T00:00:00.000Z',
      },
    ]);
    vi.mocked(assignImeisToFleet).mockResolvedValue({
      fleetId: 'fleet-1',
      assigned: [
        { imei: '490154203237518', deviceId: 'dev-1', created: false, assignment: null },
        { imei: '356938035643809', deviceId: 'dev-2', created: true, assignment: null },
      ],
      failed: [],
    });
    render(
      <MemoryRouter initialEntries={['/tenants/t1']}>
        <Routes>
          <Route path="/tenants/:id" element={<TenantDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: /ناوگان|Fleets/i }));
    expect(await screen.findByRole('checkbox', { name: '356938035643809' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /انتخاب همه|Select all/i }));
    const assign = screen.getByRole('button', { name: /تخصیص انتخاب|Assign selected/i });
    await waitFor(() => expect(assign).toBeEnabled());
    fireEvent.click(assign);
    await waitFor(() =>
      expect(assignImeisToFleet).toHaveBeenCalledWith('t1', {
        fleetId: 'fleet-1',
        imeis: ['490154203237518', '356938035643809'],
      }),
    );
    expect(await screen.findByText(/2 دستگاه به ناوگان|2 devices assigned/)).toBeInTheDocument();
  });

  it('removes a device from its fleet so it can join another one', async () => {
    vi.mocked(listTenantDevices).mockResolvedValueOnce([
      {
        id: 'dev-1',
        imei: '490154203237518',
        serialNumber: null,
        manufacturer: null,
        model: null,
        protocol: 'meitrack',
        status: 'ACTIVE',
        vehicleId: 'veh-1',
        fleetId: 'fleet-1',
        fleetName: 'North',
        fleetCode: 'NORTH',
      },
    ]);
    vi.mocked(clearDevicesFromFleet).mockResolvedValue({
      cleared: [{ deviceId: 'dev-1', cleared: true }],
      failed: [],
    });
    render(
      <MemoryRouter initialEntries={['/tenants/t1']}>
        <Routes>
          <Route path="/tenants/:id" element={<TenantDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: /ناوگان|Fleets/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: /برداشتن از ناوگان|Remove from fleet/i }),
    );
    await waitFor(() => expect(clearDevicesFromFleet).toHaveBeenCalledWith('t1', ['dev-1']));
    expect(await screen.findByText(/1 دستگاه از ناوگان|1 devices removed/)).toBeInTheDocument();
  });
});
