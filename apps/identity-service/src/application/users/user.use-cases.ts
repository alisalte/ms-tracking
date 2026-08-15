/**
 * User-management use-cases (admin operations). All run within the caller's
 * tenant (INV-I02); tenant_id is sourced from the principal, never the body.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  EmailAlreadyUsedError,
  NotFoundError,
  type User,
  UsernameTakenError,
} from '../../domain/index.js';
import { User as UserClass } from '../../domain/index.js';
import { assertPasswordPolicy } from '../../domain/password-policy.js';
import type { RevocationStore } from '../../infrastructure/cache/session-store.js';
import type { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import type { PasswordHasher } from '../../infrastructure/services/password-hasher.js';
import { buildEventContext } from '../shared/context.js';

export interface CreateUserInput {
  readonly tenantId: string;
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly displayName?: string;
  readonly correlationId?: string;
}

export interface UpdateUserInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly email?: string;
  readonly displayName?: string;
}

export interface AssignRoleInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly correlationId?: string;
}

@Injectable()
export class CreateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly policy: { minLength: number },
  ) {}

  public async execute(input: CreateUserInput): Promise<User> {
    assertPasswordPolicy(input.password, this.policy);

    // INV-IAM-01 (email unique per tenant) + INV-IAM-02 (username unique platform).
    const existingEmail = await this.users.findByEmail(input.tenantId, input.email);
    if (existingEmail) throw new EmailAlreadyUsedError();
    const existingUsername = await this.users.findByUsername(input.username);
    if (existingUsername) throw new UsernameTakenError();

    const hash = await this.hasher.hash(input.password);
    const ctx = buildEventContext(input.tenantId, 'user', input.correlationId);
    const user = UserClass.create(
      randomUUID(),
      {
        tenantId: input.tenantId,
        email: input.email,
        username: input.username,
        passwordHash: hash,
        displayName: input.displayName ?? null,
        authProvider: 'LOCAL',
      },
      ctx,
    );
    await this.users.save(user, ctx);
    return user;
  }
}

@Injectable()
export class UpdateUserUseCase {
  constructor(private readonly users: UserRepository) {}

  public async execute(input: UpdateUserInput): Promise<User> {
    const user = await this.users.findById(input.tenantId, input.userId);
    if (!user) throw new NotFoundError('User');
    if (input.email) {
      const clash = await this.users.findByEmail(input.tenantId, input.email);
      if (clash && (clash.id as string) !== input.userId) throw new EmailAlreadyUsedError();
      user.changeEmail(input.email);
    }
    // Re-save: no domain events for a plain profile edit; use an empty context.
    await this.users.save(user, buildEventContext(input.tenantId, 'user'));
    return user;
  }
}

/**
 * Assign-role use-case. After a role grant the user's permission set changes,
 * so any outstanding access token (which carries the previous permission union,
 * Sprint B) must be invalidated: setting `revocation:user:<uid>` kills the
 * user's tokens within the access-token TTL — the client then refreshes and
 * obtains a token with the new permissions.
 */
@Injectable()
export class AssignRoleUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly revocation: RevocationStore,
    private readonly config: { accessTtlSeconds: number },
  ) {}

  public async execute(input: AssignRoleInput): Promise<void> {
    const user = await this.users.findById(input.tenantId, input.userId);
    if (!user) throw new NotFoundError('User');
    await this.users.assignRole(input.tenantId, input.userId, input.roleId);
    await this.revocation.revokeUser(input.userId, this.config.accessTtlSeconds);
  }
}
