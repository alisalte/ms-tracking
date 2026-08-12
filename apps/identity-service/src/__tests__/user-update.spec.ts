import { describe, expect, it } from '@jest/globals';
import { UpdateUserUseCase } from '../application/users/user.use-cases.js';
import { User as UserClass } from '../domain/index.js';

/**
 * Sprint 2 bug 5b: UpdateUserUseCase ignored display_name (full stack — no domain
 * setter, no use-case call, no repo column). This test pins the domain setter +
 * use-case behavior: display_name round-trips through update.
 */
function makeUser() {
  return UserClass.rehydrate(
    'u-1',
    1,
    {
      tenantId: '11111111-1111-1111-1111-111111111111',
      email: 'a@b.com',
      username: 'alice',
      passwordHash: 'h',
      status: 'ACTIVE',
      displayName: 'Old Name',
      authProvider: 'LOCAL',
      mfaEnabled: false,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
    },
    [],
  );
}

describe('User.changeDisplayName (bug 5b)', () => {
  it('updates the display name', () => {
    const u = makeUser();
    u.changeDisplayName('New Name');
    expect(u.displayName).toBe('New Name');
  });

  it('accepts null to clear the display name', () => {
    const u = makeUser();
    u.changeDisplayName(null);
    expect(u.displayName).toBeNull();
  });
});

describe('UpdateUserUseCase applies display_name (bug 5b)', () => {
  it('calls changeDisplayName when displayName is provided', async () => {
    const saved: { displayName: string | null }[] = [];
    const users = {
      findById: async () => makeUser(),
      findByEmail: async () => null,
      save: async (u: ReturnType<typeof makeUser>) => {
        saved.push({ displayName: u.displayName });
      },
    };
    const audit = { record: async () => {} };
    const useCase = new UpdateUserUseCase(users as never, audit as never);
    await useCase.execute({
      tenantId: '11111111-1111-1111-1111-111111111111',
      userId: 'u-1',
      displayName: 'Updated Display',
    });
    expect(saved[0]?.displayName).toBe('Updated Display');
  });
});
