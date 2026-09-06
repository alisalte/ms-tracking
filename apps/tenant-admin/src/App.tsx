import { Navigate, Outlet, Route, Routes } from 'react-router';

import { Shell } from '@/Shell';
import { canManageTenants, loadSession } from '@/lib/session';
import { LoginPage } from '@/pages/LoginPage';
import { TenantCreatePage } from '@/pages/TenantCreatePage';
import { TenantDetailPage } from '@/pages/TenantDetailPage';
import { TenantsPage } from '@/pages/TenantsPage';

function RequireSession() {
  const session = loadSession();
  if (!session) return <Navigate to="/login" replace />;
  if (!canManageTenants(session.permissions)) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireSession />}>
        <Route element={<Shell />}>
          <Route path="/" element={<TenantsPage />} />
          <Route path="/new" element={<TenantCreatePage />} />
          <Route path="/tenants/:id" element={<TenantDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
