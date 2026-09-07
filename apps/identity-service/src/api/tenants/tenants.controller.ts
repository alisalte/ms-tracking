/**
 * Tenants controller — platform SaaS-Ops (list / provision / suspend /
 * reactivate / grant access) plus tenant self-view.
 *
 * Cross-tenant routes require `billing.tenant.manage`. Tenant id in those
 * paths is an operator target, not the caller's JWT tenant (INV-I02 still
 * holds for the caller's own session).
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import {
  ChangeUserStatusUseCase,
  CreateTenantAccessUseCase,
  ProvisionTenantUseCase,
  TenantEntitlementUseCase,
  TenantLifecycleUseCase,
} from '../../application/index.js';
import type { Tenant } from '../../domain/index.js';
import { tenantSettingsPatchSchema } from '../../domain/tenant-settings.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { TenantLicenseRepository } from '../../infrastructure/persistence/tenant-license.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import {
  changeUserStatusSchema,
  createTenantAccessSchema,
  provisionTenantSchema,
  putTenantLicenseSchema,
  putTenantUsageSchema,
} from '../auth/auth.dto.js';
import { RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';

@Controller('api/v1')
export class TenantsController {
  constructor(
    private readonly provisionUseCase: ProvisionTenantUseCase,
    private readonly lifecycle: TenantLifecycleUseCase,
    private readonly createAccess: CreateTenantAccessUseCase,
    private readonly changeStatus: ChangeUserStatusUseCase,
    private readonly entitlements: TenantEntitlementUseCase,
    private readonly licenses: TenantLicenseRepository,
    private readonly tenants: TenantRepository,
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
  ) {}

  /** Provision a new tenant + first admin (platform SaaS-Ops). */
  @Post('tenants')
  @RequirePermissions('billing.tenant.manage')
  public async provision(
    @Body(new ZodValidationPipe(provisionTenantSchema))
    body: import('../auth/auth.dto.js').ProvisionTenantDto,
  ) {
    const result = await this.provisionUseCase.execute({
      name: body.name,
      tier: body.tier,
      region: body.region,
      adminEmail: body.admin_email,
      adminUsername: body.admin_username,
      adminPassword: body.admin_password,
      license: licenseDtoToPatch(body.license),
    });
    return {
      data: {
        tenant_id: result.tenantId,
        admin_user_id: result.adminUserId,
        status: 'ACTIVE',
      },
    };
  }

  /** List every tenant (platform console). */
  @Get('tenants')
  @RequirePermissions('billing.tenant.manage')
  public async list() {
    const rows = await this.tenants.list();
    const snaps = await this.licenses.snapshotsFor(rows.map((r) => r.tenant.id as string));
    return {
      data: rows.map(({ tenant, createdAt }) =>
        this.toView(tenant, createdAt, snaps.get(tenant.id as string) ?? null),
      ),
      meta: { total: rows.length },
    };
  }

  /** Self-view: any authenticated user reads their own tenant. */
  @Get('tenant')
  public async self(@Req() req: Request) {
    const p = getPrincipal(req);
    const tenant = await this.tenants.findById(p.tenantId);
    if (!tenant) return { data: null };
    const license = await this.licenses.snapshot(p.tenantId);
    return { data: this.toView(tenant, undefined, license) };
  }

  @Get('tenant/entitlement')
  public async selfEntitlement(@Req() req: Request) {
    const p = getPrincipal(req);
    const snap = await this.licenses.snapshot(p.tenantId);
    return { data: snap };
  }

  @Get('tenant/settings')
  @RequirePermissions('iam.org.read')
  public async getSettings(@Req() req: Request) {
    const p = getPrincipal(req);
    const settings = await this.tenants.readSettings(p.tenantId);
    if (!settings) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);
    return { data: settings };
  }

  @Put('tenant/settings')
  @RequirePermissions('iam.org.update')
  public async putSettings(
    @Body(new ZodValidationPipe(tenantSettingsPatchSchema))
    body: import('../../domain/tenant-settings.js').TenantSettingsPatch,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const settings = await this.tenants.saveSettings(p.tenantId, body);
    if (!settings) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);
    return { data: settings };
  }

  @Get('tenants/:id/users')
  @RequirePermissions('billing.tenant.manage')
  public async listUsers(@Param('id') id: string) {
    await this.requireTenant(id);
    const { rows, total } = await this.users.list(id, 100, 0);
    const roleNames = await this.roleNameMap(id);
    return {
      data: rows.map((u) => ({
        id: u.id as string,
        tenant_id: u.tenantId,
        email: u.email,
        username: u.username,
        status: u.status,
        display_name: u.displayName,
        roles: u.roles.map((rid) => roleNames.get(rid) ?? rid),
        last_login_at: u.lastLoginAt,
      })),
      meta: { total },
    };
  }

  @Post('tenants/:id/users')
  @RequirePermissions('billing.tenant.manage')
  public async createUser(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createTenantAccessSchema))
    body: import('../auth/auth.dto.js').CreateTenantAccessDto,
  ) {
    const user = await this.createAccess.execute({
      tenantId: id,
      email: body.email,
      username: body.username,
      password: body.password,
      displayName: body.display_name,
      roleName: body.role_name,
    });
    return {
      data: {
        id: user.id as string,
        tenant_id: user.tenantId,
        email: user.email,
        username: user.username,
        status: user.status,
        display_name: user.displayName,
        role_name: body.role_name,
      },
    };
  }

  @Get('tenants/:id/roles')
  @RequirePermissions('billing.tenant.manage')
  public async listRoles(@Param('id') id: string) {
    await this.requireTenant(id);
    const roles = await this.roles.list(id);
    return {
      data: roles.map((r) => ({
        id: r.id as string,
        name: r.name,
        is_system: r.isSystem,
      })),
    };
  }

  @Patch('tenants/:id/users/:userId/status')
  @RequirePermissions('billing.tenant.manage')
  public async changeUserStatus(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(changeUserStatusSchema))
    body: { status: 'active' | 'suspended' | 'deactivated'; reason?: string },
  ) {
    const user = await this.changeStatus.execute({
      tenantId: id,
      userId,
      status: body.status,
      reason: body.reason,
    });
    return {
      data: {
        id: user.id as string,
        status: user.status,
      },
    };
  }

  @Post('tenants/:id/suspend')
  @RequirePermissions('billing.tenant.manage')
  public async suspend(@Param('id') id: string) {
    const tenant = await this.lifecycle.suspend(id);
    return { data: await this.viewOf(tenant) };
  }

  @Post('tenants/:id/reactivate')
  @RequirePermissions('billing.tenant.manage')
  public async reactivate(@Param('id') id: string) {
    const tenant = await this.lifecycle.reactivate(id);
    return { data: await this.viewOf(tenant) };
  }

  @Get('tenants/:id')
  @RequirePermissions('billing.tenant.manage')
  public async get(@Param('id') id: string) {
    const tenant = await this.requireTenant(id);
    return { data: await this.viewOf(tenant) };
  }

  @Put('tenants/:id/license')
  @RequirePermissions('billing.tenant.manage')
  public async putLicense(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(putTenantLicenseSchema))
    body: import('../auth/auth.dto.js').PutTenantLicenseDto,
  ) {
    await this.requireTenant(id);
    await this.entitlements.update(id, licenseDtoToPatch(body) ?? {});
    const tenant = await this.requireTenant(id);
    return { data: await this.viewOf(tenant) };
  }

  @Post('tenants/:id/usage')
  @RequirePermissions('billing.tenant.manage')
  public async putUsage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(putTenantUsageSchema))
    body: import('../auth/auth.dto.js').PutTenantUsageDto,
  ) {
    await this.requireTenant(id);
    await this.entitlements.setUsage(id, {
      storageBytes: body.storage_bytes,
      downloadBytesMonth: body.download_bytes_month,
    });
    const tenant = await this.requireTenant(id);
    return { data: await this.viewOf(tenant) };
  }

  private async requireTenant(id: string): Promise<Tenant> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);
    return tenant;
  }

  private async roleNameMap(tenantId: string): Promise<Map<string, string>> {
    const roles = await this.roles.list(tenantId);
    return new Map(roles.map((r) => [r.id as string, r.name]));
  }

  private async viewOf(tenant: Tenant, createdAt?: Date) {
    const license = await this.licenses.snapshot(tenant.id as string);
    return this.toView(tenant, createdAt, license);
  }

  private toView(
    tenant: Tenant,
    createdAt?: Date,
    license?:
      | import('../../infrastructure/persistence/tenant-license.repository.js').LicenseSnapshot
      | null,
  ) {
    return {
      id: tenant.id as string,
      name: tenant.name,
      tier: tenant.tier,
      region: tenant.region,
      status: tenant.status,
      ...(createdAt ? { created_at: createdAt.toISOString() } : {}),
      license: license ?? null,
    };
  }
}

function parseInstant(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = value.length <= 10 ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function licenseDtoToPatch(
  dto: import('../auth/auth.dto.js').TenantLicenseFieldsDto | undefined,
): import('../../application/tenants/tenant-entitlement.use-case.js').LicensePatch | undefined {
  if (!dto) return undefined;
  return {
    planCode: dto.plan_code,
    startsAt: parseInstant(dto.starts_at),
    expiresAt: parseInstant(dto.expires_at),
    graceDays: dto.grace_days,
    maxUsers: dto.max_users,
    maxVehicles: dto.max_vehicles,
    maxDevices: dto.max_devices,
    maxDrivers: dto.max_drivers,
    maxStorageBytes: dto.max_storage_bytes,
    maxDownloadBytesMonth: dto.max_download_bytes_month,
    maxConcurrentSessions: dto.max_concurrent_sessions,
    sessionIdleMinutes: dto.session_idle_minutes,
    sessionAbsoluteHours: dto.session_absolute_hours,
    loginHoursStart: dto.login_hours_start,
    loginHoursEnd: dto.login_hours_end,
    timezone: dto.timezone,
    notes: dto.notes,
    features: dto.features,
    currency: dto.currency,
    basePrice: dto.base_price,
    unitPriceUsers: dto.unit_price_users,
    unitPriceVehicles: dto.unit_price_vehicles,
    unitPriceDevices: dto.unit_price_devices,
    unitPriceDrivers: dto.unit_price_drivers,
    unitPriceStorageGib: dto.unit_price_storage_gib,
    unitPriceDownloadGib: dto.unit_price_download_gib,
  };
}
