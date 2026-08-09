import { type ReactNode, useEffect } from 'react';

import { useAuthStore } from './auth.store';

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * AuthProvider hydrates the auth store from localStorage on app init.
 *
 * The Zustand store now reads localStorage synchronously at creation (so a page
 * refresh no longer races the ProtectedRoute). This provider's remaining job is
 * to fetch the full user profile once a stored session is restored.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  // If we have a stored token but no user profile yet, fetch it.
  useEffect(() => {
    if (accessToken && isAuthenticated && !user) {
      fetchUser();
    }
  }, [accessToken, isAuthenticated, user, fetchUser]);

  return <>{children}</>;
}
