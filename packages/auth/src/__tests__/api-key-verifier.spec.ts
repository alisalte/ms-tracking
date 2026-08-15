import { randomBytes } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
/**
 * KnexApiKeyVerifier behavior tests (Sprint B). Verifies the prefix-extraction
 * and reject-on-unknown/short-key logic without hitting a database (the raw
 * query is stubbed). Argon2 correctness is exercised against a real hash so the
 * verify path is proven end-to-end.
 */
import argon2 from 'argon2';
import { KnexApiKeyVerifier } from '../api-key-verifier.js';

/** Build a verifier whose knex.raw returns a fixed set of rows. */
function verifierFor(rows: unknown[]) {
  const knex = {
    raw: async () => ({ rows }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  return new KnexApiKeyVerifier(knex as any);
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'key-1',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    key_hash: '',
    key_prefix: 'fv_live_xxxx',
    scopes: ['tracking.read'],
    assigned_user_id: null,
    expires_at: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('KnexApiKeyVerifier', () => {
  it('rejects a non-fv_ credential outright', async () => {
    const v = verifierFor([]);
    await expect(v.verify('not-a-key')).resolves.toBeNull();
  });

  it('rejects when no key matches the prefix', async () => {
    const v = verifierFor([]);
    await expect(v.verify('fv_live_abcd')).resolves.toBeNull();
  });

  it('resolves an ACTIVE key whose argon2 hash matches', async () => {
    const plaintext = `fv_live_${randomBytes(16).toString('base64url')}`;
    const hash = await argon2.hash(plaintext);
    const v = verifierFor([row({ key_prefix: plaintext.slice(0, 11), key_hash: hash })]);
    const result = await v.verify(plaintext);
    expect(result?.tenantId).toBe('00000000-0000-0000-0000-000000000001');
    expect(result?.scopes).toContain('tracking.read');
  });

  it('rejects when the secret does not match the hash', async () => {
    const hash = await argon2.hash('fv_live_someothersecret_padding');
    const v = verifierFor([row({ key_hash: hash })]);
    await expect(v.verify('fv_live_wrongsecret')).resolves.toBeNull();
  });

  it('rejects a REVOKED key even with a matching hash', async () => {
    const plaintext = `fv_live_${randomBytes(16).toString('base64url')}`;
    const hash = await argon2.hash(plaintext);
    const v = verifierFor([
      row({ key_prefix: plaintext.slice(0, 11), key_hash: hash, status: 'REVOKED' }),
    ]);
    await expect(v.verify(plaintext)).resolves.toBeNull();
  });

  it('rejects an expired key', async () => {
    const plaintext = `fv_live_${randomBytes(16).toString('base64url')}`;
    const hash = await argon2.hash(plaintext);
    const v = verifierFor([
      row({
        key_prefix: plaintext.slice(0, 11),
        key_hash: hash,
        expires_at: new Date(Date.now() - 86_400_000),
      }),
    ]);
    await expect(v.verify(plaintext)).resolves.toBeNull();
  });
});
