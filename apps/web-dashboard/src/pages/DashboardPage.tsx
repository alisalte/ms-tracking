import { DashboardGrid } from '@/components/dashboard/DashboardGrid';

/**
 * DashboardPage — the Fleet Dashboard home screen.
 *
 * Renders the full widget grid (UI_UX_Design.md §1): stat-card row, fleet
 * activity chart, active alerts, vehicles needing attention, utilization,
 * weather, and a map preview. All data is mock-backed via TanStack Query hooks
 * (`api/fleet.api.ts`) so the UI is fully demoable; swap mock → apiGet when the
 * analytics/gps backends land.
 */
export function DashboardPage() {
  return <DashboardGrid />;
}
