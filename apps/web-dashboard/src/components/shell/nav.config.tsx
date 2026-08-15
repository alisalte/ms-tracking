import {
  BarChart3,
  Bell,
  BellRing,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  Navigation,
  Settings,
  ShieldCheck,
  TerminalSquare,
  Truck,
  Video,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { PERMISSIONS } from '@/auth/permissions';

/**
 * FleetVision navigation — Limitless-style grouped IA.
 *
 * Limitless groups nav items under uppercase section headers (MAIN, FORMS,
 * COMPONENTS, LAYOUT, TABLES, etc.). FleetVision adapts this pattern to the
 * fleet-management domain: MAIN (Dashboard), TRACKING, VIDEO, OPERATIONS,
 * ASSETS, REPORTING, MAINTENANCE, ADMINISTRATION. Only routes that exist in
 * the router are exposed.
 *
 * Each item may declare a `permission` (single requirement) and/or `anyOf`
 * (satisfied by ANY ONE of the listed permissions); when present the item is
 * hidden unless the principal holds it/them. The `*` tenant-admin wildcard
 * satisfies everything (mirrors the backend's permissionSatisfies()). Items
 * without a permission always show.
 */

export interface NavItem {
  key: string;
  path: string;
  icon: LucideIcon;
  /** Single required permission (hidden unless granted). */
  permission?: string;
  /** ANY-of permission list — the item shows when at least one is granted. */
  anyOf?: readonly string[];
}

export interface NavGroup {
  groupKey: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    // Limitless "MAIN" group — the primary dashboard.
    groupKey: 'main',
    items: [{ key: 'dashboard', path: '/dashboard', icon: LayoutDashboard }],
  },
  {
    groupKey: 'tracking',
    items: [
      { key: 'map', path: '/map', icon: MapIcon, permission: PERMISSIONS.trackingRead },
      { key: 'trips', path: '/trips', icon: Navigation, permission: PERMISSIONS.trackingRead },
    ],
  },
  {
    groupKey: 'video',
    items: [{ key: 'video', path: '/video', icon: Video }],
  },
  {
    groupKey: 'operations',
    items: [
      { key: 'alarms', path: '/alarms', icon: Bell },
      {
        // Sprint H — Notification Center (bell history + preferences).
        key: 'notifications',
        path: '/notifications',
        icon: BellRing,
        permission: PERMISSIONS.notificationRead,
      },
      { key: 'commands', path: '/commands', icon: TerminalSquare },
      { key: 'geofences', path: '/geofences', icon: MapPin },
    ],
  },
  {
    // Asset hub: readable with EITHER the fleet or the vehicle registry scope.
    groupKey: 'assets',
    items: [
      {
        key: 'assets',
        path: '/assets',
        icon: Truck,
        anyOf: [PERMISSIONS.vehicleRead, PERMISSIONS.fleetRead],
      },
    ],
  },
  {
    groupKey: 'reporting',
    items: [{ key: 'reports', path: '/reports', icon: BarChart3 }],
  },
  {
    groupKey: 'maintenance',
    items: [{ key: 'maintenance', path: '/maintenance', icon: Wrench }],
  },
  {
    groupKey: 'administration',
    items: [{ key: 'admin', path: '/admin', icon: ShieldCheck }],
  },
];

export const MAINTENANCE_ICON = Settings;

export function filterNavByPermissions(
  groups: readonly NavGroup[],
  permissions: readonly string[],
): NavGroup[] {
  const has = (p?: string) => !p || permissions.includes('*') || permissions.includes(p);
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => has(i.permission) && (i.anyOf ? i.anyOf.some(has) : true)),
    }))
    .filter((g) => g.items.length > 0);
}
