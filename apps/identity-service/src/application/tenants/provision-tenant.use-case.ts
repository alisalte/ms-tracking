/**
 * Tenant provisioning use-case — creates a tenant, seeds its system roles
 * (tenant-admin, fleet-admin, viewer), and provisions the first admin user.
 *
 * Runs WITHOUT tenant scope (the tenant does not exist yet) — a platform
 * operation. The tenant starts PROVISIONING and is immediately activated in
 * the MVP (the multi-service ack saga is deferred).
 *
 * This same path powers the bootstrap seed at startup (SEED_* env).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  Role,
  SYSTEM_ROLES,
  Tenant as TenantClass,
  type TenantTier,
  User as UserClass,
} from '../../domain/index.js';
import type { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
import type { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
import type { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import type { PasswordHasher } from '../../infrastructure/services/password-hasher.js';
import type { AuditActor, AuditManager } from '../audit/audit-manager.js';
import { buildEventContext } from '../shared/context.js';

export interface ProvisionTenantInput extends Partial<AuditActor> {
  readonly name: string;
  readonly tier: TenantTier;
  readonly region: string;
  readonly adminEmail: string;
  readonly adminUsername: string;
  readonly adminPassword: string;
  readonly correlationId?: string;
  readonly actorId?: string | null;
}

export interface ProvisionedTenant {
  readonly tenantId: string;
  readonly adminUserId: string;
  readonly adminRoleId: string;
}

@Injectable()
export class ProvisionTenantUseCase {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditManager,
  ) {}

  public async execute(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
    const tenantId = randomUUID();
    const tenantCtx = buildEventContext(tenantId, 'tenant', input.correlationId);
    const tenant = TenantClass.provision(
      tenantId,
      { name: input.name, tier: input.tier, region: input.region },
      tenantCtx,
    );
    tenant.activate(tenantCtx);
    await this.tenants.save(tenant, tenantCtx);

    // Seed system roles; remember the tenant-admin role id for the admin user.
    let adminRoleId = '';
    for (const seed of SYSTEM_ROLES) {
      const roleId = randomUUID();
      if (seed.name === 'tenant-admin') adminRoleId = roleId;
      const role = Role.seedSystem(roleId, {
        tenantId,
        name: seed.name,
        permissions: seed.permissions,
      });
      await this.roles.save(role);
    }

    // Create the admin user and bind the tenant-admin role.
    const hash = await this.hasher.hash(input.adminPassword);
    const adminUserId = randomUUID();
    const userCtx = buildEventContext(tenantId, 'user', input.correlationId);
    const admin = UserClass.create(
      adminUserId,
      {
        tenantId,
        email: input.adminEmail,
        username: input.adminUsername,
        passwordHash: hash,
        displayName: 'Tenant Admin',
        authProvider: 'LOCAL',
      },
      userCtx,
    );
    await this.users.save(admin, userCtx);
    await this.users.assignRole(tenantId, adminUserId, adminRoleId);

    // Platform-scoped audit: provisioning is a cross-tenant operation.
    await this.audit.record({
      tenantId,
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      action: 'billing.tenant.provision',
      resourceType: 'tenant',
      resourceId: tenantId,
      permission: 'billing.tenant.manage',
      outcome: 'SUCCESS',
      after: {
        name: input.name,
        tier: input.tier,
        region: input.region,
        admin_user_id: adminUserId,
      },
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      platform: true,
    });

    return { tenantId, adminUserId, adminRoleId };
  }
}
