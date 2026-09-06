/**
 * Platform: create a user inside an existing tenant and bind a system role
 * (tenant-admin / fleet-admin / viewer) — the "grant access" step of onboarding.
 */
import { Injectable } from '@nestjs/common';
import { NotFoundError, type User } from '../../domain/index.js';
import type { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
import type { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
import type { AssignRoleUseCase, CreateUserUseCase } from '../users/user.use-cases.js';

export type SystemRoleName = 'tenant-admin' | 'fleet-admin' | 'viewer';

export interface CreateTenantAccessInput {
  readonly tenantId: string;
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly displayName?: string;
  readonly roleName: SystemRoleName;
  readonly correlationId?: string;
}

@Injectable()
export class CreateTenantAccessUseCase {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly roles: RoleRepository,
    private readonly createUser: CreateUserUseCase,
    private readonly assignRole: AssignRoleUseCase,
  ) {}

  public async execute(input: CreateTenantAccessInput): Promise<User> {
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const role = await this.roles.findByName(input.tenantId, input.roleName);
    if (!role) throw new NotFoundError('Role');

    const user = await this.createUser.execute({
      tenantId: input.tenantId,
      email: input.email,
      username: input.username,
      password: input.password,
      displayName: input.displayName,
      correlationId: input.correlationId,
    });

    await this.assignRole.execute({
      tenantId: input.tenantId,
      userId: user.id as string,
      roleId: role.id as string,
      correlationId: input.correlationId,
    });

    return user;
  }
}
