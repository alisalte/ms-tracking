import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router';

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
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // No token — redirect to login
  if (!accessToken || !isAuthenticated) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <Outlet />;
}
