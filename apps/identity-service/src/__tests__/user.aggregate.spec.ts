import { describe, expect, it } from '@jest/globals';
import { IllegalStatusTransitionError } from '../domain/errors.js';
import type { EventContext } from '../domain/events.js';
import { User } from '../domain/user.js';

const ctx: EventContext = { tenantId: 'tenant-1', correlationId: 'corr-1', aggregateType: 'user' };

describe('User aggregate', () => {
  function makeUser(overrides: Partial<Parameters<typeof User.create>[1]> = {}): User {
    return User.create(
      'user-1',
      {
        tenantId: 'tenant-1',
        email: 'alice@example.com',
        username: 'alice',
        passwordHash: 'hashed',
        displayName: 'Alice',
        authProvider: 'LOCAL',
        ...overrides,
      },
      ctx,
    );
  }

  it('creates a user and raises UserCreatedEvent', () => {
    const user = makeUser();
    expect(user.email).toBe('alice@example.com');
    expect(user.status).toBe('ACTIVE');
    const events = user.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('iam.user.created.v1');
  });

  it('rejects a LOCAL user without a password hash (INV-IAM-04)', () => {
    expect(() =>
      User.create(
        'user-2',
        {
          tenantId: 'tenant-1',
          email: 'sso@example.com',
          username: 'sso-user',
          passwordHash: null,
          displayName: null,
          authProvider: 'LOCAL',
        },
        ctx,
      ),
    ).toThrow(IllegalStatusTransitionError);
  });

  it('locks the account after failed logins (INV-IAM-05)', () => {
    const user = makeUser();
    let result = { locked: false };
    for (let i = 0; i < 5; i++) {
      result = user.recordFailedLogin(5, ctx);
    }
    expect(result.locked).toBe(true);
    expect(user.status).toBe('LOCKED');
    expect(user.isLocked()).toBe(true);
  });

  it('unlocks a locked account back to ACTIVE', () => {
    const user = makeUser();
    for (let i = 0; i < 5; i++) user.recordFailedLogin(5, ctx);
    user.unlock(ctx);
    expect(user.status).toBe('ACTIVE');
    expect(user.failedLoginAttempts).toBe(0);
  });

  it('rejects illegal status transitions (ACTIVE → DEACTIVATED direct)', () => {
    const user = makeUser();
    expect(() => user.deactivate(ctx)).not.toThrow(); // ACTIVE → DEACTIVATED is allowed
  });

  it('records a successful login and resets counters', () => {
    const user = makeUser();
    user.recordFailedLogin(5, ctx);
    user.recordSuccessfulLogin('session-1', '1.2.3.4', ctx);
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockoutUntil).toBeNull();
    expect(user.lastLoginAt).not.toBeNull();
  });

  it('assigns and revokes roles idempotently', () => {
    const user = makeUser();
    user.assignRole('role-1', null, ctx);
    user.assignRole('role-1', null, ctx); // idempotent
    expect(user.roles).toEqual(['role-1']);
    user.revokeRole('role-1', ctx);
    expect(user.roles).toEqual([]);
  });
});
