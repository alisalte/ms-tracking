/**
 * Profile page — identity card, photo upload, cover, stats.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { i18n } from '@/i18n';
import { writeProfileAvatar } from '@/lib/profile-media';
import { ProfilePage } from '@/pages/ProfilePage';

vi.mock('@/api/admin.api', () => ({
  useTenant: () => ({ data: { name: 'Acme Fleet' } }),
  useRoles: () => ({ data: [{ id: 'operator', name: 'Operator' }] }),
}));

vi.mock('@/lib/profile-media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/profile-media')>('@/lib/profile-media');
  return {
    ...actual,
    fileToProfileImage: vi.fn(async (file: File) => `data:image/jpeg;base64,${file.name}`),
  };
});

function renderProfile() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('ProfilePage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
    useAuthStore.setState({
      accessToken: 't',
      refreshToken: 'r',
      isAuthenticated: true,
      isLoading: false,
      error: null,
      tenantId: 'tenant-1',
      user: {
        id: 'u1',
        email: 'op@fleet.test',
        tenantId: 'tenant-1',
        tenantName: 'Acme Fleet',
        roles: ['operator'],
        permissions: ['fleet.read'],
      },
    });
  });

  it('renders the identity card with a portrait, cover action, and stats', () => {
    renderProfile();
    expect(screen.getByText('Op')).toBeTruthy();
    expect(screen.getAllByText('op@fleet.test').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Acme Fleet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Operator').length).toBeGreaterThan(0);
    expect(screen.getByText(/Add a profile photo/i)).toBeTruthy();
    expect(screen.getByLabelText('Change photo')).toBeTruthy();
    expect(screen.getByLabelText('Cover photo')).toBeTruthy();
    expect(screen.getByText('Organization')).toBeTruthy();
    expect(screen.getAllByText('Roles').length).toBeGreaterThan(0);
  });

  it('shows a custom photo after the operator picks a file', async () => {
    renderProfile();
    const input = document.getElementById('profile-avatar-input') as HTMLInputElement;
    const file = new File(['fake'], 'face.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      const portrait = screen.getByTestId('profile-portrait');
      const img = portrait.querySelector('img');
      expect(img?.getAttribute('src') ?? '').toContain('face.jpg');
    });
    expect(screen.getByText(/This photo also appears in the header/i)).toBeTruthy();
  });

  it('restores a previously saved photo', () => {
    writeProfileAvatar('u1', 'data:image/jpeg;base64,saved');
    renderProfile();
    const portrait = screen.getByTestId('profile-portrait');
    expect(portrait.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,saved');
  });
});
