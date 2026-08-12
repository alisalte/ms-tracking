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
import type { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import type { PasswordHasher } from '../../infrastructure/services/password-hasher.js';
import type { AuditActor, AuditManager } from '../audit/audit-manager.js';
import { buildEventContext } from '../shared/context.js';

export interface CreateUserInput extends Partial<AuditActor> {
  readonly tenantId: string;
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly displayName?: string;
  readonly correlationId?: string;
  /** The admin creating the user (for audit). Null when seeded by the system. */
  readonly actorId?: string | null;
}

export interface UpdateUserInput extends Partial<AuditActor> {
  readonly tenantId: string;
  readonly userId: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly actorId?: string | null;
}

export interface AssignRoleInput extends Partial<AuditActor> {
  readonly tenantId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly correlationId?: string;
  readonly actorId?: string | null;
}

@Injectable()
export class CreateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly policy: { minLength: number },
    private readonly audit: AuditManager,
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
    await this.audit.record({
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      action: 'iam.user.create',
      resourceType: 'user',
      resourceId: user.id as string,
      permission: 'iam.user.create',
      outcome: 'SUCCESS',
      after: { email: user.email, username: user.username },
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
    return user;
  }
}

@Injectable()
export class UpdateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditManager,
  ) {}

  public async execute(input: UpdateUserInput): Promise<User> {
    const user = await this.users.findById(input.tenantId, input.userId);
    if (!user) throw new NotFoundError('User');
    const before = { email: user.email, display_name: user.displayName };
    if (input.email) {
      const clash = await this.users.findByEmail(input.tenantId, input.email);
      if (clash && (clash.id as string) !== input.userId) throw new EmailAlreadyUsedError();
      user.changeEmail(input.email);
    }
    // display_name is applied when provided (the DTO requires at least one field).
    if (input.displayName !== undefined) {
      user.changeDisplayName(input.displayName ?? null);
    }
    // Re-save: no domain events for a plain profile edit; use an empty context.
    await this.users.save(user, buildEventContext(input.tenantId, 'user'));
    await this.audit.record({
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      action: 'iam.user.update',
      resourceType: 'user',
      resourceId: user.id as string,
      permission: 'iam.user.update',
      outcome: 'SUCCESS',
      before,
      after: { email: user.email, display_name: user.displayName },
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
    return user;
  }
}

@Injectable()
export class AssignRoleUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditManager,
  ) {}

  public async execute(input: AssignRoleInput): Promise<void> {
    const user = await this.users.findById(input.tenantId, input.userId);
    if (!user) throw new NotFoundError('User');
    await this.users.assignRole(input.tenantId, input.userId, input.roleId);
    await this.audit.record({
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      action: 'iam.role.assign',
      resourceType: 'user_role',
      resourceId: input.roleId,
      permission: 'iam.role.assign',
      outcome: 'SUCCESS',
      after: { user_id: input.userId, role_id: input.roleId },
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
  }
}
