import { describe, expect, it } from '@jest/globals';
import { primaryBindingRole, resolveBindingRoles } from '../application/binding-roles.js';

describe('binding-roles', () => {
  it('defaults to TRACKER when the body is empty', () => {
    expect(resolveBindingRoles({})).toEqual(['TRACKER']);
    expect(primaryBindingRole(resolveBindingRoles({}))).toBe('TRACKER');
  });

  it('prefers roles[] over a single role and keeps TRACKER as primary', () => {
    const roles = resolveBindingRoles({ role: 'CAN', roles: ['MDVR', 'TRACKER', 'SENSOR'] });
    expect(roles).toEqual(['MDVR', 'TRACKER', 'SENSOR']);
    expect(primaryBindingRole(roles)).toBe('TRACKER');
  });
});
