import { Box, Typography } from '@mui/material';
import { Navigate, createBrowserRouter } from 'react-router';

import { ProtectedRoute } from '@/auth/auth.guard';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { AdminPage } from '@/pages/AdminPage';
import { AlarmCenterPage } from '@/pages/AlarmCenterPage';
import { AssetManagementPage } from '@/pages/AssetManagementPage';
import { CommandCenterPage } from '@/pages/CommandCenterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { GeofencePage } from '@/pages/GeofencePage';
import { LoginPage } from '@/pages/LoginPage';
import { MaintenancePage } from '@/pages/MaintenancePage';
import { MapPage } from '@/pages/MapPage';
import { MfaVerifyPage } from '@/pages/MfaVerifyPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { TripsPage } from '@/pages/TripsPage';
import { VideoWallPage } from '@/pages/VideoWallPage';

/**
 * Not-found page rendered inside the authenticated AppLayout shell.
 */
function NotFoundPage() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '50vh',
        textAlign: 'center',
      }}
    >
      <Typography variant="h4" color="text.secondary" gutterBottom>
        404
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Page not found
      </Typography>
    </Box>
  );
}

/**
 * Application router configuration.
 *
 * Route structure:
 * - /login            → AuthLayout → LoginPage (public)
 * - /register         → AuthLayout → RegisterPage (public)
 * - /forgot-password  → AuthLayout → ForgotPasswordPage (public)
 * - /reset-password   → AuthLayout → ResetPasswordPage (public)
 * - /mfa/verify       → AuthLayout → MfaVerifyPage (public)
 * - /dashboard        → AppLayout → DashboardPage (protected)
 * - /account/profile  → AppLayout → ProfilePage (protected)
 * - /                 → redirect to /dashboard
 * - *                 → AppLayout → 404 (protected, not found)
 */
export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
      {
        path: '/register',
        element: <RegisterPage />,
      },
      {
        path: '/forgot-password',
        element: <ForgotPasswordPage />,
      },
      {
        path: '/reset-password',
        element: <ResetPasswordPage />,
      },
      {
        path: '/mfa/verify',
        element: <MfaVerifyPage />,
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: '/dashboard',
            element: <DashboardPage />,
          },
          {
            path: '/map',
            element: <MapPage />,
          },
          {
            path: '/trips',
            element: <TripsPage />,
          },
          {
            path: '/trips/:id',
            element: <TripDetailPage />,
          },
          {
            path: '/video',
            element: <VideoWallPage />,
          },
          {
            path: '/alarms',
            element: <AlarmCenterPage />,
          },
          {
            path: '/assets',
            element: <AssetManagementPage />,
          },
          {
            // Legacy nav items redirect to the consolidated Asset hub.
            path: '/vehicles',
            element: <Navigate to="/assets?tab=vehicles" replace />,
          },
          {
            path: '/drivers',
            element: <Navigate to="/assets?tab=drivers" replace />,
          },
          {
            path: '/reports',
            element: <ReportsPage />,
          },
          {
            path: '/admin',
            element: <AdminPage />,
          },
          {
            path: '/geofences',
            element: <GeofencePage />,
          },
          {
            path: '/commands',
            element: <CommandCenterPage />,
          },
          {
            path: '/maintenance',
            element: <MaintenancePage />,
          },
          {
            path: '/account/profile',
            element: <ProfilePage />,
          },
          {
            path: '*',
            element: <NotFoundPage />,
          },
        ],
      },
    ],
  },
  {
    path: '/',
    element: <Navigate to="/dashboard" replace />,
  },
]);
