import { describe, expect, it, jest } from '@jest/globals';
import { createUserSchema, loginSchema } from '../api/auth/auth.dto.js';
import { LoginUseCase } from '../application/auth/login.use-case.js';
import { normalizeEmail } from '../domain/email.js';
import { InvalidCredentialsError } from '../domain/errors.js';
import type { UserRepository } from '../infrastructure/persistence/user.repository.js';

describe('login identifier', () => {
  it('normalizes a mailbox', () => {
    expect(normalizeEmail('  Ali@Example.com ')).toBe('ali@example.com');
  });

  it('accepts a username and lowercases an email', () => {
    expect(loginSchema.parse({ email: '  Operator.One  ', password: 'x' }).email).toBe(
      'operator.one',
    );
    expect(loginSchema.parse({ email: 'Ali@Example.com', password: 'x' }).email).toBe(
      'ali@example.com',
    );
    expect(
      createUserSchema.parse({
        email: 'Ali@Example.com',
        username: 'operator.one',
        password: 'StrongPass123!',
      }).email,
    ).toBe('ali@example.com');
  });

  it('looks up an email inside the tenant, then the username', async () => {
    const findByEmail = jest.fn(async () => null);
    const findByUsernameInTenant = jest.fn(async () => null);
    const users = { findByEmail, findByUsernameInTenant } as unknown as UserRepository;
    const login = new LoginUseCase(
      users,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        accessTtlSeconds: 60,
        refreshTtlSeconds: 60,
        maxAttempts: 5,
        lockoutSeconds: 60,
        rateLimitPerIp: 10,
        rateLimitPerUser: 5,
      },
    );

    await expect(
      login.execute({
        email: 'Ali@Example.com',
        password: 'secret',
        tenantId: 'tenant-1',
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(findByEmail).toHaveBeenCalledWith('tenant-1', 'Ali@Example.com');
    expect(findByUsernameInTenant).toHaveBeenCalledWith('tenant-1', 'Ali@Example.com');
  });

  it('looks up a username without treating it as an email', async () => {
    const findByEmail = jest.fn(async () => null);
    const findByUsernameInTenant = jest.fn(async () => null);
    const users = { findByEmail, findByUsernameInTenant } as unknown as UserRepository;
    const login = new LoginUseCase(
      users,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        accessTtlSeconds: 60,
        refreshTtlSeconds: 60,
        maxAttempts: 5,
        lockoutSeconds: 60,
        rateLimitPerIp: 10,
        rateLimitPerUser: 5,
      },
    );

    await expect(
      login.execute({
        email: 'operator.one',
        password: 'secret',
        tenantId: 'tenant-1',
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(findByEmail).not.toHaveBeenCalled();
    expect(findByUsernameInTenant).toHaveBeenCalledWith('tenant-1', 'operator.one');
  });

  it('resolves a username platform-wide when no organization is supplied', async () => {
    const findByEmail = jest.fn(async () => null);
    const findByUsernameInTenant = jest.fn(async () => null);
    const findUniqueByEmail = jest.fn(async () => null);
    const findUniqueByUsername = jest.fn(async () => null);
    const users = {
      findByEmail,
      findByUsernameInTenant,
      findUniqueByEmail,
      findUniqueByUsername,
    } as unknown as UserRepository;
    const login = new LoginUseCase(
      users,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        accessTtlSeconds: 60,
        refreshTtlSeconds: 60,
        maxAttempts: 5,
        lockoutSeconds: 60,
        rateLimitPerIp: 10,
        rateLimitPerUser: 5,
      },
    );

    await expect(
      login.execute({
        email: 'operator.one',
        password: 'secret',
        tenantId: null,
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(findByEmail).not.toHaveBeenCalled();
    expect(findByUsernameInTenant).not.toHaveBeenCalled();
    expect(findUniqueByUsername).toHaveBeenCalledWith('operator.one');
    expect(findUniqueByEmail).not.toHaveBeenCalled();
  });

  it('resolves an email platform-wide when no organization is supplied', async () => {
    const findUniqueByEmail = jest.fn(async () => null);
    const findUniqueByUsername = jest.fn(async () => null);
    const users = { findUniqueByEmail, findUniqueByUsername } as unknown as UserRepository;
    const login = new LoginUseCase(
      users,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        accessTtlSeconds: 60,
        refreshTtlSeconds: 60,
        maxAttempts: 5,
        lockoutSeconds: 60,
        rateLimitPerIp: 10,
        rateLimitPerUser: 5,
      },
    );

    await expect(
      login.execute({
        email: 'ali@example.com',
        password: 'secret',
        tenantId: null,
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(findUniqueByEmail).toHaveBeenCalledWith('ali@example.com');
    expect(findUniqueByUsername).not.toHaveBeenCalled();
  });
});
