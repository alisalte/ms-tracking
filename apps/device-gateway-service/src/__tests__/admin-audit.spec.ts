import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import type { Request } from 'express';
import { AdminController } from '../api/admin/admin.controller.js';
import type { GatewayAuditWriter } from '../api/admin/gateway-audit-writer.js';
import { ADAPTER_REGISTRY, CONNECTION_POOL, SESSION_MANAGER } from '../api/tokens.js';

/**
 * Phase 7: device-gateway admin mutations (adapter enable/disable) must be
 * recorded in the shared hash-chained audit log. This pins that the controller
 * actually calls the audit writer for each mutating route (not just that it is
 * guarded). The writer's own DB behaviour is best-effort and out of scope here;
 * we assert the controller→writer call happens with the right shape.
 */
function makePrincipal() {
  return {
    userId: 'u-1',
    tenantId: 't-1',
    tenantTier: 'STANDARD',
    roles: ['tenant-admin'],
    sessionId: 's-1',
    jti: 'jti-1',
    exp: 9999999999,
    permissions: ['telemetry.gateway.manage'],
    authMethod: 'JWT' as const,
  };
}

function makeReq(): Request {
  const req = { auth: makePrincipal(), ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
  return req as unknown as Request;
}

describe('device-gateway admin controller audits mutations', () => {
  function buildController(recorded: { entry: unknown | null; called: boolean }) {
    const adapters = {
      setEnabled: () => true, // matches AdapterRegistry.setEnabled: true = adapter existed
      list: () => [{ id: 'a', enabled: true }],
    };
    const sessions = { list: () => [] };
    const pool = { pressure: () => ({ active: 0, capacity: 10 }) };
    const audit = {
      record: async (entry: unknown) => {
        recorded.entry = entry;
        recorded.called = true;
      },
    };
    const controller = new AdminController(
      adapters as never,
      sessions as never,
      pool as never,
      audit as unknown as GatewayAuditWriter,
    );
    return { controller, tokens: { ADAPTER_REGISTRY, CONNECTION_POOL, SESSION_MANAGER } };
  }

  it('enable() records an audit entry', async () => {
    const recorded = { entry: null as unknown, called: false };
    const { controller } = buildController(recorded);
    const res = await controller.enable('a', makeReq());
    expect(res).toEqual({ id: 'a', enabled: true });
    expect(recorded.called).toBe(true);
    const entry = recorded.entry as { action: string; resourceId: string; tenantId: string };
    expect(entry.action).toBe('telemetry.adapter.enable');
    expect(entry.resourceId).toBe('a');
    expect(entry.tenantId).toBe('t-1');
  });

  it('disable() records an audit entry', async () => {
    const recorded = { entry: null as unknown, called: false };
    const { controller } = buildController(recorded);
    const res = await controller.disable('a', makeReq());
    expect(res).toEqual({ id: 'a', disabled: true });
    expect(recorded.called).toBe(true);
    const entry = recorded.entry as { action: string; resourceId: string };
    expect(entry.action).toBe('telemetry.adapter.disable');
    expect(entry.resourceId).toBe('a');
  });
});
