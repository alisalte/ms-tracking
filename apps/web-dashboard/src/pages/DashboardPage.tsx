import { FleetDashboard } from '@/components/dashboard/FleetDashboard';

/**
 * DashboardPage — Fleet Dashboard home screen.
 *
 * Renders FleetDashboard: live KPIs, period reporting KPIs (ApexCharts),
 * health meters, events, and the live map preview. Data via TanStack Query
 * hooks; mock mode uses the same fixtures.
 */
export function DashboardPage() {
  return <FleetDashboard />;
}
