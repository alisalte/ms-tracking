import { type ReactNode, useEffect } from 'react';

import { useAuthStore } from './auth.store';
import { getStoredTokens } from './token.storage';

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * AuthProvider hydrates the auth store from localStorage on app init.
 *
 * Must be rendered inside the Zustand store context (automatically via useAuthStore).
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const hydrate = useAuthStore((s) => s.hydrate);
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    const stored = getStoredTokens();
    if (stored) {
      hydrate(stored.accessToken, stored.refreshToken, stored.tenantId);
    }
  }, [hydrate]);

  // If we have a stored token, fetch the full user profile
  useEffect(() => {
    if (accessToken && isAuthenticated) {
      fetchUser();
    }
  }, [accessToken, isAuthenticated, fetchUser]);

  return <>{children}</>;
}
