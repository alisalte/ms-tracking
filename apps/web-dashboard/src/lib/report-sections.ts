/**
 * First-class report tabs on `/reports?section=`.
 *
 * Overview is a catalog + KPI scoreboard; the rest are dedicated reports
 * backed by reporting-service (or live registry/status for devices/commands).
 */
export const REPORT_SECTIONS = [
  'overview',
  'analytics',
  'vehicles',
  'drivers',
  'devices',
  'distance',
  'speed',
  'stops',
  'operation',
  'odometer',
  'trips',
  'alarms',
  'geofences',
  'commands',
  'activity',
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

export type ReportCatalogGroup = 'ops' | 'safety' | 'assets' | 'activity';

export const REPORT_CATALOG: ReadonlyArray<{
  id: Exclude<ReportSection, 'overview'>;
  group: ReportCatalogGroup;
}> = [
  { id: 'distance', group: 'ops' },
  { id: 'trips', group: 'ops' },
  { id: 'operation', group: 'ops' },
  { id: 'odometer', group: 'ops' },
  { id: 'stops', group: 'ops' },
  { id: 'speed', group: 'ops' },
  { id: 'alarms', group: 'safety' },
  { id: 'geofences', group: 'safety' },
  { id: 'analytics', group: 'safety' },
  { id: 'vehicles', group: 'assets' },
  { id: 'drivers', group: 'assets' },
  { id: 'devices', group: 'assets' },
  { id: 'commands', group: 'assets' },
  { id: 'activity', group: 'activity' },
];

export const REPORT_CATALOG_GROUPS: readonly ReportCatalogGroup[] = [
  'ops',
  'safety',
  'assets',
  'activity',
];

export function isReportSection(v: string | null): v is ReportSection {
  return v !== null && (REPORT_SECTIONS as readonly string[]).includes(v);
}
