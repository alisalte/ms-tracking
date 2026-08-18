import { Navigate, Outlet, useLocation } from 'react-router';

import { Spinner } from '@/components/tailwind-ui';

import { useAuthStore } from './auth.store';

/**
 * ProtectedRoute wraps routes that require authentication.
 *
 * - If not authenticated: redirects to /login with the current path as redirect param
 * - If loading (initial hydration): shows a loading spinner
 * - If authenticated: renders the child routes via <Outlet />
 */
export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const accessToken = useAuthStore((s) => s.accessToken);
  const location = useLocation();

  // Show loading while hydrating from localStorage
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" label="Loading session" />
      </div>
    );
  }

  // No token — redirect to login
  if (!accessToken || !isAuthenticated) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <Outlet />;
}
