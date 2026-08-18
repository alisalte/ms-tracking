import { FleetDashboard } from '@/components/dashboard/FleetDashboard';

/**
 * DashboardPage — the Fleet Dashboard home screen (Phase 4, TailAdmin).
 *
 * Renders the FleetDashboard composition: KPI row (fleet summary + live map
 * join + alarm feed), vehicle-activity donut, fleet-health meters, recent
 * events, alert-type breakdown, and the live map preview. All data comes from
 * real APIs via TanStack Query hooks (`api/fleet.api.ts`); the deterministic
 * fixture dataset stands in only in explicit mock mode.
 */
export function DashboardPage() {
  return <FleetDashboard />;
}
