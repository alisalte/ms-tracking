import {
  Bell,
  BarChart3,
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

/**
 * FleetVision navigation configuration (v3 — Limitless-inspired IA).
 *
 * Navigation is grouped into Limitless-style sections (uppercase group labels),
 * but only routes that actually exist in the router are exposed — no fake
 * pages. The legacy `/vehicles` and `/drivers` routes redirect to `/assets`
 * (see router/index.tsx) and are therefore omitted from the sidebar.
 *
 * Each item may declare a `permission`; when present the item is hidden unless
 * the principal owns that permission. Items without a permission always show.
 */

export interface NavItem {
  /** i18n key under `nav.*` for the label. */
  key: string;
  /** Route path. */
  path: string;
  /** Lucide icon. */
  icon: LucideIcon;
  /** Optional permission string; if absent the item is always visible. */
  permission?: string;
}

export interface NavGroup {
  /** i18n key under `navGroups.*` for the section label, or null for the top. */
  groupKey: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: null,
    items: [{ key: 'dashboard', path: '/dashboard', icon: LayoutDashboard }],
  },
  {
    groupKey: 'tracking',
    items: [
      { key: 'map', path: '/map', icon: MapIcon },
      { key: 'trips', path: '/trips', icon: Navigation },
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
      { key: 'commands', path: '/commands', icon: TerminalSquare },
      { key: 'geofences', path: '/geofences', icon: MapPin },
    ],
  },
  {
    groupKey: 'assets',
    items: [{ key: 'assets', path: '/assets', icon: Truck }],
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

/** Maintenance icon override for the maintenance item (more apt than Wrench). */
export const MAINTENANCE_ICON = Settings;

/**
 * Filter nav groups by the principal's permissions. Groups that become empty
 * after filtering are dropped entirely.
 */
export function filterNavByPermissions(
  groups: readonly NavGroup[],
  permissions: readonly string[],
): NavGroup[] {
  const has = (p?: string) => !p || permissions.includes(p);
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => has(i.permission)) }))
    .filter((g) => g.items.length > 0);
}
