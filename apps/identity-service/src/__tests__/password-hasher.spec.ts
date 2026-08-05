import { describe, expect, it } from '@jest/globals';
import { PasswordHasher } from '../infrastructure/services/password-hasher.js';

/**
 * argon2 runs natively (no DB/Redis needed) so it is safe in CI (which has no
 * infra containers). Verifies hash + verify round-trip and rejection of wrong
 * plaintexts.
 */
describe('PasswordHasher (argon2id)', () => {
  const hasher = new PasswordHasher({ memoryKib: 8192, time: 2, parallelism: 1 });

  it('hashes and verifies a password', async () => {
    const hash = await hasher.hash('Correct-Horse-Battery-9!');
    expect(hash).not.toBe('Correct-Horse-Battery-9!');
    expect(await hasher.verify(hash, 'Correct-Horse-Battery-9!')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('Correct-Horse-Battery-9!');
    expect(await hasher.verify(hash, 'wrong-password')).toBe(false);
  });

  it('returns false (no throw) on a malformed hash', async () => {
    expect(await hasher.verify('not-a-real-hash', 'anything')).toBe(false);
  });
});
