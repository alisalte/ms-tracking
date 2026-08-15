import { DashboardGrid } from '@/components/dashboard/DashboardGrid';

/**
 * DashboardPage — the Fleet Dashboard home screen.
 *
 * Renders the widget grid (UI_UX_Design.md §1): the real stat-card row
 * (fleet-management /summary × gps-engine device statuses), active alerts
 * (notification-service), and a live map preview (latest positions).
 * All data comes from real APIs via TanStack Query hooks (`api/fleet.api.ts`);
 * the deterministic fixture dataset stands in only in explicit mock mode.
 */
export function DashboardPage() {
  return <DashboardGrid />;
}
