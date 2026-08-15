import { describe, expect, it } from '@jest/globals';
import { isAllowedRoom } from '../infrastructure/websocket/realtime.gateway.js';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/**
 * Sprint 1 requirement 4 (WebSocket tenant isolation): a client may only join
 * rooms namespaced under its OWN tenant. Cross-tenant joins are denied.
 */
describe('GPS realtime gateway room-join tenant isolation', () => {
  it('allows the caller own fleet room', () => {
    expect(isAllowedRoom(`tenant:${TENANT_A}:fleet`, TENANT_A)).toBe(true);
  });
  it('allows the caller own vehicle room', () => {
    expect(isAllowedRoom(`tenant:${TENANT_A}:vehicle:vid-1`, TENANT_A)).toBe(true);
  });
  it('denies another tenant fleet room', () => {
    expect(isAllowedRoom(`tenant:${TENANT_B}:fleet`, TENANT_A)).toBe(false);
  });
  it('denies another tenant vehicle room', () => {
    expect(isAllowedRoom(`tenant:${TENANT_B}:vehicle:vid-1`, TENANT_A)).toBe(false);
  });
  it('denies a malformed room', () => {
    expect(isAllowedRoom('global', TENANT_A)).toBe(false);
    expect(isAllowedRoom('tenant::fleet', TENANT_A)).toBe(false);
    expect(isAllowedRoom('', TENANT_A)).toBe(false);
  });
  it('denies a vehicle room with no vehicle id', () => {
    expect(isAllowedRoom(`tenant:${TENANT_A}:vehicle:`, TENANT_A)).toBe(false);
  });
});
