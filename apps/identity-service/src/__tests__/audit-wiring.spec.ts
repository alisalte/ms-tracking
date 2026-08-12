import { describe, expect, it } from '@jest/globals';
import { AuditManager } from '../application/audit/audit-manager.js';
import type {
  AuditEntry,
  AuditRepository,
} from '../infrastructure/persistence/audit.repository.js';

/**
 * Audit subsystem (Sprint 1 requirement 7): AuditManager.record must call
 * AuditRepository.append with a well-formed entry (hash-chain fields delegated to
 * the repository). This pins the wiring so a regression (audit not invoked) is
 * caught. The hash-chain integrity itself is the repository's responsibility.
 */
function fakeKnex() {
  // withTenantContext opens a transaction and runs SET LOCAL; fake a minimal trx.
  const raws: string[] = [];
  return {
    knex: {
      transaction: async (cb: (trx: unknown) => Promise<unknown>) => {
        const fakeTrx = {
          raw: async (sql: string) => {
            raws.push(sql);
          },
        };
        return cb(fakeTrx);
      },
    },
    raws,
  };
}

function capturingRepo(): { repo: AuditRepository; calls: AuditEntry[] } {
  const calls: AuditEntry[] = [];
  const repo = {
    append: async (_trx: unknown, entry: AuditEntry) => {
      calls.push(entry);
    },
  } as unknown as AuditRepository;
  return { repo, calls };
}

describe('AuditManager.record wires to AuditRepository.append', () => {
  it('records a tenant-scoped audit entry with the required fields', async () => {
    const { knex } = fakeKnex();
    const { repo, calls } = capturingRepo();
    const manager = new AuditManager(knex as never, repo);
    await manager.record({
      tenantId: '11111111-1111-1111-1111-111111111111',
      actorId: 'user-1',
      actorType: 'USER',
      action: 'iam.user.create',
      resourceType: 'user',
      resourceId: 'user-2',
      permission: 'iam.user.create',
      outcome: 'SUCCESS',
      requestId: null,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      after: { email: 'x@y.com' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe('iam.user.create');
    expect(calls[0]?.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(calls[0]?.actorId).toBe('user-1');
    expect(calls[0]?.outcome).toBe('SUCCESS');
  });

  it('sets app.current_tenant_id for tenant-scoped records (RLS)', async () => {
    const { knex, raws } = fakeKnex();
    const { repo } = capturingRepo();
    const manager = new AuditManager(knex as never, repo);
    await manager.record({
      tenantId: '22222222-2222-2222-2222-222222222222',
      actorId: null,
      actorType: 'SYSTEM',
      action: 'auth.login.failed',
      resourceType: 'auth_session',
      resourceId: null,
      permission: null,
      outcome: 'DENIED',
      requestId: null,
      ipAddress: null,
      userAgent: null,
    });
    expect(raws.some((s) => s.includes('app.current_tenant_id'))).toBe(true);
  });
});
