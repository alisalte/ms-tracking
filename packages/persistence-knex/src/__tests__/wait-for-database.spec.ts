import { describe, expect, it } from '@jest/globals';
import { isTransientPgError, waitForDatabase } from '../migrations.js';

describe('isTransientPgError', () => {
  it('treats TCP refusals as transient', () => {
    expect(isTransientPgError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 172.18.0.5:5432' })).toBe(
      true,
    );
  });

  it('treats Postgres cannot_connect_now as transient', () => {
    expect(isTransientPgError({ code: '57P03', message: 'the database system is starting up' })).toBe(
      true,
    );
  });

  it('matches recovery-mode text even without a SQLSTATE', () => {
    expect(isTransientPgError(new Error('the database system is in recovery mode'))).toBe(true);
  });

  it('does not retry permanent errors', () => {
    expect(isTransientPgError({ code: '28P01', message: 'password authentication failed' })).toBe(
      false,
    );
    expect(isTransientPgError(new Error('relation "iam.users" does not exist'))).toBe(false);
  });
});

describe('waitForDatabase', () => {
  it('returns once SELECT 1 succeeds after a transient failure', async () => {
    let calls = 0;
    const client = {
      raw: async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error('connect ECONNREFUSED 172.18.0.5:5432') as Error & { code: string };
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return { rows: [{ ok: 1 }] };
      },
    };

    await waitForDatabase(client as never, { timeoutMs: 5_000 });
    expect(calls).toBe(2);
  });

  it('throws immediately on a permanent error', async () => {
    const client = {
      raw: async () => {
        throw new Error('password authentication failed for user "fleetvision_app"');
      },
    };

    await expect(waitForDatabase(client as never, { timeoutMs: 5_000 })).rejects.toThrow(
      /password authentication failed/,
    );
  });
});
