import { describe, expect, it } from 'vitest';

import { formatVehicleLabel } from '@/lib/vehicle-label';

describe('formatVehicleLabel', () => {
  it('joins name and plate when both exist', () => {
    expect(formatVehicleLabel({ name: 'کامیون ولوو', plate: '12A345', code: 'V001' })).toBe(
      'کامیون ولوو · 12A345',
    );
  });

  it('does not duplicate when name equals plate', () => {
    expect(formatVehicleLabel({ name: '11-B-22', plate: '11-B-22' })).toBe('11-B-22');
  });

  it('falls back to name, then plate, then code', () => {
    expect(formatVehicleLabel({ name: 'Truck 7', plate: null })).toBe('Truck 7');
    expect(formatVehicleLabel({ name: '  ', plate: '11-B-22' })).toBe('11-B-22');
    expect(formatVehicleLabel({ name: '', plate: null, code: 'V007' })).toBe('V007');
    expect(formatVehicleLabel({})).toBe('');
  });
});
