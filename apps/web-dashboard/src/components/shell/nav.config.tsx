import {
  Activity,
  BarChart3,
  Bell,
  BellRing,
  Boxes,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  Navigation,
  Scale,
  Settings,
  ShieldCheck,
  TerminalSquare,
  UserRound,
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
        key: 'rules',
        path: '/rules',
        icon: Scale,
        permission: PERMISSIONS.ruleRead,
      },
      {
        // Phase 6 — Event Center (fleet event timeline).
        key: 'events',
        path: '/events',
        icon: Activity,
        permission: PERMISSIONS.notificationRead,
      },
      {
        // Sprint H — Notification Center (bell history + preferences).
        key: 'notifications',
        path: '/notifications',
        icon: BellRing,
        permission: PERMISSIONS.notificationRead,
      },
      {
        // Device commands over TCP (Meitrack MDVR catalog + history).
        key: 'commands',
        path: '/commands',
        icon: TerminalSquare,
        permission: PERMISSIONS.commandRead,
      },
      {
        key: 'geofences',
        path: '/geofences',
        icon: MapPin,
        permission: PERMISSIONS.mapsRead,
      },
    ],
  },
  {
    // Sprint E — the consolidated Fleets/Vehicles/Devices registry hub.
    groupKey: 'assets',
    items: [
      {
        key: 'assets',
        path: '/assets',
        icon: Boxes,
        anyOf: [PERMISSIONS.vehicleRead, PERMISSIONS.fleetRead, PERMISSIONS.driverRead],
      },
      {
        key: 'drivers',
        path: '/assets?tab=drivers',
        icon: UserRound,
        permission: PERMISSIONS.driverRead,
      },
    ],
  },
  {
    groupKey: 'reporting',
    items: [
      { key: 'reports', path: '/reports', icon: BarChart3, permission: PERMISSIONS.reportRead },
    ],
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

/** Split a nav path that may carry a query string (`/assets?tab=drivers`). */
export function splitNavPath(path: string): { pathname: string; searchParams: URLSearchParams } {
  const q = path.indexOf('?');
  if (q === -1) return { pathname: path, searchParams: new URLSearchParams() };
  return { pathname: path.slice(0, q), searchParams: new URLSearchParams(path.slice(q)) };
}

const ALL_NAV_PATHS: readonly string[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.path));

/**
 * Active-item match that understands query strings so `/assets` and
 * `/assets?tab=drivers` do not highlight at the same time.
 */
export function isNavItemActive(
  itemPath: string,
  location: { pathname: string; search: string },
  allItemPaths: readonly string[] = ALL_NAV_PATHS,
): boolean {
  const { pathname, searchParams } = splitNavPath(itemPath);
  const locParams = new URLSearchParams(location.search);

  const pathMatch =
    location.pathname === pathname ||
    (pathname !== '/dashboard' && location.pathname.startsWith(`${pathname}/`));
  if (!pathMatch) return false;

  if ([...searchParams.keys()].length > 0) {
    return [...searchParams.entries()].every(([k, v]) => locParams.get(k) === v);
  }

  // A more specific sibling (same pathname + extra query) owns this location.
  return !allItemPaths.some((other) => {
    if (other === itemPath) return false;
    const o = splitNavPath(other);
    if (o.pathname !== pathname) return false;
    if ([...o.searchParams.keys()].length === 0) return false;
    return [...o.searchParams.entries()].every(([k, v]) => locParams.get(k) === v);
  });
}
