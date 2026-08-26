/**
 * Tenant settings — locale, units, branding, retention (Tenant-Management.md
 * TEN-FR-03 / TEN-FR-13, UI_UX §5.2). Stored as JSONB on iam.tenants.settings.
 */
import { z } from 'zod';

export const tenantSettingsSchema = z.object({
  locale: z.enum(['en', 'fa']).default('en'),
  timezone: z.string().min(1).max(64).default('UTC'),
  dateFormat: z.string().min(1).max(32).default('YYYY-MM-DD'),
  distanceUnit: z.enum(['km', 'mi']).default('km'),
  volumeUnit: z.enum(['L', 'gal']).default('L'),
  tempUnit: z.enum(['C', 'F']).default('C'),
  orgName: z.string().min(1).max(128),
  /** Telemetry retention preview (days). KPI doc: positions drop after 180 days. */
  retentionDays: z.coerce.number().int().min(30).max(2555).default(180),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const tenantSettingsPatchSchema = tenantSettingsSchema.partial();
export type TenantSettingsPatch = z.infer<typeof tenantSettingsPatchSchema>;

export function mergeTenantSettings(
  stored: unknown,
  orgNameFallback: string,
  patch: TenantSettingsPatch = {},
): TenantSettings {
  const base =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const { orgName: storedOrgName, ...baseRest } = base;
  const { orgName: patchOrgName, ...patchRest } = patch;
  const storedName = typeof storedOrgName === 'string' ? storedOrgName : orgNameFallback;
  return tenantSettingsSchema.parse({
    ...baseRest,
    ...patchRest,
    orgName: patchOrgName ?? storedName,
  });
}
