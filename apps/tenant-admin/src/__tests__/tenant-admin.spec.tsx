import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { addDaysIso } from '@/lib/license';
import { canManageTenants } from '@/lib/session';
import { LoginPage } from '@/pages/LoginPage';
import { TenantCreatePage } from '@/pages/TenantCreatePage';
import '@/i18n';

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
