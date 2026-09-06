import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

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
});
