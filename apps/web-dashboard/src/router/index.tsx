import { Box, Typography } from '@mui/material';
import { Navigate, createBrowserRouter } from 'react-router';
import { Suspense, lazy } from 'react';

import { ProtectedRoute } from '@/auth/auth.guard';
import { PERMISSIONS } from '@/auth/permissions';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { RequirePermission } from '@/components/common/RequirePermission';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { AdminPage } from '@/pages/AdminPage';
import { AlarmCenterPage } from '@/pages/AlarmCenterPage';
import { AssetManagementPage } from '@/pages/AssetManagementPage';
import { CommandCenterPage } from '@/pages/CommandCenterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EventCenterPage } from '@/pages/EventCenterPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { LoginPage } from '@/pages/LoginPage';
import { MaintenancePage } from '@/pages/MaintenancePage';
import { MfaVerifyPage } from '@/pages/MfaVerifyPage';
import { NotificationCenterPage } from '@/pages/NotificationCenterPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { TripsPage } from '@/pages/TripsPage';

const GeofencePage = lazy(() => import('@/pages/GeofencePage').then((m) => ({ default: m.GeofencePage })));
const MapPage = lazy(() => import('@/pages/MapPage').then((m) => ({ default: m.MapPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const VideoWallPage = lazy(() => import('@/pages/VideoWallPage').then((m) => ({ default: m.VideoWallPage })));

function LazyWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center" />}>
      {children}
    </Suspense>
  );
}

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
 * - /map              → AppLayout → RequirePermission(tracking.read) → MapPage
 * - /assets           → AppLayout → RequirePermission(vehicle.read) → AssetManagementPage
 * - /account/profile  → AppLayout → ProfilePage (protected)
 * - /                 → redirect to /dashboard
 * - *                 → AppLayout → 404 (protected, not found)
 *
 * Each top-level branch is wrapped in an ErrorBoundary (§22) so an unexpected
 * render crash shows a recoverable screen instead of a blank page. Permission
 * guards are render-only UX — the backend enforces the same strings.
 */
export const router = createBrowserRouter([
  {
    element: (
      <ErrorBoundary>
        <AuthLayout />
      </ErrorBoundary>
    ),
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
    element: (
      <ErrorBoundary>
        <ProtectedRoute />
      </ErrorBoundary>
    ),
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
            element: (
              <LazyWrapper>
                <RequirePermission permission={PERMISSIONS.trackingRead}>
                  <MapPage />
                </RequirePermission>
              </LazyWrapper>
            ),
          },
          {
            // Phase 3 — route-level gate matching the nav item's declared
            // permission (hiding the menu item alone was insufficient).
            path: '/trips',
            element: (
              <RequirePermission permission={PERMISSIONS.trackingRead}>
                <TripsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/trips/:id',
            element: (
              <RequirePermission permission={PERMISSIONS.trackingRead}>
                <TripDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: '/video',
            element: (
              <LazyWrapper>
                <VideoWallPage />
              </LazyWrapper>
            ),
          },
          {
            path: '/alarms',
            element: <AlarmCenterPage />,
          },
          {
            // Phase 6 — Event Center (notification event-stream timeline).
            path: '/events',
            element: (
              <RequirePermission permission={PERMISSIONS.notificationRead}>
                <EventCenterPage />
              </RequirePermission>
            ),
          },
          {
            // Sprint H — Notification Center (history + preferences).
            path: '/notifications',
            element: (
              <RequirePermission permission={PERMISSIONS.notificationRead}>
                <NotificationCenterPage />
              </RequirePermission>
            ),
          },
          {
            path: '/assets',
            element: (
              // Phase 3 — ANY-of gate mirrors the nav item's visibility rule
              // (vehicle.read OR fleet.read); the backend enforces per-entity.
              <RequirePermission anyOf={[PERMISSIONS.vehicleRead, PERMISSIONS.fleetRead]}>
                <AssetManagementPage />
              </RequirePermission>
            ),
          },
          {
            // Legacy nav items redirect to the consolidated Asset hub.
            path: '/fleets',
            element: <Navigate to="/assets?tab=fleets" replace />,
          },
          {
            path: '/vehicles',
            element: <Navigate to="/assets?tab=vehicles" replace />,
          },
          {
            path: '/devices',
            element: <Navigate to="/assets?tab=devices" replace />,
          },
          {
            path: '/reports',
            // Sprint J: reporting surface is permission-gated.
            element: (
              <LazyWrapper>
                <RequirePermission permission={PERMISSIONS.reportRead}>
                  <ReportsPage />
                </RequirePermission>
              </LazyWrapper>
            ),
          },
          {
            path: '/admin',
            element: <AdminPage />,
          },
          {
            path: '/geofences',
            // Sprint I: geofence surface is permission-gated like /map.
            element: (
              <LazyWrapper>
                <RequirePermission permission={PERMISSIONS.mapsRead}>
                  <GeofencePage />
                </RequirePermission>
              </LazyWrapper>
            ),
          },
          {
            path: '/commands',
            element: (
              <RequirePermission permission={PERMISSIONS.commandRead}>
                <CommandCenterPage />
              </RequirePermission>
            ),
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
