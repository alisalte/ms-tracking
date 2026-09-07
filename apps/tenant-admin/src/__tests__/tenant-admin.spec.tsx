import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

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
  };
});

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
});
