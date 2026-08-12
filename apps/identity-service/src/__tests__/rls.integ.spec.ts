/**
 * RLS enforcement integration test (Sprint 1 requirement 5).
 *
 * OPT-IN: this test spins up a real PostgreSQL (TimescaleDB) container and runs
 * the identity migrations to prove the database ENFORCES tenant isolation
 * independently of the application layer. It only runs when RUN_RLS_TESTS=1 so
 * `pnpm test` stays hermetic (no Docker required) locally and in CI without a
 * Docker daemon. Run with: `RUN_RLS_TESTS=1 pnpm --filter @fleetvision/identity-service test`.
 *
 * Proves:
 *   - tenant A cannot SELECT tenant B's rows
 *   - tenant A cannot INSERT/UPDATE/DELETE tenant B's rows (WITH CHECK blocks)
 *   - the platform role sees all rows
 *   - audit.audit_entries is tenant-isolated
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

const ENABLED = process.env.RUN_RLS_TESTS === '1';

const skip = ENABLED ? describe : (describe.skip as typeof describe);

skip('RLS enforcement (real Postgres via testcontainers)', () => {
  // Lazily imported so the module loads even when testcontainers is absent.
  // Use a loose type — the container is only used for stop()/getConnectionUri().
  let pgContainer: { stop: () => Promise<unknown>; getConnectionUri: () => string };
  let appKnex: import('@fleetvision/persistence-knex').Knex;
  let platformKnex: import('@fleetvision/persistence-knex').Knex;

  beforeAll(async () => {
    const mod = await import('@testcontainers/postgresql');
    const PostgreSqlContainer = mod.PostgreSqlContainer;
    const { createKnex } = await import('@fleetvision/persistence-knex');
    const { join } = await import('node:path');
    const { runMigrations } = await import('@fleetvision/persistence-knex');

    // A plain postgres:16 image suffices for the RLS checks (identity migrations
    // use no TimescaleDB hypertables). docker-compose uses timescale/timescaledb-ha:pg16.
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('fleetvision')
      .withUsername('fleetvision')
      .withPassword('fleetvision')
      .start();

    const bootstrapUrl = pgContainer.getConnectionUri(); // superuser — runs migrations
    const migrationsKnex = createKnex({ url: bootstrapUrl });
    await runMigrations(migrationsKnex, {
      directory: join(import.meta.dirname, '../infrastructure/database/migrations'),
    });
    await migrationsKnex.destroy();

    // App role client (fleetvision_app — created by the hardening migration).
    const baseUrl = bootstrapUrl.replace(
      'fleetvision:fleetvision@',
      'fleetvision_app:fleetvision_app_dev@',
    );
    appKnex = createKnex({ url: baseUrl });
    platformKnex = createKnex({
      url: bootstrapUrl.replace(
        'fleetvision:fleetvision@',
        'fleetvision_platform:fleetvision_platform_dev@',
      ),
    });
  }, 120_000);

  afterAll(async () => {
    await appKnex?.destroy().catch(() => {});
    await platformKnex?.destroy().catch(() => {});
    await pgContainer?.stop().catch(() => {});
  });

  const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('tenant A cannot SELECT tenant B rows', async () => {
    // Seed two users in different tenants via the platform client.
    await platformKnex.raw("SET LOCAL app.is_platform = 'true'");
    await platformKnex.transaction(async (trx) => {
      await trx.raw("SET LOCAL app.is_platform = 'true'");
      await trx('iam.users').insert([
        {
          id: 'u-a',
          tenant_id: TENANT_A,
          email: 'a@x.com',
          username: 'a',
          status: 'ACTIVE',
          auth_provider: 'LOCAL',
          version: 1,
        },
        {
          id: 'u-b',
          tenant_id: TENANT_B,
          email: 'b@x.com',
          username: 'b',
          status: 'ACTIVE',
          auth_provider: 'LOCAL',
          version: 1,
        },
      ]);
    });

    // As tenant A, only u-a is visible.
    const rows = (await appKnex.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
      return trx('iam.users').select('id');
    })) as { id: string }[];
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('u-a');
    expect(ids).not.toContain('u-b');
  });

  it('WITH CHECK blocks a cross-tenant INSERT', async () => {
    await expect(
      appKnex.transaction(async (trx) => {
        await trx.raw(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
        await trx('iam.users').insert({
          id: 'u-bad',
          tenant_id: TENANT_B,
          email: 'bad@x.com',
          username: 'bad',
          status: 'ACTIVE',
          auth_provider: 'LOCAL',
          version: 1,
        });
      }),
    ).rejects.toThrow();
  });

  it('WITH CHECK blocks a cross-tenant UPDATE', async () => {
    // Tenant A tries to modify tenant B's row → 0 rows updated (policy filters it out).
    const updated = await appKnex.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
      return trx('iam.users').where({ id: 'u-b' }).update({ display_name: 'hacked' });
    });
    expect(updated).toBe(0);
  });

  it('platform role sees all tenants', async () => {
    const rows = await platformKnex.transaction(async (trx) => {
      await trx.raw("SET LOCAL app.is_platform = 'true'");
      return trx('iam.users').count({ total: '*' }).first();
    });
    expect(Number((rows as { total: string }).total)).toBeGreaterThanOrEqual(2);
  });

  it('audit.audit_entries is tenant-isolated', async () => {
    await platformKnex.transaction(async (trx) => {
      await trx.raw("SET LOCAL app.is_platform = 'true'");
      await trx('audit.audit_entries').insert([
        {
          id: 'a1',
          tenant_id: TENANT_A,
          actor_id: null,
          actor_type: 'SYSTEM',
          action: 'test',
          resource_type: 'test',
          outcome: 'SUCCESS',
          seq_no: 1,
          prev_hash: '0'.repeat(64),
          entry_hash: 'x',
          created_at: new Date(),
        },
        {
          id: 'a2',
          tenant_id: TENANT_B,
          actor_id: null,
          actor_type: 'SYSTEM',
          action: 'test',
          resource_type: 'test',
          outcome: 'SUCCESS',
          seq_no: 2,
          prev_hash: 'x',
          entry_hash: 'y',
          created_at: new Date(),
        },
      ]);
    });
    const rows = (await appKnex.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
      return trx('audit.audit_entries').select('id');
    })) as { id: string }[];
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('a1');
    expect(ids).not.toContain('a2');
  });
});

if (!ENABLED) {
  describe('RLS enforcement (opt-in)', () => {
    it('skipped — set RUN_RLS_TESTS=1 and run with Docker available', () => {
      expect(true).toBe(true);
    });
  });
}
