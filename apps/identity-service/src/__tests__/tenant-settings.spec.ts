import { describe, expect, it } from '@jest/globals';
import { mergeTenantSettings, tenantSettingsPatchSchema } from '../domain/tenant-settings.js';

describe('mergeTenantSettings', () => {
  it('fills defaults from the tenant name when storage is empty', () => {
    const s = mergeTenantSettings({}, 'FleetVision');
    expect(s.orgName).toBe('FleetVision');
    expect(s.locale).toBe('en');
    expect(s.timezone).toBe('UTC');
    expect(s.distanceUnit).toBe('km');
    expect(s.retentionDays).toBe(180);
  });

  it('applies a partial patch over stored values', () => {
    const s = mergeTenantSettings(
      { locale: 'fa', timezone: 'Asia/Tehran', orgName: 'Acme' },
      'FleetVision',
      { distanceUnit: 'mi' },
    );
    expect(s.locale).toBe('fa');
    expect(s.timezone).toBe('Asia/Tehran');
    expect(s.distanceUnit).toBe('mi');
    expect(s.orgName).toBe('Acme');
  });

  it('rejects an invalid patch', () => {
    expect(() => tenantSettingsPatchSchema.parse({ locale: 'de' })).toThrow();
    expect(() => tenantSettingsPatchSchema.parse({ retentionDays: 1 })).toThrow();
  });
});
